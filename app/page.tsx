'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';

interface RecentSlice {
  id: string;
  file_name: string;
  print_time: string | null;
  layers: number | null;
  source: string | null;
  created_at: string;
}

function greeting(name: string) {
  const h = new Date().getHours();
  const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return `${g}, ${name}.`;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function Home() {
  const router = useRouter();
  const [ready,         setReady]         = useState(false);
  const [userName,      setUserName]      = useState('');
  const [showOnboard,   setShowOnboard]   = useState(false);
  const [nameInput,     setNameInput]     = useState('');
  const [tosChecked,    setTosChecked]    = useState(false);
  const [privChecked,   setPrivChecked]   = useState(false);
  const [dataChecked,   setDataChecked]   = useState(false);
  const [recentSlices,  setRecentSlices]  = useState<RecentSlice[]>([]);

  useEffect(() => {
    const name = localStorage.getItem('autobuild_user_name');
    const tos  = localStorage.getItem('autobuild_tos_accepted');
    const priv = localStorage.getItem('autobuild_privacy_accepted');
    if (!name || !tos || !priv) {
      setShowOnboard(true);
    } else {
      setUserName(name);
    }
    setReady(true);

    supabase
      .from('saved_slices')
      .select('id, file_name, print_time, layers, source, created_at')
      .order('created_at', { ascending: false })
      .limit(3)
      .then(({ data }) => { if (data) setRecentSlices(data); });
  }, []);

  const handleOnboard = () => {
    if (!nameInput.trim() || !tosChecked || !privChecked) return;
    localStorage.setItem('autobuild_user_name',             nameInput.trim());
    localStorage.setItem('autobuild_tos_accepted',           'true');
    localStorage.setItem('autobuild_privacy_accepted',       'true');
    localStorage.setItem('autobuild_data_training_opted_in', dataChecked ? 'true' : 'false');
    setUserName(nameInput.trim());
    setShowOnboard(false);
  };

  if (!ready) return null;

  const PRIMARY_TOOLS = [
    {
      key:   'projects',
      label: 'Projects',
      desc:  'Manage print jobs and track progress through setup, optimisation, and live monitoring.',
      route: '/projects',
      icon: (
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
        </svg>
      ),
    },
    {
      key:   'slicer',
      label: 'Slicer',
      desc:  'Upload a 3D model and run the RL optimizer to generate an adaptive concrete print toolpath.',
      route: '/tools/slicer',
      icon: (
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
        </svg>
      ),
    },
  ];

  const SECONDARY_TOOLS = [
    {
      key:   'monitor',
      label: 'Live Monitor',
      desc:  'AI bead analysis and defect logging during a concrete print.',
      route: '/tools/monitor',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
        </svg>
      ),
    },
    {
      key:   'image-analysis',
      label: 'Image Analysis',
      desc:  'Upload a bead photo for AI defect detection and quality scoring.',
      route: '/tools/image-analysis',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
        </svg>
      ),
    },
    {
      key:   'slices',
      label: 'My Slices',
      desc:  'Browse and download your saved slicer results.',
      route: '/tools/slices',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Onboarding modal */}
      <AnimatePresence>
        {showOnboard && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
              <div className="bg-black px-6 pt-6 pb-5">
                <Image src="/Autobuildwhite.png" alt="AutoBuild AI" width={400} height={400} className="h-20 w-auto mb-4"/>
                <p className="text-white font-bold text-lg leading-snug">Welcome to AutoBuild AI</p>
                <p className="text-white/40 text-xs mt-1">3DCP monitoring and path optimisation platform</p>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-black/50 mb-1.5 uppercase tracking-wider">Your name</label>
                  <input
                    autoFocus
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleOnboard()}
                    placeholder="e.g. John Doe"
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-black transition-colors placeholder:text-black/20"
                  />
                </div>

                <div className="space-y-3 pt-1">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={tosChecked} onChange={e => setTosChecked(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-black flex-shrink-0"/>
                    <span className="text-xs text-black/60 leading-relaxed">
                      I agree to the{' '}
                      <button type="button" onClick={e => { e.preventDefault(); router.push('/tos'); }}
                        className="underline text-black hover:text-black/60">Terms of Service</button>
                      {' '}<span className="text-red-400">*</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={privChecked} onChange={e => setPrivChecked(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-black flex-shrink-0"/>
                    <span className="text-xs text-black/60 leading-relaxed">
                      I agree to the{' '}
                      <button type="button" onClick={e => { e.preventDefault(); router.push('/privacy'); }}
                        className="underline text-black hover:text-black/60">Privacy Policy</button>
                      {' '}<span className="text-red-400">*</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={dataChecked} onChange={e => setDataChecked(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-black flex-shrink-0"/>
                    <span className="text-xs text-black/50 leading-relaxed">
                      Allow AutoBuild AI to use my anonymised print data to improve its models.{' '}
                      <span className="text-black/30">(Optional)</span>
                    </span>
                  </label>
                </div>

                <button onClick={handleOnboard} disabled={!nameInput.trim() || !tosChecked || !privChecked}
                  className="w-full py-3 bg-black text-white text-sm font-semibold rounded-xl hover:bg-black/80 disabled:opacity-30 transition-all">
                  Enter AutoBuild AI
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-black border-b border-white/10">
        <div className="max-w-5xl mx-auto px-6 py-1 flex items-center justify-between">
          <div className="-my-3">
            <Image src="/Autobuildwhite.png" alt="AutoBuild AI" width={400} height={400} className="h-20 w-auto"/>
          </div>
          <button onClick={() => router.push('/settings')}
            className="w-9 h-9 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center px-4 py-12 sm:py-16">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
          className="w-full max-w-3xl">

          {/* Greeting */}
          <div className="mb-10">
            {userName
              ? <h1 className="text-2xl sm:text-3xl font-bold text-black tracking-tight">{greeting(userName)}</h1>
              : <h1 className="text-2xl sm:text-3xl font-bold text-black tracking-tight">AutoBuild AI</h1>
            }
            <p className="text-sm text-black/40 mt-1.5">3D concrete printing — monitoring, optimisation, and path planning.</p>
          </div>

          {/* Primary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            {PRIMARY_TOOLS.map((tool, i) => (
              <motion.button key={tool.key}
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 + 0.05 }}
                onClick={() => router.push(tool.route)}
                className="group bg-white border border-gray-100 rounded-2xl p-6 text-left shadow-sm hover:shadow-md hover:border-black transition-all duration-200">
                <div className="w-12 h-12 rounded-xl bg-gray-50 group-hover:bg-black group-hover:text-white flex items-center justify-center mb-5 transition-all text-black/40">
                  {tool.icon}
                </div>
                <h2 className="text-base font-bold text-black mb-1.5">{tool.label}</h2>
                <p className="text-xs text-black/40 leading-relaxed">{tool.desc}</p>
                <div className="mt-5 text-[11px] font-semibold text-black/20 group-hover:text-black transition-colors">
                  Open →
                </div>
              </motion.button>
            ))}
          </div>

          {/* Secondary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
            {SECONDARY_TOOLS.map((tool, i) => (
              <motion.button key={tool.key}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 + 0.2 }}
                onClick={() => router.push(tool.route)}
                className="group bg-white border border-gray-100 rounded-2xl px-5 py-4 text-left shadow-sm hover:shadow-md hover:border-black transition-all duration-200 flex items-center gap-4">
                <div className="w-9 h-9 rounded-xl bg-gray-50 group-hover:bg-black group-hover:text-white flex items-center justify-center flex-shrink-0 transition-all text-black/40">
                  {tool.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-black">{tool.label}</p>
                  <p className="text-[11px] text-black/35 leading-relaxed mt-0.5 line-clamp-1">{tool.desc}</p>
                </div>
              </motion.button>
            ))}
          </div>

          {/* Recent slices */}
          {recentSlices.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-black/30">Recent Slices</p>
                <button onClick={() => router.push('/tools/slices')}
                  className="text-[11px] text-black/30 hover:text-black transition-colors">
                  View all →
                </button>
              </div>
              <div className="space-y-2">
                {recentSlices.map(s => (
                  <button key={s.id} onClick={() => router.push('/tools/slices')}
                    className="w-full bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center gap-3 hover:border-black transition-colors group text-left">
                    <div className="w-7 h-7 rounded-lg bg-gray-50 group-hover:bg-black group-hover:text-white flex items-center justify-center flex-shrink-0 transition-all text-black/30">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-black truncate">{s.file_name}</p>
                      <p className="text-[10px] text-black/35 mt-0.5">
                        {fmtDate(s.created_at)}
                        {s.print_time ? ` · ${s.print_time}` : ''}
                        {s.layers     ? ` · ${s.layers.toLocaleString()} layers` : ''}
                        {s.source     ? ` · ${s.source === 'pre-print' ? 'Pre-Print' : 'Slicer'}` : ''}
                      </p>
                    </div>
                    <svg className="w-3.5 h-3.5 text-black/20 group-hover:text-black/50 flex-shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                    </svg>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

        </motion.div>
      </main>
    </div>
  );
}
