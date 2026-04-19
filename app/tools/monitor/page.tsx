'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CameraView, BeadEventLog, AlertBanner,
  type Camera, type BeadAnalysis,
} from '@/app/live-monitoring/page';

interface AlertEntry {
  time: string;
  msg: string;
  level: 'info' | 'warn' | 'error';
}

export default function StandaloneMonitor() {
  const router   = useRouter();
  const startRef = useRef(Date.now());
  const [elapsed,     setElapsed]     = useState(0);
  const [cameras,     setCameras]     = useState<Camera[]>([]);
  const [beadLog,     setBeadLog]     = useState<BeadAnalysis[]>([]);
  const [alertLog,    setAlertLog]    = useState<AlertEntry[]>([]);
  const [activeAlert, setActiveAlert] = useState<BeadAnalysis | null>(null);

  useEffect(() => {
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);

  const fmtElapsed = () => {
    const h = Math.floor(elapsed / 3600), m = Math.floor((elapsed % 3600) / 60), s = elapsed % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`;
  };

  const addAlert = useCallback((msg: string, level: 'info' | 'warn' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setAlertLog(prev => [{ time, msg, level }, ...prev.slice(0, 49)]);
  }, []);

  const handleBeadLog = useCallback((analysis: BeadAnalysis) => {
    setBeadLog(prev => [analysis, ...prev.slice(0, 99)]);
    const level: 'info' | 'warn' | 'error' = analysis.severity === 'high' ? 'error' : analysis.severity === 'medium' ? 'warn' : 'info';
    const msg = analysis.verdict === 'unclear'
      ? `Bead unclear — ${analysis.cameraLabel}`
      : `[${analysis.cameraLabel}] ${analysis.verdict}${analysis.angle_deviation !== 0 ? ` ${analysis.angle_deviation > 0 ? '+' : ''}${analysis.angle_deviation.toFixed(1)}°` : ''}${analysis.defect_type !== 'none' ? ` · ${analysis.defect_type}` : ''}`;
    addAlert(msg, level);
  }, [addAlert]);

  const handleBeadAlert = useCallback((analysis: BeadAnalysis) => setActiveAlert(analysis), []);

  const addCamera    = () => { const id = String(Date.now()); setCameras(prev => [...prev, { id, label: `Camera ${prev.length + 1}`, angle: 'front', active: true }]); };
  const removeCamera = (id: string) => setCameras(prev => prev.filter(c => c.id !== id));
  const updateAngle  = (id: string, angle: Camera['angle']) => setCameras(prev => prev.map(c => c.id === id ? { ...c, angle } : c));
  const renameCamera = (id: string, label: string) => setCameras(prev => prev.map(c => c.id === id ? { ...c, label } : c));

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/')} className="text-base font-bold text-black tracking-tight hover:text-black/60 transition-colors">AutoBuild AI</button>
            <span className="w-px h-4 bg-gray-200" />
            <span className="text-sm font-medium text-black/40">Live Monitor</span>
          </div>
          <span className="text-2xl font-bold font-mono text-black tracking-tight">{fmtElapsed()}</span>
        </div>
      </header>

      <AnimatePresence>
        {activeAlert && <AlertBanner analysis={activeAlert} onDismiss={() => setActiveAlert(null)} />}
      </AnimatePresence>

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 pt-6 space-y-4">

        {/* Camera grid */}
        <div className={`grid gap-4 ${
          cameras.length === 0 ? 'grid-cols-1' :
          cameras.length === 1 ? 'grid-cols-1' :
          cameras.length <= 4  ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
        }`}>
          {cameras.map(cam => (
            <div key={cam.id} className="relative group">
              <CameraView camera={cam} onAngleChange={updateAngle} onRename={renameCamera}
                onRemove={removeCamera} onBeadAlert={handleBeadAlert} onBeadLog={handleBeadLog} />
              <button onClick={() => removeCamera(cam.id)}
                className="absolute top-10 right-2 w-5 h-5 bg-black/70 text-white rounded-full text-[10px] opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center hover:bg-red-600 z-20">
                ×
              </button>
            </div>
          ))}
          <button onClick={addCamera}
            className="aspect-video rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-2 hover:border-black hover:bg-gray-50 transition-all group min-h-[160px]">
            <div className="w-10 h-10 rounded-full border-2 border-gray-200 group-hover:border-black flex items-center justify-center transition-all">
              <span className="text-gray-300 group-hover:text-black text-xl">+</span>
            </div>
            <span className="text-xs text-black/30 group-hover:text-black transition-all">Add Camera</span>
          </button>
        </div>

        {/* Bead Analysis Log */}
        {beadLog.length > 0 && <BeadEventLog entries={beadLog} />}

        {/* System log */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-3">System Log</h3>
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {alertLog.length === 0 && <p className="text-xs text-black/25 text-center py-3">No events</p>}
            {alertLog.map((a, i) => (
              <div key={i} className={`flex gap-2 px-2 py-1 rounded-lg text-[11px] ${a.level === 'error' ? 'bg-red-50 text-red-700' : a.level === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-black/50'}`}>
                <span className="font-mono opacity-50 flex-shrink-0">{a.time}</span>
                <span className="truncate">{a.msg}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
