'use client';

import AppNav from '@/components/AppNav';
import { DefectDetectionPanel } from '@/app/live-monitoring/page';

export default function ImageAnalysisPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav />

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
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
