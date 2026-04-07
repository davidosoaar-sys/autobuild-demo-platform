'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useProjects, Project } from '@/lib/project-store';

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'Just now';
}

const STATUS: Record<Project['status'], { label: string; dotClass: string; pillClass: string }> = {
  setup:         { label: 'Setup',     dotClass: 'bg-black/20',                  pillClass: 'bg-gray-100 text-black/50' },
  'pre-print':   { label: 'Pre-Print', dotClass: 'bg-black/50',                  pillClass: 'bg-gray-100 text-black/70' },
  printing:      { label: 'Printing',  dotClass: 'bg-white animate-pulse',        pillClass: '' },
  complete:      { label: 'Complete',  dotClass: 'bg-black',                      pillClass: 'bg-gray-100 text-black' },
};

// Standard Home is first so it's the default
const STRUCTURES = [
  'Standard Home',
  'Load-bearing wall',
  'Foundation slab',
  'Column',
  'Partition wall',
  'Retaining wall',
  'Custom',
];

function CreateModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (name: string, desc: string, structure: string, address: string) => void;
}) {
  const [name,      setName]      = useState('');
  const [desc,      setDesc]      = useState('');
  const [address,   setAddress]   = useState('');
  const [structure, setStructure] = useState(STRUCTURES[0]);

  const canSubmit = name.trim().length > 0;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div>
            <h2 className="text-sm font-semibold text-black">New Project</h2>
            <p className="text-xs text-black/40 mt-0.5">Set up your print job</p>
          </div>
          <button onClick={onClose}
            className="text-black/20 hover:text-black transition-colors text-xl leading-none w-7 h-7 flex items-center justify-center">
            &times;
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-black mb-1.5">Project name</label>
            <input
              value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Wall Section A"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-black transition-colors text-black placeholder:text-black/20"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-black mb-1.5">
              Description <span className="text-black/30 font-normal">(optional)</span>
            </label>
            <textarea
              value={desc} onChange={e => setDesc(e.target.value)}
              placeholder="Brief notes about this print job"
              rows={2}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-black transition-colors text-black placeholder:text-black/20 resize-none"
            />
          </div>

          {/* Address */}
          <div>
            <label className="block text-xs font-medium text-black mb-1.5">
              Site address <span className="text-black/30 font-normal">(optional)</span>
            </label>
            <input
              value={address} onChange={e => setAddress(e.target.value)}
              placeholder="e.g. 14 Riverside Drive, Lagos"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-black transition-colors text-black placeholder:text-black/20"
            />
          </div>

          {/* Structure type */}
          <div>
            <label className="block text-xs font-medium text-black mb-2">Structure type</label>
            <div className="grid grid-cols-2 gap-2">
              {STRUCTURES.map(s => (
                <button
                  key={s}
                  onClick={() => setStructure(s)}
                  className={`px-3 py-2 text-xs rounded-xl border transition-colors text-left ${
                    structure === s
                      ? 'border-black bg-black text-white'
                      : 'border-gray-200 text-black hover:border-black'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl text-black hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => canSubmit && onCreate(name, desc, structure, address)}
            disabled={!canSubmit}
            className="flex-1 py-2.5 text-sm bg-black text-white rounded-xl hover:bg-black/90 disabled:opacity-30 transition-colors font-medium"
          >
            Create Project
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ project, onOpen, onDelete }: {
  project: Project; onOpen: () => void; onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isPrinting = project.status === 'printing';
  const st = STATUS[project.status];

  return (
    <div className={`rounded-2xl overflow-hidden border transition-shadow hover:shadow-lg ${
      isPrinting ? 'bg-black border-black' : 'bg-white border-gray-100'
    }`}>
      <button onClick={onOpen} className="w-full text-left p-5">
        {/* Status row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${st.dotClass}`} />
            <span className={`text-[10px] font-semibold uppercase tracking-widest ${
              isPrinting ? 'text-white/50' : 'text-black/40'
            }`}>
              {st.label}
            </span>
          </div>
          <span className={`text-[10px] ${isPrinting ? 'text-white/25' : 'text-black/20'}`}>
            {timeAgo(project.createdAt)}
          </span>
        </div>

        {/* Name + desc */}
        <h3 className={`text-sm font-semibold mb-0.5 truncate ${isPrinting ? 'text-white' : 'text-black'}`}>
          {project.name}
        </h3>
        {project.description && (
          <p className={`text-xs mb-1 truncate ${isPrinting ? 'text-white/40' : 'text-black/40'}`}>
            {project.description}
          </p>
        )}

        {/* Address */}
        {(project as any).address && (
          <p className={`text-[11px] mb-3 truncate ${isPrinting ? 'text-white/30' : 'text-black/30'}`}>
            {(project as any).address}
          </p>
        )}

        {/* Stats */}
        <div className={`grid grid-cols-3 gap-3 pt-4 border-t ${isPrinting ? 'border-white/10' : 'border-gray-100'}`}>
          {[
            { label: 'Structure', value: project.structureType },
            { label: 'Layers',    value: project.totalLayers > 0 ? String(project.totalLayers) : '—' },
            { label: 'Speed',     value: `${project.printSpeed} mm/s` },
          ].map((s, i) => (
            <div key={i}>
              <div className={`text-[10px] uppercase tracking-wider mb-0.5 ${isPrinting ? 'text-white/30' : 'text-black/30'}`}>
                {s.label}
              </div>
              <div className={`text-xs font-medium truncate ${isPrinting ? 'text-white' : 'text-black'}`}>
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* Printer */}
        <div className="flex items-center gap-1.5 mt-4">
          <div className={`w-1.5 h-1.5 rounded-full ${
            project.printer.status === 'connected'
              ? isPrinting ? 'bg-white/60' : 'bg-black'
              : isPrinting ? 'bg-white/20' : 'bg-black/20'
          }`} />
          <span className={`text-[11px] truncate ${isPrinting ? 'text-white/40' : 'text-black/40'}`}>
            {project.printer.name || 'No printer assigned'}
          </span>
        </div>
      </button>

      {/* Actions */}
      <div className={`px-5 pb-5 pt-4 flex gap-2 border-t ${isPrinting ? 'border-white/10' : 'border-gray-100'}`}>
        <button onClick={onOpen}
          className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-colors ${
            isPrinting
              ? 'bg-white text-black hover:bg-white/90'
              : 'bg-black text-white hover:bg-black/90'
          }`}>
          Open
        </button>
        {confirmDelete ? (
          <>
            <button onClick={onDelete}
              className={`px-3 py-2 text-xs font-semibold rounded-xl transition-colors ${
                isPrinting ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-red-50 text-red-600 hover:bg-red-100'
              }`}>
              Confirm
            </button>
            <button onClick={() => setConfirmDelete(false)}
              className={`px-3 py-2 text-xs rounded-xl border transition-colors ${
                isPrinting ? 'border-white/20 text-white/50 hover:bg-white/10' : 'border-gray-200 text-black/40 hover:bg-gray-50'
              }`}>
              Cancel
            </button>
          </>
        ) : (
          <button onClick={() => setConfirmDelete(true)}
            className={`px-3 py-2 text-xs rounded-xl border transition-colors ${
              isPrinting ? 'border-white/20 text-white/30 hover:bg-white/10' : 'border-gray-200 text-black/30 hover:bg-gray-50'
            }`}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const router = useRouter();
  const { projects, setActiveProject, createProject, deleteProject } = useProjects();
  const [showCreate, setShowCreate] = useState(false);

  const activelyPrinting = projects.find(p => p.status === 'printing');

  const handleCreate = (name: string, desc: string, structure: string, address: string) => {
    const p = createProject({
      name,
      description: desc,
      structureType: structure,
      printer: { name: '', model: '', ip: '', status: 'idle' },
      totalLayers: 0,
      printSpeed: 60,
      ...(address ? { address } : {}),
    } as any);
    setActiveProject(p);
    setShowCreate(false);
    router.push('/printer-setup');
  };

  const handleOpen = (project: Project) => {
    setActiveProject(project);
    if (project.status === 'setup')          router.push('/printer-setup');
    else if (project.status === 'pre-print') router.push('/pre-print-optimizer');
    else if (project.status === 'printing')  router.push('/live-monitoring');
    else                                     router.push('/report');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white sticky top-0 z-10 overflow-visible">
        <div className="max-w-7xl mx-auto px-6 py-1 flex items-center justify-between">
          <div className="-my-6">
            <Image src="/logo.png" alt="AutoBuild AI" width={400} height={400} className="h-40 w-auto" />
          </div>
          <button onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-black text-white text-sm font-medium rounded-xl hover:bg-black/90 transition-colors">
            New Project
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-black tracking-tight">Projects</h1>
            <p className="text-xs text-black/40 mt-0.5">{projects.length} total</p>
          </div>
        </div>

        {/* Active print banner */}
        {activelyPrinting && (
          <div className="bg-black rounded-2xl px-6 py-4 mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <div>
                <p className="text-sm font-semibold text-white">
                  {activelyPrinting.name} is currently printing
                </p>
                <p className="text-xs text-white/40 mt-0.5">{activelyPrinting.printer.name}</p>
              </div>
            </div>
            <button onClick={() => handleOpen(activelyPrinting)}
              className="px-4 py-2 bg-white text-black text-xs font-semibold rounded-xl hover:bg-white/90 transition-colors">
              View Live Feed
            </button>
          </div>
        )}

        {/* Grid */}
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 bg-white rounded-2xl border border-gray-100">
            <p className="text-sm font-medium text-black mb-1">No projects yet</p>
            <p className="text-xs text-black/40 mb-4">Create your first print job to get started</p>
            <button onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-black text-white text-xs font-semibold rounded-xl hover:bg-black/90 transition-colors">
              New Project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map(p => (
              <ProjectCard
                key={p.id} project={p}
                onOpen={() => handleOpen(p)}
                onDelete={() => deleteProject(p.id)}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      )}
    </div>
  );
}