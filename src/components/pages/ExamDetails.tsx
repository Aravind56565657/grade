import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { collection, query, where, addDoc, serverTimestamp, doc, updateDoc, arrayUnion, deleteDoc } from 'firebase/firestore';
import { useCollection, useDocument } from 'react-firebase-hooks/firestore';
import { auth, db, handleFirestoreError } from '../../services/firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import { ArrowLeft, Plus, FileText, ChevronRight, Loader2, Image as ImageIcon, BrainCircuit, Trash2, CheckCircle2, Hash } from 'lucide-react';
import { Exam, Script, OperationType, RubricItem } from '../../types';
import { motion, AnimatePresence } from 'motion/react';
import { generateRubric } from '../../services/gemini';

export default function ExamDetails() {
  const { examId } = useParams();
  const navigate = useNavigate();
  const [user] = useAuthState(auth);
  const [isUploading, setIsUploading] = useState(false);
  const [isRubricToolOpen, setIsRubricToolOpen] = useState(false);
  const [studentName, setStudentName] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Rubric Form State
  const [rubricFiles, setRubricFiles] = useState<File[]>([]);
  const [rubricInput, setRubricInput] = useState({
    content: '',
    studentLevel: 'Secondary School Students, Year 10',
    totalPoints: 10
  });
  const [previewRubric, setPreviewRubric] = useState<{ items: RubricItem[], sections: any[] } | null>(null);

  const examRef = doc(db, 'exams', examId!);
  const [examSnap] = useDocument(examRef);
  const exam = examSnap ? { id: examSnap.id, ...examSnap.data() } as Exam : undefined;

  const scriptsRef = collection(db, 'exams', examId!, 'scripts');
  const [scriptsSnap, loadingScripts] = useCollection(
    user ? query(scriptsRef, where('creatorId', '==', user.uid)) : null
  );
  const scripts = scriptsSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() } as Script));

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !studentName.trim() || selectedFiles.length === 0) return;

    setIsProcessing(true);
    setError(null);
    try {
      // Basic check for file size to prevent 1MB Firestore limit issues
      const totalSize = selectedFiles.reduce((acc, file) => acc + file.size, 0);
      if (totalSize > 700000) { // Approx limit for base64 in Firestore
        throw new Error("Files are too large. Please upload smaller images or fewer pages at a time.");
      }

      const imageUrls = await Promise.all(selectedFiles.map(file => {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      }));

      await addDoc(scriptsRef, {
        examId,
        creatorId: user.uid,
        studentName,
        studentId: Math.random().toString(36).substring(7).toUpperCase(),
        status: 'pending',
        imageUrls,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      setStudentName('');
      setSelectedFiles([]);
      setIsUploading(false);
      setError(null);
    } catch (err: any) {
      const errorMessage = err.message || "Failed to upload script. Please check your connection.";
      setError(errorMessage);
      console.error("Upload Error:", err);
      // Only call global handler for generic/server errors
      if (!err.message?.includes("too large")) {
        handleFirestoreError(err, OperationType.CREATE, `exams/${examId}/scripts`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGenerateRubric = async () => {
    if (!rubricInput.content && rubricFiles.length === 0) return;
    setIsProcessing(true);
    try {
      const images = await Promise.all(rubricFiles.map(file => {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      }));

      const result = await generateRubric({ ...rubricInput, images });
      
      // Support additive preview
      if (previewRubric) {
        setPreviewRubric({
          items: [...previewRubric.items, ...result.items],
          sections: [...previewRubric.sections, ...result.sections]
        });
      } else {
        setPreviewRubric(result);
      }
      
      // Clear inputs for next part if needed
      setRubricFiles([]);
      setRubricInput(prev => ({ ...prev, content: '' }));
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'FAILED TO GENERATE RUBRIC. PLEASE TRY AGAIN.');
    } finally {
      setIsProcessing(false);
    }
  };

  const commitRubric = async () => {
    if (!previewRubric) return;
    setIsProcessing(true);
    try {
      await updateDoc(examRef, {
        'rubric': {
          items: exam?.rubric?.items ? [...exam.rubric.items, ...previewRubric.items] : previewRubric.items,
          sections: exam?.rubric?.sections ? [...exam.rubric.sections, ...previewRubric.sections] : previewRubric.sections
        }
      });
      setPreviewRubric(null);
      setRubricFiles([]);
      setRubricInput({ content: '', studentLevel: 'Secondary School Students, Year 10', totalPoints: 10 });
      setIsRubricToolOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `exams/${examId}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const updatePreviewItem = (index: number, updatedItem: RubricItem) => {
    if (!previewRubric) return;
    const newItems = [...previewRubric.items];
    newItems[index] = updatedItem;
    setPreviewRubric({ ...previewRubric, items: newItems });
  };

  const deleteRubricItem = async (index: number) => {
    if (!exam?.rubric?.items) return;
    const items = [...exam.rubric.items];
    const removed = items.splice(index, 1)[0];
    
    const sections = exam.rubric.sections?.map(s => ({
      ...s,
      questionNumbers: s.questionNumbers.filter(q => q !== removed.questionNumber)
    })) || [];

    try {
      await updateDoc(examRef, {
        'rubric.items': items,
        'rubric.sections': sections
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `exams/${examId}`);
    }
  };

  const [deletingScriptId, setDeletingScriptId] = useState<string | null>(null);

  const deleteScript = async (scriptId: string) => {
    try {
      await deleteDoc(doc(db, 'exams', examId!, 'scripts', scriptId));
      setDeletingScriptId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `exams/${examId}/scripts/${scriptId}`);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-12">
      <Link to="/dashboard" className="inline-flex items-center gap-2 text-slate-400 hover:text-indigo-600 transition-colors font-mono text-[10px] uppercase mb-8 group tracking-widest">
        <ArrowLeft className="h-3 w-3 group-hover:-translate-x-1 transition-transform" />
        All Batches
      </Link>

      <div className="flex justify-between items-start mb-12">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">{exam?.title || 'Loading Batch...'}</h2>
          <p className="text-slate-400 text-sm mt-1">{exam?.description || 'Evaluation pipeline active.'}</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => setIsRubricToolOpen(true)}
            className="bg-white border border-slate-200 text-slate-600 px-6 py-3 rounded-lg font-bold hover:bg-slate-50 transition-all flex items-center gap-2 shadow-sm"
          >
            <BrainCircuit className="h-4 w-4 text-indigo-500" />
            <span>Setup Rubric</span>
          </button>
          <button 
            onClick={() => setIsUploading(true)}
            className="bg-indigo-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span>Add Script</span>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isRubricToolOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-12 bg-indigo-50/30 rounded-xl shadow-sm border border-indigo-100 overflow-hidden"
          >
            <div className="p-10 space-y-8">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-indigo-900 flex items-center gap-2">
                  <BrainCircuit className="h-5 w-5" />
                  AI Rubric Generator
                </h3>
              </div>
              {!previewRubric ? (
                <div className="grid md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-indigo-400 tracking-widest mb-2">Question Paper / Part (Images or Text)</label>
                      <div className="grid grid-cols-2 gap-4 h-[120px]">
                        <label className="bg-white border border-indigo-100 border-dashed rounded-lg p-2 flex flex-col items-center justify-center cursor-pointer hover:bg-white/50 transition-all">
                          <ImageIcon className="h-5 w-5 text-indigo-300 mb-1" />
                          <span className="text-[8px] font-bold uppercase text-indigo-400">{rubricFiles.length > 0 ? `${rubricFiles.length} files` : 'Upload Scans'}</span>
                          <input type="file" multiple accept="image/*" className="hidden" onChange={e => e.target.files && setRubricFiles(Array.from(e.target.files))} />
                        </label>
                        <textarea 
                          value={rubricInput.content}
                          onChange={e => setRubricInput({...rubricInput, content: e.target.value})}
                          className="bg-white border border-indigo-100 rounded-lg p-2 text-[10px] focus:outline-none focus:ring-1 focus:ring-indigo-200 resize-none"
                          placeholder="Or paste text..."
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-indigo-400 tracking-widest mb-2">Maximum Points (Suggested)</label>
                      <input 
                        type="number"
                        value={rubricInput.totalPoints}
                        onChange={e => setRubricInput({...rubricInput, totalPoints: Number(e.target.value)})}
                        className="w-full bg-white border border-indigo-100 rounded-lg p-4 font-bold text-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 transition-all font-sans"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-indigo-400 tracking-widest mb-2">Student Level / Context (Freeform)</label>
                    <input 
                      value={rubricInput.studentLevel}
                      onChange={e => setRubricInput({...rubricInput, studentLevel: e.target.value})}
                      className="w-full bg-white border border-indigo-100 rounded-lg p-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 transition-all font-sans"
                      placeholder="e.g. 10th Grade Calculus Students"
                    />
                    <div className="mt-6 p-6 bg-white/50 rounded-xl border border-dashed border-indigo-200">
                      <p className="text-xs text-indigo-400 leading-relaxed italic">
                        Tip: Provide as much context as possible. Mention specific chapters or topics covered if needed.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-indigo-500 uppercase tracking-widest">Preview & Refine AI Rubric</p>
                    <div className="flex gap-4">
                      <button 
                        onClick={() => setPreviewRubric(null)}
                        className="text-[10px] font-bold text-indigo-400 hover:text-indigo-600 uppercase"
                      >
                        Reset All
                      </button>
                      <button 
                         onClick={() => setPreviewRubric(null)} // Temporary: set back to null to "Add Part"
                         className="text-[10px] font-bold text-indigo-600 hover:underline uppercase"
                      >
                        Add Another Part
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-6">
                    {previewRubric.sections.length > 0 && (
                      <div className="space-y-4">
                        <label className="block text-[8px] font-bold text-indigo-400 uppercase tracking-widest">Detected Sections & Constraints</label>
                        {previewRubric.sections.map((section, sIdx) => (
                          <div key={sIdx} className="bg-white border border-indigo-200 rounded-lg p-4 grid grid-cols-3 gap-4 items-center">
                            <input 
                              className="font-bold text-indigo-700 bg-transparent border-none focus:ring-0"
                              value={section.title}
                              onChange={e => {
                                const newSecs = [...previewRubric.sections];
                                newSecs[sIdx] = { ...section, title: e.target.value };
                                setPreviewRubric({ ...previewRubric, sections: newSecs });
                              }}
                            />
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-slate-400">ATTEMPT:</span>
                              <input 
                                type="number"
                                className="w-12 font-bold text-indigo-600 border-b border-indigo-100"
                                value={section.questionsToAttempt}
                                onChange={e => {
                                  const newSecs = [...previewRubric.sections];
                                  newSecs[sIdx] = { ...section, questionsToAttempt: Number(e.target.value) };
                                  setPreviewRubric({ ...previewRubric, sections: newSecs });
                                }}
                              />
                            </div>
                            <div className="text-[10px] font-mono text-slate-400 truncate">
                              Q: {section.questionNumbers.join(', ')}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {previewRubric.items.map((item, idx) => (
                      <div key={idx} className="bg-white border border-indigo-100 rounded-xl p-6 shadow-sm">
                        <div className="flex gap-4 mb-4">
                           <input 
                             className="w-16 font-bold text-indigo-600 border-b border-indigo-100 focus:outline-none"
                             value={item.questionNumber}
                             onChange={e => {
                               const updated = {...item, questionNumber: e.target.value};
                               updatePreviewItem(idx, updated);
                             }}
                           />
                           <input 
                             className="flex-1 font-bold text-slate-800 border-b border-indigo-100 focus:outline-none"
                             value={item.questionText}
                             onChange={e => {
                               const updated = {...item, questionText: e.target.value};
                               updatePreviewItem(idx, updated);
                             }}
                           />
                           <div className="flex items-center gap-2">
                             <span className="text-[10px] font-bold text-slate-300">PTS</span>
                             <input 
                               type="number"
                               className="w-12 font-bold text-slate-600 text-right focus:outline-none"
                               value={item.maxScore}
                               onChange={e => {
                                 const updated = {...item, maxScore: Number(e.target.value)};
                                 updatePreviewItem(idx, updated);
                               }}
                             />
                           </div>
                        </div>
                        <div className="space-y-2">
                          <label className="block text-[8px] font-bold text-slate-300 uppercase">Criteria</label>
                          {item.criteria.map((c, ci) => (
                            <div key={ci} className="grid grid-cols-6 gap-2 items-center">
                              <input 
                                className="col-span-2 text-xs font-bold p-1 bg-slate-50 border-none focus:ring-1 focus:ring-indigo-100 rounded"
                                value={c.label}
                                onChange={e => {
                                   const newCriteria = [...item.criteria];
                                   newCriteria[ci] = {...c, label: e.target.value};
                                   updatePreviewItem(idx, {...item, criteria: newCriteria});
                                }}
                              />
                              <input 
                                className="col-span-3 text-xs p-1 bg-slate-50 border-none focus:ring-1 focus:ring-indigo-100 rounded"
                                value={c.description}
                                onChange={e => {
                                   const newCriteria = [...item.criteria];
                                   newCriteria[ci] = {...c, description: e.target.value};
                                   updatePreviewItem(idx, {...item, criteria: newCriteria});
                                }}
                              />
                              <input 
                                type="number"
                                className="text-xs font-bold text-indigo-600 text-right p-1 bg-slate-50 border-none focus:ring-1 focus:ring-indigo-100 rounded"
                                value={c.points}
                                onChange={e => {
                                   const newCriteria = [...item.criteria];
                                   newCriteria[ci] = {...c, points: Number(e.target.value)};
                                   updatePreviewItem(idx, {...item, criteria: newCriteria});
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-4 pt-4 border-t border-indigo-100">
                {!previewRubric ? (
                  <button 
                    onClick={handleGenerateRubric}
                    disabled={isProcessing || (!rubricInput.content && rubricFiles.length === 0)}
                    className="bg-indigo-600 text-white px-8 py-3 rounded-lg font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    {isProcessing && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isProcessing ? 'Analyzing Paper...' : 'Identify Questions & Criteria'}
                  </button>
                ) : (
                  <button 
                    onClick={commitRubric}
                    disabled={isProcessing}
                    className="bg-green-600 text-white px-8 py-3 rounded-lg font-bold hover:bg-green-700 transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    {isProcessing && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isProcessing ? 'Deploying...' : 'Finalize and Save Rubric'}
                  </button>
                )}
                <button 
                  onClick={() => {
                    setPreviewRubric(null);
                    if (!previewRubric) setIsRubricToolOpen(false);
                  }}
                  className="px-8 py-3 text-indigo-400 hover:text-indigo-600 transition-colors font-semibold"
                >
                  Discard Draft
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {isUploading && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-12 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"
          >
            <form onSubmit={handleUpload} className="p-10 space-y-8">
              {error && (
                <div className="p-4 bg-red-50 border border-red-100 rounded-lg text-red-600 text-xs font-bold uppercase tracking-tight">
                  {error}
                </div>
              )}
              <div className="grid md:grid-cols-2 gap-8">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 tracking-widest mb-2">Student Identity</label>
                  <input 
                    value={studentName}
                    onChange={e => setStudentName(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-100 rounded-lg p-4 text-xl font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:bg-white transition-all"
                    placeholder="Full Name"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 tracking-widest mb-2">Source Material (Scans)</label>
                  <label className="w-full bg-slate-50 border border-slate-200 border-dashed rounded-lg p-4 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-100 transition-colors h-[86px]">
                    <div className="flex items-center gap-2 text-slate-400">
                      <ImageIcon className="h-4 w-4" />
                      <span className="font-mono text-[10px] uppercase font-bold tracking-tighter">{selectedFiles.length > 0 ? `${selectedFiles.length} files attached` : 'Upload Images'}</span>
                    </div>
                    <input 
                      type="file" 
                      multiple 
                      accept="image/*" 
                      onChange={handleFileChange}
                      className="hidden" 
                    />
                  </label>
                </div>
              </div>
              <div className="flex gap-4 pt-4 border-t border-slate-50">
                <button 
                  type="submit" 
                  disabled={isProcessing}
                  className="bg-indigo-600 text-white px-8 py-3 rounded-lg font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {isProcessing && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isProcessing ? 'Ingesting...' : 'Confirm Upload'}
                </button>
                <button 
                  type="button" 
                  onClick={() => setIsUploading(false)}
                  className="px-8 py-3 text-slate-400 hover:text-slate-600 transition-colors font-semibold"
                >
                  Discard
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rubric Review Section */}
      {exam?.rubric?.sections && exam.rubric.sections.length > 0 && (
        <div className="mb-10 p-6 bg-indigo-50/30 border border-indigo-100 rounded-2xl">
           <div className="flex items-center gap-2 mb-6">
            <CheckCircle2 className="h-5 w-5 text-indigo-500" />
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Grading Boundaries & Section Logic</h3>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {exam.rubric.sections.map((section, idx) => (
              <div key={idx} className="bg-white border border-indigo-100 p-5 rounded-xl shadow-sm hover:shadow-md transition-all group">
                 <div className="flex justify-between items-start mb-4">
                   <input 
                      className="font-bold text-indigo-900 text-xs bg-transparent border-none p-0 focus:ring-0 w-full"
                      value={section.title}
                      onChange={async (e) => {
                        const nextSecs = [...exam.rubric!.sections!];
                        nextSecs[idx] = { ...section, title: e.target.value };
                        await updateDoc(examRef, { 'rubric.sections': nextSecs });
                      }}
                   />
                 </div>
                 <div className="flex items-center gap-2 text-[10px] font-bold text-indigo-600 bg-indigo-50 p-2 rounded-lg">
                    <span>BEST</span>
                    <input 
                      type="number"
                      className="w-8 bg-white border border-indigo-200 rounded text-center py-0.5"
                      value={section.questionsToAttempt}
                      onChange={async (e) => {
                        const nextSecs = [...exam.rubric!.sections!];
                        nextSecs[idx] = { ...section, questionsToAttempt: Number(e.target.value) };
                        await updateDoc(examRef, { 'rubric.sections': nextSecs });
                      }}
                    />
                    <span>OF {section.questionNumbers.length} RESPONSES</span>
                 </div>
                 <div className="mt-4 flex flex-wrap gap-1">
                    {section.questionNumbers.map(q => (
                       <span key={q} className="px-1.5 py-0.5 bg-slate-50 border border-slate-100 rounded text-[9px] font-bold text-slate-400">Q{q}</span>
                    ))}
                 </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {exam?.rubric?.items && exam.rubric.items.length > 0 && (
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-6">
            <Hash className="h-5 w-5 text-indigo-500" />
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Individual Question Rubric ({exam.rubric.items.length})</h3>
          </div>
          <div className="grid gap-4">
            {exam.rubric.items.map((item, idx) => (
              <div key={idx} className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm group hover:border-indigo-200 transition-all">
                <div className="flex flex-col md:flex-row gap-6">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex flex-col gap-1 items-center bg-indigo-50 px-2 py-1 rounded-lg">
                        <span className="text-[7px] font-black text-indigo-400 uppercase leading-none">Num</span>
                         <input 
                            className="w-10 text-center font-bold font-mono text-indigo-600 bg-transparent border-none p-0 focus:ring-0"
                            value={item.questionNumber}
                            onChange={async (e) => {
                              const nextItems = [...exam.rubric!.items];
                              nextItems[idx] = { ...item, questionNumber: e.target.value };
                              await updateDoc(examRef, { 'rubric.items': nextItems });
                            }}
                         />
                      </div>
                      <input 
                        className="flex-1 font-bold text-slate-800 text-lg bg-transparent border-none p-0 focus:ring-0"
                        value={item.questionText}
                        onChange={async (e) => {
                          const nextItems = [...exam.rubric!.items];
                          nextItems[idx] = { ...item, questionText: e.target.value };
                          await updateDoc(examRef, { 'rubric.items': nextItems });
                        }}
                      />
                      <div className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl shadow-lg shadow-indigo-100">
                        <span className="text-[10px] font-black uppercase tracking-tighter opacity-70">Max</span>
                        <input 
                          type="number"
                          className="w-8 bg-transparent font-bold text-center border-none focus:ring-0 p-0 text-lg"
                          value={item.maxScore}
                          onChange={async (e) => {
                             const nextItems = [...exam.rubric!.items];
                             nextItems[idx] = { ...item, maxScore: Number(e.target.value) };
                             await updateDoc(examRef, { 'rubric.items': nextItems });
                          }}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                       {item.criteria.map((c, ci) => (
                         <div key={ci} className="flex gap-4 p-3 bg-slate-50 rounded-xl border border-slate-100 items-start">
                            <div className="flex-1">
                               <input 
                                  className="w-full font-bold text-slate-700 text-[10px] bg-transparent border-none p-0 mb-1 focus:ring-0"
                                  value={c.label}
                                  onChange={async (e) => {
                                    const nextItems = [...exam.rubric!.items];
                                    const nextCriteria = [...item.criteria];
                                    nextCriteria[ci] = { ...c, label: e.target.value };
                                    nextItems[idx] = { ...item, criteria: nextCriteria };
                                    await updateDoc(examRef, { 'rubric.items': nextItems });
                                  }}
                               />
                               <textarea 
                                  className="w-full text-slate-500 text-[10px] bg-transparent border-none p-0 focus:ring-0 resize-none min-h-[30px]"
                                  value={c.description}
                                  onChange={async (e) => {
                                    const nextItems = [...exam.rubric!.items];
                                    const nextCriteria = [...item.criteria];
                                    nextCriteria[ci] = { ...c, description: e.target.value };
                                    nextItems[idx] = { ...item, criteria: nextCriteria };
                                    await updateDoc(examRef, { 'rubric.items': nextItems });
                                  }}
                               />
                            </div>
                            <div className="flex items-center gap-1 font-bold text-indigo-500 text-[10px]">
                               <span>+</span>
                               <input 
                                  type="number"
                                  className="w-6 bg-white border border-indigo-100 rounded text-center"
                                  value={c.points}
                                  onChange={async (e) => {
                                    const nextItems = [...exam.rubric!.items];
                                    const nextCriteria = [...item.criteria];
                                    nextCriteria[ci] = { ...c, points: Number(e.target.value) };
                                    nextItems[idx] = { ...item, criteria: nextCriteria };
                                    await updateDoc(examRef, { 'rubric.items': nextItems });
                                  }}
                               />
                               <span>p</span>
                            </div>
                         </div>
                       ))}
                    </div>
                  </div>
                  <div className="md:w-1/3 flex flex-col justify-end items-end">
                    <button 
                      onClick={() => deleteRubricItem(idx)}
                      className="mb-auto p-2 text-slate-200 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    {item.exemplaryResponse && (
                      <div className="w-full mt-4 bg-green-50 p-4 rounded-xl border border-green-100">
                         <div className="text-[8px] font-bold text-green-600 uppercase mb-2 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Model Response
                         </div>
                         <textarea 
                            className="w-full bg-transparent border-none p-0 text-[10px] text-green-800 font-medium leading-relaxed focus:ring-0 resize-none min-h-[60px]"
                            value={item.exemplaryResponse}
                            onChange={async (e) => {
                              const nextItems = [...exam.rubric!.items];
                              nextItems[idx] = { ...item, exemplaryResponse: e.target.value };
                              await updateDoc(examRef, { 'rubric.items': nextItems });
                            }}
                         />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="grid grid-cols-4 px-8 py-4 bg-slate-50 border-b border-slate-200 font-bold text-[10px] uppercase text-slate-400 tracking-widest">
          <div className="col-span-2">Candidate</div>
          <div>Status</div>
          <div className="text-right">Evaluation</div>
        </div>
        
        {loadingScripts ? (
          <div className="p-12 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-indigo-400" /></div>
        ) : scripts?.length === 0 ? (
          <div className="p-24 text-center text-slate-300 font-serif italic text-lg uppercase tracking-tight">No script entries found in this batch.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {scripts?.map(script => (
              <div 
                key={script.id} 
                className="grid grid-cols-4 px-8 py-6 hover:bg-slate-50 transition-all items-center group"
              >
                <div 
                  className="col-span-2 flex items-center gap-4 cursor-pointer"
                  onClick={() => navigate(`/grade/${examId}/${script.id}`)}
                >
                  <div className="w-10 h-10 bg-slate-100 text-indigo-600 rounded-lg flex items-center justify-center font-bold font-mono text-sm group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                    {script.studentName.charAt(0)}
                  </div>
                  <div>
                    <div className="font-bold text-slate-700 text-lg tracking-tight group-hover:text-indigo-600 transition-colors">{script.studentName}</div>
                    <div className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">SID: {script.studentId}</div>
                  </div>
                </div>
                <div 
                  className="cursor-pointer h-full flex items-center"
                  onClick={() => navigate(`/grade/${examId}/${script.id}`)}
                >
                  <span className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-full ${
                    script.status === 'completed' ? 'bg-green-100 text-green-700' : 
                    script.status === 'processing' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {script.status}
                  </span>
                </div>
                <div className="text-right flex justify-end items-center gap-4">
                  {deletingScriptId === script.id ? (
                    <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-300">
                      <span className="text-[8px] font-bold text-red-500 uppercase">Delete?</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteScript(script.id);
                        }}
                        className="p-1 px-2 bg-red-600 text-white rounded font-mono text-[9px] font-bold hover:bg-red-700"
                      >
                        YES
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingScriptId(null);
                        }}
                        className="p-1 px-2 bg-slate-100 text-slate-600 rounded font-mono text-[9px] font-bold hover:bg-slate-200"
                      >
                        NO
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingScriptId(script.id);
                      }}
                      className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 border border-slate-50 rounded-lg transition-all"
                      title="Delete Candidate"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <div 
                    onClick={() => navigate(`/grade/${examId}/${script.id}`)}
                    className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center group-hover:border-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-sm cursor-pointer"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
