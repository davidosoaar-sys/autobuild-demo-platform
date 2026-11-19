'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight, ChevronRight, CircleHelp, FileBox, FolderOpen, Layers3, ScanLine, Settings, Video } from 'lucide-react';
import './dashboard.css';
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

function ConstructionContours() {
  return <svg className="dashboard-contours" viewBox="0 0 300 200" fill="none" aria-hidden="true">
    {Array.from({ length: 12 }, (_, layer) => <path key={layer} transform={`translate(0 ${layer * 9})`}
      d="M12 103 125 40Q146 28 167 40L281 99M68 132 178 70Q194 62 210 70L290 111" />)}
  </svg>;
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
  const [recentSlices,      setRecentSlices]      = useState<RecentSlice[]>([]);
  const [sliceState, setSliceState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [showSlicerPicker, setShowSlicerPicker] = useState(false);

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
      .then(({ data, error }) => {
        if (data) setRecentSlices(data);
        setSliceState(error ? 'error' : 'ready');
      });
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

  return (
    <div className="inspection-workspace dashboard">

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

      {/* Slicer picker modal */}
      <AnimatePresence>
        {showSlicerPicker && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowSlicerPicker(false)}>
            <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
              <div className="bg-black px-6 py-5">
                <p className="text-white font-bold text-lg">Choose Slicer Mode</p>
                <p className="text-white/40 text-xs mt-1">How would you like to generate your print path?</p>
              </div>
              <div className="p-4 space-y-3">
                <button
                  onClick={() => { setShowSlicerPicker(false); router.push('/tools/slicer'); }}
                  className="w-full flex items-start gap-4 bg-gray-50 hover:bg-black hover:text-white rounded-xl p-4 text-left transition-all group">
                  <div className="mt-0.5 flex-shrink-0">
                    <svg className="w-5 h-5 text-black/40 group-hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-bold">Traditional Slicer</p>
                    <p className="text-xs text-black/40 group-hover:text-white/60 mt-0.5 leading-relaxed">
                      Upload a 3D model (STL, OBJ, IFC…) and slice it into print layers.
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => { setShowSlicerPicker(false); router.push('/floorplan'); }}
                  className="w-full flex items-start gap-4 bg-gray-50 hover:bg-black hover:text-white rounded-xl p-4 text-left transition-all group">
                  <div className="mt-0.5 flex-shrink-0">
                    <svg className="w-5 h-5 text-black/40 group-hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-1.447-.894L15 9m0 8V9m0 0L9 7"/>
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-bold">Floor Plan</p>
                    <p className="text-xs text-black/40 group-hover:text-white/60 mt-0.5 leading-relaxed">
                      Upload a PDF floor plan and extract wall geometry as a print path.
                    </p>
                  </div>
                </button>
                <button onClick={() => setShowSlicerPicker(false)}
                  className="w-full py-2 text-xs text-black/30 hover:text-black transition-colors">
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="inspection-glass inspection-topbar">
        <div className="inspection-header-inner dashboard-width">
          <Link href="/" className="inspection-brand" aria-label="AutoBuild home">
            <Image src="/Autobuildblack.png" alt="AutoBuild" width={400} height={400} priority />
          </Link>
          <nav className="dashboard-utilities" aria-label="Workspace utilities">
            <Link href="/help"><CircleHelp size={18} aria-hidden="true" /> Help</Link>
            <Link href="/settings" aria-label="Settings"><Settings size={18} aria-hidden="true" /></Link>
          </nav>
        </div>
      </header>

      <main className="dashboard-width dashboard-main">
        <div className="dashboard-intro">
          <h1>Print workspace</h1>
          <p>{userName ? `${greeting(userName)} ` : ''}Plan a print, monitor it on site, or review a layer photo.</p>
        </div>

        <div className="dashboard-primary">
          <Link className="dashboard-glass dashboard-project" href="/projects">
            <ConstructionContours />
            <span className="dashboard-primary-copy">
              <FolderOpen size={25} strokeWidth={1.6} aria-hidden="true" />
              <span className="dashboard-card-title">Projects</span>
              <span className="dashboard-description">Set up print jobs and track them from planning through monitoring.</span>
              <span className="dashboard-cta">Open projects <ArrowUpRight size={16} aria-hidden="true" /></span>
            </span>
          </Link>
          <button type="button" className="dashboard-glass dashboard-slicer" onClick={() => setShowSlicerPicker(true)}>
            <Layers3 size={25} strokeWidth={1.6} aria-hidden="true" />
            <span className="dashboard-card-title">Slicer</span>
            <span className="dashboard-description">Turn a 3D model or floor plan into a concrete print path.</span>
            <span className="dashboard-cta">Choose slicer mode <ArrowUpRight size={16} aria-hidden="true" /></span>
          </button>
        </div>

        <section aria-labelledby="dashboard-inspection">
          <h2 id="dashboard-inspection" className="dashboard-section-title">Print inspection</h2>
          <div className="dashboard-glass dashboard-inspection">
            <Link href="/tools/monitor">
              <Video size={22} strokeWidth={1.6} aria-hidden="true" />
              <span><strong>Live Monitor</strong><small>Watch camera views and track layers during a print.</small></span>
              <ChevronRight size={18} aria-hidden="true" />
            </Link>
            <Link href="/tools/image-analysis">
              <ScanLine size={22} strokeWidth={1.6} aria-hidden="true" />
              <span><strong>Image Analysis</strong><small>Review observations from a layer photo.</small></span>
              <ChevronRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section className="dashboard-history" aria-labelledby="dashboard-history-title">
          <div className="dashboard-history-head">
            <h2 id="dashboard-history-title" className="dashboard-section-title">Recent slices</h2>
            <Link href="/tools/slices">My Slices <ChevronRight size={16} aria-hidden="true" /></Link>
          </div>
          {sliceState === 'loading' ? <p role="status">Loading saved slices…</p>
            : sliceState === 'error' ? <p role="status">Couldn’t load recent slices. Open My Slices to try again.</p>
            : recentSlices.length === 0 ? <p>No saved slices yet. Saved toolpaths will appear here.</p>
            : <ul className="dashboard-history-list">
              {recentSlices.map(slice => <li key={slice.id}>
                <Link href="/tools/slices">
                  <FileBox size={19} aria-hidden="true" />
                  <span><strong>{slice.file_name}</strong><small>
                    {[fmtDate(slice.created_at), slice.print_time, slice.layers === null ? null : `${slice.layers.toLocaleString()} layers`,
                      slice.source ? (slice.source === 'pre-print' ? 'Pre-Print' : 'Slicer') : null].filter(Boolean).join(' · ')}
                  </small></span>
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              </li>)}
            </ul>}
        </section>
      </main>
    </div>
  );
}
