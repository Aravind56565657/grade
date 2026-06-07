/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/common/Header';
import LandingPage from './components/pages/LandingPage';
import Dashboard from './components/pages/Dashboard';
import ExamDetails from './components/pages/ExamDetails';
import GradingView from './components/pages/GradingView';
import { auth } from './services/firebase';
import { useAuthState } from 'react-firebase-hooks/auth';

export default function App() {
  const [user, loading] = useAuthState(auth);

  if (loading) {
    return (
      <div className="h-screen w-screen bg-[#F5F7FA] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          <div className="text-slate-400 font-mono text-[10px] tracking-widest uppercase">Initializing System...</div>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <div className="min-h-screen bg-[#F5F7FA] text-slate-800 font-sans selection:bg-indigo-100 selection:text-indigo-900">
        <Header />
        <main>
          <Routes>
            <Route path="/" element={user ? <Navigate to="/dashboard" /> : <Navigate to="/" />} />
            <Route path="/dashboard" element={user ? <Dashboard /> : <Navigate to="/" />} />
            <Route path="/exam/:examId" element={user ? <ExamDetails /> : <Navigate to="/" />} />
            <Route path="/grade/:examId/:scriptId" element={user ? <GradingView /> : <Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}
