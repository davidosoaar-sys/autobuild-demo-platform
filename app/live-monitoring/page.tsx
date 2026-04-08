'use client';

import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useProjects, ProjectReport, ReportAlert } from '@/lib/project-store';
import AppNav from '@/components/AppNav';
import ImageDetection from './components/ImageDetection';
import LiveFeed from './components/LiveFeed';

type Tab = 'live' | 'image';

export default function LiveMonitoring() {
  const router = useRouter();
  const { activeProject, updateProject } = useProjects();

  const [activeTab,   setActiveTab]   = useState<Tab>('live');
  const [showConfirm, setShowConfirm] = useState(false);
  const startTimeRef = useRef<Date>(new Date());
  const sessionRef   = useRef({ layersPrinted: 0, errorsDetected: 0, alerts: [] as ReportAlert[] });

  const endPrint = () => {
    if (!activeProject) return;
    const elapsed  = Date.now() - startTimeRef.current.getTime();
    const h        = Math.floor(elapsed / 3600000);
    const m        = Math.floor((elapsed % 3600000) / 60000);
    const sec      = Math.floor((elapsed % 60000) / 1000);
    const duration = h > 0 ? `${h}h ${m}m` : `${m}m ${sec}s`;
    const s        = sessionRef.current;

    const report: ProjectReport = {
      generatedAt:    new Date().toISOString(),
      duration,
      totalLayers:    activeProject.totalLayers,
      layersPrinted:  s.layersPrinted,
      errorsDetected: s.errorsDetected,
      errorRate:      activeProject.totalLayers > 0
        ? `${((s.errorsDetected / activeProject.totalLayers) * 100).toFixed(1)}%`
        : '0%',
      alerts:         s.alerts,
      printerName:    activeProject.printer.name,
      structureType:  activeProject.structureType,
    };

    updateProject(activeProject.id, { status: 'complete', report });
    router.push('/report');
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <AppNav currentStep="monitor" />

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Tabs — Live Feed first, Image Detection second */}
        <div className="flex space-x-2 mb-8 bg-white rounded-xl p-1.5 border border-gray-100 w-fit shadow-sm">
          {([
            { key: 'live',  label: 'Live Feed Analysis' },
            { key: 'image', label: 'Image Detection'    },
          ] as { key: Tab; label: string }[]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? 'bg-black text-white shadow-sm'
                  : 'text-black/50 hover:text-black hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          {activeTab === 'live'  && <LiveFeed />}
          {activeTab === 'image' && <ImageDetection />}
        </motion.div>
      </div>

      {/* End Print footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-black">{activeProject?.name || 'Current print'}</p>
            <p className="text-xs text-black/40 mt-0.5">
              {activeProject?.printer.name} · {activeProject?.totalLayers} layers total
            </p>
          </div>

          {showConfirm ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-black/50">End session and generate report?</span>
              <button onClick={endPrint}
                className="px-5 py-2.5 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/90 transition-colors">
                Confirm
              </button>
              <button onClick={() => setShowConfirm(false)}
                className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl text-black hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setShowConfirm(true)}
              className="px-6 py-2.5 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/90 transition-colors">
              End Print &amp; View Report
            </button>
          )}
        </div>
      </div>
    </div>
  );
}