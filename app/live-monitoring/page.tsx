'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useProjects, ProjectReport, ReportAlert } from '@/lib/project-store';
import AppNav from '@/components/AppNav';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'control' | 'sensors' | 'camera' | 'defects';

interface SensorReading {
  label: string;
  value: string;
  unit: string;
  status: 'ok' | 'warn' | 'error';
  trend?: 'up' | 'down' | 'stable';
  history: number[];
}

interface PrinterControl {
  printSpeed: number;       // mm/s
  extrusionRate: number;    // %
  layerHeight: number;      // mm
  nozzleTemp: number;       // °C
  pumpPressure: number;     // bar
  paused: boolean;
}

// ── Mini sparkline ─────────────────────────────────────────────────────────────

function Sparkline({ data, color = '#22c55e', width = 80, height = 28 }: {
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
    <svg width={width} height={height} className="opacity-70">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Sensor card ───────────────────────────────────────────────────────────────

function SensorCard({ sensor }: { sensor: SensorReading }) {
  const statusColor = {
    ok:    'text-emerald-600 bg-emerald-50 border-emerald-200',
    warn:  'text-amber-600 bg-amber-50 border-amber-200',
    error: 'text-red-600 bg-red-50 border-red-200',
  }[sensor.status];

  const dotColor = {
    ok:    'bg-emerald-500',
    warn:  'bg-amber-500',
    error: 'bg-red-500',
  }[sensor.status];

  const sparkColor = {
    ok:    '#22c55e',
    warn:  '#f59e0b',
    error: '#ef4444',
  }[sensor.status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white border rounded-2xl p-4 ${statusColor}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest opacity-60 mb-0.5">{sensor.label}</p>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold">{sensor.value}</span>
            <span className="text-xs opacity-60">{sensor.unit}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className={`w-2 h-2 rounded-full ${dotColor} animate-pulse`}/>
          {sensor.trend && (
            <span className="text-[10px] opacity-50">
              {sensor.trend === 'up' ? '↑' : sensor.trend === 'down' ? '↓' : '→'}
            </span>
          )}
        </div>
      </div>
      <Sparkline data={sensor.history} color={sparkColor}/>
    </motion.div>
  );
}

// ── Slider control ─────────────────────────────────────────────────────────────

function ControlSlider({
  label, value, min, max, step, unit, onChange, warning
}: {
  label: string; value: number; min: number; max: number;
  step: number; unit: string; onChange: (v: number) => void; warning?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-xs font-semibold text-black/60">{label}</span>
        <span className={`text-sm font-bold font-mono ${warning ? 'text-red-500' : 'text-black'}`}>
          {value}{unit}
        </span>
      </div>
      <div className="relative">
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, ${warning ? '#ef4444' : '#000'} ${pct}%, #e5e7eb ${pct}%)`
          }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-black/25">
        <span>{min}{unit}</span><span>{max}{unit}</span>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function LiveMonitoring() {
  const router = useRouter();
  const { activeProject, updateProject } = useProjects();
  const startTimeRef  = useRef<Date>(new Date());
  const sessionRef    = useRef({ layersPrinted: 0, errorsDetected: 0, alerts: [] as ReportAlert[] });
  const tickRef       = useRef<NodeJS.Timeout | null>(null);

  const [activeTab,    setActiveTab]   = useState<Tab>('control');
  const [showConfirm,  setShowConfirm] = useState(false);
  const [elapsed,      setElapsed]     = useState(0); // seconds
  const [alertLog,     setAlertLog]    = useState<{time:string;msg:string;level:'info'|'warn'|'error'}[]>([]);

  // ── Printer controls ───────────────────────────────────────────────────────
  const [controls, setControls] = useState<PrinterControl>({
    printSpeed:    60,
    extrusionRate: 100,
    layerHeight:   15,
    nozzleTemp:    22,
    pumpPressure:  4.2,
    paused:        false,
  });

  const updateControl = (key: keyof PrinterControl, val: number | boolean) => {
    setControls(prev => ({ ...prev, [key]: val }));
    if (key !== 'paused') {
      const label = key.replace(/([A-Z])/g, ' $1').toLowerCase();
      addAlert(`${label} updated to ${val}${typeof val === 'number' ? '' : ''}`, 'info');
    }
  };

  // ── Sensor simulation ──────────────────────────────────────────────────────
  const [sensors, setSensors] = useState<SensorReading[]>([
    // Environmental
    { label: 'Ambient Temp',    value: '24.2', unit: '°C',  status: 'ok',   trend: 'stable', history: [24,24.1,24.2,24.1,24.2,24.3,24.2] },
    { label: 'Humidity',        value: '58',   unit: '%',   status: 'ok',   trend: 'stable', history: [57,58,58,59,58,57,58] },
    { label: 'Wind Speed',      value: '6.2',  unit: 'km/h',status: 'ok',   trend: 'up',     history: [4,5,5.5,6,6.1,6.2,6.2] },
    { label: 'UV Index',        value: '3',    unit: '',    status: 'ok',   trend: 'stable', history: [2,3,3,3,3,3,3] },
    // Nozzle / material
    { label: 'Nozzle Temp',     value: '22.1', unit: '°C',  status: 'ok',   trend: 'stable', history: [22,22.1,22,22.1,22.2,22.1,22.1] },
    { label: 'Flow Rate',       value: '8.1',  unit: 'L/min',status:'ok',   trend: 'stable', history: [8,8.1,8.1,8,8.1,8.2,8.1] },
    { label: 'Pump Pressure',   value: '4.2',  unit: 'bar', status: 'ok',   trend: 'stable', history: [4.1,4.2,4.2,4.3,4.2,4.2,4.2] },
    { label: 'Extrusion Rate',  value: '100',  unit: '%',   status: 'ok',   trend: 'stable', history: [100,100,100,99,100,100,100] },
    // Mix / material
    { label: 'Mix Consistency', value: '94',   unit: '%',   status: 'ok',   trend: 'stable', history: [93,94,95,94,94,93,94] },
    { label: 'Pot Life Left',   value: '47',   unit: 'min', status: 'warn', trend: 'down',   history: [60,58,55,53,51,49,47] },
    { label: 'W/C Ratio',       value: '0.45', unit: '',    status: 'ok',   trend: 'stable', history: [0.45,0.45,0.45,0.46,0.45,0.45,0.45] },
    { label: 'Batch Temp',      value: '21.8', unit: '°C',  status: 'ok',   trend: 'stable', history: [21.5,21.6,21.7,21.8,21.8,21.8,21.8] },
  ]);

  // ── Elapsed timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    tickRef.current = setInterval(() => {
      setElapsed(s => s + 1);
      // Simulate sensor drift
      setSensors(prev => prev.map(s => {
        const last = parseFloat(s.value);
        const drift = (Math.random() - 0.5) * 0.2;
        const next  = Math.round((last + drift) * 100) / 100;
        const newHistory = [...s.history.slice(-8), next];
        // Recalculate status
        let status: 'ok'|'warn'|'error' = s.status;
        if (s.label === 'Pot Life Left') {
          status = next < 20 ? 'error' : next < 35 ? 'warn' : 'ok';
        }
        return { ...s, value: String(next), history: newHistory, status };
      }));
    }, 3000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  const addAlert = (msg: string, level: 'info'|'warn'|'error' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setAlertLog(prev => [{ time, msg, level }, ...prev.slice(0, 19)]);
    if (level !== 'info') {
      sessionRef.current.alerts.push({ time, layer: sessionRef.current.layersPrinted, message: msg });
    }
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

  const TABS: { key: Tab; label: string }[] = [
    { key: 'control', label: 'Printer Control' },
    { key: 'sensors', label: 'Sensors' },
    { key: 'camera',  label: 'Camera Feed' },
    { key: 'defects', label: 'Defect Detection' },
  ];

  const envSensors    = sensors.slice(0, 4);
  const nozzleSensors = sensors.slice(4, 8);
  const mixSensors    = sensors.slice(8, 12);

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <AppNav currentStep="monitor"/>
      <style>{`footer { display: none !important; }`}</style>

      {/* ── Header strip ── */}
      <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <motion.div className="w-2.5 h-2.5 rounded-full bg-emerald-500"
              animate={{ opacity: controls.paused ? 1 : [1,0.3,1] }}
              transition={{ duration: 1.2, repeat: Infinity }}/>
            <span className="text-sm font-semibold text-black">
              {controls.paused ? 'Paused' : 'Printing'}
            </span>
          </div>
          <div className="h-4 w-px bg-gray-200"/>
          <span className="text-xs font-mono text-black/40">{fmtElapsed()}</span>
          {activeProject && (
            <>
              <div className="h-4 w-px bg-gray-200"/>
              <span className="text-xs text-black/40">{activeProject.printer.name || 'No printer'}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => updateControl('paused', !controls.paused)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-xl border transition-all ${
              controls.paused
                ? 'bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-400'
                : 'bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100'
            }`}>
            {controls.paused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={() => setShowConfirm(true)}
            className="px-4 py-1.5 text-xs font-semibold bg-black text-white rounded-xl hover:bg-black/80 transition-all">
            End Print
          </button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="max-w-7xl mx-auto px-6 pt-6">
        <div className="flex gap-1 bg-white border border-gray-100 rounded-2xl p-1 w-fit mb-6 shadow-sm">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all ${
                activeTab === tab.key
                  ? 'bg-black text-white'
                  : 'text-black/40 hover:text-black hover:bg-gray-50'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">

          {/* ── PRINTER CONTROL TAB ── */}
          {activeTab === 'control' && (
            <motion.div key="control" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="grid grid-cols-3 gap-6">

              {/* Main controls */}
              <div className="col-span-2 space-y-4">
                <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-black/40 mb-5">Print Speed & Extrusion</h3>
                  <div className="space-y-6">
                    <ControlSlider label="Print Speed" value={controls.printSpeed} min={10} max={150} step={5} unit=" mm/s"
                      warning={controls.printSpeed > 120}
                      onChange={v => updateControl('printSpeed', v)}/>
                    <ControlSlider label="Extrusion Rate" value={controls.extrusionRate} min={50} max={150} step={5} unit="%"
                      warning={controls.extrusionRate > 130 || controls.extrusionRate < 70}
                      onChange={v => updateControl('extrusionRate', v)}/>
                    <ControlSlider label="Pump Pressure" value={controls.pumpPressure} min={1} max={10} step={0.1} unit=" bar"
                      warning={controls.pumpPressure > 8}
                      onChange={v => updateControl('pumpPressure', v)}/>
                  </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-black/40 mb-5">Layer & Nozzle</h3>
                  <div className="space-y-6">
                    <ControlSlider label="Layer Height" value={controls.layerHeight} min={6} max={20} step={1} unit=" mm"
                      onChange={v => updateControl('layerHeight', v)}/>
                    <ControlSlider label="Nozzle Temperature" value={controls.nozzleTemp} min={10} max={45} step={0.5} unit="°C"
                      warning={controls.nozzleTemp > 35}
                      onChange={v => updateControl('nozzleTemp', v)}/>
                  </div>
                </div>

                {/* Quick actions */}
                <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-black/40 mb-4">Quick Actions</h3>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: 'Home Nozzle',   action: () => addAlert('Homing nozzle…') },
                      { label: 'Purge',          action: () => addAlert('Purge sequence started') },
                      { label: 'Prime',          action: () => addAlert('Priming pump…') },
                      { label: 'Emergency Stop', action: () => { updateControl('paused', true); addAlert('EMERGENCY STOP', 'error'); }, danger: true },
                    ].map((btn, i) => (
                      <button key={i} onClick={btn.action}
                        className={`py-2.5 text-xs font-semibold rounded-xl border transition-all ${
                          (btn as any).danger
                            ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                            : 'bg-gray-50 text-black border-gray-200 hover:bg-gray-100'
                        }`}>
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Alert log */}
              <div className="space-y-4">
                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm h-full">
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-black/40 mb-4">System Log</h3>
                  <div className="space-y-2 max-h-[520px] overflow-y-auto">
                    <AnimatePresence>
                      {alertLog.length === 0 && (
                        <p className="text-xs text-black/25 text-center py-8">No events yet</p>
                      )}
                      {alertLog.map((a, i) => (
                        <motion.div key={i} initial={{opacity:0,x:8}} animate={{opacity:1,x:0}}
                          className={`flex gap-2 p-2 rounded-xl text-[11px] ${
                            a.level === 'error' ? 'bg-red-50 text-red-700' :
                            a.level === 'warn'  ? 'bg-amber-50 text-amber-700' :
                            'bg-gray-50 text-black/50'
                          }`}>
                          <span className="font-mono opacity-60 flex-shrink-0">{a.time}</span>
                          <span className="font-medium">{a.msg}</span>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── SENSORS TAB ── */}
          {activeTab === 'sensors' && (
            <motion.div key="sensors" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="space-y-6">
              <div>
                <h3 className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-3">Environmental Sensors</h3>
                <div className="grid grid-cols-4 gap-4">
                  {envSensors.map((s, i) => <SensorCard key={i} sensor={s}/>)}
                </div>
              </div>
              <div>
                <h3 className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-3">Nozzle & Printer Sensors</h3>
                <div className="grid grid-cols-4 gap-4">
                  {nozzleSensors.map((s, i) => <SensorCard key={i} sensor={s}/>)}
                </div>
              </div>
              <div>
                <h3 className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-3">Mix & Material Sensors</h3>
                <div className="grid grid-cols-4 gap-4">
                  {mixSensors.map((s, i) => <SensorCard key={i} sensor={s}/>)}
                </div>
              </div>

              {/* Connect external sensor */}
              <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-black/40 mb-4">Connect External Sensor</h3>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: 'Weather Station', desc: 'Davis Vantage Pro 2 · Modbus TCP', connected: true },
                    { label: 'Nozzle IR Sensor', desc: 'FLIR Lepton 3.5 · USB', connected: true },
                    { label: 'Mix Viscometer', desc: 'Anton Paar · RS-232', connected: false },
                    { label: 'Concrete Thermometer', desc: 'PT100 probe · 4-20mA', connected: false },
                    { label: 'Laser Profilometer', desc: 'Keyence LJ-X · Ethernet', connected: false },
                    { label: 'Custom Sensor', desc: 'MQTT · WebSocket · Modbus', connected: false },
                  ].map((s, i) => (
                    <div key={i} className={`rounded-xl border p-4 flex items-start justify-between ${
                      s.connected ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-white'
                    }`}>
                      <div>
                        <p className={`text-xs font-semibold mb-0.5 ${s.connected ? 'text-emerald-700' : 'text-black'}`}>{s.label}</p>
                        <p className="text-[10px] text-black/40">{s.desc}</p>
                      </div>
                      <button className={`text-[10px] font-semibold px-2 py-1 rounded-lg border flex-shrink-0 ml-2 transition-all ${
                        s.connected
                          ? 'border-emerald-300 text-emerald-600 bg-white hover:bg-emerald-100'
                          : 'border-gray-200 text-black/40 bg-white hover:border-black hover:text-black'
                      }`}>
                        {s.connected ? 'Connected' : 'Connect'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* ── CAMERA TAB ── */}
          {activeTab === 'camera' && (
            <motion.div key="camera" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="grid grid-cols-2 gap-6">
              {[
                { label: 'Camera 1 — Front',    id: 'cam1' },
                { label: 'Camera 2 — Side',     id: 'cam2' },
                { label: 'Camera 3 — Overhead', id: 'cam3' },
                { label: 'Camera 4 — Nozzle',   id: 'cam4' },
              ].map((cam, i) => (
                <div key={cam.id} className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"/>
                      <span className="text-xs font-semibold text-black">{cam.label}</span>
                    </div>
                    <span className="text-[10px] font-mono text-black/30">LIVE</span>
                  </div>
                  {/* Camera placeholder */}
                  <div className="relative bg-black aspect-video flex items-center justify-center">
                    <div className="absolute inset-0 opacity-10"
                      style={{backgroundImage:'linear-gradient(rgba(255,255,255,0.1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.1) 1px,transparent 1px)',backgroundSize:'32px 32px'}}/>
                    <div className="text-center">
                      <div className="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center mx-auto mb-2">
                        <svg className="w-5 h-5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                        </svg>
                      </div>
                      <p className="text-white/30 text-xs">Connect camera stream</p>
                      <button className="mt-2 text-[10px] text-white/40 border border-white/15 rounded-lg px-3 py-1 hover:border-white/40 transition-all">
                        Configure RTSP URL
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          )}

          {/* ── DEFECT DETECTION TAB ── */}
          {activeTab === 'defects' && (
            <motion.div key="defects" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}}>
              <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm text-center py-16">
                <div className="w-16 h-16 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-black/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-black mb-1">YOLOv8 Defect Detection</h3>
                <p className="text-xs text-black/40 mb-4 max-w-xs mx-auto">Upload an image from your camera feed to run real-time defect analysis on the printed layers.</p>
                <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-black text-white text-xs font-semibold rounded-xl hover:bg-black/80 transition-all">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                  </svg>
                  Upload Image for Analysis
                  <input type="file" accept="image/*" className="hidden"
                    onChange={() => addAlert('Defect analysis started…')}/>
                </label>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* ── End print confirm ── */}
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
                  className="flex-1 py-2.5 text-sm font-semibold border border-gray-200 rounded-xl hover:bg-gray-50 transition-all">
                  Cancel
                </button>
                <button onClick={endPrint}
                  className="flex-1 py-2.5 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/80 transition-all">
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