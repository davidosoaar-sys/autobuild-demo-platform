'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { loadOpenCV } from '@/lib/opencv-loader';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DetectedLine {
  x1: number; y1: number; x2: number; y2: number;
  angle: number; length: number;
}

interface AlertEntry {
  id: string;
  time: Date;
  cameraLabel: string;
  type: 'caution' | 'warning';
  angle: number;
  layer: number;
}

interface PrintJob {
  totalLayers: number;
  currentLayer: number;
  startTime: Date | null;
  isRunning: boolean;
  extrusionStatus: 'active' | 'paused' | 'stopped';
  printSpeed: number;
  errorsDetected: number;
  alerts: AlertEntry[];
}

interface Camera {
  id: string;
  label: string;
  printer: string;
  deviceId: string;
  stream: MediaStream | null;
  isActive: boolean;
  dominantAngle: number | null;
  sensitivity: number;
  localErrors: number;
}

type CVStatus = 'idle' | 'loading' | 'ready' | 'error';

// ─── Utils ────────────────────────────────────────────────────────────────────

function angleFromVertical(x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1;
  const deg = (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI;
  return dx < 0 ? -deg : deg;
}

function lineLength(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

function fmt(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}h ${String(m).padStart(2, '0')}m`
    : `${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
}

function angleStatus(angle: number | null) {
  if (angle === null) return { label: 'Scanning', color: '#9ca3af', dot: 'bg-gray-300', badge: 'bg-gray-50 text-gray-500' };
  const a = Math.abs(angle);
  if (a <= 9)  return { label: 'Optimal',  color: '#16a34a', dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700' };
  if (a <= 15) return { label: 'Caution',  color: '#d97706', dot: 'bg-amber-400',   badge: 'bg-amber-50 text-amber-700' };
  return          { label: 'Warning',  color: '#dc2626', dot: 'bg-red-500',     badge: 'bg-red-50 text-red-700' };
}

// ─── OpenCV processor ─────────────────────────────────────────────────────────

function processFrame(video: HTMLVideoElement, sensitivity: number): DetectedLine | null {
  const cv = (window as any).cv;
  if (!cv?.Mat) return null;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;

  const off = document.createElement('canvas');
  off.width = vw; off.height = vh;
  off.getContext('2d')!.drawImage(video, 0, 0, vw, vh);

  let src: any, gray: any, blur: any, edges: any, lines: any;
  try {
    src = cv.imread(off); gray = new cv.Mat(); blur = new cv.Mat();
    edges = new cv.Mat(); lines = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    const hi = Math.round(200 - sensitivity * 1.2);
    cv.Canny(blur, edges, Math.round(hi * 0.4), hi);
    cv.HoughLinesP(edges, lines, 1, Math.PI / 180,
      Math.round(80 - sensitivity * 0.4), Math.round(vh * 0.12), 18);
    const detected: DetectedLine[] = [];
    for (let i = 0; i < lines.rows; i++) {
      const [x1, y1, x2, y2] = [
        lines.data32S[i * 4], lines.data32S[i * 4 + 1],
        lines.data32S[i * 4 + 2], lines.data32S[i * 4 + 3],
      ];
      const angle = angleFromVertical(x1, y1, x2, y2);
      if (Math.abs(angle) <= 45)
        detected.push({ x1, y1, x2, y2, angle, length: lineLength(x1, y1, x2, y2) });
    }
    return detected.length
      ? detected.reduce((b, l) => l.length > b.length ? l : b, detected[0])
      : null;
  } catch { return null; }
  finally { src?.delete(); gray?.delete(); blur?.delete(); edges?.delete(); lines?.delete(); }
}

// ─── Canvas overlay ───────────────────────────────────────────────────────────

function drawOverlay(canvas: HTMLCanvasElement, line: DetectedLine | null, sx: number, sy: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!line) return;

  const { color } = angleStatus(line.angle);
  const x1 = line.x1 * sx, y1 = line.y1 * sy, x2 = line.x2 * sx, y2 = line.y2 * sy;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const halfLen = Math.max(lineLength(x1, y1, x2, y2) * 0.6, canvas.height * 0.25);

  // Detected edge
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.shadowColor = color; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  [{ x: x1, y: y1 }, { x: x2, y: y2 }].forEach(p => {
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  });
  ctx.restore();

  // Ideal plumb
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 1.5; ctx.setLineDash([7, 5]); ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.moveTo(mx, my - halfLen); ctx.lineTo(mx, my + halfLen); ctx.stroke();
  ctx.restore();

  // Arc
  if (Math.abs(line.angle) > 0.5) {
    const r = halfLen * 0.28;
    const s = -Math.PI / 2, e = s + (line.angle * Math.PI) / 180;
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.55; ctx.setLineDash([3, 3]); ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(mx, my, r, Math.min(s, e), Math.max(s, e)); ctx.stroke();
    ctx.restore();
  }

  // Label pill
  const tag = `${line.angle > 0 ? '+' : ''}${Math.round(line.angle)}° off plumb`;
  ctx.save();
  ctx.font = 'bold 12px monospace';
  const tw = ctx.measureText(tag).width + 18;
  const lx = Math.min(Math.max(mx + 14, 6), canvas.width - tw - 6);
  const ly = Math.max(my - halfLen * 0.45, 10);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  pill(ctx, lx, ly - 12, tw, 24, 6); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.globalAlpha = 0.4; ctx.setLineDash([]);
  pill(ctx, lx, ly - 12, tw, 24, 6); ctx.stroke();
  ctx.globalAlpha = 1; ctx.fillStyle = color; ctx.textAlign = 'center';
  ctx.fillText(tag, lx + tw / 2, ly + 4);
  ctx.restore();
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ─── Drag resize ──────────────────────────────────────────────────────────────

function useDragResize(iw: number, ih: number) {
  const [size, setSize] = useState({ w: iw, h: ih });
  const drag = useRef(false);
  const s0 = useRef({ x: 0, y: 0, w: iw, h: ih });
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); drag.current = true;
    s0.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    const mv = (ev: MouseEvent) => {
      if (!drag.current) return;
      setSize({ w: Math.max(380, s0.current.w + ev.clientX - s0.current.x), h: Math.max(280, s0.current.h + ev.clientY - s0.current.y) });
    };
    const up = () => { drag.current = false; window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  }, [size]);
  return { size, onMouseDown };
}

// ─── Global stats bar (black card) ───────────────────────────────────────────

function GlobalStatsBar({ job, cameras, onEdit }: { job: PrintJob; cameras: Camera[]; onEdit: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const elapsed = job.startTime ? now - job.startTime.getTime() : 0;
  const progress = job.totalLayers > 0 ? (job.currentLayer / job.totalLayers) * 100 : 0;
  const avgMs = job.currentLayer > 0 ? elapsed / job.currentLayer : 0;
  const remaining = avgMs * (job.totalLayers - job.currentLayer);
  const activeCams = cameras.filter(c => c.isActive).length;

  const stats = [
    {
      label: 'Current Layer',
      value: job.isRunning ? `${job.currentLayer} / ${job.totalLayers || '—'}` : '— / —',
      sub: job.totalLayers > 0 ? `${progress.toFixed(1)}% complete` : 'Set total layers',
    },
    {
      label: 'Error Type',
      value: job.errorsDetected > 0
        ? job.alerts[0]?.type === 'warning' ? 'Structural' : 'Deviation'
        : 'None',
      sub: job.errorsDetected > 0 ? `${job.errorsDetected} error${job.errorsDetected > 1 ? 's' : ''} logged` : 'No issues detected',
    },
    {
      label: 'Elapsed Time',
      value: job.startTime ? fmtElapsed(elapsed) : '—',
      sub: job.isRunning && remaining > 0 ? `~${fmtElapsed(remaining)} remaining` : job.isRunning ? 'Calculating...' : 'Not started',
    },
    {
      label: 'Extrusion',
      value: job.extrusionStatus.charAt(0).toUpperCase() + job.extrusionStatus.slice(1),
      sub: `${job.printSpeed} mm/s`,
    },
    {
      label: 'Active Cameras',
      value: `${activeCams} / ${cameras.length}`,
      sub: activeCams === 0 ? 'No feed active' : 'Monitoring',
    },
  ];

  return (
    <div className="bg-black rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className={`w-1.5 h-1.5 rounded-full ${job.isRunning ? 'bg-white animate-pulse' : 'bg-white/30'}`} />
          <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-white/50">
            Print Monitor
          </span>
          {job.isRunning && (
            <span className="text-[10px] font-semibold px-2 py-0.5 border border-white/20 text-white/60 rounded-full tracking-widest">
              LIVE
            </span>
          )}
        </div>
        <button
          onClick={onEdit}
          className="text-[11px] font-medium text-white/40 hover:text-white transition-colors tracking-wide"
        >
          Configure job
        </button>
      </div>

      {/* Progress bar */}
      {job.totalLayers > 0 && (
        <div className="h-px bg-white/10">
          <div className="h-full bg-white transition-all duration-700" style={{ width: `${progress}%` }} />
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-5 divide-x divide-white/10">
        {stats.map((s, i) => (
          <div key={i} className="px-5 py-4">
            <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/35 mb-2">
              {s.label}
            </div>
            <div className="text-base font-semibold text-white leading-none tracking-tight">
              {s.value}
            </div>
            <div className="text-[10px] text-white/35 mt-1.5">{s.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Job config modal ─────────────────────────────────────────────────────────

function JobConfigModal({ job, onSave, onClose }: {
  job: PrintJob; onSave: (layers: number, speed: number) => void; onClose: () => void;
}) {
  const [layers, setLayers] = useState(String(job.totalLayers || 100));
  const [speed, setSpeed]   = useState(String(job.printSpeed || 60));
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl w-80 border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-black">Configure Print Job</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
            <span className="text-gray-400 text-lg leading-none">&times;</span>
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-black mb-1.5">Total Layers</label>
            <input type="number" value={layers} onChange={e => setLayers(e.target.value)} min={1}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-black transition-colors text-black" />
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1.5">Print Speed (mm/s)</label>
            <input type="number" value={speed} onChange={e => setSpeed(e.target.value)} min={1}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-black transition-colors text-black" />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-black transition-colors">Cancel</button>
          <button onClick={() => { onSave(parseInt(layers) || 100, parseInt(speed) || 60); onClose(); }}
            className="flex-1 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-900 transition-colors">Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── Alert log ────────────────────────────────────────────────────────────────

function AlertLog({ alerts }: { alerts: AlertEntry[] }) {
  const [open, setOpen] = useState(false);
  if (!alerts.length) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs font-semibold tracking-widest uppercase text-black">Alert Log</span>
          <span className="px-2 py-0.5 bg-red-50 text-red-600 text-[10px] font-semibold rounded-full">{alerts.length}</span>
        </div>
        <span className="text-gray-300 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 divide-y divide-gray-50 max-h-48 overflow-y-auto">
          {alerts.map(a => (
            <div key={a.id} className="flex items-center gap-3 px-5 py-2.5">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.type === 'warning' ? 'bg-red-500' : 'bg-amber-400'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-black truncate">
                  {a.cameraLabel} — {a.type === 'warning' ? 'Warning' : 'Caution'} {a.angle > 0 ? '+' : ''}{a.angle}° off plumb
                </div>
                <div className="text-[10px] text-gray-400">Layer {a.layer} · {fmt(a.time)}</div>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${a.type === 'warning' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
                {a.type === 'warning' ? 'WARNING' : 'CAUTION'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Per-camera stats ─────────────────────────────────────────────────────────

function CameraStats({ camera }: { camera: Camera }) {
  const st = angleStatus(camera.dominantAngle);
  return (
    <div className="grid grid-cols-3 divide-x divide-gray-100 border-t border-gray-100">
      {[
        { label: 'Angle', value: camera.dominantAngle !== null ? `${camera.dominantAngle > 0 ? '+' : ''}${camera.dominantAngle}°` : '—' },
        { label: 'Status', value: st.label },
        { label: 'Errors', value: String(camera.localErrors) },
      ].map((s, i) => (
        <div key={i} className="px-3 py-2 text-center">
          <div className="text-[10px] text-black/40 uppercase tracking-wider mb-0.5">{s.label}</div>
          <div className="text-xs font-semibold text-black">{s.value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Camera Card ──────────────────────────────────────────────────────────────

function CameraCard({
  camera, devices, cvReady,
  onRemove, onStart, onStop,
  onUpdateLabel, onUpdatePrinter, onUpdateDevice, onUpdateSensitivity,
  onAngleUpdate,
}: {
  camera: Camera; devices: MediaDeviceInfo[]; cvReady: boolean;
  onRemove: () => void; onStart: (d: string) => void; onStop: () => void;
  onUpdateLabel: (v: string) => void; onUpdatePrinter: (v: string) => void;
  onUpdateDevice: (v: string) => void; onUpdateSensitivity: (v: number) => void;
  onAngleUpdate: (angle: number | null) => void;
}) {
  const videoRef  = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef    = useRef<number>(0);
  const frameRef  = useRef(0);
  const [editLabel, setEditLabel]       = useState(false);
  const [labelVal, setLabelVal]         = useState(camera.label);
  const [showSettings, setShowSettings] = useState(false);
  const { size, onMouseDown }           = useDragResize(480, 380);
  const st = angleStatus(camera.dominantAngle);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.srcObject = camera.stream ?? null;
  }, [camera.stream]);

  useEffect(() => {
    if (!camera.isActive || !cvReady) return;
    const loop = () => {
      const video = videoRef.current, canvas = canvasRef.current;
      if (!video || !canvas || !camera.isActive) return;
      frameRef.current++;
      if (frameRef.current % 4 === 0) {
        const line = processFrame(video, camera.sensitivity);
        const sx = canvas.clientWidth / (video.videoWidth || 1);
        const sy = canvas.clientHeight / (video.videoHeight || 1);
        drawOverlay(canvas, line, sx, sy);
        onAngleUpdate(line?.angle ?? null);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [camera.isActive, camera.sensitivity, cvReady, onAngleUpdate]);

  return (
    <div
      className="relative bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden flex flex-col flex-shrink-0"
      style={{ width: size.w, height: size.h }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${camera.isActive ? st.dot : 'bg-gray-200'}`} />

        {editLabel ? (
          <input autoFocus value={labelVal}
            onChange={e => setLabelVal(e.target.value)}
            onBlur={() => { onUpdateLabel(labelVal); setEditLabel(false); }}
            onKeyDown={e => { if (e.key === 'Enter') { onUpdateLabel(labelVal); setEditLabel(false); } if (e.key === 'Escape') setEditLabel(false); }}
            className="text-sm font-semibold border-b border-gray-300 outline-none w-28 text-black"
          />
        ) : (
          <button onClick={() => setEditLabel(true)} className="text-sm font-semibold text-black hover:text-gray-500 transition-colors truncate">
            {camera.label}
          </button>
        )}

        <input value={camera.printer} onChange={e => onUpdatePrinter(e.target.value)}
          className="text-xs outline-none bg-transparent w-20 text-black/40 truncate" placeholder="Printer" />

        <div className="flex-1" />

        {/* Device selector */}
        <div className="relative">
          <select value={camera.deviceId} onChange={e => onUpdateDevice(e.target.value)}
            disabled={camera.isActive}
            className="text-[11px] text-black border border-gray-200 rounded-lg pl-2.5 pr-6 py-1.5 appearance-none bg-white disabled:opacity-40 outline-none cursor-pointer max-w-[130px] truncate">
            {devices.length === 0 && <option value="">Default camera</option>}
            {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 6)}`}</option>)}
          </select>
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-[10px] pointer-events-none">▾</span>
        </div>

        <button onClick={() => setShowSettings(s => !s)}
          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${showSettings ? 'bg-black text-white' : 'border border-gray-200 text-black hover:bg-gray-50'}`}>
          Adjust
        </button>
        <button onClick={onRemove} className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-gray-200 text-black hover:bg-gray-50 transition-colors">
          Remove
        </button>
      </div>

      {/* Sensitivity */}
      {showSettings && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex-shrink-0">
          <span className="text-[11px] font-medium text-black flex-shrink-0">Detection sensitivity</span>
          <input type="range" min={10} max={100} step={5} value={camera.sensitivity}
            onChange={e => onUpdateSensitivity(Number(e.target.value))}
            className="flex-1 accent-black" />
          <span className="text-[11px] font-mono text-black w-6 text-right">{camera.sensitivity}</span>
        </div>
      )}

      {/* Video */}
      <div className="relative bg-black flex-1 min-h-0">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

        {!camera.isActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <span className="text-xs text-white/30">No feed</span>
          </div>
        )}

        {camera.isActive && (
          <>
            <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 bg-black/70 backdrop-blur-md rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-white text-[10px] font-bold tracking-widest">LIVE</span>
            </div>

            <div className="absolute top-3 right-3 px-3 py-1.5 bg-black/70 backdrop-blur-md rounded-xl">
              {camera.dominantAngle !== null ? (
                <div className="text-center">
                  <div className="text-sm font-bold font-mono" style={{ color: st.color }}>
                    {camera.dominantAngle > 0 ? '+' : ''}{camera.dominantAngle}°
                  </div>
                  <div className="text-[9px] text-white/50 mt-0.5">{st.label}</div>
                </div>
              ) : (
                <div className="text-[10px] text-white/40">Scanning…</div>
              )}
            </div>

            <div className="absolute bottom-3 right-3 flex flex-col gap-1 items-end">
              {[
                { stroke: 'rgba(255,255,255,0.6)', dash: '5 4', label: 'Ideal' },
                { stroke: st.color, dash: '', label: 'Actual' },
              ].map((l, i) => (
                <div key={i} className="flex items-center gap-1.5 px-2 py-0.5 bg-black/60 backdrop-blur-md rounded-md">
                  <svg width="16" height="5">
                    <line x1="0" y1="2.5" x2="16" y2="2.5" stroke={l.stroke} strokeWidth={i === 0 ? 1.5 : 2.5} strokeDasharray={l.dash} />
                  </svg>
                  <span className="text-[10px] text-white/50">{l.label}</span>
                </div>
              ))}
            </div>

            {!cvReady && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <span className="text-white text-sm">Loading vision engine…</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Per-camera stats */}
      {camera.isActive && <CameraStats camera={camera} />}

      {/* Footer */}
      <div className="px-4 py-3 flex items-center gap-3 border-t border-gray-100 bg-white flex-shrink-0">
        <button
          onClick={() => camera.isActive ? onStop() : onStart(camera.deviceId)}
          className={`flex-1 py-2 rounded-xl text-xs font-semibold tracking-wide transition-colors ${
            camera.isActive ? 'bg-gray-100 text-black hover:bg-gray-200' : 'bg-black text-white hover:bg-gray-900'
          }`}
        >
          {camera.isActive ? 'Stop Camera' : 'Start Camera'}
        </button>

        {camera.isActive && (
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="absolute left-[47%] top-0 bottom-0 w-px bg-gray-300" />
              <div className="absolute left-[53%] top-0 bottom-0 w-px bg-gray-300" />
              <div
                className="absolute top-0 bottom-0 w-2 -ml-1 rounded-full transition-all duration-300"
                style={{ background: st.color, left: `${50 + Math.min(Math.max(camera.dominantAngle ?? 0, -45), 45) / 45 * 50}%` }}
              />
            </div>
            <span className="text-[11px] font-mono text-black w-8 text-right">
              {camera.dominantAngle !== null ? `${Math.abs(camera.dominantAngle)}°` : '—'}
            </span>
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div onMouseDown={onMouseDown}
        className="absolute bottom-0 right-0 w-7 h-7 cursor-se-resize flex items-end justify-end p-1.5 z-10">
        <span className="text-gray-200 text-xs leading-none select-none">⤡</span>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const DEFAULT_JOB: PrintJob = {
  totalLayers: 0, currentLayer: 0, startTime: null,
  isRunning: false, extrusionStatus: 'stopped',
  printSpeed: 60, errorsDetected: 0, alerts: [],
};

export default function LiveFeed() {
  const [cameras, setCameras]       = useState<Camera[]>([]);
  const [devices, setDevices]       = useState<MediaDeviceInfo[]>([]);
  const [cvStatus, setCvStatus]     = useState<CVStatus>('idle');
  const [job, setJob]               = useState<PrintJob>(DEFAULT_JOB);
  const [showConfig, setShowConfig] = useState(false);
  const streamsRef  = useRef<{ [id: string]: MediaStream }>({});
  const jobTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setCvStatus('loading');
    loadOpenCV().then(() => setCvStatus('ready')).catch(() => setCvStatus('error'));
  }, []);

  useEffect(() => {
    async function enumerate() {
      try {
        await navigator.mediaDevices.getUserMedia({ video: true }).then(s => s.getTracks().forEach(t => t.stop()));
        setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'));
      } catch { /* no permission */ }
    }
    enumerate();
  }, []);

  const activeCamIds = cameras.filter(c => c.isActive).map(c => c.id).join(',');

  useEffect(() => {
    const anyActive = cameras.some(c => c.isActive);
    if (anyActive && !job.isRunning) {
      setJob(j => ({ ...j, isRunning: true, startTime: j.startTime ?? new Date(), extrusionStatus: 'active' }));
    }
    if (!anyActive && job.isRunning) {
      setJob(j => ({ ...j, isRunning: false, extrusionStatus: 'stopped' }));
      if (jobTimerRef.current) clearInterval(jobTimerRef.current);
    }
    if (anyActive) {
      jobTimerRef.current = setInterval(() => {
        setJob(j => j.totalLayers > 0 && j.currentLayer < j.totalLayers
          ? { ...j, currentLayer: j.currentLayer + 1 } : j);
      }, 8000);
      return () => { if (jobTimerRef.current) clearInterval(jobTimerRef.current); };
    }
  }, [activeCamIds]);

  const addCamera = () => {
    const id = `cam-${Date.now()}`;
    setCameras(prev => [...prev, {
      id, label: `Camera ${prev.length + 1}`, printer: `Printer ${prev.length + 1}`,
      deviceId: devices[0]?.deviceId ?? '',
      stream: null, isActive: false, dominantAngle: null,
      sensitivity: 55, localErrors: 0,
    }]);
  };

  const removeCamera = (id: string) => {
    streamsRef.current[id]?.getTracks().forEach(t => t.stop());
    delete streamsRef.current[id];
    setCameras(prev => prev.filter(c => c.id !== id));
  };

  const startCamera = async (id: string, deviceId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamsRef.current[id] = stream;
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'));
      setCameras(prev => prev.map(c => c.id === id
        ? { ...c, stream, isActive: true, dominantAngle: null, localErrors: 0 } : c));
    } catch { alert('Could not access camera. Check permissions.'); }
  };

  const stopCamera = (id: string) => {
    streamsRef.current[id]?.getTracks().forEach(t => t.stop());
    delete streamsRef.current[id];
    setCameras(prev => prev.map(c => c.id === id
      ? { ...c, stream: null, isActive: false, dominantAngle: null } : c));
  };

  const handleAngleUpdate = useCallback((id: string, angle: number | null) => {
    setCameras(prev => prev.map(c => c.id === id
      ? { ...c, dominantAngle: angle !== null ? Math.round(angle) : null } : c));

    if (angle !== null && Math.abs(angle) > 9) {
      setCameras(prev => {
        const cam = prev.find(c => c.id === id);
        if (!cam) return prev;
        const type: AlertEntry['type'] = Math.abs(angle) > 15 ? 'warning' : 'caution';
        const alert: AlertEntry = {
          id: `${id}-${Date.now()}`, time: new Date(),
          cameraLabel: cam.label, type,
          angle: Math.round(angle), layer: 0,
        };
        setJob(j => ({ ...j, errorsDetected: j.errorsDetected + 1, alerts: [alert, ...j.alerts].slice(0, 50) }));
        return prev.map(c => c.id === id ? { ...c, localErrors: c.localErrors + 1 } : c);
      });
    }
  }, []);

  useEffect(() => {
    return () => Object.values(streamsRef.current).forEach(s => s.getTracks().forEach(t => t.stop()));
  }, []);

  return (
    <div className="space-y-4">
      <GlobalStatsBar job={job} cameras={cameras} onEdit={() => setShowConfig(true)} />

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <button onClick={addCamera}
          className="px-4 py-2 bg-black text-white text-xs font-semibold tracking-wide rounded-xl hover:bg-gray-900 transition-colors">
          Add Camera
        </button>
      </div>

      {/* Camera grid */}
      {cameras.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white border border-gray-100 rounded-2xl shadow-sm">
          <p className="text-sm font-medium text-black">No cameras added</p>
          <p className="text-xs text-black/40 mt-1">Click "Add Camera" to begin monitoring</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-4 items-start">
          {cameras.map(camera => (
            <CameraCard
              key={camera.id} camera={camera} devices={devices} cvReady={cvStatus === 'ready'}
              onRemove={() => removeCamera(camera.id)}
              onStart={d => startCamera(camera.id, d)}
              onStop={() => stopCamera(camera.id)}
              onUpdateLabel={v => setCameras(p => p.map(c => c.id === camera.id ? { ...c, label: v } : c))}
              onUpdatePrinter={v => setCameras(p => p.map(c => c.id === camera.id ? { ...c, printer: v } : c))}
              onUpdateDevice={v => setCameras(p => p.map(c => c.id === camera.id ? { ...c, deviceId: v } : c))}
              onUpdateSensitivity={v => setCameras(p => p.map(c => c.id === camera.id ? { ...c, sensitivity: v } : c))}
              onAngleUpdate={angle => handleAngleUpdate(camera.id, angle)}
            />
          ))}
        </div>
      )}

      <AlertLog alerts={job.alerts} />

      {showConfig && (
        <JobConfigModal job={job}
          onSave={(layers, speed) => setJob(j => ({ ...j, totalLayers: layers, printSpeed: speed }))}
          onClose={() => setShowConfig(false)} />
      )}
    </div>
  );
}