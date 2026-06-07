import React from 'react';
import { LogOut, User } from 'lucide-react';
import { auth, loginWithGoogle, logout } from '../../services/firebase';
import { useAuthState } from 'react-firebase-hooks/auth';

export default function Header() {
  const [user] = useAuthState(auth);

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 sticky top-0 z-50">
      <div className="flex items-center space-x-2">
        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
          <span className="text-white font-bold text-lg">G</span>
        </div>
        <span className="font-bold text-xl tracking-tight uppercase text-slate-800">GradeFlow</span>
      </div>
      
      <div className="flex items-center gap-4">
        {user ? (
          <>
            <div className="flex items-center gap-2 bg-slate-50 rounded-full py-1.5 px-4 border border-slate-200">
              <User className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-xs font-medium text-slate-600 truncate max-w-[150px]">{user.email}</span>
            </div>
            <button 
              onClick={logout}
              className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600"
              title="Sign Out"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </>
        ) : (
          <button 
            onClick={loginWithGoogle}
            className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-bold text-sm tracking-tight hover:bg-indigo-700 transition-colors shadow-sm"
          >
            SIGN IN
          </button>
        )}
      </div>
    </header>
  );
}
