'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useProjects } from '@/lib/project-store';
import AppNav from '@/components/AppNav';

// ── Types ─────────────────────────────────────────────────────────────────────

type SetupMode = 'choose' | 'connect' | 'manual';

interface ManualConfig {
  // 1. Nozzle & Extrusion
  nozzleDiameter:    number;
  nozzleShape:       'round' | 'square' | 'rectangular';
  layerHeightRatio:  number;
  beadWidth:         number;
  // 2. Pump & Delivery
  pumpType:          'peristaltic' | 'rotor-stator' | 'piston';
  hoseLength:        number;
  hoseInternalDiam:  number;
  maxMassFlowRate:   number;
  // 3. Machine Kinematics
  maxFeedrate:       number;
  acceleration:      number;
  jerkDeviation:     number;
  // 4. Material Baseline
  initialSetTime:    number;
  slumpValue:        number;
  aggregateSize:     number;
  // Meta
  printerName:       string;
}

const DEFAULT_CONFIG: ManualConfig = {
  nozzleDiameter:   25,
  nozzleShape:      'round',
  layerHeightRatio: 0.6,
  beadWidth:        30,
  pumpType:         'rotor-stator',
  hoseLength:       15,
  hoseInternalDiam: 50,
  maxMassFlowRate:  8,
  maxFeedrate:      100,
  acceleration:     500,
  jerkDeviation:    8,
  initialSetTime:   45,
  slumpValue:       5,
  aggregateSize:    4,
  printerName:      'Custom Printer',
};

// ── Printers for Option A ─────────────────────────────────────────────────────

const PRINTERS = [
  { name:'COBOD BOD2',   type:'Gantry',      nozzle:'25 mm', maxSpeed:'100 mm/s', origin:'Denmark', desc:'Industry-leading gantry, deployed in 50+ countries' },
  { name:'COBOD BOD3',   type:'Gantry',      nozzle:'30 mm', maxSpeed:'150 mm/s', origin:'Denmark', desc:'Next-gen multi-material with steel reinforcement support' },
  { name:'Tektaio T1',   type:'Gantry',      nozzle:'30 mm', maxSpeed:'120 mm/s', origin:'UK',      desc:'High-throughput gantry for large footprint structures' },
  { name:'Apis Cor',     type:'Crane',       nozzle:'22 mm', maxSpeed:'75 mm/s',  origin:'USA',     desc:'Portable crane-type with rapid on-site deployment' },
  { name:'ICON Vulcan',  type:'Gantry',      nozzle:'28 mm', maxSpeed:'90 mm/s',  origin:'USA',     desc:'Lavacrete system, US military and NASA programs' },
];

// ── UI helpers ────────────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h3 className="text-xs font-bold text-black uppercase tracking-widest">{title}</h3>
      {subtitle && <p className="text-[11px] text-black/40 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function Field({
  label, unit, hint, value, onChange, type = 'number', min, max, step, children,
}: {
  label: string; unit?: string; hint?: string;
  value?: number | string;
  onChange?: (v: any) => void;
  type?: 'number' | 'text';
  min?: number; max?: number; step?: number;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <label className="text-xs font-medium text-black">{label}</label>
        {unit && <span className="text-[10px] text-black/30">({unit})</span>}
        {hint && (
          <div className="relative group ml-auto">
            <div className="w-4 h-4 rounded-full border border-black/20 flex items-center justify-center cursor-help">
              <span className="text-[9px] text-black/40 font-bold">i</span>
            </div>
            <div className="absolute right-0 top-5 z-20 w-56 p-2.5 bg-black text-white text-[10px] leading-relaxed rounded-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-xl">
              {hint}
            </div>
          </div>
        )}
      </div>
      {children ?? (
        <input
          type={type} value={value} min={min} max={max} step={step}
          onChange={e => onChange?.(type === 'number' ? Number(e.target.value) : e.target.value)}
          className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-black transition-colors text-black"
        />
      )}
    </div>
  );
}

function Select({
  label, value, onChange, options, hint,
}: {
  label: string; value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <label className="text-xs font-medium text-black">{label}</label>
        {hint && (
          <div className="relative group ml-auto">
            <div className="w-4 h-4 rounded-full border border-black/20 flex items-center justify-center cursor-help">
              <span className="text-[9px] text-black/40 font-bold">i</span>
            </div>
            <div className="absolute right-0 top-5 z-20 w-56 p-2.5 bg-black text-white text-[10px] leading-relaxed rounded-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-xl">
              {hint}
            </div>
          </div>
        )}
      </div>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-black transition-colors text-black bg-white appearance-none cursor-pointer">
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function SliderField({
  label, value, onChange, min, max, step, unit, hint, formatValue,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; unit?: string; hint?: string;
  formatValue?: (v: number) => string;
}) {
  const display = formatValue ? formatValue(value) : `${value}${unit ?? ''}`;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <label className="text-xs font-medium text-black">{label}</label>
        {hint && (
          <div className="relative group">
            <div className="w-4 h-4 rounded-full border border-black/20 flex items-center justify-center cursor-help">
              <span className="text-[9px] text-black/40 font-bold">i</span>
            </div>
            <div className="absolute left-0 top-5 z-20 w-56 p-2.5 bg-black text-white text-[10px] leading-relaxed rounded-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-xl">
              {hint}
            </div>
          </div>
        )}
        <span className="ml-auto text-xs font-mono font-bold text-black">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-black h-1"/>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-black/25">{min}{unit}</span>
        <span className="text-[10px] text-black/25">{max}{unit}</span>
      </div>
    </div>
  );
}

// ── Option A: Connect flow ────────────────────────────────────────────────────

const LOG_STEPS = [
  'Initialising serial interface…',
  'Sending CONNECT command…',
  'Handshake acknowledged…',
  'Querying printer firmware…',
  'Loading printer profile…',
  'Calibrating extrusion baseline…',
  'Running nozzle test sequence…',
  'Connection established.',
];

function ConnectFlow({
  onConnected, onBack,
}: { onConnected: (printer: typeof PRINTERS[0]) => void; onBack: () => void }) {
  const [selected,    setSelected]    = useState<typeof PRINTERS[0] | null>(null);
  const [connecting,  setConnecting]  = useState(false);
  const [logLines,    setLogLines]    = useState<string[]>([]);
  const [connected,   setConnected]   = useState(false);

  const handleConnect = () => {
    if (!selected) return;
    setConnecting(true);
    setLogLines([]);
    let i = 0;
    const interval = setInterval(() => {
      setLogLines(prev => [...prev, `> ${LOG_STEPS[i]}`]);
      i++;
      if (i >= LOG_STEPS.length) {
        clearInterval(interval);
        setConnected(true);
      }
    }, 420);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: printer selection */}
      <div>
        <h2 className="text-sm font-semibold text-black mb-4">Select Printer</h2>
        <div className="space-y-3">
          {PRINTERS.map(p => (
            <button key={p.name} onClick={() => { setSelected(p); setConnected(false); setLogLines([]); setConnecting(false); }}
              className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${
                selected?.name === p.name
                  ? 'bg-black border-black'
                  : 'bg-white border-gray-100 hover:border-black'
              }`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className={`text-sm font-semibold ${selected?.name===p.name?'text-white':'text-black'}`}>{p.name}</p>
                  <p className={`text-[11px] mt-0.5 ${selected?.name===p.name?'text-white/50':'text-black/40'}`}>
                    {p.type} · {p.origin}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-[10px] font-mono ${selected?.name===p.name?'text-white/50':'text-black/30'}`}>{p.nozzle}</p>
                  <p className={`text-[10px] font-mono ${selected?.name===p.name?'text-white/50':'text-black/30'}`}>{p.maxSpeed}</p>
                </div>
              </div>
              <p className={`text-[11px] mt-2 ${selected?.name===p.name?'text-white/40':'text-black/30'}`}>{p.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Right: connection log */}
      <div>
        <h2 className="text-sm font-semibold text-black mb-4">Connection Log</h2>
        <div className="bg-black rounded-2xl p-5 font-mono text-[11px] min-h-[280px] relative">
          {logLines.length === 0 && !connecting && (
            <p className="text-white/20">Select a printer and click Connect…</p>
          )}
          {logLines.map((line, i) => (
            <motion.p key={i}
              initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
              className={`leading-relaxed ${
                line.includes('established') ? 'text-emerald-400 font-bold' : 'text-white/60'
              }`}>
              {line}
            </motion.p>
          ))}
          {connecting && !connected && (
            <span className="inline-block w-2 h-3.5 bg-white/60 animate-pulse ml-0.5 align-middle" />
          )}
        </div>

        <div className="mt-4 flex gap-3">
          <button onClick={onBack}
            className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl text-black hover:bg-gray-50 transition-colors">
            ← Back
          </button>
          {!connected ? (
            <button onClick={handleConnect}
              disabled={!selected || connecting}
              className="flex-1 py-2.5 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              {connecting ? 'Connecting…' : 'Connect'}
            </button>
          ) : (
            <motion.button
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              onClick={() => onConnected(selected!)}
              className="flex-1 py-2.5 text-sm font-semibold bg-emerald-500 text-white rounded-xl hover:bg-emerald-400 transition-colors flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
              </svg>
              Continue to Pre-Print
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Option B: Manual config form ──────────────────────────────────────────────

function ManualConfigForm({
  onSave, onBack,
}: { onSave: (cfg: ManualConfig) => void; onBack: () => void }) {
  const [cfg, setCfg] = useState<ManualConfig>(DEFAULT_CONFIG);
  const set = (key: keyof ManualConfig) => (val: any) => setCfg(c => ({ ...c, [key]: val }));

  // Derived values shown to user
  const layerHeightMm    = (cfg.nozzleDiameter * cfg.layerHeightRatio).toFixed(1);
  const hydraulicVolume  = (Math.PI * (cfg.hoseInternalDiam/2/1000)**2 * cfg.hoseLength * 1000).toFixed(2);

  return (
    <div className="max-w-4xl">
      {/* Printer name */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
        <Field label="Printer Name" type="text" value={cfg.printerName} onChange={set('printerName')}/>
      </div>

      {/* ── Section 1: Nozzle & Extrusion ── */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
        <SectionHeader
          title="1. Nozzle & Extrusion Geometry"
          subtitle="Defines the shape and resolution of the concrete bead"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field
            label="Nozzle Diameter" unit="mm"
            value={cfg.nozzleDiameter} onChange={set('nozzleDiameter')}
            min={10} max={50} step={0.5}
          />
          <Select
            label="Nozzle Shape"
            value={cfg.nozzleShape} onChange={set('nozzleShape')}
            options={[
              { value:'round',       label:'Round — standard, self-centring' },
              { value:'square',      label:'Square — flat-top layers' },
              { value:'rectangular', label:'Rectangular — high aspect ratio beads' },
            ]}
          />
          <div>
            <SliderField
              label="Layer Height Ratio" value={cfg.layerHeightRatio}
              onChange={set('layerHeightRatio')} min={0.4} max={0.8} step={0.01}
              formatValue={v => `${v.toFixed(2)} → ${layerHeightMm} mm layer`}
              hint="Fraction of nozzle diameter used as layer height. 0.6 = 60% of nozzle diameter. Lower = stronger bonds, slower print."
            />
          </div>
          <Field
            label="Bead Width (Spread)" unit="mm"
            value={cfg.beadWidth} onChange={set('beadWidth')}
            min={cfg.nozzleDiameter} max={cfg.nozzleDiameter * 2} step={0.5}
          >
            <input
              type="number" value={cfg.beadWidth} min={cfg.nozzleDiameter} max={cfg.nozzleDiameter*2} step={0.5}
              onChange={e => set('beadWidth')(Number(e.target.value))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-black transition-colors text-black"
            />
            <p className="text-[10px] text-black/30 mt-1">
              Measured from your test prints. Typically {cfg.nozzleDiameter}–{(cfg.nozzleDiameter*1.5).toFixed(0)} mm for this nozzle.
            </p>
          </Field>
        </div>
      </div>

      {/* ── Section 2: Pump & Delivery ── */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
        <SectionHeader
          title="2. Pump & Delivery Dynamics"
          subtitle="Controls hydraulic lag, pressure drop and material delivery timing"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Select
            label="Pump Type"
            value={cfg.pumpType} onChange={set('pumpType')}
            options={[
              { value:'peristaltic',  label:'Peristaltic — gentle, reversible' },
              { value:'rotor-stator', label:'Rotor-Stator — high pressure, common' },
              { value:'piston',       label:'Piston — precise, high viscosity' },
            ]}
          />
          <Field
            label="Hose Length" unit="m"
            value={cfg.hoseLength} onChange={set('hoseLength')}
            min={1} max={100} step={0.5}
            hint="Used by RL Agent to calculate Hydraulic Lag and Thermal Drift compensation. Longer hose = more material in flight = longer lag time before extrusion responds to pump changes."
          />
          <div>
            <Field
              label="Hose Internal Diameter" unit="mm"
              value={cfg.hoseInternalDiam} onChange={set('hoseInternalDiam')}
              min={20} max={100} step={1}
              hint="Used by RL Agent to calculate Hydraulic Lag and Thermal Drift compensation. Combined with hose length this gives the total volume of concrete in transit."
            />
            <p className="text-[10px] text-black/40 mt-1.5 font-mono">
              Volume in hose: {hydraulicVolume} L
            </p>
          </div>
          <Field
            label="Max Mass Flow Rate" unit="L/min"
            value={cfg.maxMassFlowRate} onChange={set('maxMassFlowRate')}
            min={1} max={40} step={0.5}
          />
        </div>
      </div>

      {/* ── Section 3: Machine Kinematics ── */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
        <SectionHeader
          title="3. Machine Kinematics"
          subtitle="Speed limits so the RL agent never commands motion beyond physical capability"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field
            label="Maximum Feedrate (Fₘₐₓ)" unit="mm/s"
            value={cfg.maxFeedrate} onChange={set('maxFeedrate')}
            min={10} max={300} step={5}
          />
          <Field
            label="Acceleration (A)" unit="mm/s²"
            value={cfg.acceleration} onChange={set('acceleration')}
            min={50} max={3000} step={50}
          />
          <div className="sm:col-span-2">
            <SliderField
              label="Jerk / Junction Deviation" value={cfg.jerkDeviation}
              onChange={set('jerkDeviation')} min={1} max={20} step={0.5} unit=" mm/s"
              formatValue={v => v <= 5 ? `${v} mm/s — Smooth corners, slower` : v <= 12 ? `${v} mm/s — Balanced` : `${v} mm/s — Fast corners, more vibration`}
            />
          </div>
        </div>
      </div>

      {/* ── Section 4: Material Baseline ── */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
        <SectionHeader
          title="4. Material-Specific Baseline"
          subtitle="Custom mix properties — even standard mixes vary by site conditions"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field
            label="Initial Set Time" unit="min at 20°C"
            value={cfg.initialSetTime} onChange={set('initialSetTime')}
            min={5} max={120} step={1}
            hint="Used by RL Agent to calculate Hydraulic Lag and Thermal Drift compensation. Time window the RL has to complete each layer before material loses workability."
          />
          <div>
            <SliderField
              label="Slump Value (Workability)" value={cfg.slumpValue}
              onChange={set('slumpValue')} min={1} max={10} step={0.5}
              formatValue={v => v <= 3 ? `${v}/10 — Stiff, structural` : v <= 6 ? `${v}/10 — Balanced` : `${v}/10 — Wet, may sag`}
            />
          </div>
          <Field
            label="Aggregate Size" unit="mm"
            value={cfg.aggregateSize} onChange={set('aggregateSize')}
            min={0} max={20} step={0.5}
          >
            <input
              type="number" value={cfg.aggregateSize} min={0} max={20} step={0.5}
              onChange={e => set('aggregateSize')(Number(e.target.value))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-black transition-colors text-black"
            />
            {cfg.aggregateSize > cfg.nozzleDiameter * 0.35 && (
              <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-1">
                <span>⚠</span>
                Aggregate may clog this nozzle — recommended max {(cfg.nozzleDiameter * 0.35).toFixed(1)} mm
              </p>
            )}
          </Field>
        </div>
      </div>

      {/* Derived summary */}
      <div className="bg-black rounded-2xl p-5 mb-6">
        <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-4">
          Configuration Summary — What the RL sees
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/10 rounded-xl overflow-hidden">
          {[
            { label:'Layer Height', value:`${layerHeightMm} mm` },
            { label:'Bead Area',   value:`${(cfg.beadWidth * parseFloat(layerHeightMm)).toFixed(0)} mm²` },
            { label:'Hose Volume', value:`${hydraulicVolume} L` },
            { label:'Top Speed',   value:`${cfg.maxFeedrate} mm/s` },
            { label:'Pump Type',   value:cfg.pumpType },
            { label:'Set Window',  value:`${cfg.initialSetTime} min` },
            { label:'Slump',       value:`${cfg.slumpValue}/10` },
            { label:'Aggregate',   value:`${cfg.aggregateSize} mm` },
          ].map((s,i) => (
            <div key={i} className="bg-black px-4 py-3">
              <p className="text-[9px] text-white/30 uppercase tracking-wider mb-1">{s.label}</p>
              <p className="text-sm font-bold text-white font-mono">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button onClick={onBack}
          className="px-5 py-3 text-sm border border-gray-200 rounded-xl text-black hover:bg-gray-50 transition-colors">
          ← Back
        </button>
        <button onClick={() => onSave(cfg)}
          className="flex-1 py-3 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/90 transition-colors">
          Save Configuration & Continue
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PrinterSetupPage() {
  const router = useRouter();
  const { activeProject, updateProject } = useProjects();
  const [mode, setMode] = useState<SetupMode>('choose');

  const handleConnected = (printer: typeof PRINTERS[0]) => {
    if (activeProject) {
      updateProject(activeProject.id, {
        status: 'pre-print',
        printer: {
          name:     printer.name,
          type:     printer.type as string,
          nozzle:   printer.nozzle,
          maxSpeed: printer.maxSpeed,
        },
      });
    }
    router.push('/pre-print-optimizer');
  };

  const handleManualSave = (cfg: ManualConfig) => {
    if (activeProject) {
      updateProject(activeProject.id, {
        status: 'pre-print',
        printer: {
          name:     cfg.printerName,
          type:     'Custom',
          nozzle:   `${cfg.nozzleDiameter} mm`,
          maxSpeed: `${cfg.maxFeedrate} mm/s`,
          // Pass full config for RL
          manualConfig: cfg,
        },
      });
    }
    router.push('/pre-print-optimizer');
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <AppNav currentStep="printer" />

      <div className="max-w-5xl mx-auto px-6 py-8">

        {/* ── Choose mode ── */}
        <AnimatePresence mode="wait">
          {mode === 'choose' && (
            <motion.div key="choose"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="mb-8">
                <h1 className="text-2xl font-bold text-black">Printer Setup</h1>
                <p className="text-black/50 text-sm mt-1">
                  How would you like to configure your printer?
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-2xl">

                {/* Option A */}
                <button onClick={() => setMode('connect')}
                  className="group text-left bg-black rounded-2xl p-6 hover:bg-black/90 transition-all">
                  <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center mb-4">
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"/>
                    </svg>
                  </div>
                  <p className="text-white text-sm font-bold mb-1">Option A</p>
                  <p className="text-white text-lg font-semibold mb-2">Connect to Printer</p>
                  <p className="text-white/40 text-xs leading-relaxed">
                    Select from a list of known 3DCP printers. The system connects to the printer controller and automatically loads its profile.
                  </p>
                  <div className="mt-4 flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
                    <span>5 printers available</span>
                    <svg className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                    </svg>
                  </div>
                </button>

                {/* Option B */}
                <button onClick={() => setMode('manual')}
                  className="group text-left bg-white border-2 border-gray-100 rounded-2xl p-6 hover:border-black transition-all">
                  <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center mb-4">
                    <svg className="w-5 h-5 text-black/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z"/>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                    </svg>
                  </div>
                  <p className="text-black/50 text-sm font-bold mb-1">Option B</p>
                  <p className="text-black text-lg font-semibold mb-2">Manual Hardware Configuration</p>
                  <p className="text-black/40 text-xs leading-relaxed">
                    Configure nozzle geometry, pump dynamics, kinematic limits, and material properties for any custom or unlisted printer.
                  </p>
                  <div className="mt-4 flex items-center gap-1.5 text-black/30 text-xs font-medium group-hover:text-black transition-colors">
                    <span>4 configuration sections</span>
                    <svg className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                    </svg>
                  </div>
                </button>
              </div>
            </motion.div>
          )}

          {/* ── Option A: Connect ── */}
          {mode === 'connect' && (
            <motion.div key="connect"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="flex items-center gap-3 mb-8">
                <button onClick={() => setMode('choose')}
                  className="text-black/40 hover:text-black transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
                  </svg>
                </button>
                <div>
                  <h1 className="text-2xl font-bold text-black">Connect to Printer</h1>
                  <p className="text-black/40 text-sm">Select a printer and establish connection</p>
                </div>
              </div>
              <ConnectFlow onConnected={handleConnected} onBack={() => setMode('choose')} />
            </motion.div>
          )}

          {/* ── Option B: Manual ── */}
          {mode === 'manual' && (
            <motion.div key="manual"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="flex items-center gap-3 mb-8">
                <button onClick={() => setMode('choose')}
                  className="text-black/40 hover:text-black transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
                  </svg>
                </button>
                <div>
                  <h1 className="text-2xl font-bold text-black">Manual Hardware Configuration</h1>
                  <p className="text-black/40 text-sm">Configure your printer's physical and material properties</p>
                </div>
              </div>
              <ManualConfigForm onSave={handleManualSave} onBack={() => setMode('choose')} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}