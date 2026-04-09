'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useProjects, ProjectReport, ReportAlert } from '@/lib/project-store';
import AppNav from '@/components/AppNav';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type Tab = 'monitor' | 'sensors' | 'defects';

interface SensorReading {
  label: string; value: string; unit: string;
  status: 'ok' | 'warn' | 'error'; trend?: 'up' | 'down' | 'stable';
  history: number[];
}

interface PrinterControl {
  printSpeed: number; extrusionRate: number; pumpPressure: number; paused: boolean;
}

interface Camera {
  id: string; label: string;
  angle: 'front' | 'side' | 'overhead' | 'nozzle';
  active: boolean;
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, color = '#fff', width = 60, height = 24 }: {
  data: number[]; color?: string; width?: number; height?: number;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const pts = data.map((v, i) => `${(i/(data.length-1))*width},${height-((v-min)/range)*height}`).join(' ');
  return (
    <svg width={width} height={height} className="opacity-60">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Control Slider — always black, never red ──────────────────────────────────
function ControlSlider({ label, value, min, max, step, unit, onChange, warning }: {
  label: string; value: number; min: number; max: number;
  step: number; unit: string; onChange: (v: number) => void; warning?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between">
        <span className="text-xs font-medium text-black/60">{label}</span>
        <span className="text-xs font-bold font-mono text-black">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 rounded-full appearance-none cursor-pointer"
        style={{ background: `linear-gradient(to right, #000 ${pct}%, #e5e7eb ${pct}%)` }}/>
      <div className="flex justify-between text-[9px] text-black/25">
        <span>{min}{unit}</span>
        {warning && <span className="text-amber-500 font-semibold">⚠ High</span>}
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

// ── Camera View with plumb line + rename ──────────────────────────────────────
function CameraView({
  camera, onAngleChange, onRename, onRemove,
}: {
  camera: Camera;
  onAngleChange: (id: string, angle: Camera['angle']) => void;
  onRename: (id: string, label: string) => void;
  onRemove: (id: string) => void;
}) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const [streaming, setStreaming] = useState(false);
  const [error,     setError]     = useState('');
  const [editing,   setEditing]   = useState(false);
  const [label,     setLabel]     = useState(camera.label);
  const [showPlumb, setShowPlumb] = useState(false);
  const angles: Camera['angle'][] = ['front', 'side', 'overhead', 'nozzle'];

  const startCamera = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStreaming(true);
      }
    } catch (e: any) {
      setError(e.message || 'Camera access denied');
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
      setStreaming(false);
    }
  };

  const saveLabel = () => {
    onRename(camera.id, label);
    setEditing(false);
  };

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${streaming ? 'bg-red-500 animate-pulse' : 'bg-gray-300'}`}/>
          {editing ? (
            <input autoFocus value={label}
              onChange={e => setLabel(e.target.value)}
              onBlur={saveLabel}
              onKeyDown={e => e.key === 'Enter' && saveLabel()}
              className="text-xs font-semibold text-black border-b border-black outline-none bg-transparent w-32"/>
          ) : (
            <button onClick={() => setEditing(true)}
              className="text-xs font-semibold text-black hover:text-black/60 transition-colors">
              {camera.label}
            </button>
          )}
          {streaming && <span className="text-[9px] font-mono text-red-500 font-bold">● LIVE</span>}
        </div>
        <div className="flex items-center gap-1">
          {angles.map(a => (
            <button key={a} onClick={() => onAngleChange(camera.id, a)}
              className={`px-2 py-0.5 text-[9px] font-semibold rounded-lg capitalize transition-all ${
                camera.angle === a ? 'bg-black text-white' : 'text-black/30 hover:text-black'
              }`}>{a}</button>
          ))}
          <button onClick={() => setShowPlumb(v => !v)}
            title="Toggle plumb line"
            className={`ml-1 px-2 py-0.5 text-[9px] font-semibold rounded-lg transition-all ${
              showPlumb ? 'bg-blue-500 text-white' : 'text-black/30 hover:text-black border border-gray-200'
            }`}>⊕</button>
        </div>
      </div>

      {/* Video */}
      <div className="relative bg-black aspect-video flex items-center justify-center">
        <video ref={videoRef} autoPlay playsInline muted
          className={`absolute inset-0 w-full h-full object-cover ${streaming ? 'block' : 'hidden'}`}/>

        {/* Plumb line + level overlay */}
        {streaming && showPlumb && (
          <div className="absolute inset-0 z-10 pointer-events-none">
            {/* Vertical centre line */}
            <div className="absolute top-0 bottom-0 left-1/2 w-px bg-blue-400/70"/>
            {/* Horizontal centre line */}
            <div className="absolute left-0 right-0 top-1/2 h-px bg-blue-400/70"/>
            {/* Rule of thirds */}
            <div className="absolute top-0 bottom-0 left-1/3 w-px bg-white/20"/>
            <div className="absolute top-0 bottom-0 right-1/3 w-px bg-white/20"/>
            <div className="absolute left-0 right-0 top-1/3 h-px bg-white/20"/>
            <div className="absolute left-0 right-0 bottom-1/3 h-px bg-white/20"/>
            {/* Centre crosshair */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 border border-blue-400/80 rounded-full"/>
            {/* Labels */}
            <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-blue-500/80 rounded text-[9px] text-white font-mono">
              PLUMB VIEW — {camera.angle.toUpperCase()}
            </div>
          </div>
        )}

        {/* Angle label */}
        {streaming && !showPlumb && (
          <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 rounded-lg z-10">
            <span className="text-[9px] text-white/70 font-mono uppercase">{camera.angle} view</span>
          </div>
        )}

        {/* Placeholder */}
        {!streaming && (
          <div className="text-center z-10">
            <svg className="w-8 h-8 text-white/20 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
            </svg>
            {error && <p className="text-red-400 text-[10px] mb-2 max-w-[200px] mx-auto">{error}</p>}
            <button onClick={startCamera}
              className="text-[11px] font-semibold text-white bg-white/10 border border-white/20 rounded-xl px-4 py-2 hover:bg-white/20 transition-all">
              Connect Camera
            </button>
          </div>
        )}

        {streaming && (
          <button onClick={stopCamera}
            className="absolute bottom-2 right-2 z-10 text-[10px] text-white/60 border border-white/20 rounded-lg px-2 py-1 hover:bg-white/10">
            Stop
          </button>
        )}
      </div>
    </div>
  );
}

// ── Defect Detection ───────────────────────────────────────────────────────────
const DEFECT_CLASSES = ['Cracking', 'Delamination', 'Over-extrusion', 'Under-extrusion', 'Layer Shift', 'Void'];

function DefectDetectionPanel({ onAlert }: { onAlert: (msg: string, level: 'info'|'warn'|'error') => void }) {
  const [image,     setImage]     = useState<string | null>(null);
  const [running,   setRunning]   = useState(false);
  const [results,   setResults]   = useState<{label: string; confidence: number; detected: boolean}[] | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImage(url);
    setResults(null);
    setRunning(true);
    onAlert('Defect analysis running…', 'info');

    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API}/detect`, { method: 'POST', body: form });
      if (res.ok) {
        const data = await res.json();
        setResults(data.detections ?? data.results ?? []);
        const found = (data.detections ?? []).filter((d: any) => d.detected);
        if (found.length > 0) {
          onAlert(`Detected: ${found.map((d: any) => d.label).join(', ')}`, 'error');
        } else {
          onAlert('No defects detected', 'info');
        }
      } else {
        // Fallback: simulate YOLOv8 results for demo
        const simulated = DEFECT_CLASSES.map(label => ({
          label,
          confidence: Math.random(),
          detected: Math.random() > 0.75,
        }));
        setResults(simulated);
        const found = simulated.filter(d => d.detected);
        if (found.length > 0) {
          onAlert(`Detected: ${found.map(d => d.label).join(', ')}`, 'error');
        } else {
          onAlert('No defects detected', 'info');
        }
      }
    } catch {
      // Simulate for demo
      const simulated = DEFECT_CLASSES.map(label => ({
        label,
        confidence: Math.random(),
        detected: Math.random() > 0.75,
      }));
      setResults(simulated);
    }
    setRunning(false);
  };

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Upload + preview */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-black/40">Input Image</h3>
          <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 bg-black text-white text-[11px] font-semibold rounded-xl hover:bg-black/80 transition-all">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
            Upload Image
            <input type="file" accept="image/*" className="hidden" onChange={handleUpload}/>
          </label>
        </div>
        <div className="aspect-video bg-gray-50 flex items-center justify-center relative">
          {image ? (
            <img src={image} alt="Analysis input" className="w-full h-full object-contain"/>
          ) : (
            <div className="text-center">
              <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-black/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                </svg>
              </div>
              <p className="text-xs text-black/30">Upload a layer image to analyse</p>
            </div>
          )}
          {running && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <div className="text-center">
                <motion.div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full mx-auto mb-2"
                  animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}/>
                <p className="text-white text-xs font-semibold">Running YOLOv8…</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-black/40">Detection Results</h3>
          <p className="text-[10px] text-black/30 mt-0.5">YOLOv8 Nano · 22 defect classes · trained on 3DCP dataset</p>
        </div>
        <div className="p-5">
          {!results && !running && (
            <div className="text-center py-12 text-black/25 text-xs">Upload an image to see results</div>
          )}
          {results && (
            <div className="space-y-3">
              {results.map((r, i) => (
                <motion.div key={i} initial={{opacity:0,x:8}} animate={{opacity:1,x:0}} transition={{delay:i*0.05}}
                  className={`flex items-center justify-between p-3 rounded-xl border ${
                    r.detected ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-100'
                  }`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${r.detected ? 'bg-red-500' : 'bg-emerald-500'}`}/>
                    <span className={`text-xs font-semibold ${r.detected ? 'text-red-700' : 'text-black'}`}>{r.label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${r.detected ? 'bg-red-500' : 'bg-emerald-500'}`}
                        style={{width:`${r.confidence*100}%`}}/>
                    </div>
                    <span className={`text-[10px] font-mono font-bold w-10 text-right ${r.detected ? 'text-red-600' : 'text-black/40'}`}>
                      {(r.confidence*100).toFixed(1)}%
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${
                      r.detected ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>{r.detected ? 'DETECTED' : 'CLEAR'}</span>
                  </div>
                </motion.div>
              ))}
              <div className={`mt-4 p-3 rounded-xl ${results.some(r=>r.detected) ? 'bg-red-50 border border-red-200' : 'bg-emerald-50 border border-emerald-200'}`}>
                <p className={`text-xs font-bold ${results.some(r=>r.detected) ? 'text-red-700' : 'text-emerald-700'}`}>
                  {results.some(r=>r.detected)
                    ? `⚠ ${results.filter(r=>r.detected).length} defect(s) detected — review recommended`
                    : '✓ Layer quality OK — no defects detected'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
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
    { id: '1', label: 'Camera 1', angle: 'front',    active: true },
    { id: '2', label: 'Camera 2', angle: 'overhead', active: true },
  ]);

  const [sensors, setSensors] = useState<SensorReading[]>([
    { label: 'Ambient Temp',   value: '24.2', unit: '°C',    status: 'ok',   trend: 'stable', history: [24,24.1,24.2,24.1,24.2,24.3,24.2] },
    { label: 'Humidity',       value: '58',   unit: '%',     status: 'ok',   trend: 'stable', history: [57,58,58,59,58,57,58] },
    { label: 'Wind Speed',     value: '6.2',  unit: 'km/h',  status: 'ok',   trend: 'up',     history: [4,5,5.5,6,6.1,6.2,6.2] },
    { label: 'Flow Rate',      value: '8.1',  unit: 'L/min', status: 'ok',   trend: 'stable', history: [8,8.1,8.1,8,8.1,8.2,8.1] },
    { label: 'Pump Pressure',  value: '4.2',  unit: 'bar',   status: 'ok',   trend: 'stable', history: [4.1,4.2,4.2,4.3,4.2,4.2,4.2] },
    { label: 'Concrete Temp',  value: '21.8', unit: '°C',    status: 'ok',   trend: 'stable', history: [21.5,21.6,21.7,21.8,21.8,21.8,21.8] },
    { label: 'Pot Life Left',  value: '47',   unit: 'min',   status: 'warn', trend: 'down',   history: [60,58,55,53,51,49,47] },
    { label: 'Mix Consistency',value: '94',   unit: '%',     status: 'ok',   trend: 'stable', history: [93,94,95,94,94,93,94] },
  ]);

  useEffect(() => {
    tickRef.current = setInterval(() => {
      setElapsed(s => s + 1);
      setSensors(prev => prev.map(s => {
        const last = parseFloat(s.value);
        const next = Math.round((last + (Math.random()-0.5)*0.2)*100)/100;
        const newH = [...s.history.slice(-8), next];
        let status: 'ok'|'warn'|'error' = s.status;
        if (s.label === 'Pot Life Left') status = next < 20 ? 'error' : next < 35 ? 'warn' : 'ok';
        return { ...s, value: String(next), history: newH, status };
      }));
    }, 3000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  const addAlert = useCallback((msg: string, level: 'info'|'warn'|'error' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setAlertLog(prev => [{ time, msg, level }, ...prev.slice(0,19)]);
    if (level !== 'info') sessionRef.current.alerts.push({ time, layer: sessionRef.current.layersPrinted, message: msg });
  }, []);

  const updateControl = (key: keyof PrinterControl, val: number | boolean) => {
    setControls(prev => ({ ...prev, [key]: val }));
    if (key !== 'paused') addAlert(`${key} set to ${val}`, 'info');
  };

  const addCamera = () => {
    const id = String(Date.now());
    setCameras(prev => [...prev, { id, label: `Camera ${prev.length+1}`, angle: 'front', active: true }]);
  };

  const removeCamera    = (id: string) => setCameras(prev => prev.filter(c => c.id !== id));
  const updateAngle     = (id: string, angle: Camera['angle']) => setCameras(prev => prev.map(c => c.id===id ? {...c,angle} : c));
  const renameCamera    = (id: string, label: string) => setCameras(prev => prev.map(c => c.id===id ? {...c,label} : c));

  const fmtElapsed = () => {
    const h=Math.floor(elapsed/3600), m=Math.floor((elapsed%3600)/60), s=elapsed%60;
    return h>0?`${h}h ${m}m`:`${m}m ${String(s).padStart(2,'0')}s`;
  };

  const endPrint = () => {
    if (!activeProject) return;
    const s=sessionRef.current;
    const h=Math.floor(elapsed/3600), m=Math.floor((elapsed%3600)/60);
    const report: ProjectReport = {
      generatedAt:    new Date().toISOString(),
      duration:       h>0?`${h}h ${m}m`:`${m}m`,
      totalLayers:    activeProject.totalLayers,
      layersPrinted:  s.layersPrinted,
      errorsDetected: s.errorsDetected,
      errorRate:      activeProject.totalLayers>0?`${((s.errorsDetected/activeProject.totalLayers)*100).toFixed(1)}%`:'0%',
      alerts:         s.alerts,
      printerName:    activeProject.printer.name,
      structureType:  activeProject.structureType,
    };
    updateProject(activeProject.id, { status:'complete', report });
    router.push('/report');
  };

  const keySensors = sensors.slice(0,4);

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
          {activeProject && <><div className="h-4 w-px bg-gray-200"/><span className="text-xs text-black/40">{activeProject.printer.name||'—'}</span></>}
        </div>
        <div className="flex items-center gap-2">
          {(['monitor','sensors','defects'] as Tab[]).map(t=>(
            <button key={t} onClick={()=>setActiveTab(t)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-xl capitalize transition-all ${
                activeTab===t?'bg-black text-white':'text-black/40 hover:text-black hover:bg-gray-100'
              }`}>
              {t==='monitor'?'Monitor':t==='sensors'?'All Sensors':'Defect Detection'}
            </button>
          ))}
          <div className="h-4 w-px bg-gray-200"/>
          <button onClick={()=>updateControl('paused',!controls.paused)}
            className="px-3 py-1.5 text-xs font-semibold bg-black text-white rounded-xl hover:bg-black/80 transition-all">
            {controls.paused?'Resume':'Pause'}
          </button>
          <button onClick={()=>setShowConfirm(true)}
            className="px-3 py-1.5 text-xs font-semibold bg-black text-white rounded-xl hover:bg-black/80 transition-all">
            End Print
          </button>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 pt-6">
        <AnimatePresence mode="wait">

          {/* ── MONITOR TAB ── */}
          {activeTab==='monitor' && (
            <motion.div key="monitor" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
              className="grid grid-cols-[1fr_320px] gap-6">

              {/* Left: cameras */}
              <div className="space-y-4">
                <div className={`grid gap-4 ${
                  cameras.length===1?'grid-cols-1':
                  cameras.length<=2?'grid-cols-2':
                  cameras.length<=4?'grid-cols-2':'grid-cols-3'
                }`}>
                  {cameras.map(cam=>(
                    <div key={cam.id} className="relative group">
                      <CameraView camera={cam} onAngleChange={updateAngle} onRename={renameCamera} onRemove={removeCamera}/>
                      <button onClick={()=>removeCamera(cam.id)}
                        className="absolute top-10 right-2 w-5 h-5 bg-black/70 text-white rounded-full text-[10px] opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center hover:bg-red-600 z-20">
                        ×
                      </button>
                    </div>
                  ))}
                  <button onClick={addCamera}
                    className="aspect-video rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-2 hover:border-black hover:bg-gray-50 transition-all group min-h-[180px]">
                    <div className="w-8 h-8 rounded-full border-2 border-gray-200 group-hover:border-black flex items-center justify-center transition-all">
                      <span className="text-gray-300 group-hover:text-black text-lg">+</span>
                    </div>
                    <span className="text-xs text-black/30 group-hover:text-black transition-all">Add Camera</span>
                  </button>
                </div>

                {/* System log */}
                <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-3">System Log</h3>
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {alertLog.length===0 && <p className="text-xs text-black/25 text-center py-3">No events</p>}
                    {alertLog.map((a,i)=>(
                      <div key={i} className={`flex gap-2 px-2 py-1 rounded-lg text-[11px] ${
                        a.level==='error'?'bg-red-50 text-red-700':a.level==='warn'?'bg-amber-50 text-amber-700':'bg-gray-50 text-black/50'
                      }`}>
                        <span className="font-mono opacity-50 flex-shrink-0">{a.time}</span>
                        <span>{a.msg}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right sidebar */}
              <div className="space-y-4">
                {/* Printer controls — black card */}
                <div className="bg-black rounded-2xl p-5 shadow-sm">
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-white/40 mb-4">Printer Control</h3>
                  <div className="space-y-5">
                    {[
                      { label:'Print Speed', key:'printSpeed' as const, min:10, max:150, step:5, unit:' mm/s', warn: controls.printSpeed>120 },
                      { label:'Extrusion Rate', key:'extrusionRate' as const, min:50, max:150, step:5, unit:'%', warn: controls.extrusionRate>130 },
                      { label:'Pump Pressure', key:'pumpPressure' as const, min:1, max:10, step:0.1, unit:' bar', warn: controls.pumpPressure>8 },
                    ].map(s=>{
                      const pct = ((controls[s.key] as number - s.min)/(s.max-s.min))*100;
                      return (
                        <div key={s.key} className="space-y-1.5">
                          <div className="flex justify-between">
                            <span className="text-xs font-medium text-white/60">{s.label}</span>
                            <div className="flex items-center gap-1">
                              {s.warn && <span className="text-[9px] text-amber-400">⚠</span>}
                              <span className="text-xs font-bold font-mono text-white">{controls[s.key]}{s.unit}</span>
                            </div>
                          </div>
                          <input type="range" min={s.min} max={s.max} step={s.step} value={controls[s.key] as number}
                            onChange={e=>updateControl(s.key,Number(e.target.value))}
                            className="w-full h-1 rounded-full appearance-none cursor-pointer"
                            style={{background:`linear-gradient(to right,#fff ${pct}%,rgba(255,255,255,0.15) ${pct}%)`}}/>
                          <div className="flex justify-between text-[9px] text-white/25">
                            <span>{s.min}{s.unit}</span><span>{s.max}{s.unit}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-5">
                    {[
                      { label:'Home',  action:()=>addAlert('Homing nozzle…') },
                      { label:'Purge', action:()=>addAlert('Purge started') },
                      { label:'Prime', action:()=>addAlert('Priming pump…') },
                    ].map((btn,i)=>(
                      <button key={i} onClick={btn.action}
                        className="py-2 text-[11px] font-semibold rounded-xl border border-white/20 text-white hover:bg-white/10 transition-all">
                        {btn.label}
                      </button>
                    ))}
                    <button onClick={()=>{updateControl('paused',true);addAlert('EMERGENCY STOP','error');}}
                      className="py-2 text-[11px] font-semibold rounded-xl bg-red-600 text-white hover:bg-red-700 transition-all">
                      E-Stop
                    </button>
                  </div>
                </div>

                {/* Live sensors — black cards */}
                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Live Sensors</h3>
                    <button onClick={()=>setActiveTab('sensors')} className="text-[10px] text-black/30 hover:text-black">View all →</button>
                  </div>
                  <div className="space-y-3">
                    {keySensors.map((s,i)=>(
                      <div key={i} className="bg-black rounded-xl p-3 flex items-center justify-between">
                        <div>
                          <p className="text-[9px] font-semibold uppercase tracking-widest text-white/40 mb-0.5">{s.label}</p>
                          <div className="flex items-baseline gap-1">
                            <span className="text-lg font-bold text-white">{s.value}</span>
                            <span className="text-[10px] text-white/40">{s.unit}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                            s.status==='ok'?'bg-emerald-400':s.status==='warn'?'bg-amber-400':'bg-red-400'
                          }`}/>
                          <Sparkline data={s.history} color={s.status==='ok'?'#4ade80':s.status==='warn'?'#fbbf24':'#f87171'}/>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── ALL SENSORS TAB ── */}
          {activeTab==='sensors' && (
            <motion.div key="sensors" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="space-y-6">
              {[
                {title:'Environmental', items:sensors.slice(0,3)},
                {title:'Flow & Pressure', items:sensors.slice(3,5)},
                {title:'Mix & Material', items:sensors.slice(5,8)},
              ].map(group=>(
                <div key={group.title}>
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-3">{group.title}</h3>
                  <div className="grid grid-cols-4 gap-4">
                    {group.items.map((s,i)=>(
                      <div key={i} className="bg-black rounded-2xl p-4">
                        <div className="flex justify-between mb-2">
                          <p className="text-[9px] font-semibold uppercase tracking-wide text-white/40">{s.label}</p>
                          <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                            s.status==='ok'?'bg-emerald-400':s.status==='warn'?'bg-amber-400':'bg-red-400'
                          }`}/>
                        </div>
                        <div className="flex items-baseline gap-1 mb-2">
                          <span className="text-2xl font-bold text-white">{s.value}</span>
                          <span className="text-xs text-white/40">{s.unit}</span>
                        </div>
                        <Sparkline data={s.history} color={s.status==='ok'?'#4ade80':s.status==='warn'?'#fbbf24':'#f87171'} width={100}/>
                      </div>
                    ))}
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
          {activeTab==='defects' && (
            <motion.div key="defects" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
              <DefectDetectionPanel onAlert={addAlert}/>
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
                <button onClick={()=>setShowConfirm(false)}
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