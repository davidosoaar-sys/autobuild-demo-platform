'use client';

import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { DefectDetectionPanel } from '@/app/live-monitoring/page';

export default function ImageAnalysisPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Minimal header — no step tabs */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-2 flex items-center gap-4">
          <button
            onClick={() => router.push('/')}
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Home
          </button>
          <div className="h-6 w-px bg-gray-200" />
          <button onClick={() => router.push('/')} className="-my-4">
            <Image src="/Autobuildblack.png" alt="AutoBuild AI" width={400} height={400} className="h-20 w-auto" />
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Image Analysis</h1>
          <p className="text-sm text-gray-500 mt-0.5">Upload a bead photo for AI defect detection and quality scoring.</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <DefectDetectionPanel onAlert={() => {}} />
        </div>
      </div>
    </div>
  );
}
