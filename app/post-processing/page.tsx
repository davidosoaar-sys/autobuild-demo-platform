'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useProjects } from '@/lib/project-store';
import AppNav from '@/components/AppNav';
import { DefectDetectionPanel } from '@/app/live-monitoring/page';

export default function PostProcessingPage() {
  const router = useRouter();
  const { activeProject, updateProject } = useProjects();

  useEffect(() => {
    if (!activeProject) router.push('/projects');
  }, [activeProject, router]);

  const handleViewReport = async () => {
    if (!activeProject) return;
    await updateProject(activeProject.id, { status: 'complete' });
    router.push('/report');
  };

  if (!activeProject) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav currentStep="post-processing" />

      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Post Processing</h1>
          <p className="text-sm text-gray-500 mt-0.5">Review defect scan results before finalising the report.</p>
        </div>

        {/* Defect detection panel */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <DefectDetectionPanel onAlert={() => {}} />
        </div>

        {/* Action */}
        <div className="flex justify-end">
          <button
            onClick={handleViewReport}
            className="px-6 py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-black transition-colors"
          >
            View Report →
          </button>
        </div>

      </div>
    </div>
  );
}
