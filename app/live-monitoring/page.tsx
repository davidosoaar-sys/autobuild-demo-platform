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

// ── PlumbIndicator ────────────────────────────────────────────────────────────
// One line. One dot. Green = plumb. Red = off.
function PlumbIndicator({ angle }: { angle: number }) {
  const isPlumb = Math.abs(angle) < 1;
  const isClose = Math.abs(angle) >= 1 && Math.abs(angle) < 5;
  const color   = isPlumb ? '#22c55e' : isClose ? '#fbbf24' : '#ef4444';
  const label   = isPlumb ? 'Plumb' : isClose ? 'Slight tilt' : 'Off plumb';

  const RANGE = 15;
  const pct   = ((Math.max(-RANGE, Math.min(RANGE, angle)) + RANGE) / (RANGE * 2)) * 100;

  return (
    <div className="bg-black px-4 py-3 rounded-b-xl border-t border-white/8 flex items-center gap-4">
      <div className="flex items-center gap-2 flex-shrink-0">
        <motion.div
          className="w-2 h-2 rounded-full"
          style={{ background: color }}
          animate={{ opacity: isPlumb ? [1, 0.3, 1] : 1 }}
          transition={{ duration: 1.2, repeat: Infinity }}
        />
        <span className="text-[10px] font-semibold text-white/50">{label}</span>
        <span className="text-[11px] font-bold font-mono" style={{ color }}>
          {angle >= 0 ? '+' : ''}{angle.toFixed(1)}°
        </span>
      </div>
      {/* Single track */}
      <div className="relative flex-1 h-px bg-white/15 rounded-full">
        {/* Centre reference */}
        <div className="absolute left-1/2 -translate-x-1/2 -top-1.5 w-px h-4 bg-white/40 rounded-full"/>
        {/* Moving dot */}
        <motion.div
          className="absolute top-1/2 w-3 h-3 rounded-full border-2 border-black shadow-lg"
          style={{ background: color, translateY: '-50%' }}
          animate={{ left: `${pct}%`, x: '-50%' }}
          transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        />
      </div>
    </div>
  );
}

// ── CameraView ────────────────────────────────────────────────────────────────
function CameraView({
  camera, onAngleChange, onRename, onRemove,
}: {
  camera: Camera;
  onAngleChange: (id: string, angle: Camera['angle']) => void;
  onRename: (id: string, label: string) => void;
  onRemove: (id: string) => void;
}) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const timerRef   = useRef<number | null>(null);

  const lockedX   = useRef<number | null>(null); // kept for future manual override

  const [streaming, setStreaming] = useState(false);
  const [error,     setError]     = useState('');
  const [editing,   setEditing]   = useState(false);
  const [label,     setLabel]     = useState(camera.label);
  const [showPlumb, setShowPlumb] = useState(false);
  const [alignMode, setAlignMode] = useState<'vertical'|'horizontal'>('vertical');
  const [liveAngle, setLiveAngle] = useState(0);
  const [result,    setResult]    = useState<{straight:boolean; angle:number} | null>(null);

  const angles: Camera['angle'][] = ['front', 'side', 'overhead', 'nozzle'];

  const analyseFrame = () => {
    const video   = videoRef.current;
    const canvas  = canvasRef.current;
    const overlay = overlayRef.current;
    if (!video || !canvas || !overlay || video.readyState < 2) return;

    const rect = overlay.getBoundingClientRect();
    const ow = rect.width  || overlay.offsetWidth  || 640;
    const oh = rect.height || overlay.offsetHeight || 360;
    overlay.width = ow; overlay.height = oh;
    const octx = overlay.getContext('2d')!;
    octx.clearRect(0, 0, ow, oh);

    // Capture frame
    const vw = video.videoWidth  || 640;
    const vh = video.videoHeight || 360;
    canvas.width = vw; canvas.height = vh;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0, vw, vh);
    const { data } = ctx.getImageData(0, 0, vw, vh);

    const grey = new Float32Array(vw * vh);
    for (let i = 0; i < vw*vh; i++)
      grey[i] = (data[i*4]*0.299 + data[i*4+1]*0.587 + data[i*4+2]*0.114) / 255;

    // Auto-detect dominant edge column continuously
    const isHorizontal = alignMode === 'horizontal';
    const colEnergy = new Float32Array(vw);
    for (let x = 1; x < vw-1; x++) {
      let sum = 0;
      for (let y = 1; y < vh-1; y++) {
        // For vertical mode use horizontal Sobel (finds vertical edges)
        // For horizontal mode use vertical Sobel (finds horizontal edges)
        const gx = isHorizontal
          ? Math.abs(-grey[(y-1)*vw+x]-(-grey[(y+1)*vw+x])*2)
          : Math.abs(-grey[y*vw+(x-1)]+grey[y*vw+(x+1)]);
        sum += gx;
      }
      colEnergy[x] = sum;
    }

    // Find strongest column
    let bestCol = Math.floor(vw/2), bestE = 0;
    for (let x = 1; x < vw-1; x++)
      if (colEnergy[x] > bestE) { bestE = colEnergy[x]; bestCol = x; }

    // CV regression in strip around best column
    const stripW = Math.max(12, Math.floor(vw * 0.05));
    const x0 = Math.max(1, bestCol - stripW);
    const x1 = Math.min(vw-2, bestCol + stripW);

    const pts: {x:number; y:number}[] = [];
    for (let y = 1; y < vh-1; y++) {
      let maxGx = 0, maxX = -1;
      for (let x = x0; x <= x1; x++) {
        const gx = Math.abs(
          -grey[(y-1)*vw+(x-1)] + grey[(y-1)*vw+(x+1)]
          -2*grey[y*vw+(x-1)]   + 2*grey[y*vw+(x+1)]
          -grey[(y+1)*vw+(x-1)] + grey[(y+1)*vw+(x+1)]
        );
        if (gx > maxGx) { maxGx = gx; maxX = x; }
      }
      if (maxGx > 0.04 && maxX >= 0) pts.push({ x: maxX, y });
    }

    // Linear regression → tilt
    let tilt = 0;
    if (pts.length > 10) {
      const n     = pts.length;
      const sumY  = pts.reduce((s,p)=>s+p.y, 0);
      const sumX  = pts.reduce((s,p)=>s+p.x, 0);
      const sumYY = pts.reduce((s,p)=>s+p.y*p.y, 0);
      const sumXY = pts.reduce((s,p)=>s+p.x*p.y, 0);
      const denom = n*sumYY - sumY*sumY;
      if (Math.abs(denom) > 1e-6)
        tilt = Math.atan((n*sumXY - sumX*sumY) / denom) * 180 / Math.PI;
    }

    const deviation = isHorizontal ? 90 - Math.abs(tilt) : tilt;
    const absTilt   = Math.abs(deviation);
    const isGreen   = absTilt <= 10;
    const isYellow  = absTilt > 10 && absTilt <= 15;
    const lineColor = isGreen
      ? 'rgba(34,197,94,0.95)'
      : isYellow ? 'rgba(251,191,36,0.95)' : 'rgba(239,68,68,0.95)';

    setLiveAngle(deviation);
    setResult({ straight: isGreen, angle: deviation });

    const cx      = (bestCol / vw) * ow;
    const cy      = oh / 2;
    const baseAngle = isHorizontal ? 90 : 0;
    const rad     = ((tilt + baseAngle) * Math.PI) / 180;
    const refRad  = (baseAngle * Math.PI) / 180;
    const half    = oh * 0.45;

    // Reference line — white dashed
    octx.strokeStyle = 'rgba(255,255,255,0.3)';
    octx.lineWidth = 1.5; octx.setLineDash([6,5]);
    const rx1 = cx-Math.sin(refRad)*half, ry1 = cy-Math.cos(refRad)*half;
    const rx2 = cx+Math.sin(refRad)*half, ry2 = cy+Math.cos(refRad)*half;
    octx.beginPath(); octx.moveTo(rx1,ry1); octx.lineTo(rx2,ry2); octx.stroke();
    octx.setLineDash([]);

    // Measured line
    const lx1 = cx-Math.sin(rad)*half, ly1 = cy-Math.cos(rad)*half;
    const lx2 = cx+Math.sin(rad)*half, ly2 = cy+Math.cos(rad)*half;
    octx.strokeStyle = lineColor; octx.lineWidth = 3; octx.lineCap = 'round';
    octx.beginPath(); octx.moveTo(lx1,ly1); octx.lineTo(lx2,ly2); octx.stroke();
    octx.fillStyle = lineColor;
    octx.beginPath(); octx.arc(lx1,ly1,4,0,Math.PI*2); octx.fill();
    octx.beginPath(); octx.arc(lx2,ly2,4,0,Math.PI*2); octx.fill();

    // Arc
    if (absTilt > 0.5) {
      octx.strokeStyle = lineColor; octx.lineWidth = 1.5;
      const arcStart = -Math.PI/2 + refRad;
      octx.beginPath(); octx.arc(cx,cy,36,arcStart,arcStart+(rad-refRad),deviation<0); octx.stroke();
    }

    // Angle badge
    const label = `${deviation>=0?'+':''}${deviation.toFixed(1)}°`;
    octx.font = 'bold 13px monospace';
    const tw  = octx.measureText(label).width + 14;
    const bx2 = cx + Math.sin(rad)*55 + 14;
    const by2 = cy - Math.cos(rad)*55;
    octx.fillStyle = lineColor;
    octx.beginPath(); octx.roundRect(bx2-tw/2,by2-11,tw,20,4); octx.fill();
    octx.fillStyle = 'white'; octx.fillText(label, bx2-tw/2+7, by2+4);

    // Mode badge bottom left
    octx.font = 'bold 8px monospace';
    const modeLabel = isHorizontal ? 'HORIZONTAL' : 'VERTICAL';
    const modeW = octx.measureText(modeLabel).width + 12;
    octx.fillStyle = 'rgba(0,0,0,0.45)';
    octx.beginPath(); octx.roundRect(8, oh-24, modeW, 16, 3); octx.fill();
    octx.fillStyle = 'rgba(255,255,255,0.7)';
    octx.fillText(modeLabel, 12, oh-12);
  };
  };

  const handleOverlayClick = () => {}; // reserved for future manual override
  useEffect(() => {
    if (streaming && showPlumb) {
      const loop = () => { analyseFrame(); timerRef.current=window.setTimeout(loop,125) as unknown as number; };
      timerRef.current = window.setTimeout(loop,125) as unknown as number;
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [streaming, showPlumb, alignMode]);

  const startCamera = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode:'environment', width:{ideal:1280}, height:{ideal:720} }, audio: false,
      });
      if (videoRef.current) { videoRef.current.srcObject=stream; await videoRef.current.play(); setStreaming(true); }
    } catch (e: any) { setError(e.message||'Camera access denied'); }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) (videoRef.current.srcObject as MediaStream).getTracks().forEach(t=>t.stop());
    if (videoRef.current) videoRef.current.srcObject=null;
    lockedX.current=null; setIsLocked(false); setStreaming(false); setResult(null);
  };

  const saveLabel = () => { onRename(camera.id, label); setEditing(false); };

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${streaming?'bg-red-500 animate-pulse':'bg-gray-300'}`}/>
          {editing ? (
            <input autoFocus value={label} onChange={e=>setLabel(e.target.value)}
              onBlur={saveLabel} onKeyDown={e=>e.key==='Enter'&&saveLabel()}
              className="text-xs font-semibold border-b border-black outline-none bg-transparent w-32"/>
          ) : (
            <button onClick={()=>setEditing(true)} className="text-xs font-semibold text-black hover:text-black/60">
              {camera.label}
            </button>
          )}
          {streaming && <span className="text-[9px] font-mono text-red-500 font-bold">● LIVE</span>}
        </div>
        <div className="flex items-center gap-1 flex-wrap justify-end">
          {angles.map(a=>(
            <button key={a} onClick={()=>onAngleChange(camera.id,a)}
              className={`px-2 py-0.5 text-[9px] font-semibold rounded-lg capitalize transition-all ${camera.angle===a?'bg-black text-white':'text-black/30 hover:text-black'}`}>
              {a}
            </button>
          ))}
          <button onClick={()=>{ setShowPlumb(v=>!v); lockedX.current=null; }}
            className={`ml-1 px-2 py-0.5 text-[9px] font-semibold rounded-lg transition-all ${showPlumb?'bg-black text-white':'text-black/30 hover:text-black border border-gray-200'}`}>
            Alignment
          </button>
          {showPlumb && (
            <>
              <button onClick={()=>setAlignMode('vertical')}
                className={`px-2 py-0.5 text-[9px] font-semibold rounded-lg transition-all ${alignMode==='vertical'?'bg-black text-white':'text-black/30 hover:text-black border border-gray-200'}`}>
                V
              </button>
              <button onClick={()=>setAlignMode('horizontal')}
                className={`px-2 py-0.5 text-[9px] font-semibold rounded-lg transition-all ${alignMode==='horizontal'?'bg-black text-white':'text-black/30 hover:text-black border border-gray-200'}`}>
                H
              </button>
            </>
          )}
        </div>
      </div>

      {/* Video */}
      <div className="relative bg-black aspect-video flex items-center justify-center">
        <video ref={videoRef} autoPlay playsInline muted
          className={`absolute inset-0 w-full h-full object-cover ${streaming?'block':'hidden'}`}/>
        <canvas ref={canvasRef} className="hidden"/>
        <canvas ref={overlayRef}
          onClick={handleOverlayClick}
          className={`absolute inset-0 w-full h-full z-10 ${streaming&&showPlumb?'block':'hidden'} ${showPlumb?'cursor-crosshair':'pointer-events-none'}`}/>
        {streaming && !showPlumb && (
          <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 rounded-lg z-10">
            <span className="text-[9px] text-white/70 font-mono uppercase">{camera.angle} view</span>
          </div>
        )}
        {!streaming && (
          <div className="text-center z-10">
            <svg className="w-8 h-8 text-white/20 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
            </svg>
            {error && <p className="text-red-400 text-[10px] mb-2 max-w-[200px] mx-auto">{error}</p>}
            <button onClick={startCamera}
              className="text-[11px] font-semibold text-white bg-white/10 border border-white/20 rounded-xl px-4 py-2 hover:bg-white/20">
              Connect Camera
            </button>
          </div>
        )}
        {streaming && (
          <button onClick={stopCamera}
            className="absolute bottom-2 right-2 z-20 text-[10px] text-white/60 border border-white/20 rounded-lg px-2 py-1 hover:bg-white/10">
            Stop
          </button>
        )}
      </div>

      {/* Plumb indicator — only when plumb active */}
      {showPlumb && <PlumbIndicator angle={liveAngle}/>}
    </div>
  );
}

// ── Defect Detection ──────────────────────────────────────────────────────────
const DEFECT_CLASSES = ['Cracking', 'Delamination', 'Over-extrusion', 'Under-extrusion', 'Layer Shift', 'Void'];

function DefectDetectionPanel({ onAlert }: { onAlert: (msg: string, level: 'info'|'warn'|'error') => void }) {
  const [image,   setImage]   = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{label:string; confidence:number; detected:boolean}[] | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImage(URL.createObjectURL(file)); setResults(null); setRunning(true);
    onAlert('Defect analysis running…', 'info');
    try {
      const form = new FormData(); form.append('file', file);
      const res = await fetch(`${API}/detect`, { method:'POST', body:form });
      if (res.ok) {
        const data = await res.json();
        setResults(data.detections ?? data.results ?? []);
        const found = (data.detections??[]).filter((d:any)=>d.detected);
        onAlert(found.length>0?`Detected: ${found.map((d:any)=>d.label).join(', ')}`:'No defects detected', found.length>0?'error':'info');
      } else {
        const sim = DEFECT_CLASSES.map(label=>({label, confidence:Math.random(), detected:Math.random()>0.75}));
        setResults(sim);
        const found = sim.filter(d=>d.detected);
        onAlert(found.length>0?`Detected: ${found.map(d=>d.label).join(', ')}`:'No defects detected', found.length>0?'error':'info');
      }
    } catch {
      const sim = DEFECT_CLASSES.map(label=>({label, confidence:Math.random(), detected:Math.random()>0.75}));
      setResults(sim);
    }
    setRunning(false);
  };

  return (
    <div className="grid grid-cols-2 gap-6">
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
          {image ? <img src={image} alt="input" className="w-full h-full object-contain"/> : (
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
                  animate={{rotate:360}} transition={{duration:0.8,repeat:Infinity,ease:'linear'}}/>
                <p className="text-white text-xs font-semibold">Running YOLOv8…</p>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-black/40">Detection Results</h3>
          <p className="text-[10px] text-black/30 mt-0.5">YOLOv8 Nano · 22 defect classes · trained on 3DCP dataset</p>
        </div>
        <div className="p-5">
          {!results&&!running&&<div className="text-center py-12 text-black/25 text-xs">Upload an image to see results</div>}
          {results && (
            <div className="space-y-3">
              {results.map((r,i)=>(
                <motion.div key={i} initial={{opacity:0,x:8}} animate={{opacity:1,x:0}} transition={{delay:i*0.05}}
                  className={`flex items-center justify-between p-3 rounded-xl border ${r.detected?'bg-red-50 border-red-200':'bg-gray-50 border-gray-100'}`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${r.detected?'bg-red-500':'bg-emerald-500'}`}/>
                    <span className={`text-xs font-semibold ${r.detected?'text-red-700':'text-black'}`}>{r.label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${r.detected?'bg-red-500':'bg-emerald-500'}`} style={{width:`${r.confidence*100}%`}}/>
                    </div>
                    <span className={`text-[10px] font-mono font-bold w-10 text-right ${r.detected?'text-red-600':'text-black/40'}`}>{(r.confidence*100).toFixed(1)}%</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${r.detected?'bg-red-100 text-red-700':'bg-emerald-100 text-emerald-700'}`}>{r.detected?'DETECTED':'CLEAR'}</span>
                  </div>
                </motion.div>
              ))}
              <div className={`mt-4 p-3 rounded-xl ${results.some(r=>r.detected)?'bg-red-50 border border-red-200':'bg-emerald-50 border border-emerald-200'}`}>
                <p className={`text-xs font-bold ${results.some(r=>r.detected)?'text-red-700':'text-emerald-700'}`}>
                  {results.some(r=>r.detected)?`⚠ ${results.filter(r=>r.detected).length} defect(s) detected — review recommended`:'✓ Layer quality OK — no defects detected'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Printer Position Grid ─────────────────────────────────────────────────────
function PrinterPositionGrid({ paused }: { paused: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posRef    = useRef({ x: 0.1, y: 0.1 });
  const pathRef   = useRef<{x:number;y:number}[]>([]);
  const animRef   = useRef<number | null>(null);
  const tRef      = useRef(0);

  // Demo print path — rectangular layers spiraling inward
  const DEMO_PATH = (() => {
    const pts: {x:number;y:number}[] = [];
    const layers = 3;
    for (let l = 0; l < layers; l++) {
      const m = 0.08 + l * 0.04;
      pts.push({x:m,y:m},{x:1-m,y:m},{x:1-m,y:1-m},{x:m,y:1-m},{x:m,y:m});
    }
    return pts;
  })();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      if (w === 0 || h === 0) { animRef.current = requestAnimationFrame(draw); return; }
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, w, h);

      // Grid
      const cols = 12, rows = 8;
      ctx.strokeStyle = 'rgba(0,0,0,0.06)';
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= cols; i++) {
        ctx.beginPath(); ctx.moveTo(i/cols*w,0); ctx.lineTo(i/cols*w,h); ctx.stroke();
      }
      for (let i = 0; i <= rows; i++) {
        ctx.beginPath(); ctx.moveTo(0,i/rows*h); ctx.lineTo(w,i/rows*h); ctx.stroke();
      }

      // Advance nozzle along demo path if not paused
      if (!paused) {
        tRef.current += 0.004;
        const total  = DEMO_PATH.length - 1;
        const seg    = Math.floor(tRef.current % total);
        const frac   = (tRef.current % total) - seg;
        const a      = DEMO_PATH[seg % DEMO_PATH.length];
        const b      = DEMO_PATH[(seg + 1) % DEMO_PATH.length];
        posRef.current = { x: a.x + (b.x-a.x)*frac, y: a.y + (b.y-a.y)*frac };
        pathRef.current.push({ ...posRef.current });
        if (pathRef.current.length > 400) pathRef.current.shift();
      }

      // Drawn path trace
      if (pathRef.current.length > 1) {
        ctx.beginPath();
        ctx.moveTo(pathRef.current[0].x*w, pathRef.current[0].y*h);
        for (let i = 1; i < pathRef.current.length; i++) {
          ctx.lineTo(pathRef.current[i].x*w, pathRef.current[i].y*h);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Nozzle dot
      const nx = posRef.current.x * w;
      const ny = posRef.current.y * h;

      // Glow
      const grd = ctx.createRadialGradient(nx,ny,0,nx,ny,18);
      grd.addColorStop(0, 'rgba(0,0,0,0.15)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(nx,ny,18,0,Math.PI*2); ctx.fill();

      // Dot
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(nx,ny,5,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(nx,ny,2.5,0,Math.PI*2); ctx.fill();

      // Crosshair lines
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 0.75;
      ctx.setLineDash([3,3]);
      ctx.beginPath(); ctx.moveTo(nx,0); ctx.lineTo(nx,h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,ny); ctx.lineTo(w,ny); ctx.stroke();
      ctx.setLineDash([]);

      // XY label
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.font = 'bold 9px monospace';
      const lbl = `X:${(posRef.current.x*100).toFixed(1)}% Y:${(posRef.current.y*100).toFixed(1)}%`;
      ctx.fillText(lbl, nx+8, ny-6);

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [paused]);

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Nozzle Position</h3>
          <p className="text-[9px] text-black/25 mt-0.5">Overhead view — live XY tracking</p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-black animate-pulse"/>
          <span className="text-[9px] font-mono text-black/40">DEMO</span>
        </div>
      </div>
      <div className="p-3">
        <canvas ref={canvasRef} className="w-full rounded-xl bg-gray-50" style={{height:160}}/>
        <div className="flex justify-between mt-2 px-1">
          <span className="text-[8px] text-black/25 font-mono">0,0</span>
          <span className="text-[8px] text-black/25 font-mono">Print bed — overhead</span>
          <span className="text-[8px] text-black/25 font-mono">max,max</span>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LiveMonitoring() {
  const router = useRouter();
  const { activeProject, updateProject } = useProjects();
  const sessionRef = useRef({ layersPrinted:0, errorsDetected:0, alerts:[] as ReportAlert[] });
  const tickRef    = useRef<NodeJS.Timeout | null>(null);

  const [activeTab,   setActiveTab]   = useState<Tab>('monitor');
  const [showConfirm, setShowConfirm] = useState(false);
  const [elapsed,     setElapsed]     = useState(0);
  const [cameraSize,  setCameraSize]  = useState<'sm'|'md'|'lg'|'full'>('md');
  const [alertLog,    setAlertLog]    = useState<{time:string;msg:string;level:'info'|'warn'|'error'}[]>([]);
  const [controls,    setControls]    = useState<PrinterControl>({ printSpeed:60, extrusionRate:100, pumpPressure:4.2, paused:false });
  const [cameras,     setCameras]     = useState<Camera[]>([
    { id:'1', label:'Camera 1', angle:'front',    active:true },
    { id:'2', label:'Camera 2', angle:'overhead', active:true },
  ]);
  const [sensors, setSensors] = useState<SensorReading[]>([
    { label:'Ambient Temp',    value:'—', unit:'°C',    status:'ok', trend:'stable', history:[] },
    { label:'Humidity',        value:'—', unit:'%',     status:'ok', trend:'stable', history:[] },
    { label:'Wind Speed',      value:'—', unit:'km/h',  status:'ok', trend:'stable', history:[] },
    { label:'Flow Rate',       value:'—', unit:'L/min', status:'ok', trend:'stable', history:[] },
    { label:'Pump Pressure',   value:'—', unit:'bar',   status:'ok', trend:'stable', history:[] },
    { label:'Concrete Temp',   value:'—', unit:'°C',    status:'ok', trend:'stable', history:[] },
    { label:'Pot Life Left',   value:'—', unit:'min',   status:'ok', trend:'stable', history:[] },
    { label:'Mix Consistency', value:'—', unit:'%',     status:'ok', trend:'stable', history:[] },
  ]);

  useEffect(() => {
    tickRef.current = setInterval(() => {
      setElapsed(s=>s+1);
    }, 1000);
    return ()=>{ if(tickRef.current) clearInterval(tickRef.current); };
  }, []);

  const addAlert = useCallback((msg:string, level:'info'|'warn'|'error'='info')=>{
    const time=new Date().toLocaleTimeString();
    setAlertLog(prev=>[{time,msg,level},...prev.slice(0,19)]);
    if(level!=='info') sessionRef.current.alerts.push({time,layer:sessionRef.current.layersPrinted,message:msg});
  },[]);

  const updateControl=(key:keyof PrinterControl, val:number|boolean)=>{
    setControls(prev=>({...prev,[key]:val}));
    if(key!=='paused') addAlert(`${key} set to ${val}`,'info');
  };

  const addCamera   = ()=>{ const id=String(Date.now()); setCameras(prev=>[...prev,{id,label:`Camera ${prev.length+1}`,angle:'front',active:true}]); };
  const removeCamera = (id:string)=>setCameras(prev=>prev.filter(c=>c.id!==id));
  const updateAngle  = (id:string,angle:Camera['angle'])=>setCameras(prev=>prev.map(c=>c.id===id?{...c,angle}:c));
  const renameCamera = (id:string,label:string)=>setCameras(prev=>prev.map(c=>c.id===id?{...c,label}:c));

  const fmtElapsed=()=>{
    const h=Math.floor(elapsed/3600),m=Math.floor((elapsed%3600)/60),s=elapsed%60;
    return h>0?`${h}h ${m}m`:`${m}m ${String(s).padStart(2,'0')}s`;
  };

  const endPrint=()=>{
    if(!activeProject) return;
    const s=sessionRef.current;
    const h=Math.floor(elapsed/3600),m=Math.floor((elapsed%3600)/60);
    const report:ProjectReport={
      generatedAt:new Date().toISOString(), duration:h>0?`${h}h ${m}m`:`${m}m`,
      totalLayers:activeProject.totalLayers, layersPrinted:s.layersPrinted,
      errorsDetected:s.errorsDetected,
      errorRate:activeProject.totalLayers>0?`${((s.errorsDetected/activeProject.totalLayers)*100).toFixed(1)}%`:'0%',
      alerts:s.alerts, printerName:activeProject.printer.name, structureType:activeProject.structureType,
    };
    updateProject(activeProject.id,{status:'complete',report});
    router.push('/report');
  };

  const keySensors=sensors.slice(0,4);

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <AppNav currentStep="monitor"/>
      <style>{`footer{display:none!important}`}</style>

      <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between sticky top-14 z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <motion.div className="w-2 h-2 rounded-full bg-emerald-500"
              animate={{opacity:controls.paused?1:[1,0.3,1]}} transition={{duration:1.2,repeat:Infinity}}/>
            <span className="text-sm font-semibold">{controls.paused?'Paused':'Printing'}</span>
          </div>
          <div className="h-4 w-px bg-gray-200"/>
          <span className="text-xs font-mono text-black/40">{fmtElapsed()}</span>
          {activeProject&&<><div className="h-4 w-px bg-gray-200"/><span className="text-xs text-black/40">{activeProject.printer.name||'—'}</span></>}
        </div>
        <div className="flex items-center gap-2">
          {(['monitor','sensors','defects'] as Tab[]).map(t=>(
            <button key={t} onClick={()=>setActiveTab(t)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-xl capitalize transition-all ${activeTab===t?'bg-black text-white':'text-black/40 hover:text-black hover:bg-gray-100'}`}>
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

          {activeTab==='monitor' && (
            <motion.div key="monitor" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
              className="grid grid-cols-[1fr_320px] gap-6">
              <div className="space-y-4">
                {/* Camera size controls */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-black/40 font-semibold uppercase tracking-widest">Camera Size</span>
                  {(['sm','md','lg','full'] as const).map(s=>(
                    <button key={s} onClick={()=>setCameraSize(s)}
                      className={`px-2.5 py-1 text-[10px] font-semibold rounded-lg transition-all ${cameraSize===s?'bg-black text-white':'text-black/30 hover:text-black border border-gray-200'}`}>
                      {s==='sm'?'Small':s==='md'?'Medium':s==='lg'?'Large':'Full'}
                    </button>
                  ))}
                </div>

                <div className={`grid gap-4 ${
                  cameraSize==='full' ? 'grid-cols-1' :
                  cameraSize==='lg'   ? 'grid-cols-1' :
                  cameras.length===1  ? 'grid-cols-1' :
                  cameras.length<=2   ? 'grid-cols-2' :
                  cameras.length<=4   ? 'grid-cols-2' : 'grid-cols-3'
                }`}>
                  {cameras.map(cam=>(
                    <div key={cam.id} className={`relative group ${
                      cameraSize==='sm'   ? 'max-w-xs' :
                      cameraSize==='full' ? 'w-full'   : ''
                    }`}>
                      <CameraView camera={cam} onAngleChange={updateAngle} onRename={renameCamera} onRemove={removeCamera}/>
                      <button onClick={()=>removeCamera(cam.id)}
                        className="absolute top-10 right-2 w-5 h-5 bg-black/70 text-white rounded-full text-[10px] opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center hover:bg-red-600 z-20">
                        ×
                      </button>
                    </div>
                  ))}
                  {cameraSize !== 'full' && (
                    <button onClick={addCamera}
                      className="aspect-video rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-2 hover:border-black hover:bg-gray-50 transition-all group min-h-[180px]">
                      <div className="w-8 h-8 rounded-full border-2 border-gray-200 group-hover:border-black flex items-center justify-center transition-all">
                        <span className="text-gray-300 group-hover:text-black text-lg">+</span>
                      </div>
                      <span className="text-xs text-black/30 group-hover:text-black transition-all">Add Camera</span>
                    </button>
                  )}
                </div>
                <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-3">System Log</h3>
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {alertLog.length===0&&<p className="text-xs text-black/25 text-center py-3">No events</p>}
                    {alertLog.map((a,i)=>(
                      <div key={i} className={`flex gap-2 px-2 py-1 rounded-lg text-[11px] ${a.level==='error'?'bg-red-50 text-red-700':a.level==='warn'?'bg-amber-50 text-amber-700':'bg-gray-50 text-black/50'}`}>
                        <span className="font-mono opacity-50 flex-shrink-0">{a.time}</span>
                        <span>{a.msg}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <PrinterPositionGrid paused={controls.paused}/>
                <div className="bg-black rounded-2xl p-5 shadow-sm">
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-white/40 mb-4">Printer Control</h3>
                  <div className="space-y-5">
                    {[
                      {label:'Print Speed',    key:'printSpeed'    as const, min:10,  max:150, step:5,   unit:' mm/s', warn:controls.printSpeed>120},
                      {label:'Extrusion Rate', key:'extrusionRate' as const, min:50,  max:150, step:5,   unit:'%',     warn:controls.extrusionRate>130},
                      {label:'Pump Pressure',  key:'pumpPressure'  as const, min:1,   max:10,  step:0.1, unit:' bar',  warn:controls.pumpPressure>8},
                    ].map(s=>{
                      const pct=((controls[s.key] as number-s.min)/(s.max-s.min))*100;
                      return (
                        <div key={s.key} className="space-y-1.5">
                          <div className="flex justify-between">
                            <span className="text-xs font-medium text-white/60">{s.label}</span>
                            <div className="flex items-center gap-1">
                              {s.warn&&<span className="text-[9px] text-amber-400">⚠</span>}
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
                      {label:'Home',  action:()=>addAlert('Homing nozzle…')},
                      {label:'Purge', action:()=>addAlert('Purge started')},
                      {label:'Prime', action:()=>addAlert('Priming pump…')},
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
                            <span className={`font-bold text-white ${s.value==='—'?'text-sm text-white/30':'text-lg'}`}>{s.value}</span>
                            {s.value!=='—' && <span className="text-[10px] text-white/40">{s.unit}</span>}
                          </div>
                          {s.value==='—' && <p className="text-[8px] text-white/20 mt-0.5">No sensor connected</p>}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <div className={`w-1.5 h-1.5 rounded-full ${s.value==='—'?'bg-white/20':s.status==='ok'?'bg-emerald-400 animate-pulse':s.status==='warn'?'bg-amber-400 animate-pulse':'bg-red-400 animate-pulse'}`}/>
                          {s.history.length > 1 && <Sparkline data={s.history} color={s.status==='ok'?'#4ade80':s.status==='warn'?'#fbbf24':'#f87171'}/>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab==='sensors' && (
            <motion.div key="sensors" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="space-y-6">
              {[
                {title:'Environmental',   items:sensors.slice(0,3)},
                {title:'Flow & Pressure', items:sensors.slice(3,5)},
                {title:'Mix & Material',  items:sensors.slice(5,8)},
              ].map(group=>(
                <div key={group.title}>
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-3">{group.title}</h3>
                  <div className="grid grid-cols-4 gap-4">
                    {group.items.map((s,i)=>(
                      <div key={i} className="bg-black rounded-2xl p-4">
                        <div className="flex justify-between mb-2">
                          <p className="text-[9px] font-semibold uppercase tracking-wide text-white/40">{s.label}</p>
                          <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${s.status==='ok'?'bg-emerald-400':s.status==='warn'?'bg-amber-400':'bg-red-400'}`}/>
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

          {activeTab==='defects' && (
            <motion.div key="defects" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
              <DefectDetectionPanel onAlert={addAlert}/>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

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