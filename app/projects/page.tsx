'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { useProjects } from '@/lib/project-store';

const STRUCTURE_TYPES = ['Wall', 'Foundation', 'Column', 'Slab', 'Custom'];
const PRINTER_TYPES   = ['COBOD BOD2', 'Printerra P1', 'Custom Gantry', 'Delta 3DCP', 'Other'];

export default function ProjectsPage() {
  const router = useRouter();
  const { projects, createProject, setActiveProject } = useProjects();

  const [userName,    setUserName]    = useState('');
  const [nameInput,   setNameInput]   = useState('');
  const [showNameModal, setShowNameModal] = useState(false);
  const [showNew,     setShowNew]     = useState(false);
  const [newName,     setNewName]     = useState('');
  const [structure,   setStructure]   = useState(STRUCTURE_TYPES[0]);
  const [printerType, setPrinterType] = useState(PRINTER_TYPES[0]);
  const [printerName, setPrinterName] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('autobuild_user_name');
    if (saved) setUserName(saved);
    else setShowNameModal(true);
  }, []);

  const saveName = () => {
    const n = nameInput.trim();
    if (!n) return;
    localStorage.setItem('autobuild_user_name', n);
    setUserName(n);
    setShowNameModal(false);
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    const id = createProject({
      name:          newName.trim(),
      structureType: structure,
      printer: { name: printerName || printerType, type: printerType },
      status:        'setup',
      totalLayers:   100,
    });
    setActiveProject(id);
    router.push('/pre-print-optimizer');
  };

  const openProject = (id: string) => {
    setActiveProject(id);
    router.push('/pre-print-optimizer');
  };

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Name modal */}
      <AnimatePresence>
        {showNameModal && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <motion.div initial={{scale:0.95,y:8}} animate={{scale:1,y:0}} exit={{scale:0.95}}
              className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
              <div className="bg-black px-6 py-5">
                <Image src="/logo.png" alt="AutoBuild AI" width={200} height={200} className="h-14 w-auto mb-3"/>
                <p className="text-white font-bold text-lg leading-snug">Welcome to AutoBuild AI</p>
                <p className="text-white/40 text-xs mt-1">What should we call you?</p>
              </div>
              <div className="px-6 py-5">
                <input
                  autoFocus
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveName()}
                  placeholder="Your name"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-black transition-colors mb-4"
                />
                <button onClick={saveName} disabled={!nameInput.trim()}
                  className="w-full py-3 bg-black text-white text-sm font-semibold rounded-xl hover:bg-black/80 disabled:opacity-30 transition-all">
                  Get Started
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-1 flex items-center justify-between">
          <Image src="/logo.png" alt="AutoBuild AI" width={400} height={400} className="h-20 sm:h-24 w-auto"/>
          {userName && (
            <button onClick={() => setShowNameModal(true)}
              className="text-xs text-black/40 hover:text-black transition-colors">
              {userName}
            </button>
          )}
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-10">

        {/* Welcome */}
        {userName && (
          <div className="mb-8">
            <p className="text-2xl sm:text-3xl font-bold text-black tracking-tight">
              {greeting()}, {userName}.
            </p>
            <p className="text-sm text-black/40 mt-1">
              {projects.length === 0
                ? 'Start your first print project below.'
                : `You have ${projects.length} project${projects.length !== 1 ? 's' : ''}.`}
            </p>
          </div>
        )}

        {/* New project button */}
        <div className="flex items-center justify-between mb-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-black/30">Projects</p>
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2 bg-black text-white text-xs font-semibold rounded-xl hover:bg-black/80 transition-all">
            <span className="text-base leading-none">+</span>
            New Project
          </button>
        </div>

        {/* Project list */}
        {projects.length === 0 ? (
          <div className="border-2 border-dashed border-gray-200 rounded-2xl py-16 text-center">
            <p className="text-sm font-medium text-black/30 mb-1">No projects yet</p>
            <p className="text-xs text-black/20">Create your first 3DCP project to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((p, i) => (
              <motion.button key={p.id} initial={{opacity:0,y:4}} animate={{opacity:1,y:0}}
                transition={{delay:i*0.04}}
                onClick={() => openProject(p.id)}
                className="w-full bg-white border border-gray-100 rounded-2xl px-5 py-4 flex items-center justify-between hover:border-black transition-all group text-left shadow-sm">
                <div>
                  <p className="text-sm font-semibold text-black group-hover:text-black">{p.name}</p>
                  <p className="text-[11px] text-black/35 mt-0.5">
                    {p.structureType} · {p.printer.name}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${
                    p.status === 'complete' ? 'border-black/10 bg-black/5 text-black' :
                    p.status === 'printing' ? 'border-black/20 bg-black text-white' :
                    'border-gray-200 text-black/30'
                  }`}>
                    {p.status === 'complete' ? 'Complete' :
                     p.status === 'printing' ? 'Printing' : 'Setup'}
                  </span>
                  <svg className="w-4 h-4 text-black/20 group-hover:text-black transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                  </svg>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>

      {/* New project modal */}
      <AnimatePresence>
        {showNew && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <motion.div initial={{scale:0.95,y:8}} animate={{scale:1,y:0}} exit={{scale:0.95}}
              className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
              <h3 className="text-base font-bold text-black mb-5">New Project</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-1.5 block">Project Name</label>
                  <input value={newName} onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                    placeholder="e.g. Wall Section A"
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-black transition-colors"/>
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-1.5 block">Structure Type</label>
                  <div className="flex flex-wrap gap-1.5">
                    {STRUCTURE_TYPES.map(s => (
                      <button key={s} onClick={() => setStructure(s)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${structure === s ? 'bg-black text-white' : 'border border-gray-200 text-black/40 hover:text-black'}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-1.5 block">Printer</label>
                  <select value={printerType} onChange={e => setPrinterType(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-black transition-colors bg-white mb-2">
                    {PRINTER_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                  <input value={printerName} onChange={e => setPrinterName(e.target.value)}
                    placeholder="Custom printer name (optional)"
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-black transition-colors"/>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setShowNew(false)}
                  className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl text-black/40 hover:text-black hover:border-black transition-colors">
                  Cancel
                </button>
                <button onClick={handleCreate} disabled={!newName.trim()}
                  className="flex-1 py-2.5 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/80 disabled:opacity-30 transition-all">
                  Create
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}