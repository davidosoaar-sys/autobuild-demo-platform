'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';

const TOOLS = [
  {
    key:     'projects',
    label:   'Projects',
    desc:    'Manage print jobs and track progress through setup, optimisation, and live monitoring.',
    route:   '/projects',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
      </svg>
    ),
  },
  {
    key:     'slicer',
    label:   'Slicer',
    desc:    'Upload a 3D model and run the RL optimizer to generate an adaptive concrete print toolpath.',
    route:   '/tools/slicer',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
      </svg>
    ),
  },
  {
    key:     'monitor',
    label:   'Live Monitor',
    desc:    'Connect cameras, run AI bead analysis, and log defect events during a concrete print.',
    route:   '/tools/monitor',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
      </svg>
    ),
  },
];

function greeting(name: string) {
  const h = new Date().getHours();
  const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return `${g}, ${name}.`;
}

export default function Home() {
  const router = useRouter();
  const [ready,      setReady]      = useState(false);
  const [userName,   setUserName]   = useState('');
  const [showOnboard, setShowOnboard] = useState(false);
  const [nameInput,  setNameInput]  = useState('');
  const [tosChecked, setTosChecked] = useState(false);

  useEffect(() => {
    const name = localStorage.getItem('autobuild_user_name');
    const tos  = localStorage.getItem('autobuild_tos_accepted');
    if (!name || !tos) {
      setShowOnboard(true);
    } else {
      setUserName(name);
    }
    setReady(true);
  }, []);

  const handleOnboard = () => {
    if (!nameInput.trim() || !tosChecked) return;
    localStorage.setItem('autobuild_user_name',    nameInput.trim());
    localStorage.setItem('autobuild_tos_accepted', 'true');
    setUserName(nameInput.trim());
    setShowOnboard(false);
  };

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Onboarding modal */}
      <AnimatePresence>
        {showOnboard && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
              <div className="bg-black px-6 py-5">
                <Image src="/Autobuildblack.png" alt="AutoBuild AI" width={400} height={400} className="h-24 w-auto mb-4" />
                <p className="text-white font-bold text-lg">Welcome to AutoBuild AI</p>
                <p className="text-white/40 text-xs mt-1">3DCP monitoring and path optimisation platform</p>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-black mb-1.5">Your name</label>
                  <input
                    autoFocus
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleOnboard()}
                    placeholder="e.g. John Doe"
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-black transition-colors placeholder:text-black/20"
                  />
                </div>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={tosChecked} onChange={e => setTosChecked(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-black flex-shrink-0" />
                  <span className="text-xs text-black/50 leading-relaxed">
                    I agree to the{' '}
                    <button onClick={() => router.push('/tos')} className="underline text-black hover:text-black/60">
                      Terms of Service
                    </button>{' '}
                    and acknowledge that AI analysis outputs are for decision-support only and not a substitute for qualified engineering judgement.
                  </span>
                </label>
                <button
                  onClick={handleOnboard}
                  disabled={!nameInput.trim() || !tosChecked}
                  className="w-full py-3 bg-black text-white text-sm font-semibold rounded-xl hover:bg-black/80 disabled:opacity-30 transition-all">
                  Enter AutoBuild AI
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="border-b border-gray-100 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-1 flex items-center">
          <div className="-my-4">
            <Image src="/Autobuildwhite.png" alt="AutoBuild AI" width={400} height={400} className="h-24 w-auto" />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          className="w-full max-w-3xl">

          {/* Greeting */}
          <div className="mb-10 text-center">
            {userName
              ? <h1 className="text-2xl sm:text-3xl font-bold text-black tracking-tight">{greeting(userName)}</h1>
              : <h1 className="text-2xl sm:text-3xl font-bold text-black tracking-tight">What would you like to do?</h1>
            }
            <p className="text-sm text-black/40 mt-2">Choose a tool to get started</p>
          </div>

          {/* 3 option cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {TOOLS.map((tool, i) => (
              <motion.button
                key={tool.key}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 + 0.1 }}
                onClick={() => router.push(tool.route)}
                className="group bg-white border border-gray-100 rounded-2xl p-6 text-left shadow-sm hover:shadow-md hover:border-black transition-all duration-200"
              >
                <div className="w-10 h-10 rounded-xl bg-gray-50 group-hover:bg-black group-hover:text-white flex items-center justify-center mb-4 transition-all text-black/50">
                  {tool.icon}
                </div>
                <h2 className="text-sm font-bold text-black mb-1.5">{tool.label}</h2>
                <p className="text-xs text-black/40 leading-relaxed">{tool.desc}</p>
                <div className="mt-4 text-[10px] font-semibold text-black/20 group-hover:text-black transition-colors">
                  Open →
                </div>
              </motion.button>
            ))}
          </div>
        </motion.div>
      </main>
    </div>
  );
}
