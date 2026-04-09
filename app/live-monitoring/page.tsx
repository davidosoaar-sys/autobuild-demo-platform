'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useProjects, ProjectReport, ReportAlert } from '@/lib/project-store';
import AppNav from '@/components/AppNav';

type Tab = 'monitor' | 'sensors' | 'defects';

interface SensorReading {
  label: string;
  value: string;
  unit: string;
  status: 'ok' | 'warn' | 'error';
  trend?: 'up' | 'down' | 'stable';
  history: number[];
}

interface PrinterControl {
  printSpeed: number;
  extrusionRate: number;
  pumpPressure: number;
  paused: boolean;
}

interface Camera {
  id: string;
  label: string;
  angle: 'front' | 'side' | 'overhead' | 'nozzle' | 'custom';
  rtspUrl: string;
  active: boolean;
}

function Sparkline({ data, color = '#22c55e', width = 60, height = 24 }: {
  data: number[]; color?: string; width?: number; height?: number;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  );
}

function MiniSensor({ sensor }: { sensor: SensorReading }) {
  const colors = { ok: '#22c55e', warn: '#f59e0b', error: '#ef4444' };
  const bgColors = { ok: 'bg-emerald-50 border-emerald-200', warn: 'bg-amber-50 border-amber-200', error: 'bg-red-50 border-red-200' };
  const textColors = { ok: 'text-emerald-700', warn: 'text-amber-700', error: 'text-red-700' };
  return (
    <div className={`rounded-xl border p-3 ${bgColors[sensor.status]}`}>
      <div className="flex items-center justify-between mb-1">
        <span className={`text-[10px] font-semibold uppercase tracking-wide ${textColors[sensor.status]}`}>{sensor.label}</span>
        <div className={`w-1.5 h-1.5 rounded-full animate-pulse`} style={{background: colors[sensor.status]}}/>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <span className={`text-lg font-bold ${textColors[sensor.status]}`}>{sensor.value}</span>
          <span className={`text-[10px] ml-1 ${textColors[sensor.status]} opacity-60`}>{sensor.unit}</span>
        </div>
        <Sparkline data={sensor.history} color={colors[sensor.status]}/>
      </div>
    </div>
  );
}

function ControlSlider({ label, value, min, max, step, unit, onChange, warning }: {
  label: string; value: number; min: number; max: number;
  step: number; unit: string; onChange: (v: number) => void; warning?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between">
        <span className="text-xs font-medium text-black/60">{label}</span>
        <span className={`text-xs font-bold font-mono ${warning ? 'text-red-500' : 'text-black'}`}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 rounded-full appearance-none cursor-pointer"
        style={{ background: `linear-gradient(to right, ${warning ? '#ef4444' : '#000'} ${pct}%, #e5e7eb ${pct}%)` }}/>
      <div className="flex justify-between text-[9px] text-black/25">
        <span>{min}{unit}</span><span>{max}{unit}</span>
      </div>
    </div>
  );
}

function CameraView({ camera, onAngleChange }: { camera: Camera; onAngleChange: (id: string, angle: Camera['angle']) => void }) {
  const angles: Camera['angle'][] = ['front', 'side', 'overhead', 'nozzle'];
  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"/>
          <span className="text-xs font-semibold text-black">{camera.label}</span>
        </div>
        <div className="flex items-center gap-1">
          {angles.map(a => (
            <button key={a} onClick={() => onAngleChange(camera.id, a)}
              className={`px-2 py-0.5 text-[9px] font-semibold rounded-lg capitalize transition-all ${
                camera.angle === a ? 'bg-black text-white' : 'text-black/30 hover:text-black'
              }`}>
              {a}
            </button>
          ))}
        </div>
      </div>
      <div className="relative bg-black aspect-video flex items-center justify-center">
        <div className="absolute inset-0 opacity-5"
          style={{backgroundImage:'linear-gradient(rgba(255,255,255,0.15) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.15) 1px,transparent 1px)',backgroundSize:'24px 24px'}}/>
        {/* Angle-specific overlay */}
        <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 rounded-lg">
          <span className="text-[9px] text-white/60 font-mono uppercase">{camera.angle} view</span>
        </div>
        <div className="text-center z-10">
          <svg className="w-8 h-8 text-white/20 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
          </svg>
          <p className="text-white/25 text-[10px] mb-2">{camera.rtspUrl || 'No stream configured'}</p>
          <button className="text-[10px] text-white/40 border border-white/15 rounded-lg px-2 py-1 hover:border-white/40 transition-all">
            Connect Stream
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LiveMonitoring() {
  const router = useRouter();
  const { activeProject, updateProject } = useProjects();
  const startTimeRef = useRef<Date>(new Date());
  const sessionRef   = useRef({ layersPrinted: 0, errorsDetected: 0, alerts: [] as ReportAlert[] });
  const tickRef      = useRef<NodeJS.Timeout | null>(null);

  const [activeTab,   setActiveTab]   = useState<Tab>('monitor');
  const [showConfirm, setShowConfirm] = useState(false);
  const [elapsed,     setElapsed]     = useState(0);
  const [alertLog,    setAlertLog]    = useState<{time:string;msg:string;level:'info'|'warn'|'error'}[]>([]);

  const [controls, setControls] = useState<PrinterControl>({
    printSpeed: 60, extrusionRate: 100, pumpPressure: 4.2, paused: false,
  });

  const [cameras, setCameras] = useState<Camera[]>([
    { id: '1', label: 'Camera 1', angle: 'front',    rtspUrl: '', active: true },
    { id: '2', label: 'Camera 2', angle: 'overhead', rtspUrl: '', active: true },
  ]);

  const [sensors, setSensors] = useState<SensorReading[]>([
    { label: 'Ambient Temp',  value: '24.2', unit: '°C',   status: 'ok',   trend: 'stable', history: [24,24.1,24.2,24.1,24.2,24.3,24.2] },
    { label: 'Humidity',      value: '58',   unit: '%',    status: 'ok',   trend: 'stable', history: [57,58,58,59,58,57,58] },
    { label: 'Wind Speed',    value: '6.2',  unit: 'km/h', status: 'ok',   trend: 'up',     history: [4,5,5.5,6,6.1,6.2,6.2] },
    { label: 'Flow Rate',     value: '8.1',  unit: 'L/min',status: 'ok',   trend: 'stable', history: [8,8.1,8.1,8,8.1,8.2,8.1] },
    { label: 'Pump Pressure', value: '4.2',  unit: 'bar',  status: 'ok',   trend: 'stable', history: [4.1,4.2,4.2,4.3,4.2,4.2,4.2] },
    { label: 'Concrete Temp', value: '21.8', unit: '°C',   status: 'ok',   trend: 'stable', history: [21.5,21.6,21.7,21.8,21.8,21.8,21.8] },
    { label: 'Pot Life Left', value: '47',   unit: 'min',  status: 'warn', trend: 'down',   history: [60,58,55,53,51,49,47] },
    { label: 'Mix Consistency',value: '94',  unit: '%',    status: 'ok',   trend: 'stable', history: [93,94,95,94,94,93,94] },
  ]);

  useEffect(() => {
    tickRef.current = setInterval(() => {
      setElapsed(s => s + 1);
      setSensors(prev => prev.map(s => {
        const last  = parseFloat(s.value);
        const next  = Math.round((last + (Math.random() - 0.5) * 0.2) * 100) / 100;
        const newH  = [...s.history.slice(-8), next];
        let status: 'ok'|'warn'|'error' = s.status;
        if (s.label === 'Pot Life Left') status = next < 20 ? 'error' : next < 35 ? 'warn' : 'ok';
        return { ...s, value: String(next), history: newH, status };
      }));
    }, 3000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  const addAlert = (msg: string, level: 'info'|'warn'|'error' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setAlertLog(prev => [{ time, msg, level }, ...prev.slice(0, 19)]);
    if (level !== 'info') sessionRef.current.alerts.push({ time, layer: sessionRef.current.layersPrinted, message: msg });
  };

  const updateControl = (key: keyof PrinterControl, val: number | boolean) => {
    setControls(prev => ({ ...prev, [key]: val }));
    if (key !== 'paused') addAlert(`${key} set to ${val}`, 'info');
  };

  const addCamera = () => {
    const id = String(Date.now());
    setCameras(prev => [...prev, { id, label: `Camera ${prev.length + 1}`, angle: 'front', rtspUrl: '', active: true }]);
  };

  const removeCamera = (id: string) => setCameras(prev => prev.filter(c => c.id !== id));

  const updateCameraAngle = (id: string, angle: Camera['angle']) => {
    setCameras(prev => prev.map(c => c.id === id ? { ...c, angle } : c));
  };

  const fmtElapsed = () => {
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2,'0')}s`;
  };

  const endPrint = () => {
    if (!activeProject) return;
    const s = sessionRef.current;
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const report: ProjectReport = {
      generatedAt:    new Date().toISOString(),
      duration:       h > 0 ? `${h}h ${m}m` : `${m}m`,
      totalLayers:    activeProject.totalLayers,
      layersPrinted:  s.layersPrinted,
      errorsDetected: s.errorsDetected,
      errorRate:      activeProject.totalLayers > 0 ? `${((s.errorsDetected / activeProject.totalLayers) * 100).toFixed(1)}%` : '0%',
      alerts:         s.alerts,
      printerName:    activeProject.printer.name,
      structureType:  activeProject.structureType,
    };
    updateProject(activeProject.id, { status: 'complete', report });
    router.push('/report');
  };

  const keySensors = sensors.slice(0, 4); // show in sidebar

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <AppNav currentStep="monitor"/>
      <style>{`footer { display: none !important; }`}</style>

      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between sticky top-14 z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <motion.div className="w-2 h-2 rounded-full bg-emerald-500"
              animate={{ opacity: controls.paused ? 1 : [1,0.3,1] }}
              transition={{ duration: 1.2, repeat: Infinity }}/>
            <span className="text-sm font-semibold">{controls.paused ? 'Paused' : 'Printing'}</span>
          </div>
          <div className="h-4 w-px bg-gray-200"/>
          <span className="text-xs font-mono text-black/40">{fmtElapsed()}</span>
          {activeProject && <><div className="h-4 w-px bg-gray-200"/><span className="text-xs text-black/40">{activeProject.printer.name || '—'}</span></>}
        </div>
        <div className="flex items-center gap-2">
          {(['monitor','sensors','defects'] as Tab[]).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-xl capitalize transition-all ${
                activeTab === t ? 'bg-black text-white' : 'text-black/40 hover:text-black hover:bg-gray-100'
              }`}>{t === 'monitor' ? 'Monitor' : t === 'sensors' ? 'All Sensors' : 'Defect Detection'}</button>
          ))}
          <div className="h-4 w-px bg-gray-200"/>
          <button onClick={() => updateControl('paused', !controls.paused)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition-all ${
              controls.paused ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-amber-50 text-amber-600 border-amber-200'
            }`}>{controls.paused ? 'Resume' : 'Pause'}</button>
          <button onClick={() => setShowConfirm(true)}
            className="px-3 py-1.5 text-xs font-semibold bg-black text-white rounded-xl hover:bg-black/80 transition-all">
            End Print
          </button>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 pt-6">
        <AnimatePresence mode="wait">

          {/* ── MONITOR TAB — main layout ── */}
          {activeTab === 'monitor' && (
            <motion.div key="monitor" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
              className="grid grid-cols-[1fr_320px] gap-6">

              {/* Left: cameras */}
              <div className="space-y-4">
                {/* Camera grid */}
                <div className={`grid gap-4 ${cameras.length === 1 ? 'grid-cols-1' : cameras.length <= 2 ? 'grid-cols-2' : cameras.length <= 4 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  {cameras.map(cam => (
                    <div key={cam.id} className="relative group">
                      <CameraView camera={cam} onAngleChange={updateCameraAngle}/>
                      <button onClick={() => removeCamera(cam.id)}
                        className="absolute top-2 right-2 w-6 h-6 bg-black/60 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center hover:bg-red-600">
                        ×
                      </button>
                    </div>
                  ))}
                  {/* Add camera */}
                  <button onClick={addCamera}
                    className="aspect-video rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-2 hover:border-black hover:bg-gray-50 transition-all group">
                    <div className="w-8 h-8 rounded-full border-2 border-gray-200 group-hover:border-black flex items-center justify-center transition-all">
                      <span className="text-gray-300 group-hover:text-black text-lg transition-all">+</span>
                    </div>
                    <span className="text-xs text-black/30 group-hover:text-black transition-all">Add Camera</span>
                  </button>
                </div>

                {/* System log */}
                <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-3">System Log</h3>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {alertLog.length === 0 && <p className="text-xs text-black/25 text-center py-4">No events</p>}
                    {alertLog.map((a, i) => (
                      <div key={i} className={`flex gap-2 px-2 py-1.5 rounded-lg text-[11px] ${
                        a.level === 'error' ? 'bg-red-50 text-red-700' : a.level === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-black/50'
                      }`}>
                        <span className="font-mono opacity-50 flex-shrink-0">{a.time}</span>
                        <span>{a.msg}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right sidebar: controls + sensors */}
              <div className="space-y-4">

                {/* Printer controls */}
                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-4">Printer Control</h3>
                  <div className="space-y-5">
                    <ControlSlider label="Print Speed" value={controls.printSpeed} min={10} max={150} step={5} unit=" mm/s"
                      warning={controls.printSpeed > 120} onChange={v => updateControl('printSpeed', v)}/>
                    <ControlSlider label="Extrusion Rate" value={controls.extrusionRate} min={50} max={150} step={5} unit="%"
                      warning={controls.extrusionRate > 130} onChange={v => updateControl('extrusionRate', v)}/>
                    <ControlSlider label="Pump Pressure" value={controls.pumpPressure} min={1} max={10} step={0.1} unit=" bar"
                      warning={controls.pumpPressure > 8} onChange={v => updateControl('pumpPressure', v)}/>
                  </div>

                  {/* Quick actions */}
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    {[
                      { label: 'Home',  action: () => addAlert('Homing nozzle…') },
                      { label: 'Purge', action: () => addAlert('Purge started') },
                      { label: 'Prime', action: () => addAlert('Priming pump…') },
                      { label: 'E-Stop',action: () => { updateControl('paused', true); addAlert('EMERGENCY STOP', 'error'); }, danger: true },
                    ].map((btn, i) => (
                      <button key={i} onClick={btn.action}
                        className={`py-2 text-[11px] font-semibold rounded-xl border transition-all ${
                          (btn as any).danger ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100' : 'bg-gray-50 text-black border-gray-200 hover:bg-gray-100'
                        }`}>{btn.label}</button>
                    ))}
                  </div>
                </div>

                {/* Key sensor stats */}
                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Live Sensors</h3>
                    <button onClick={() => setActiveTab('sensors')} className="text-[10px] text-black/30 hover:text-black transition-colors">
                      View all →
                    </button>
                  </div>
                  <div className="space-y-3">
                    {keySensors.map((s, i) => <MiniSensor key={i} sensor={s}/>)}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── ALL SENSORS TAB ── */}
          {activeTab === 'sensors' && (
            <motion.div key="sensors" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="space-y-6">
              {[
                { title: 'Environmental', items: sensors.slice(0,3) },
                { title: 'Flow & Pressure', items: sensors.slice(3,5) },
                { title: 'Mix & Material', items: sensors.slice(5,8) },
              ].map(group => (
                <div key={group.title}>
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-3">{group.title}</h3>
                  <div className="grid grid-cols-4 gap-4">
                    {group.items.map((s, i) => (
                      <div key={i} className={`bg-white border rounded-2xl p-4 ${
                        s.status === 'ok' ? 'border-emerald-200' : s.status === 'warn' ? 'border-amber-200' : 'border-red-200'
                      }`}>
                        <div className="flex justify-between mb-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-black/40">{s.label}</p>
                          <div className={`w-2 h-2 rounded-full animate-pulse ${
                            s.status === 'ok' ? 'bg-emerald-500' : s.status === 'warn' ? 'bg-amber-500' : 'bg-red-500'
                          }`}/>
                        </div>
                        <div className="flex items-baseline gap-1 mb-2">
                          <span className="text-2xl font-bold text-black">{s.value}</span>
                          <span className="text-xs text-black/40">{s.unit}</span>
                        </div>
                        <Sparkline data={s.history} color={s.status === 'ok' ? '#22c55e' : s.status === 'warn' ? '#f59e0b' : '#ef4444'} width={100}/>
                      </div>
                    ))}
                    {/* Connect sensor card */}
                    <button className="bg-white border-2 border-dashed border-gray-200 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 hover:border-black transition-all group">
                      <span className="text-2xl text-gray-200 group-hover:text-black transition-all">+</span>
                      <span className="text-[10px] text-black/25 group-hover:text-black transition-all">Connect Sensor</span>
                    </button>
                  </div>
                </div>
              ))}
            </motion.div>
          )}

          {/* ── DEFECT DETECTION TAB ── */}
          {activeTab === 'defects' && (
            <motion.div key="defects" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
              <div className="bg-white border border-gray-100 rounded-2xl p-12 shadow-sm text-center">
                <div className="w-16 h-16 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-black/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-black mb-1">YOLOv8 Defect Detection</h3>
                <p className="text-xs text-black/40 mb-6 max-w-xs mx-auto">Upload an image from your camera feed to run real-time defect analysis on the printed layers.</p>
                <label className="cursor-pointer inline-flex items-center gap-2 px-5 py-2.5 bg-black text-white text-xs font-semibold rounded-xl hover:bg-black/80 transition-all">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                  </svg>
                  Upload Image for Analysis
                  <input type="file" accept="image/*" className="hidden" onChange={() => addAlert('Defect analysis started…')}/>
                </label>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* End print confirm */}
      <AnimatePresence>
        {showConfirm && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
            <motion.div initial={{scale:0.95}} animate={{scale:1}} exit={{scale:0.95}}
              className="bg-white rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl">
              <h3 className="text-base font-bold text-black mb-2">End print session?</h3>
              <p className="text-sm text-black/40 mb-6">This will generate your report and mark the project as complete.</p>
              <div className="flex gap-3">
                <button onClick={() => setShowConfirm(false)}
                  className="flex-1 py-2.5 text-sm font-semibold border border-gray-200 rounded-xl hover:bg-gray-50">Cancel</button>
                <button onClick={endPrint}
                  className="flex-1 py-2.5 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/80">
                  End & Generate Report
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}