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

type BeadVerdict = 'straight' | 'deviated' | 'defect' | 'unclear';
type BeadSeverity = 'none' | 'low' | 'medium' | 'high';
type BeadDefectType = 'none' | 'gap' | 'collapse' | 'over-extrusion' | 'under-extrusion' | 'layer-shift' | 'deformation' | 'surface-crack';

interface BeadAnalysis {
  verdict: BeadVerdict;
  angle_deviation: number;
  defect_type: BeadDefectType;
  severity: BeadSeverity;
  description: string;
  bead_count: number;
  confidence: 'low' | 'medium' | 'high';
  timestamp: string;
  cameraId: string;
  cameraLabel: string;
}

interface AlertEntry {
  time: string;
  msg: string;
  level: 'info' | 'warn' | 'error';
}

function Sparkline({ data, color = '#fff', width = 60, height = 24 }: {
  data: number[]; color?: string; width?: number; height?: number;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height}`).join(' ');
  return (
    <svg width={width} height={height} className="opacity-60">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function PlumbIndicator({ angle }: { angle: number }) {
  const isPlumb = Math.abs(angle) < 1;
  const isClose = Math.abs(angle) >= 1 && Math.abs(angle) < 5;
  const color = isPlumb ? '#22c55e' : isClose ? '#fbbf24' : '#ef4444';
  const label = isPlumb ? 'Plumb' : isClose ? 'Slight tilt' : 'Off plumb';
  const RANGE = 15;
  const pct = ((Math.max(-RANGE, Math.min(RANGE, angle)) + RANGE) / (RANGE * 2)) * 100;
  return (
    <div className="bg-black px-4 py-3 rounded-b-xl border-t border-white/8 flex items-center gap-4">
      <div className="flex items-center gap-2 flex-shrink-0">
        <motion.div className="w-2 h-2 rounded-full" style={{ background: color }}
          animate={{ opacity: isPlumb ? [1, 0.3, 1] : 1 }}
          transition={{ duration: 1.2, repeat: Infinity }} />
        <span className="text-[10px] font-semibold text-white/50">{label}</span>
        <span className="text-[11px] font-bold font-mono" style={{ color }}>
          {angle >= 0 ? '+' : ''}{angle.toFixed(1)}°
        </span>
      </div>
      <div className="relative flex-1 h-px bg-white/15 rounded-full">
        <div className="absolute left-1/2 -translate-x-1/2 -top-1.5 w-px h-4 bg-white/40 rounded-full" />
        <motion.div
          className="absolute top-1/2 w-3 h-3 rounded-full border-2 border-black shadow-lg"
          style={{ background: color, translateY: '-50%' }}
          animate={{ left: `${pct}%`, x: '-50%' }}
          transition={{ type: 'spring', stiffness: 400, damping: 35 }} />
      </div>
    </div>
  );
}

function BeadOverlay({ analysis, analysing }: { analysis: BeadAnalysis | null; analysing: boolean }) {
  if (!analysis && !analysing) return null;
  const severityColor = (s: BeadSeverity) => s === 'high' ? '#ef4444' : s === 'medium' || s === 'low' ? '#fbbf24' : '#22c55e';
  const verdictLabel: Record<BeadVerdict, string> = { straight: 'STRAIGHT', deviated: 'DEVIATED', defect: 'DEFECT', unclear: 'UNCLEAR' };
  return (
    <div className="absolute bottom-10 left-2 right-2 z-20 pointer-events-none">
      {analysing && !analysis && (
        <div className="flex items-center gap-2 px-3 py-2 bg-black/80 rounded-xl border border-white/10 w-fit">
          <motion.div className="w-3 h-3 border border-white/60 border-t-transparent rounded-full"
            animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} />
          <span className="text-[10px] font-mono text-white/60">Analysing bead...</span>
        </div>
      )}
      {analysis && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-2">
          <div className="px-3 py-2 rounded-xl border flex items-center gap-2"
            style={{ background: 'rgba(0,0,0,0.85)', borderColor: `${severityColor(analysis.severity)}40` }}>
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: severityColor(analysis.severity) }} />
            <span className="text-[10px] font-bold font-mono" style={{ color: severityColor(analysis.severity) }}>
              {verdictLabel[analysis.verdict]}
            </span>
            {analysis.angle_deviation !== 0 && (
              <span className="text-[10px] font-mono text-white/60">
                {analysis.angle_deviation > 0 ? '+' : ''}{analysis.angle_deviation.toFixed(1)}°
              </span>
            )}
            {analysis.defect_type !== 'none' && (
              <span className="text-[10px] text-white/50 uppercase tracking-wide">· {analysis.defect_type.replace('-', ' ')}</span>
            )}
          </div>
          {analysing && (
            <div className="px-2 py-2 bg-black/70 rounded-xl border border-white/10 flex items-center">
              <motion.div className="w-2.5 h-2.5 border border-white/40 border-t-transparent rounded-full"
                animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} />
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

function BeadStatusPanel({ analysis }: { analysis: BeadAnalysis | null }) {
  if (!analysis) return null;
  const severityColor = (s: BeadSeverity) => s === 'high' ? '#ef4444' : s === 'medium' || s === 'low' ? '#fbbf24' : '#22c55e';
  const color = severityColor(analysis.severity);
  return (
    <div className="bg-black px-4 py-3 rounded-b-xl border-t border-white/8">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-white/40 font-mono mb-0.5 truncate">{analysis.description}</p>
          <div className="flex items-center gap-3 mt-1">
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-white/30 uppercase tracking-wide">Deviation</span>
              <span className="text-[11px] font-bold font-mono" style={{ color }}>
                {analysis.angle_deviation > 0 ? '+' : ''}{analysis.angle_deviation.toFixed(1)}°
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-white/30 uppercase tracking-wide">Beads</span>
              <span className="text-[11px] font-bold font-mono text-white">{analysis.bead_count}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-white/30 uppercase tracking-wide">Confidence</span>
              <span className="text-[11px] font-mono text-white/60 capitalize">{analysis.confidence}</span>
            </div>
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="text-[9px] text-white/25 font-mono">{analysis.timestamp}</div>
          {analysis.defect_type !== 'none' && (
            <div className="text-[9px] font-bold uppercase tracking-wide mt-0.5" style={{ color }}>
              {analysis.defect_type.replace('-', ' ')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AlertBanner({ analysis, onDismiss }: { analysis: BeadAnalysis; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 8000);
    return () => clearTimeout(t);
  }, [analysis, onDismiss]);
  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
      className="fixed top-28 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4">
      <div className="bg-red-600 text-white rounded-2xl px-5 py-4 shadow-2xl flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest mb-1">Bead Alert — {analysis.cameraLabel}</p>
          <p className="text-sm font-medium leading-snug">{analysis.description}</p>
          <div className="flex items-center gap-3 mt-2">
            {analysis.angle_deviation !== 0 && (
              <span className="text-xs font-mono opacity-80">
                Deviation: {analysis.angle_deviation > 0 ? '+' : ''}{analysis.angle_deviation.toFixed(1)}°
              </span>
            )}
            {analysis.defect_type !== 'none' && (
              <span className="text-xs opacity-80 capitalize">{analysis.defect_type.replace('-', ' ')}</span>
            )}
          </div>
        </div>
        <button onClick={onDismiss} className="text-white/60 hover:text-white text-lg leading-none flex-shrink-0 mt-0.5">×</button>
      </div>
    </motion.div>
  );
}

function CameraView({ camera, onAngleChange, onRename, onRemove, onBeadAlert, onBeadLog }: {
  camera: Camera;
  onAngleChange: (id: string, angle: Camera['angle']) => void;
  onRename: (id: string, label: string) => void;
  onRemove: (id: string) => void;
  onBeadAlert: (analysis: BeadAnalysis) => void;
  onBeadLog: (analysis: BeadAnalysis) => void;
}) {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const overlayRef   = useRef<HTMLCanvasElement>(null);
  const captureRef   = useRef<HTMLCanvasElement>(null);
  const timerRef     = useRef<number | null>(null);
  const beadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [streaming,  setStreaming]  = useState(false);
  const [error,      setError]      = useState('');
  const [editing,    setEditing]    = useState(false);
  const [label,      setLabel]      = useState(camera.label);
  const [showPlumb,  setShowPlumb]  = useState(false);
  const [showBead,   setShowBead]   = useState(false);
  const [alignMode,  setAlignMode]  = useState<'vertical' | 'horizontal'>('vertical');
  const [liveAngle,  setLiveAngle]  = useState(0);
  const [beadResult, setBeadResult] = useState<BeadAnalysis | null>(null);
  const [analysing,  setAnalysing]  = useState(false);

  const angles: Camera['angle'][] = ['front', 'side', 'overhead', 'nozzle'];

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = captureRef.current;
    if (!video || !canvas || video.readyState < 2) return null;
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  }, []);

  const runBeadAnalysis = useCallback(async () => {
    if (!streaming || !showBead) return;
    const base64 = captureFrame();
    if (!base64) return;
    setAnalysing(true);
    try {
      const res = await fetch('/api/analyze-beads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType: 'image/jpeg' }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      const analysis: BeadAnalysis = {
        verdict:         data.verdict         ?? 'unclear',
        angle_deviation: data.angle_deviation ?? 0,
        defect_type:     data.defect_type     ?? 'none',
        severity:        data.severity        ?? 'none',
        description:     data.description     ?? '',
        bead_count:      data.bead_count      ?? 0,
        confidence:      data.confidence      ?? 'low',
        timestamp:       new Date().toLocaleTimeString(),
        cameraId:        camera.id,
        cameraLabel:     camera.label,
      };
      setBeadResult(analysis);
      onBeadLog(analysis);
      if (analysis.severity === 'high') onBeadAlert(analysis);
    } catch (e) {
      console.error('[bead-analysis]', e);
    } finally {
      setAnalysing(false);
    }
  }, [streaming, showBead, captureFrame, camera.id, camera.label, onBeadLog, onBeadAlert]);

  useEffect(() => {
    if (streaming && showBead) {
      runBeadAnalysis();
      beadTimerRef.current = setInterval(runBeadAnalysis, 15000);
    } else {
      if (beadTimerRef.current) clearInterval(beadTimerRef.current);
      if (!showBead) setBeadResult(null);
    }
    return () => { if (beadTimerRef.current) clearInterval(beadTimerRef.current); };
  }, [streaming, showBead, runBeadAnalysis]);

  const analyseFrame = () => {
    const video   = videoRef.current;
    const canvas  = canvasRef.current;
    const overlay = overlayRef.current;
    if (!video || !canvas || !overlay || video.readyState < 2) return;
    const rect = overlay.getBoundingClientRect();
    const ow = rect.width || 640, oh = rect.height || 360;
    overlay.width = ow; overlay.height = oh;
    const octx = overlay.getContext('2d')!;
    octx.clearRect(0, 0, ow, oh);
    const vw = video.videoWidth || 640, vh = video.videoHeight || 360;
    canvas.width = vw; canvas.height = vh;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0, vw, vh);
    const { data } = ctx.getImageData(0, 0, vw, vh);
    const grey = new Float32Array(vw * vh);
    for (let i = 0; i < vw * vh; i++)
      grey[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
    const isHorizontal = alignMode === 'horizontal';
    const stepX = Math.max(1, Math.floor(vw / 40)), stepY = Math.max(1, Math.floor(vh / 60));
    const pts: { x: number; y: number }[] = [];
    for (let y = stepY; y < vh - stepY; y += stepY)
      for (let x = stepX; x < vw - stepX; x += stepX) {
        const gx = Math.abs(grey[y * vw + (x + 1)] - grey[y * vw + (x - 1)]);
        const gy = Math.abs(grey[(y + 1) * vw + x] - grey[(y - 1) * vw + x]);
        const mag = gx + gy;
        if (isHorizontal ? gy > gx && mag > 0.08 : gx > gy && mag > 0.08) pts.push({ x, y });
      }
    let tilt = 0;
    if (pts.length > 5) {
      const n = pts.length, sumY = pts.reduce((s, p) => s + p.y, 0), sumX = pts.reduce((s, p) => s + p.x, 0);
      const sumYY = pts.reduce((s, p) => s + p.y * p.y, 0), sumXY = pts.reduce((s, p) => s + p.x * p.y, 0);
      const denom = n * sumYY - sumY * sumY;
      if (Math.abs(denom) > 1e-6) tilt = Math.atan((n * sumXY - sumX * sumY) / denom) * 180 / Math.PI;
    }
    const deviation = isHorizontal ? 90 - Math.abs(tilt) : tilt;
    const absDev = Math.abs(deviation);
    const lineColor = absDev <= 10 ? 'rgba(34,197,94,0.95)' : absDev <= 15 ? 'rgba(251,191,36,0.95)' : 'rgba(239,68,68,0.95)';
    const baseAngle = isHorizontal ? 90 : 0;
    const rad = ((tilt + baseAngle) * Math.PI) / 180, refRad = (baseAngle * Math.PI) / 180;
    const half = oh * 0.45;
    const cx = pts.length > 0 ? (pts.reduce((s, p) => s + p.x, 0) / pts.length / vw) * ow : ow / 2;
    const cy = pts.length > 0 ? (pts.reduce((s, p) => s + p.y, 0) / pts.length / vh) * oh : oh / 2;
    setLiveAngle(deviation);
    octx.strokeStyle = 'rgba(255,255,255,0.35)'; octx.lineWidth = 1.5; octx.setLineDash([6, 5]);
    octx.beginPath(); octx.moveTo(cx - Math.sin(refRad) * half, cy - Math.cos(refRad) * half);
    octx.lineTo(cx + Math.sin(refRad) * half, cy + Math.cos(refRad) * half); octx.stroke(); octx.setLineDash([]);
    const lx1 = cx - Math.sin(rad) * half, ly1 = cy - Math.cos(rad) * half;
    const lx2 = cx + Math.sin(rad) * half, ly2 = cy + Math.cos(rad) * half;
    octx.strokeStyle = lineColor; octx.lineWidth = 3; octx.lineCap = 'round';
    octx.beginPath(); octx.moveTo(lx1, ly1); octx.lineTo(lx2, ly2); octx.stroke();
    octx.fillStyle = lineColor;
    octx.beginPath(); octx.arc(lx1, ly1, 4, 0, Math.PI * 2); octx.fill();
    octx.beginPath(); octx.arc(lx2, ly2, 4, 0, Math.PI * 2); octx.fill();
    const lbl = `${deviation >= 0 ? '+' : ''}${deviation.toFixed(1)}°`;
    octx.font = 'bold 13px monospace';
    const tw = octx.measureText(lbl).width + 14;
    const bx2 = cx + Math.sin(rad) * 55 + 14, by2 = cy - Math.cos(rad) * 55;
    octx.fillStyle = lineColor;
    octx.beginPath(); octx.roundRect(bx2 - tw / 2, by2 - 11, tw, 20, 4); octx.fill();
    octx.fillStyle = 'white'; octx.fillText(lbl, bx2 - tw / 2 + 7, by2 + 4);
  };

  useEffect(() => {
    if (streaming && showPlumb) {
      const loop = () => { analyseFrame(); timerRef.current = window.setTimeout(loop, 125) as unknown as number; };
      timerRef.current = window.setTimeout(loop, 125) as unknown as number;
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [streaming, showPlumb, alignMode]);

  const startCamera = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); setStreaming(true); }
    } catch (e: any) { setError(e.message || 'Camera access denied'); }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreaming(false); setShowBead(false); setBeadResult(null);
  };

  const saveLabel = () => { onRename(camera.id, label); setEditing(false); };
  const showBeadPanel = showBead && (beadResult !== null || analysing);

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 flex-wrap gap-1">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${streaming ? 'bg-red-500 animate-pulse' : 'bg-gray-300'}`} />
          {editing ? (
            <input autoFocus value={label} onChange={e => setLabel(e.target.value)}
              onBlur={saveLabel} onKeyDown={e => e.key === 'Enter' && saveLabel()}
              className="text-xs font-semibold border-b border-black outline-none bg-transparent w-28" />
          ) : (
            <button onClick={() => setEditing(true)} className="text-xs font-semibold text-black hover:text-black/60 truncate max-w-[120px]">
              {camera.label}
            </button>
          )}
          {streaming && <span className="text-[9px] font-mono text-red-500 font-bold">LIVE</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => streaming && setShowBead(v => !v)} disabled={!streaming}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold rounded-lg transition-all ${
              !streaming ? 'text-black/15 border border-gray-100 cursor-not-allowed'
              : showBead ? 'bg-black text-white' : 'text-black/40 hover:text-black border border-gray-200'
            }`}
            title={!streaming ? 'Start camera to enable AI Monitor' : 'Toggle AI Monitor'}>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
            </svg>
            AI Monitor
          </button>
          {showBead && analysing && (
            <motion.div className="w-3 h-3 border border-black/40 border-t-black rounded-full flex-shrink-0"
              animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} />
          )}
        </div>
      </div>

      <div className="relative bg-black aspect-video flex items-center justify-center">
        <video ref={videoRef} autoPlay playsInline muted
          className={`absolute inset-0 w-full h-full object-cover ${streaming ? 'block' : 'hidden'}`} />
        <canvas ref={canvasRef} className="hidden" />
        <canvas ref={captureRef} className="hidden" />
        <canvas ref={overlayRef}
          className={`absolute inset-0 w-full h-full z-10 ${streaming && showPlumb ? 'block' : 'hidden'}`} />
        {streaming && showBead && <BeadOverlay analysis={beadResult} analysing={analysing} />}
        {streaming && !showPlumb && !showBead && (
          <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 rounded-lg z-10">
            <span className="text-[9px] text-white/70 font-mono uppercase">{camera.angle} view</span>
          </div>
        )}
        {streaming && showBead && (
          <div className="absolute top-2 left-2 z-20 flex items-center gap-1.5 px-2 py-0.5 bg-black/70 rounded-lg">
            <span className="text-[9px] text-white/70 font-mono uppercase">Bead Analysis</span>
            {beadResult && <span className="text-[9px] font-mono text-white/40">· {beadResult.timestamp}</span>}
          </div>
        )}
        {!streaming && (
          <div className="text-center z-10 px-4">
            <svg className="w-8 h-8 text-white/20 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            {error && <p className="text-red-400 text-[10px] mb-2">{error}</p>}
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

      {showPlumb && <PlumbIndicator angle={liveAngle} />}
      {showBeadPanel && <BeadStatusPanel analysis={beadResult} />}
    </div>
  );
}

function DefectDetectionPanel({ onAlert }: { onAlert: (msg: string, level: 'info' | 'warn' | 'error') => void }) {
  const [image,    setImage]    = useState<string | null>(null);
  const [running,  setRunning]  = useState(false);
  const [analysis, setAnalysis] = useState<BeadAnalysis | null>(null);
  const [error,    setError]    = useState('');

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    setImage(objectUrl);
    setAnalysis(null);
    setError('');
    setRunning(true);
    onAlert('Claude Vision analysing image…', 'info');

    try {
      // Convert to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/analyze-beads', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageBase64: base64, mimeType: file.type || 'image/jpeg' }),
      });

      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();

      const result: BeadAnalysis = {
        verdict:         data.verdict         ?? 'unclear',
        angle_deviation: data.angle_deviation ?? 0,
        defect_type:     data.defect_type     ?? 'none',
        severity:        data.severity        ?? 'none',
        description:     data.description     ?? '',
        bead_count:      data.bead_count      ?? 0,
        confidence:      data.confidence      ?? 'low',
        timestamp:       new Date().toLocaleTimeString(),
        cameraId:        'upload',
        cameraLabel:     'Uploaded image',
      };

      setAnalysis(result);

      const level: 'info' | 'warn' | 'error' =
        result.severity === 'high'   ? 'error' :
        result.severity === 'medium' ? 'warn'  : 'info';
      onAlert(`[Upload] ${result.verdict} — ${result.description}`, level);
    } catch (e: any) {
      setError('Analysis failed. Check your API key and try again.');
      onAlert('Defect analysis failed', 'error');
    } finally {
      setRunning(false);
    }
  };

  const verdictLabel: Record<BeadVerdict, string> = {
    straight: 'Print quality good',
    deviated: 'Bead deviation detected',
    defect:   'Defect detected',
    unclear:  'Unable to assess',
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Left — image upload */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-black/40">Layer Image</h3>
            <p className="text-[10px] text-black/25 mt-0.5">Upload a photo of your printed layer</p>
          </div>
          <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 bg-black text-white text-[11px] font-semibold rounded-xl hover:bg-black/80 transition-all">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Upload
            <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
          </label>
        </div>
        <div className="aspect-video bg-gray-50 flex items-center justify-center relative">
          {image
            ? <img src={image} alt="layer" className="w-full h-full object-contain" />
            : (
              <div className="text-center px-6">
                <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-black/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-xs font-medium text-black/30 mb-1">Upload a concrete layer photo</p>
                <p className="text-[10px] text-black/20">Claude Vision will assess bead quality, angle deviation, and defects</p>
              </div>
            )
          }
          {running && (
            <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
              <div className="text-center">
                <motion.div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full mx-auto mb-3"
                  animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} />
                <p className="text-white text-xs font-semibold">Analysing with Claude Vision…</p>
                <p className="text-white/40 text-[10px] mt-1">Reading bead layers and detecting defects</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right — Claude Vision results */}
      <div className="bg-black rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-white/8">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-white/40">Analysis Results</h3>
          <p className="text-[10px] text-white/20 mt-0.5">Claude Vision · 3DCP quality assessment</p>
        </div>
        <div className="p-5">
          {!analysis && !running && !error && (
            <div className="text-center py-12 text-white/20 text-xs">
              Upload a layer image to see results
            </div>
          )}

          {error && (
            <div className="border border-white/15 rounded-xl p-4 text-center">
              <p className="text-xs font-semibold text-white/60">{error}</p>
            </div>
          )}

          {analysis && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">

              {/* Verdict */}
              <div>
                <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1">Verdict</p>
                <p className="text-xl font-bold text-white capitalize">
                  {analysis.verdict === 'straight' ? 'Print quality good' :
                   analysis.verdict === 'deviated' ? 'Bead deviation detected' :
                   analysis.verdict === 'defect'   ? 'Defect detected' : 'Unable to assess'}
                </p>
                <p className="text-[11px] text-white/40 mt-1.5 leading-relaxed">{analysis.description}</p>
              </div>

              <div className="h-px bg-white/8"/>

              {/* Defect */}
              <div>
                <p className="text-[10px] text-white/30 uppercase tracking-widest mb-2">Defect</p>
                <p className="text-sm font-semibold text-white capitalize">
                  {analysis.defect_type === 'none' ? 'None detected' : analysis.defect_type.replace(/-/g, ' ')}
                </p>
                {analysis.defect_type !== 'none' && (
                  <p className="text-[10px] text-white/40 mt-1">Review this layer before continuing the print</p>
                )}
              </div>

              <div className="h-px bg-white/8"/>

              {/* Angle deviation */}
              <div>
                <p className="text-[10px] text-white/30 uppercase tracking-widest mb-2">Angle Deviation</p>
                <p className="text-sm font-semibold text-white font-mono">
                  {analysis.angle_deviation !== 0
                    ? `${analysis.angle_deviation > 0 ? '+' : ''}${analysis.angle_deviation.toFixed(1)}°`
                    : 'None'}
                </p>
              </div>

              <div className="h-px bg-white/8"/>

              {/* Recommendation */}
              <div className="border border-white/10 rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-white">
                  {analysis.verdict === 'straight' && analysis.defect_type === 'none'
                    ? 'Print can continue'
                    : analysis.severity === 'high'
                      ? 'Stop print — inspect immediately'
                      : 'Monitor closely before next layer'}
                </p>
                <p className="text-[10px] text-white/30 mt-0.5 font-mono">{analysis.timestamp}</p>
              </div>

              {/* Re-upload */}
              <label className="cursor-pointer w-full block">
                <div className="w-full py-2 text-xs font-medium text-center border border-white/10 rounded-xl text-white/30 hover:text-white hover:border-white/30 transition-all">
                  Upload different image
                </div>
                <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
              </label>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

function BeadEventLog({ entries }: { entries: BeadAnalysis[] }) {
  if (entries.length === 0) return null;
  const severityDot = (s: BeadSeverity) => s === 'high' ? 'bg-red-500' : s === 'medium' ? 'bg-amber-400' : s === 'low' ? 'bg-amber-300' : 'bg-emerald-400';
  const verdictColor: Record<BeadVerdict, string> = { straight: 'text-emerald-700', deviated: 'text-amber-700', defect: 'text-red-700', unclear: 'text-black/40' };
  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Bead Analysis Log</h3>
        <span className="text-[9px] font-mono text-black/30">{entries.length} reading{entries.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="divide-y divide-gray-50 max-h-52 overflow-y-auto">
        {entries.map((e, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-2.5">
            <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
              <div className={`w-1.5 h-1.5 rounded-full ${severityDot(e.severity)}`} />
              <span className="text-[9px] font-mono text-black/30">{e.timestamp}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] font-bold uppercase ${verdictColor[e.verdict]}`}>{e.verdict}</span>
                {e.angle_deviation !== 0 && (
                  <span className="text-[10px] font-mono text-black/40">
                    {e.angle_deviation > 0 ? '+' : ''}{e.angle_deviation.toFixed(1)}°
                  </span>
                )}
                {e.defect_type !== 'none' && <span className="text-[10px] text-red-600 capitalize">{e.defect_type.replace('-', ' ')}</span>}
                <span className="text-[9px] text-black/25">{e.cameraLabel}</span>
              </div>
              {e.description && <p className="text-[10px] text-black/40 mt-0.5 truncate">{e.description}</p>}
            </div>
            <div className="flex-shrink-0 text-[9px] font-mono text-black/20">{e.confidence}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LiveMonitoring() {
  const router = useRouter();
  const { activeProject, updateProject } = useProjects();
  const sessionRef = useRef({ layersPrinted: 0, errorsDetected: 0, alerts: [] as ReportAlert[] });
  const tickRef    = useRef<NodeJS.Timeout | null>(null);

  const [activeTab,   setActiveTab]   = useState<Tab>('monitor');

  const [showConfirm, setShowConfirm] = useState(false);
  const [elapsed,     setElapsed]     = useState(0);
  const [clock,       setClock]       = useState(() => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  const [liveWeather, setLiveWeather] = useState<{ temperature: number; description: string; city: string } | null>(null);
  const [alertLog,    setAlertLog]    = useState<AlertEntry[]>([]);
  const [beadLog,     setBeadLog]     = useState<BeadAnalysis[]>([]);
  const [activeAlert, setActiveAlert] = useState<BeadAnalysis | null>(null);
  const [controls,    setControls]    = useState<PrinterControl>({ printSpeed: 60, extrusionRate: 100, pumpPressure: 4.2, paused: false });
  const [cameras,     setCameras]     = useState<Camera[]>([]);

  const [sensors, setSensors] = useState<SensorReading[]>(() => {
    const cond = (activeProject as any)?.report?.conditions;
    const seed = (val: number | undefined, warn?: (v: number) => boolean): Pick<SensorReading, 'value' | 'status' | 'history'> =>
      val != null
        ? { value: String(val), status: warn?.(val) ? 'warn' : 'ok', history: [val] }
        : { value: '—', status: 'ok', history: [] };
    return [
      { label: 'Ambient Temp',    unit: '°C',    trend: 'stable', ...seed(cond?.temperature, v => v > 30 || v < 5) },
      { label: 'Humidity',        unit: '%',     trend: 'stable', ...seed(cond?.humidity,    v => v > 80 || v < 30) },
      { label: 'Wind Speed',      unit: 'km/h',  trend: 'stable', ...seed(cond?.windSpeed,   v => v > 15) },
      { label: 'Flow Rate',       unit: 'L/min', trend: 'stable', value: '—', status: 'ok', history: [] },
      { label: 'Pump Pressure',   unit: 'bar',   trend: 'stable', value: '—', status: 'ok', history: [] },
      { label: 'Concrete Temp',   unit: '°C',    trend: 'stable', value: '—', status: 'ok', history: [] },
      { label: 'Pot Life Left',   unit: 'min',   trend: 'stable', value: '—', status: 'ok', history: [] },
      { label: 'Mix Consistency', unit: '%',     trend: 'stable', value: '—', status: 'ok', history: [] },
    ];
  });

  useEffect(() => {
    tickRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  useEffect(() => {
    const iv = setInterval(() => setClock(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const city = (activeProject as any)?.report?.city;
    if (!city || city === 'manual') return;
    const poll = async () => {
      try {
        const res = await fetch(`${API}/weather/current?city=${encodeURIComponent(city)}`);
        if (res.ok) {
          const d = await res.json();
          setLiveWeather({ temperature: d.temperature, description: d.description, city: d.city });
          setSensors(prev => prev.map(s => {
            if (s.label === 'Ambient Temp') {
              const v = Math.round(d.temperature);
              return { ...s, value: String(v), status: v > 30 || v < 5 ? 'warn' : 'ok', history: [...s.history.slice(-19), v] };
            }
            if (s.label === 'Humidity') {
              const v = Math.round(d.humidity);
              return { ...s, value: String(v), status: v > 80 || v < 30 ? 'warn' : 'ok', history: [...s.history.slice(-19), v] };
            }
            if (s.label === 'Wind Speed') {
              const v = Math.round(d.wind_speed);
              return { ...s, value: String(v), status: v > 15 ? 'warn' : 'ok', history: [...s.history.slice(-19), v] };
            }
            return s;
          }));
        }
      } catch { /* silent — don't break UI if weather is unavailable */ }
    };
    poll();
    const iv = setInterval(poll, 120_000);
    return () => clearInterval(iv);
  }, [activeProject?.report?.city]);



  const addAlert = useCallback((msg: string, level: 'info' | 'warn' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setAlertLog(prev => [{ time, msg, level }, ...prev.slice(0, 49)]);
    if (level !== 'info') sessionRef.current.alerts.push({ time, layer: sessionRef.current.layersPrinted, message: msg });
  }, []);

  const handleBeadLog = useCallback((analysis: BeadAnalysis) => {
    setBeadLog(prev => [analysis, ...prev.slice(0, 99)]);
    const level: 'info' | 'warn' | 'error' = analysis.severity === 'high' ? 'error' : analysis.severity === 'medium' ? 'warn' : 'info';
    const msg = analysis.verdict === 'unclear'
      ? `Bead analysis unclear — ${analysis.cameraLabel}`
      : `Bead [${analysis.cameraLabel}]: ${analysis.verdict}${analysis.angle_deviation !== 0 ? ` ${analysis.angle_deviation > 0 ? '+' : ''}${analysis.angle_deviation.toFixed(1)}°` : ''}${analysis.defect_type !== 'none' ? ` · ${analysis.defect_type}` : ''}`;
    addAlert(msg, level);
    if (analysis.severity === 'high') {
      sessionRef.current.errorsDetected += 1;
      sessionRef.current.alerts.push({ time: analysis.timestamp, layer: sessionRef.current.layersPrinted, message: `[Bead] ${analysis.description}` });
    }
  }, [addAlert]);

  const handleBeadAlert = useCallback((analysis: BeadAnalysis) => { setActiveAlert(analysis); }, []);

  const updateControl = (key: keyof PrinterControl, val: number | boolean) => {
    setControls(prev => ({ ...prev, [key]: val }));
    if (key !== 'paused') addAlert(`${key} set to ${val}`, 'info');
  };

  const addCamera    = () => { const id = String(Date.now()); setCameras(prev => [...prev, { id, label: `Camera ${prev.length + 1}`, angle: 'front', active: true }]); };
  const removeCamera = (id: string) => setCameras(prev => prev.filter(c => c.id !== id));
  const updateAngle  = (id: string, angle: Camera['angle']) => setCameras(prev => prev.map(c => c.id === id ? { ...c, angle } : c));
  const renameCamera = (id: string, label: string) => setCameras(prev => prev.map(c => c.id === id ? { ...c, label } : c));

  const fmtElapsed = () => {
    const h = Math.floor(elapsed / 3600), m = Math.floor((elapsed % 3600) / 60), s = elapsed % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`;
  };

  const endPrint = () => {
    if (!activeProject) return;
    const s = sessionRef.current;
    const h = Math.floor(elapsed / 3600), m = Math.floor((elapsed % 3600) / 60);
    const existing = (activeProject as any).report ?? {};
    const report = {
      // preserve all pre-print data saved by beginPrint
      ...existing,
      // update with live session data
      generatedAt:    new Date().toISOString(),
      duration:       h > 0 ? `${h}h ${m}m` : `${m}m`,
      totalLayers:    activeProject.totalLayers,
      layersPrinted:  s.layersPrinted,
      errorsDetected: s.errorsDetected,
      errorRate:      activeProject.totalLayers > 0 ? `${((s.errorsDetected / activeProject.totalLayers) * 100).toFixed(1)}%` : '0%',
      alerts:         [...(existing.alerts ?? []), ...s.alerts],
      printerName:    activeProject.printer.name,
      structureType:  activeProject.structureType,
    };
    updateProject(activeProject.id, { status: 'complete', report });
    router.push('/report');
  };

  const keySensors = sensors.slice(0, 4);

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <AppNav currentStep="monitor" />
      <style>{`footer{display:none!important}`}</style>

      <AnimatePresence>
        {activeAlert && <AlertBanner analysis={activeAlert} onDismiss={() => setActiveAlert(null)} />}
      </AnimatePresence>

      <div className="bg-white border-b border-gray-100 px-4 sm:px-6 py-3 sticky top-14 z-20">
        <div className="flex flex-wrap items-center gap-3 justify-between">

          {/* Left — status + elapsed + meta */}
          <div className="flex items-center gap-4">
            {/* Status dot */}
            <div className="flex items-center gap-2">
              <motion.div className="w-2 h-2 rounded-full bg-emerald-500"
                animate={{ opacity: controls.paused ? 1 : [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
              <span className="text-xs font-medium text-black/50">{controls.paused ? 'Paused' : 'Printing'}</span>
            </div>

            {/* Elapsed + clock + weather — all same size */}
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-bold font-mono text-black tracking-tight leading-none">{fmtElapsed()}</span>
              <span className="hidden sm:block w-px h-5 bg-black/10 self-center" />
              <span className="hidden sm:block text-2xl font-bold font-mono text-black/35 tracking-tight leading-none">{clock}</span>
              {(liveWeather || (activeProject as any)?.report?.conditions?.temperature != null) && (
                <>
                  <span className="hidden sm:block w-px h-5 bg-black/10 self-center" />
                  <span className="hidden sm:block text-2xl font-bold font-mono text-black/35 tracking-tight leading-none"
                    title={liveWeather?.description ?? 'Site conditions from optimizer'}>
                    {liveWeather
                      ? `${Math.round(liveWeather.temperature)}°C`
                      : `${(activeProject as any).report.conditions.temperature}°C`
                    }
                  </span>
                </>
              )}
            </div>

            {/* Printer name */}
            {activeProject && <span className="text-xs text-black/30 hidden md:block truncate max-w-[140px]">{activeProject.printer.name || '—'}</span>}
            {beadLog.length > 0 && <span className="text-[10px] font-mono text-black/30 hidden lg:block">{beadLog.length} bead scan{beadLog.length !== 1 ? 's' : ''}</span>}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {(['monitor', 'sensors', 'defects'] as Tab[]).map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-xl capitalize transition-all ${activeTab === t ? 'bg-black text-white' : 'text-black/40 hover:text-black hover:bg-gray-100'}`}>
                {t === 'monitor' ? 'Monitor' : t === 'sensors' ? 'Sensors' : 'Defects'}
              </button>
            ))}
            <div className="w-px h-4 bg-gray-200" />
            <button onClick={() => updateControl('paused', !controls.paused)}
              className="px-2.5 py-1.5 text-xs font-semibold bg-black text-white rounded-xl hover:bg-black/80 transition-all">
              {controls.paused ? 'Resume' : 'Pause'}
            </button>
            <button onClick={() => setShowConfirm(true)}
              className="px-2.5 py-1.5 text-xs font-semibold bg-black text-white rounded-xl hover:bg-black/80 transition-all">
              End Print
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 pt-6">
        <AnimatePresence mode="wait">

          {activeTab === 'monitor' && (
            <motion.div key="monitor" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="grid grid-cols-1 lg:grid-cols-[1fr_300px] xl:grid-cols-[1fr_320px] gap-6">

              <div className="space-y-4">
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

                {beadLog.length > 0 && <BeadEventLog entries={beadLog} />}

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

              <div className="space-y-4">
                <div className="bg-black rounded-2xl p-5 shadow-sm">
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-white/40 mb-4">Printer Control</h3>
                  <div className="space-y-5">
                    {[
                      { label: 'Print Speed',    key: 'printSpeed'    as const, min: 10,  max: 150, step: 5,   unit: ' mm/s', warn: controls.printSpeed > 120 },
                      { label: 'Extrusion Rate', key: 'extrusionRate' as const, min: 50,  max: 150, step: 5,   unit: '%',     warn: controls.extrusionRate > 130 },
                      { label: 'Pump Pressure',  key: 'pumpPressure'  as const, min: 1,   max: 10,  step: 0.1, unit: ' bar',  warn: controls.pumpPressure > 8 },
                    ].map(s => {
                      const pct = ((controls[s.key] as number - s.min) / (s.max - s.min)) * 100;
                      return (
                        <div key={s.key} className="space-y-1.5">
                          <div className="flex justify-between">
                            <span className="text-xs font-medium text-white/60">{s.label}</span>
                            <div className="flex items-center gap-1">
                              {s.warn && <span className="text-[9px] text-amber-400">!</span>}
                              <span className="text-xs font-bold font-mono text-white">{controls[s.key]}{s.unit}</span>
                            </div>
                          </div>
                          <input type="range" min={s.min} max={s.max} step={s.step} value={controls[s.key] as number}
                            onChange={e => updateControl(s.key, Number(e.target.value))}
                            className="w-full h-1 rounded-full appearance-none cursor-pointer"
                            style={{ background: `linear-gradient(to right,#fff ${pct}%,rgba(255,255,255,0.15) ${pct}%)` }} />
                          <div className="flex justify-between text-[9px] text-white/25">
                            <span>{s.min}{s.unit}</span><span>{s.max}{s.unit}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-5">
                    {[
                      { label: 'Home',  action: () => addAlert('Homing nozzle…') },
                      { label: 'Purge', action: () => addAlert('Purge started') },
                      { label: 'Prime', action: () => addAlert('Priming pump…') },
                    ].map((btn, i) => (
                      <button key={i} onClick={btn.action}
                        className="py-2 text-[11px] font-semibold rounded-xl border border-white/20 text-white hover:bg-white/10 transition-all">
                        {btn.label}
                      </button>
                    ))}
                    <button onClick={() => { updateControl('paused', true); addAlert('EMERGENCY STOP', 'error'); }}
                      className="py-2 text-[11px] font-semibold rounded-xl bg-red-600 text-white hover:bg-red-700 transition-all">
                      E-Stop
                    </button>
                  </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Live Sensors</h3>
                    <button onClick={() => setActiveTab('sensors')} className="text-[10px] text-black/30 hover:text-black">View all →</button>
                  </div>
                  <div className="space-y-3">
                    {keySensors.map((s, i) => (
                      <div key={i} className="bg-black rounded-xl p-3 flex items-center justify-between">
                        <div>
                          <p className="text-[9px] font-semibold uppercase tracking-widest text-white/40 mb-0.5">{s.label}</p>
                          <div className="flex items-baseline gap-1">
                            <span className={`font-bold text-white ${s.value === '—' ? 'text-sm text-white/30' : 'text-lg'}`}>{s.value}</span>
                            {s.value !== '—' && <span className="text-[10px] text-white/40">{s.unit}</span>}
                          </div>
                          {s.value === '—' && <p className="text-[8px] text-white/20 mt-0.5">No sensor connected</p>}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <div className={`w-1.5 h-1.5 rounded-full ${s.value === '—' ? 'bg-white/20' : s.status === 'ok' ? 'bg-emerald-400 animate-pulse' : s.status === 'warn' ? 'bg-amber-400 animate-pulse' : 'bg-red-400 animate-pulse'}`} />
                          {s.history.length > 1 && <Sparkline data={s.history} color={s.status === 'ok' ? '#4ade80' : s.status === 'warn' ? '#fbbf24' : '#f87171'} />}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'sensors' && (
            <motion.div key="sensors" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              {[
                { title: 'Environmental',   items: sensors.slice(0, 3) },
                { title: 'Flow & Pressure', items: sensors.slice(3, 5) },
                { title: 'Mix & Material',  items: sensors.slice(5, 8) },
              ].map(group => (
                <div key={group.title}>
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-3">{group.title}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                    {group.items.map((s, i) => (
                      <div key={i} className="bg-black rounded-2xl p-4">
                        <div className="flex justify-between mb-2">
                          <p className="text-[9px] font-semibold uppercase tracking-wide text-white/40">{s.label}</p>
                          <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${s.status === 'ok' ? 'bg-emerald-400' : s.status === 'warn' ? 'bg-amber-400' : 'bg-red-400'}`} />
                        </div>
                        <div className="flex items-baseline gap-1 mb-2">
                          <span className="text-xl sm:text-2xl font-bold text-white">{s.value}</span>
                          <span className="text-xs text-white/40">{s.unit}</span>
                        </div>
                        <Sparkline data={s.history} color={s.status === 'ok' ? '#4ade80' : s.status === 'warn' ? '#fbbf24' : '#f87171'} width={80} />
                      </div>
                    ))}
                    <button className="bg-white border-2 border-dashed border-gray-200 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 hover:border-black transition-all group min-h-[100px]">
                      <span className="text-2xl text-gray-200 group-hover:text-black transition-all">+</span>
                      <span className="text-[10px] text-black/25 group-hover:text-black transition-all text-center">Connect Sensor</span>
                    </button>
                  </div>
                </div>
              ))}
            </motion.div>
          )}

          {activeTab === 'defects' && (
            <motion.div key="defects" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <DefectDetectionPanel onAlert={addAlert} />
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 sm:p-8 max-w-sm w-full shadow-2xl">
            <h3 className="text-base font-bold text-black mb-2">End print session?</h3>
            <p className="text-sm text-black/40 mb-6">This will generate your report and mark the project as complete.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowConfirm(false)}
                className="flex-1 py-2.5 text-sm font-semibold border border-gray-200 rounded-xl hover:bg-gray-50">Cancel</button>
              <button onClick={endPrint}
                className="flex-1 py-2.5 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/80">
                End & Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}