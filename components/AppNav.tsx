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
    <header className="border-b border-gray-200 bg-white sticky top-0 z-10 overflow-visible">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
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
          <button onClick={() => router.push('/')} className="inspection-brand" aria-label="AutoBuild home">
            <Image src="/autobuild-wordmark.png" alt="AutoBuild" width={422} height={120} />
          </button>
          {activeProject && (
            <span className="text-sm font-medium text-gray-900 max-w-[100px] sm:max-w-[200px] truncate">
              {activeProject.name}
            </span>
          )}
        </div>

        {/* Right — step indicator + tools */}
        <div className="flex items-start gap-3 min-w-0 max-w-full py-1">
          <button
            onClick={() => router.push('/help')}
            title="How AutoBuild AI works"
            className="w-6 h-6 rounded-full border border-gray-200 text-gray-400 hover:text-gray-900 hover:border-gray-900 transition-colors flex items-center justify-center text-xs font-semibold flex-shrink-0"
          >
            ?
          </button>
          <div className="flex flex-wrap items-center gap-1.5">
            {STEPS.map((s, i) => {
              const isActive = s.key === currentStep;
              const isDone   = i < currentIdx;
              const isLocked = i > currentIdx;
              return (
                <div key={s.key} className="flex items-center gap-1.5">
                  <button
                    onClick={() => !isLocked && router.push(s.route)}
                    disabled={isLocked}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${
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
                    <span className="hidden sm:inline text-gray-200 text-xs" aria-hidden="true">›</span>
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