'use client';

import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useProjects } from '@/lib/project-store';

interface AppNavProps {
  currentStep: 'printer' | 'pre-print' | 'monitor' | 'post-processing' | 'report';
}

const STEPS = [
  { key: 'printer',         label: 'Printer Setup',   route: '/printer-setup' },
  { key: 'pre-print',       label: 'Pre-Print',       route: '/pre-print-optimizer' },
  { key: 'monitor',         label: 'Live Monitor',    route: '/live-monitoring' },
  { key: 'post-processing', label: 'Post Processing', route: '/post-processing' },
  { key: 'report',          label: 'Report',          route: '/report' },
] as const;

export default function AppNav({ currentStep }: AppNavProps) {
  const router = useRouter();
  const { activeProject } = useProjects();
  const currentIdx = STEPS.findIndex(s => s.key === currentStep);

  return (
    <header className="border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10 overflow-visible">
      <div className="max-w-7xl mx-auto px-6 py-1 flex items-center justify-between">
        {/* Left — logo + breadcrumb */}
        <div className="flex items-center space-x-4">
          <button
            onClick={() => router.push('/')}
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors flex items-center space-x-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>Home</span>
          </button>
          <div className="h-6 w-px bg-gray-200" />
          <button onClick={() => router.push('/')} className="-my-5">
            <Image src="/Autobuildblack.png" alt="AutoBuild AI" width={400} height={400} className="h-36 w-auto" />
          </button>
          {activeProject && (
            <span className="text-sm font-medium text-gray-900 max-w-[200px] truncate">
              {activeProject.name}
            </span>
          )}
        </div>

        {/* Right — step indicator + tools */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {STEPS.map((s, i) => {
              const isActive = s.key === currentStep;
              const isDone   = i < currentIdx;
              const isLocked = i > currentIdx;
              return (
                <div key={s.key} className="flex items-center gap-1.5">
                  <button
                    onClick={() => !isLocked && router.push(s.route)}
                    disabled={isLocked}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors ${
                      isActive  ? 'bg-gray-900 text-white' :
                      isDone    ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' :
                      'bg-gray-50 text-gray-300 cursor-not-allowed'
                    }`}
                  >
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] border leading-none flex-shrink-0 ${
                      isActive ? 'border-white/40' :
                      isDone   ? 'border-gray-400' :
                      'border-gray-200'
                    }`}>
                      {isDone ? '✓' : i + 1}
                    </span>
                    {s.label}
                  </button>
                  {i < STEPS.length - 1 && (
                    <span className="text-gray-200 text-xs">›</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </header>
  );
}