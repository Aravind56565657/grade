import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { collection, query, where, serverTimestamp, doc, updateDoc, onSnapshot, addDoc, getDocs, writeBatch } from 'firebase/firestore';
import { auth, db, handleFirestoreError } from '../../services/firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import { ArrowLeft, Loader2, Zap, Save, CheckCircle, AlertCircle, RefreshCw, Send, Eye, FileText } from 'lucide-react';
import { Exam, Script, Segment, OperationType } from '../../types';
import { ocrAndSegment, evaluateAnswer } from '../../services/gemini';
import { motion, AnimatePresence } from 'motion/react';

export default function GradingView() {
  const { examId, scriptId } = useParams();
  const [user] = useAuthState(auth);
  
  const [exam, setExam] = useState<Exam | null>(null);
  const [script, setScript] = useState<Script | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState('');
  const [viewImages, setViewImages] = useState(false);

  const cleanId = (id: string) => {
    return id.trim().toLowerCase()
      .replace(/^(q|question|item|part|unit)\.?\s*/i, '') // Remove prefixes
      .replace(/[()\[\]{}]/g, '.')                       // Normalize all brackets to dots
      .replace(/[-_]/g, '.')                            // Normalize separators to dots
      .replace(/[\.\s:]+$/, '')                         // Remove trailing punctuation
      .replace(/^\.+/, '')                              // Remove leading punctuation
      .replace(/\.+/g, '.')                            // Collapse multiple dots
      .trim();
  };

  const getMatchingRubrics = (id: string, allItems: any[]) => {
    const sClean = cleanId(id);
    if (!sClean) return [];

    const matches = allItems.filter(r => {
      const rClean = cleanId(r.questionNumber);
      
      // 1. Exact match (highly prioritized)
      if (rClean === sClean) return true;
      
      // 2. Hierarchical match (e.g., segment "1" should match rubric "1.i", "1.a")
      // We check if rClean starts with sClean followed by a dot
      if (rClean.startsWith(sClean + '.')) return true;

      // 3. Parent match (e.g., segment "1.i" should match rubric "1" if no specific 1.i exists)
      if (sClean.startsWith(rClean + '.')) return true;
      
      return false;
    });

    // Resolve overlaps:
    // If there is an exact match, use ONLY the exact match(es)
    const exactMatches = matches.filter(r => cleanId(r.questionNumber) === sClean);
    if (exactMatches.length > 0) return exactMatches;

    // Otherwise, if we matched a parent/children, return those
    return matches;
  };

  const calculateScores = () => {
    if (!exam?.rubric) return { current: 0, max: 0, breakdown: [] };

    const { items = [], sections = [] } = exam.rubric;
    
    // helper to check if a question is the same as or a child of another
    const isMatchHierarchy = (child: string, parent: string) => {
      const c = cleanId(child);
      const p = cleanId(parent);
      if (!c || !p) return false;
      return c === p || c.startsWith(p + '.');
    };

    // 1. Map question segments to their current scores (clamped by their matched rubrics)
    const segmentScores: Record<string, number> = {};
    segments.forEach(seg => {
      const rawScore = seg.humanResult?.score ?? seg.aiResult?.score ?? 0;
      const matchingRubrics = getMatchingRubrics(seg.questionNumber, items);
      
      // If we have an exact match for this segment name, use its max score as the limit
      const sClean = cleanId(seg.questionNumber);
      const exactMatch = matchingRubrics.find(r => cleanId(r.questionNumber) === sClean);
      const maxPossible = exactMatch ? exactMatch.maxScore : (matchingRubrics.reduce((sum, r) => sum + r.maxScore, 0) || 100);
      
      segmentScores[seg.id] = Math.min(rawScore, maxPossible);
    });

    let totalCurrent = 0;
    let totalMax = 0;
    const handledRubricIndices = new Set<number>();
    const handledSegmentIds = new Set<string>();

    const breakdown = (sections || []).map(section => {
      // Find all segments and rubric items belonging to each question number root in this section
      const questionTotals = section.questionNumbers.map(qNum => {
        let qScore = 0;
        let qMax = 0;

        // Sum all segments that belong to this qNum (e.g. 1.i, 1.ii match 1)
        segments.forEach(seg => {
          if (isMatchHierarchy(seg.questionNumber, qNum)) {
            qScore += segmentScores[seg.id] || 0;
            handledSegmentIds.add(seg.id);
          }
        });

        // Sum rubric items that belong to this qNum
        items.forEach((item, idx) => {
          if (isMatchHierarchy(item.questionNumber, qNum)) {
            qMax += item.maxScore;
            handledRubricIndices.add(idx);
          }
        });

        return { score: qScore, max: qMax };
      });

      // Best-of logic (if applicable, otherwise questionsToAttempt matches questionNumbers.length)
      const sortedScores = questionTotals.map(qt => qt.score).sort((a, b) => b - a);
      const sectionPoints = sortedScores.slice(0, section.questionsToAttempt).reduce((sum, s) => sum + s, 0);
      
      const sortedMaxes = questionTotals.map(qt => qt.max).sort((a, b) => b - a);
      const sectionMax = sortedMaxes.slice(0, section.questionsToAttempt).reduce((sum, s) => sum + s, 0);

      totalCurrent += sectionPoints;
      totalMax += sectionMax;

      return {
        title: section.title,
        score: sectionPoints,
        max: sectionMax,
        attempted: questionTotals.filter(qt => qt.score > 0).length, // simple metric for UI
        required: section.questionsToAttempt
      };
    });

    // Add everything else NOT in a section
    segments.forEach(seg => {
      if (!handledSegmentIds.has(seg.id)) {
        totalCurrent += segmentScores[seg.id] || 0;
        handledSegmentIds.add(seg.id);
      }
    });

    items.forEach((item, idx) => {
      if (!handledRubricIndices.has(idx)) {
        totalMax += item.maxScore;
        handledRubricIndices.add(idx);
      }
    });

    return { current: totalCurrent, max: totalMax, breakdown };
  };

  const { current, max, breakdown } = calculateScores();

  // Real-time listeners
  useEffect(() => {
    if (!examId || !scriptId || !user) return;

    const unsubExam = onSnapshot(doc(db, 'exams', examId), (doc) => setExam({ id: doc.id, ...doc.data() } as Exam));
    const unsubScript = onSnapshot(doc(db, 'exams', examId, 'scripts', scriptId), (doc) => setScript({ id: doc.id, ...doc.data() } as Script));
    const unsubSegments = onSnapshot(query(
      collection(db, 'exams', examId, 'scripts', scriptId, 'segments'),
      where('creatorId', '==', user.uid)
    ), (snapshot) => {
      setSegments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Segment)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, `exams/${examId}/scripts/${scriptId}/segments`));

    return () => {
      unsubExam();
      unsubScript();
      unsubSegments();
    };
  }, [examId, scriptId]);

  const runOCR = async () => {
    if (!script?.imageUrls?.length || isProcessing) return;
    
    setIsProcessing(true);
    setProcessStatus('RUNNING AI VISION ENGINE (OCR)...');
    
    try {
      // 1. Mark script as processing
      try {
        await updateDoc(doc(db, 'exams', examId!, 'scripts', scriptId!), { 
          status: 'processing',
          updatedAt: serverTimestamp()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `exams/${examId}/scripts/${scriptId}`);
      }

      // 2. Call Gemini for OCR & Segmentation
      const extracted = await ocrAndSegment(script.imageUrls);
      
      // 3. Batch write segments to Firestore
      const batch = writeBatch(db);
      extracted.forEach((item: any) => {
        const segRef = doc(collection(db, 'exams', examId!, 'scripts', scriptId!, 'segments'));
        batch.set(segRef, {
          examId,
          scriptId,
          creatorId: user?.uid,
          questionNumber: item.questionNumber,
          questionText: item.questionText || '',
          studentAnswer: item.studentAnswer,
          isHandwritten: item.isHandwritten,
          status: 'pending',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });
      try {
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `exams/${examId}/scripts/${scriptId}/segments`);
      }

      setProcessStatus('SEGMENTATION COMPLETE. READY FOR EVALUATION.');
    } catch (err: any) {
      console.error(err);
      setProcessStatus(err.message || 'ERROR DURING OCR. PLEASE TRY AGAIN.');
    } finally {
      setIsProcessing(false);
    }
  };

  const runEvaluation = async (segmentId?: string) => {
    setIsProcessing(true);
    setProcessStatus('AI HYBRID EVALUATION IN PROGRESS...');
    
    try {
      const targets = segmentId 
        ? segments.filter(s => s.id === segmentId) 
        : segments.filter(s => !s.aiResult);

      const examRubric = exam?.rubric?.items || [];

      for (const seg of targets) {
        setProcessStatus(`EVALUATING Q${seg.questionNumber}...`);
        
        const matchingRubrics = getMatchingRubrics(seg.questionNumber, examRubric);
        matchingRubrics.sort((a,b) => a.questionNumber.localeCompare(b.questionNumber, undefined, { numeric: true, sensitivity: 'base' }));

        const rubricArg = matchingRubrics.length > 0 ? (matchingRubrics.length === 1 ? matchingRubrics[0] : matchingRubrics) : undefined;

        const result = await evaluateAnswer(
          seg.questionText || `Question ${seg.questionNumber}`, 
          matchingRubrics[0]?.exemplaryResponse || "", 
          seg.studentAnswer,
          rubricArg
        );
        
        try {
          await updateDoc(doc(db, 'exams', examId!, 'scripts', scriptId!, 'segments', seg.id), {
            aiResult: result,
            updatedAt: serverTimestamp()
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `exams/${examId}/scripts/${scriptId}/segments/${seg.id}`);
        }
      }
      
      setProcessStatus('AI EVALUATION COMPLETE.');
    } catch (err: any) {
      console.error(err);
      setProcessStatus(err.message || 'ERROR DURING EVALUATION.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleManualReview = async (segId: string, score: number, feedback: string) => {
    try {
      await updateDoc(doc(db, 'exams', examId!, 'scripts', scriptId!, 'segments', segId), {
        humanResult: { score, feedback },
        status: 'reviewed',
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `segments/${segId}`);
    }
  };

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-bg-main">
      {/* Sidebar - Control Panel */}
      <div className="w-80 border-r border-slate-200 bg-white p-8 flex flex-col gap-10 overflow-y-auto">
        <Link to={`/exam/${examId}`} className="inline-flex items-center gap-2 text-slate-400 hover:text-indigo-600 transition-colors font-mono text-[10px] uppercase tracking-widest group">
          <ArrowLeft className="h-3 w-3 group-hover:-translate-x-1 transition-transform" />
          Batch Overview
        </Link>

        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Final Evaluation</p>
          <div className="bg-indigo-900 rounded-2xl p-6 text-white shadow-xl shadow-indigo-100/50">
             <div className="flex justify-between items-end mb-2">
               <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest">Total Grade</span>
               <span className="text-[10px] font-mono text-indigo-400">{((current / (max || 1)) * 100).toFixed(0)}%</span>
             </div>
             <div className="text-4xl font-bold tracking-tighter flex items-baseline">
                {current}
                <span className="text-xl text-indigo-400 font-medium ml-1">/{max}</span>
             </div>
             
             {breakdown.length > 0 && (
               <div className="mt-6 space-y-3 pt-4 border-t border-indigo-800">
                  {breakdown.map((b, i) => (
                    <div key={i} className="flex justify-between items-center text-[10px]">
                       <div className="space-y-0.5">
                         <div className="font-bold text-indigo-200 uppercase truncate max-w-[120px]">{b.title}</div>
                         <div className="text-[8px] text-indigo-400">Attempts: {b.attempted}/{b.required} (Take best {b.required})</div>
                       </div>
                       <div className="font-bold font-mono text-indigo-100">{b.score}/{b.max}</div>
                    </div>
                  ))}
               </div>
             )}
          </div>
        </div>

        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Evaluating Script</p>
          <div className="text-2xl font-bold tracking-tight text-slate-900 leading-tight mb-1">{script?.studentName}</div>
          <div className="text-sm text-slate-500 font-medium">Batch: {exam?.title}</div>
        </div>

        <div className="space-y-4">
          <button 
            onClick={runOCR}
            disabled={isProcessing || (segments.length > 0 && script?.status !== 'pending')}
            className={`w-full p-4 border border-slate-200 rounded-xl font-bold flex items-center justify-between group transition-all text-sm ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}`}
          >
            <span className="tracking-tight uppercase text-slate-600">Scan Layer Refine</span>
            <RefreshCw className={`h-4 w-4 text-slate-400 ${isProcessing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform'}`} />
          </button>

          <button 
            onClick={() => runEvaluation()}
            disabled={isProcessing || segments.length === 0}
            className={`w-full p-4 bg-indigo-600 text-white rounded-xl font-bold flex items-center justify-between group transition-all shadow-lg shadow-indigo-100 ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'hover:bg-indigo-700'}`}
          >
            <span className="tracking-tight uppercase text-sm">AI Hybrid Grader</span>
            <Zap className={`h-4 w-4 ${isProcessing ? 'animate-pulse' : 'fill-white'}`} />
          </button>
          
          <button 
            onClick={() => setViewImages(!viewImages)}
            className="w-full p-4 bg-white border border-slate-200 rounded-xl font-semibold flex items-center justify-between hover:bg-slate-50 text-slate-500 text-sm italic"
          >
            <span>{viewImages ? 'Hide' : 'Inspect'} Source Sheets</span>
            <Eye className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-auto border-t border-slate-100 pt-8">
          <div className="grid grid-cols-2 gap-3 mb-6">
             <div className="p-3 bg-green-50 border border-green-100 rounded-xl">
               <p className="text-[8px] text-green-600 font-bold uppercase tracking-widest">Confidence</p>
               <p className="text-lg font-bold text-green-700">82%</p>
             </div>
             <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl">
               <p className="text-[8px] text-blue-600 font-bold uppercase tracking-widest">Verified</p>
               <p className="text-lg font-bold text-blue-700">{segments.filter(s => s.status === 'reviewed').length}</p>
             </div>
          </div>
          
          <footer className="flex items-center justify-between text-[8px] font-mono text-slate-300 uppercase tracking-widest">
            <span>System Nominal</span>
            <span>v1.0</span>
          </footer>
        </div>
      </div>

      {/* Main Content - Segment List */}
      <div className="flex-1 overflow-y-auto bg-[#F5F7FA] p-12">
        {segments.length === 0 && !isProcessing ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto">
            <div className="mb-8 p-10 bg-white rounded-3xl shadow-sm border border-slate-100">
              <FileText className="h-12 w-12 text-slate-200" />
            </div>
            <h3 className="text-xl font-bold tracking-tight text-slate-900 mb-2">Waiting for Ingestion</h3>
            <p className="text-slate-400 text-sm mb-10 leading-relaxed uppercase tracking-wider font-bold">The evaluation pipeline has not been initialized for this script.</p>
            <button 
              onClick={runOCR}
              className="bg-indigo-600 text-white px-10 py-4 rounded-xl font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all text-sm uppercase tracking-widest"
            >
              Initialize OCR
            </button>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-10">
            <AnimatePresence>
              {isProcessing && (
                <motion.div 
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="bg-white border-l-4 border-indigo-600 shadow-sm p-5 flex items-center gap-4 rounded-r-xl"
                >
                  <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
                  <span className="font-mono text-[10px] tracking-widest text-slate-500 font-bold uppercase">{processStatus}</span>
                </motion.div>
              )}
            </AnimatePresence>
            
            {viewImages && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                <h4 className="text-[10px] font-bold uppercase text-slate-400 mb-6 tracking-widest">Captured Layouts</h4>
                <div className="flex gap-6 overflow-x-auto pb-4 custom-scrollbar">
                  {script?.imageUrls?.map((url, i) => (
                    <img key={i} src={url} alt={`Scan ${i}`} className="h-[500px] w-auto rounded-lg shadow-xl border border-slate-100" />
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-6">
              {segments.sort((a,b) => a.questionNumber.localeCompare(b.questionNumber, undefined, { numeric: true })).map((seg, idx) => {
                const matchingRubrics = getMatchingRubrics(seg.questionNumber, exam?.rubric?.items || [])
                  .sort((a,b) => a.questionNumber.localeCompare(b.questionNumber, undefined, { numeric: true }));

                return (
                  <SegmentRow 
                    key={seg.id} 
                    segment={seg} 
                    rubricItems={matchingRubrics}
                    onEvaluate={() => runEvaluation(seg.id)}
                    onReview={handleManualReview}
                    idx={idx}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SegmentRow({ segment, rubricItems = [], onEvaluate, onReview, idx }: any) {
  const [localScore, setLocalScore] = useState(segment.humanResult?.score ?? segment.aiResult?.score ?? 0);
  const [localFeedback, setLocalFeedback] = useState(segment.humanResult?.feedback ?? segment.aiResult?.feedback ?? "");
  const [isEditing, setIsEditing] = useState(false);
  const [showRubric, setShowRubric] = useState(false);

  const totalMaxScore = rubricItems.reduce((acc: number, r: any) => acc + (r.maxScore || 0), 0);
  const hasRubric = rubricItems.length > 0;

  useEffect(() => {
    if (!isEditing) {
      setLocalScore(segment.humanResult?.score ?? segment.aiResult?.score ?? 0);
      setLocalFeedback(segment.humanResult?.feedback ?? segment.aiResult?.feedback ?? "");
    }
  }, [segment, isEditing]);

  const confidence = segment.aiResult?.confidence || 0;
  const isHighConfidence = confidence >= 0.85;
  const isLowConfidence = confidence < 0.6 && segment.aiResult;

  const handleSave = () => {
    onReview(segment.id, localScore, localFeedback);
    setIsEditing(false);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: idx * 0.03 }}
      className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden group"
    >
      {/* Header Info */}
      <div className="bg-slate-50/50 px-8 py-4 flex justify-between items-center border-b border-slate-100">
        <div className="flex items-center gap-6">
          <span className="px-2 py-0.5 bg-slate-200 text-slate-500 rounded text-[9px] font-bold uppercase tracking-widest">Question {segment.questionNumber}</span>
          <h3 className="font-bold text-slate-800 text-lg tracking-tight">{segment.questionText || `Evaluation Block ${idx + 1}`}</h3>
        </div>
        <div className="flex items-center gap-3">
          {segment.isHandwritten && (
            <div className="flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
              <span>Handwritten</span>
            </div>
          )}
          {segment.aiResult && (
            <div className={`flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase px-2.5 py-1 rounded-full ${isHighConfidence ? 'bg-green-100 text-green-700' : isLowConfidence ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
              <span>AI_CONF: {(confidence * 100).toFixed(0)}%</span>
            </div>
          )}
        </div>
      </div>

      {hasRubric && (
        <div className="bg-indigo-50/30 px-8 py-3 border-b border-indigo-50 flex items-center justify-between">
           <div className="flex items-center gap-2">
             <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">
               Linked {rubricItems.length > 1 ? 'Rubrics' : 'Rubric'}
             </span>
             <span className="text-xs font-semibold text-slate-600 line-clamp-1">
               {rubricItems.map((r: any) => r.questionNumber).join(', ')}
             </span>
           </div>
           <button 
             onClick={() => setShowRubric(!showRubric)}
             className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest hover:underline"
           >
             {showRubric ? 'Hide Details' : 'View Details'}
           </button>
        </div>
      )}

      <AnimatePresence>
        {showRubric && hasRubric && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden bg-slate-50/80 border-b border-slate-100"
          >
            <div className="p-8 space-y-8">
              {rubricItems.map((rubricItem: any, rIdx: number) => (
                <div key={rIdx} className="space-y-4">
                  <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                    <span className="text-[10px] font-bold text-slate-400">ITEM {rubricItem.questionNumber}</span>
                    <span className="text-xs font-bold text-slate-700">{rubricItem.questionText}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <p className="text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Exemplary Response</p>
                      <div className="text-xs text-slate-600 leading-relaxed bg-white p-3 rounded-lg border border-slate-200">
                        {rubricItem.exemplaryResponse}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Scoring Levels</p>
                      <div className="space-y-2">
                        {rubricItem.criteria.map((c: any, i: number) => (
                          <div key={i} className="flex items-center justify-between bg-white p-2 rounded-lg border border-slate-200">
                            <span className="text-[10px] font-medium text-slate-600">{c.label}: {c.description}</span>
                            <span className="text-[10px] font-bold text-indigo-600 ml-4">+{c.points}pt</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid md:grid-cols-2 divide-x divide-slate-100">
        {/* Student Response */}
        <div className="p-8">
          <h4 className="text-[10px] font-bold uppercase text-slate-400 mb-4 tracking-widest">Extracted student text</h4>
          <div className="p-5 bg-slate-50/50 rounded-xl text-slate-600 leading-relaxed italic text-sm border border-slate-100 min-h-[120px]">
             {segment.studentAnswer}
          </div>
        </div>

        {/* AI/Human Feedback */}
        <div className="p-8 bg-white">
          <h4 className="text-[10px] font-bold uppercase text-slate-400 mb-4 tracking-widest">Evaluation Console</h4>
          
          {!segment.aiResult && !segment.humanResult ? (
            <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-slate-100 rounded-xl py-8">
                 <button 
                  onClick={onEvaluate}
                  className="text-[10px] font-bold uppercase text-indigo-400 hover:text-indigo-600 transition-colors tracking-widest"
                 >
                    {hasRubric ? '[ Request AI Rubric Check ]' : '[ Request General AI Scoring ]'}
                 </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex gap-6">
                <div className="w-24 bg-slate-50 rounded-xl p-4 flex flex-col justify-center items-center border border-slate-100">
                  <p className="text-[8px] font-bold uppercase text-slate-400 mb-2">Final Score</p>
                  {isEditing ? (
                    <input 
                      type="text" 
                      value={localScore}
                      onChange={e => setLocalScore(Number(e.target.value.replace(/[^0-9.]/g, '')))}
                      className="w-full text-3xl font-bold text-center text-indigo-600 bg-transparent outline-none border-b-2 border-indigo-200"
                    />
                  ) : (
                    <div className="text-3xl font-bold tracking-tight text-indigo-600">
                      {Math.min(segment.status === 'reviewed' ? segment.humanResult?.score : segment.aiResult?.score, totalMaxScore || 100)}
                      {hasRubric && <span className="text-sm text-slate-400 font-normal ml-1">/{totalMaxScore}</span>}
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-[8px] font-bold uppercase text-slate-400 mb-2">Rationalization</p>
                  {isEditing ? (
                    <textarea 
                      value={localFeedback}
                      onChange={e => setLocalFeedback(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-100 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-200 transition-all"
                      rows={3}
                    />
                  ) : (
                    <p className="text-sm text-slate-500 leading-relaxed bg-indigo-50/20 p-3 rounded-lg border border-indigo-50">
                      "{segment.status === 'reviewed' ? segment.humanResult?.feedback : segment.aiResult?.feedback}"
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                {isEditing ? (
                  <>
                    <button 
                      onClick={handleSave}
                      className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold text-xs uppercase shadow-lg shadow-green-100 hover:bg-green-700 transition-all"
                    >
                      Commit Marks
                    </button>
                    <button 
                      onClick={() => setIsEditing(false)}
                      className="px-6 py-3 text-slate-400 font-bold text-xs uppercase hover:text-slate-600"
                    >
                      Discard
                    </button>
                  </>
                ) : (
                  <>
                    {segment.aiResult && !segment.humanResult && isHighConfidence && (
                      <button 
                        onClick={() => onReview(segment.id, segment.aiResult!.score, segment.aiResult!.feedback)}
                        className="flex-1 py-3 bg-indigo-50 text-indigo-600 rounded-xl font-bold text-xs uppercase border border-indigo-100 hover:bg-indigo-100 transition-all"
                      >
                         Accept Suggestion
                      </button>
                    )}
                    <button 
                      onClick={() => setIsEditing(true)}
                      className={`flex-1 py-3 font-bold text-xs uppercase rounded-xl transition-all ${segment.status === 'reviewed' ? 'bg-slate-100 text-slate-500 border border-slate-200' : 'bg-white border border-slate-300 text-slate-700 hover:border-slate-800'}`}
                    >
                      {segment.status === 'reviewed' ? 'Revise Audit' : 'Override & Grade'}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
