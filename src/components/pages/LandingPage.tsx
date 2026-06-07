import React from 'react';
import { motion } from 'motion/react';
import { loginWithGoogle } from '../../services/firebase';
import { FileText, Brain, ShieldCheck } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-[calc(100vh-64px)] grid md:grid-cols-2">
      {/* Left Pane - Editorial */}
      <div className="bg-[#050505] text-white p-12 flex flex-col justify-center relative overflow-hidden">
        <motion.div 
          initial={{ opacity: 0, scale: 2 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="relative z-10"
        >
          <h2 className="text-[12vw] leading-[0.82] font-black uppercase tracking-tighter">
            EVAL<br />
            <span className="text-yellow-400">YOUR</span><br />
            WAY.
          </h2>
        </motion.div>
        
        <div className="mt-12 max-w-sm">
          <p className="text-gray-400 text-lg">
            AI-assisted exam digitization and hybrid evaluation infrastructure for education systems.
          </p>
          <button 
            onClick={loginWithGoogle}
            className="mt-8 bg-white text-black px-8 py-4 rounded-full font-bold hover:bg-yellow-400 transition-colors uppercase tracking-widest text-sm"
          >
            Get Started
          </button>
        </div>

        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-400/10 blur-[100px] rounded-full" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-yellow-400/5 blur-[120px] rounded-full" />
      </div>

      {/* Right Pane - Feature Reveal */}
      <div className="bg-white p-12 flex flex-col justify-center border-l border-gray-200">
        <div className="space-y-16">
          <Feature 
            icon={<FileText className="h-8 w-8" />} 
            title="Bulk Digitization" 
            desc="OCR-powered extraction from scanned sheets. Multi-format support." 
          />
          <Feature 
            icon={<Brain className="h-8 w-8" />} 
            title="AI Grading" 
            desc="Semantic evaluation using Gemini. Context-aware scoring." 
          />
          <Feature 
            icon={<ShieldCheck className="h-8 w-8" />} 
            title="Hybrid Oversight" 
            desc="Human-in-the-loop validation. Full control over every mark." 
          />
        </div>

        <div className="mt-24 pt-12 border-t border-gray-100 flex items-center justify-between text-xs font-mono text-gray-400 uppercase tracking-widest">
          <span>v1.0.0 Stable</span>
          <span>© 2024 GradeFlow</span>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) {
  return (
    <div className="flex gap-6">
      <div className="bg-gray-100 p-4 rounded-2xl shrink-0 h-fit">
        {icon}
      </div>
      <div>
        <h3 className="text-2xl font-bold tracking-tight mb-2 underline decoration-yellow-400 decoration-4 underline-offset-4">{title}</h3>
        <p className="text-gray-500 leading-relaxed max-w-xs">{desc}</p>
      </div>
    </div>
  );
}
