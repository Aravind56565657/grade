import React, { useState } from 'react';
import { collection, query, where, addDoc, serverTimestamp, doc, deleteDoc } from 'firebase/firestore';
import { useCollection } from 'react-firebase-hooks/firestore';
import { auth, db, handleFirestoreError } from '../../services/firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import { Plus, BookOpen, Clock, ChevronRight, Hash } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Exam, OperationType } from '../../types';
import { motion } from 'motion/react';

export default function Dashboard() {
  const navigate = useNavigate();
  const [user] = useAuthState(auth);
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const examsRef = collection(db, 'exams');
  const [examsSnap, loading] = useCollection(
    user ? query(examsRef, where('creatorId', '==', user.uid)) : null
  );
  const exams = examsSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() } as Exam));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newTitle.trim()) return;

    try {
      await addDoc(examsRef, {
        title: newTitle,
        description: newDesc,
        creatorId: user.uid,
        createdAt: serverTimestamp()
      });
      setNewTitle('');
      setNewDesc('');
      setIsCreating(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'exams');
    }
  };

  const [deletingExamId, setDeletingExamId] = useState<string | null>(null);

  const deleteExam = async (examId: string) => {
    try {
      await deleteDoc(doc(db, 'exams', examId));
      setDeletingExamId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `exams/${examId}`);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-12">
      <div className="flex justify-between items-end mb-12 border-b border-slate-200 pb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">Exam Batches</h2>
          <p className="text-slate-400 text-sm mt-1 uppercase tracking-widest font-bold">Active Evaluation Pipelines</p>
        </div>
        <button 
          onClick={() => setIsCreating(true)}
          className="bg-indigo-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-sm"
        >
          <Plus className="h-4 w-4" />
          <span>New Batch</span>
        </button>
      </div>

      {isCreating && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-12 bg-white rounded-xl shadow-sm border border-slate-200 p-10"
        >
          <form onSubmit={handleCreate} className="space-y-8">
            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 tracking-widest mb-2">Batch Title</label>
                <input 
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  required
                  className="w-full bg-slate-50 border border-slate-100 rounded-lg p-4 text-xl font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:bg-white transition-all"
                  placeholder="e.g. Finals 2024 - Math"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 tracking-widest mb-2">Description</label>
                <input 
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-100 rounded-lg p-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:bg-white transition-all h-full"
                  placeholder="Batch specifics..."
                />
              </div>
            </div>
            <div className="flex gap-4">
              <button type="submit" className="bg-indigo-600 text-white px-8 py-3 rounded-lg font-bold hover:bg-indigo-700 transition-colors">Start Pipeline</button>
              <button 
                type="button" 
                onClick={() => setIsCreating(false)}
                className="px-8 py-3 text-slate-400 hover:text-slate-600 transition-colors font-semibold"
              >
                Dismiss
              </button>
            </div>
          </form>
        </motion.div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1,2,3].map(i => (
            <div key={i} className="h-48 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {exams?.map((exam, idx) => (
            <div 
              key={exam.id} 
              onClick={() => navigate(`/exam/${exam.id}`)}
              className="bg-white border border-slate-200 p-8 rounded-xl hover:border-indigo-400 hover:shadow-md transition-all group flex flex-col justify-between cursor-pointer"
            >
              <div>
                <div className="flex justify-between items-start mb-4">
                   <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">BATCH #{idx + 1}</span>
                   <div className="flex items-center gap-2">
                     {deletingExamId === exam.id ? (
                       <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-300">
                         <span className="text-[8px] font-bold text-red-500 uppercase">Confirm?</span>
                         <button
                           onClick={(e) => {
                             e.stopPropagation();
                             deleteExam(exam.id);
                           }}
                           className="p-1 px-2 bg-red-600 text-white rounded font-mono text-[9px] font-bold hover:bg-red-700 hover:scale-105 transition-transform"
                         >
                           YES
                         </button>
                         <button
                           onClick={(e) => {
                             e.stopPropagation();
                             setDeletingExamId(null);
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
                           setDeletingExamId(exam.id);
                         }}
                         className="p-1 px-2 text-slate-400 hover:text-red-500 hover:bg-red-50 border border-slate-100 rounded transition-all font-mono text-[9px] font-bold opacity-0 group-hover:opacity-100"
                       >
                         DELETE
                       </button>
                     )}
                     <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
                   </div>
                </div>
                <h3 className="text-xl font-bold text-slate-800 leading-tight mb-2">{exam.title}</h3>
                <p className="text-slate-400 text-sm line-clamp-2 italic font-serif">
                  {exam.description || "System processing batch evaluation."}
                </p>
              </div>

              <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-slate-400">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  <span>{new Date(exam.createdAt?.seconds * 1000).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-50 rounded">
                  <Hash className="h-2.5 w-2.5" />
                  <span>{exam.id?.slice(0, 8) || 'N/A'}</span>
                </div>
              </div>
            </div>
          ))}
          {exams?.length === 0 && !isCreating && (
            <div className="col-span-full py-24 text-center bg-white border-2 border-dashed border-slate-200 rounded-2xl">
              <BookOpen className="h-10 w-10 text-slate-200 mx-auto mb-4" />
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">No Active Pipelines Found</p>
              <button 
                onClick={() => setIsCreating(true)}
                className="mt-4 text-indigo-600 text-sm font-bold border-b-2 border-indigo-100 hover:border-indigo-600 transition-colors"
              >
                Create your first exam batch
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
