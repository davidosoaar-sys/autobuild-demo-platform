'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useProjects } from '@/lib/project-store';
import AppNav from '@/components/AppNav';

// ── Types ─────────────────────────────────────────────────────────────────────

type SetupMode = 'choose' | 'connect' | 'manual' | 'pi';

interface ManualConfig {
  printerName:        string;
  // 1. Nozzle
  nozzleDiameter:     number;
  nozzleShape:        'round' | 'square' | 'rectangular' | 'teeth';
  // 2. Print Space
  printSpaceX:        number;   // mm
  printSpaceY:        number;   // mm
  printSpaceZ:        number;   // mm
  // 3. Pump & Delivery
  pumpType:           'rotor-stator' | 'piston';
  hoseLength:         number;
  hoseInternalDiam:   number;
  maxFlowRate:        number;   // L/min
  minFlowRate:        number;   // L/min
  // 4. Machine Kinematics
  maxVelocity:        number;   // mm/s
  acceleration:       number;   // mm/s²
  jerkDeviation:      number;
  // 5. Aggregate & Material
  aggregatePrinterSize: number; // mm — max aggregate the printer can handle
  initialSetTime:     number;
  slumpValue:         number;
}

const DEFAULT_CONFIG: ManualConfig = {
  printerName:          'Custom Printer',
  nozzleDiameter:       25,
  nozzleShape:          'round',
  printSpaceX:          6000,
  printSpaceY:          4000,
  printSpaceZ:          3000,
  pumpType:             'rotor-stator',
  hoseLength:           15,
  hoseInternalDiam:     50,
  maxFlowRate:          8,
  minFlowRate:          1,
  maxVelocity:          100,
  acceleration:         500,
  jerkDeviation:        8,
  aggregatePrinterSize: 4,
  initialSetTime:       45,
  slumpValue:           5,
};

// ── Field definitions — shown in definition panel ─────────────────────────────

const FIELD_DEFS: Record<string, { title: string; why: string; unit: string }> = {
  nozzleDiameter:       { title:'Nozzle Diameter',         unit:'mm',    why:'Sets the width of each concrete bead. The slicer uses this to compute bead footprint and print path spacing. Smaller = higher resolution, slower. Larger = faster, less detail.' },
  nozzleShape:          { title:'Nozzle Shape',            unit:'—',     why:'Round is self-centring and most common. Square gives flat-top layers with better inter-layer bond. Rectangular suits high aspect-ratio beads. Teeth (serrated) improves mechanical keying between layers.' },
  printSpaceX:          { title:'Print Space X',           unit:'mm',    why:'Maximum travel distance in X. The optimizer uses this to validate that the sliced toolpath fits within the machine envelope.' },
  printSpaceY:          { title:'Print Space Y',           unit:'mm',    why:'Maximum travel distance in Y.' },
  printSpaceZ:          { title:'Print Space Z',           unit:'mm',    why:'Maximum build height. Toolpaths exceeding this are flagged before printing starts.' },
  pumpType:             { title:'Pump Type',               unit:'—',     why:'Rotor-stator pumps are the industry standard for 3DCP — high pressure, continuous flow, handles stiff mixes. Piston pumps give more precise volumetric control for high-viscosity or fibre-reinforced mixes.' },
  hoseLength:           { title:'Hose Length',             unit:'m',     why:'The RL agent uses this to calculate hydraulic lag — how long after a pump command change before concrete actually exits the nozzle. Longer hose = more lag = earlier pump stop/start commands in G-code.' },
  hoseInternalDiam:     { title:'Hose Internal Diameter',  unit:'mm',    why:'Combined with hose length, this gives the volume of concrete in transit at any moment. Used to calculate lag time and pressure drop across the delivery system.' },
  maxFlowRate:          { title:'Max Flow Rate',           unit:'L/min', why:'Physical maximum the pump can deliver. The slicer uses this with bead geometry to compute the maximum achievable print speed without starving the nozzle.' },
  minFlowRate:          { title:'Min Flow Rate',           unit:'L/min', why:'Minimum stable flow before the pump surges or the mix segregates. Sets the floor on print speed during slow cornering or fine detail sections.' },
  maxVelocity:          { title:'Max Velocity',            unit:'mm/s',  why:'Maximum print head travel speed. The RL agent never commands motion above this. Separate from flow rate — the real speed limit is the lower of: max velocity and flow-rate-limited speed.' },
  acceleration:         { title:'Acceleration',            unit:'mm/s²', why:'How quickly the print head can change speed. Low acceleration = smooth motion, less vibration, better layer quality. High = faster print but may cause bead width variation at corners.' },
  jerkDeviation:        { title:'Junction Deviation',      unit:'mm/s',  why:'Controls speed through corners. Low values = slow smooth corners (better quality). High values = fast aggressive cornering (more vibration). Tune to your frame stiffness.' },
  aggregatePrinterSize: { title:'Max Aggregate Size',      unit:'mm',    why:'The largest aggregate particle the printer can pass without blockage. The material system will warn if the selected mix has aggregate larger than this value.' },
  initialSetTime:       { title:'Initial Set Time',        unit:'min',   why:'Time window before the mix loses workability at 20°C. The RL agent uses this with live temperature data to urgency-tune print speed — hotter conditions shorten this window.' },
  slumpValue:           { title:'Slump / Workability',     unit:'/10',   why:'How fluid the mix is. Higher slump = more flowable, easier to pump, but may sag on steep walls. Lower = stiffer, self-supporting, harder to pump. Tune to your mix design.' },
};

// ── Known printers ────────────────────────────────────────────────────────────

const PRINTERS = [
  { name:'COBOD BOD2',  type:'Gantry', nozzle:'25 mm', maxSpeed:'100 mm/s', origin:'Denmark', desc:'Industry-leading gantry, deployed in 50+ countries' },
  { name:'COBOD BOD3',  type:'Gantry', nozzle:'30 mm', maxSpeed:'150 mm/s', origin:'Denmark', desc:'Next-gen multi-material with steel reinforcement support' },
  { name:'Tektaio T1',  type:'Gantry', nozzle:'30 mm', maxSpeed:'120 mm/s', origin:'UK',      desc:'High-throughput gantry for large footprint structures' },
  { name:'Apis Cor',    type:'Crane',  nozzle:'22 mm', maxSpeed:'75 mm/s',  origin:'USA',     desc:'Portable crane-type with rapid on-site deployment' },
  { name:'ICON Vulcan', type:'Gantry', nozzle:'28 mm', maxSpeed:'90 mm/s',  origin:'USA',     desc:'Lavacrete system, US military and NASA programs' },
];

// ── UI helpers ─────────────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h3 className="text-xs font-bold text-black uppercase tracking-widest">{title}</h3>
      {subtitle && <p className="text-[11px] text-black/40 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function Field({
  fieldKey, label, unit, value, onChange, type = 'number',
  min, max, step, onFocus, children,
}: {
  fieldKey?: string; label: string; unit?: string;
  value?: number | string; onChange?: (v: any) => void;
  type?: 'number' | 'text'; min?: number; max?: number; step?: number;
  onFocus?: (key: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <label className="text-xs font-medium text-black">{label}</label>
        {unit && <span className="text-[10px] text-black/30">({unit})</span>}
        {fieldKey && FIELD_DEFS[fieldKey] && (
          <button
            type="button"
            onClick={() => onFocus?.(fieldKey)}
            className="ml-auto w-4 h-4 rounded-full border border-black/20 flex items-center justify-center hover:border-black transition-colors"
          >
            <span className="text-[9px] text-black/40 font-bold">i</span>
          </button>
        )}
      </div>
      {children ?? (
        <input
          type={type} value={value} min={min} max={max} step={step}
          onFocus={() => fieldKey && onFocus?.(fieldKey)}
          onChange={e => onChange?.(type === 'number' ? Number(e.target.value) : e.target.value)}
          className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-black transition-colors text-black"
        />
      )}
    </div>
  );
}

function Select({
  fieldKey, label, value, onChange, options, onFocus,
}: {
  fieldKey?: string; label: string; value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  onFocus?: (key: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <label className="text-xs font-medium text-black">{label}</label>
        {fieldKey && FIELD_DEFS[fieldKey] && (
          <button
            type="button"
            onClick={() => onFocus?.(fieldKey)}
            className="ml-auto w-4 h-4 rounded-full border border-black/20 flex items-center justify-center hover:border-black transition-colors"
          >
            <span className="text-[9px] text-black/40 font-bold">i</span>
          </button>
        )}
      </div>
      <select
        value={value} onChange={e => onChange(e.target.value)}
        onFocus={() => fieldKey && onFocus?.(fieldKey)}
        className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-black transition-colors text-black bg-white appearance-none cursor-pointer"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function SliderField({
  fieldKey, label, value, onChange, min, max, step, unit, formatValue, onFocus,
}: {
  fieldKey?: string; label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; unit?: string;
  formatValue?: (v: number) => string;
  onFocus?: (key: string) => void;
}) {
  const display = formatValue ? formatValue(value) : `${value}${unit ?? ''}`;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <label className="text-xs font-medium text-black">{label}</label>
        {fieldKey && FIELD_DEFS[fieldKey] && (
          <button
            type="button"
            onClick={() => onFocus?.(fieldKey)}
            className="w-4 h-4 rounded-full border border-black/20 flex items-center justify-center hover:border-black transition-colors"
          >
            <span className="text-[9px] text-black/40 font-bold">i</span>
          </button>
        )}
        <span className="ml-auto text-xs font-mono font-bold text-black">{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onFocus={() => fieldKey && onFocus?.(fieldKey)}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-black h-1"
      />
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-black/25">{min}{unit}</span>
        <span className="text-[10px] text-black/25">{max}{unit}</span>
      </div>
    </div>
  );
}

// ── Definition panel ──────────────────────────────────────────────────────────

function DefinitionPanel({ fieldKey, onClose }: { fieldKey: string | null; onClose: () => void }) {
  const def = fieldKey ? FIELD_DEFS[fieldKey] : null;
  return (
    <AnimatePresence>
      {def && (
        <motion.div
          initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.2 }}
          className="sticky top-24 bg-black rounded-2xl p-5 self-start"
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1">Field Definition</p>
              <p className="text-sm font-bold text-white">{def.title}</p>
              {def.unit !== '—' && (
                <p className="text-[10px] font-mono text-white/40 mt-0.5">Unit: {def.unit}</p>
              )}
            </div>
            <button onClick={onClose} className="text-white/30 hover:text-white transition-colors text-lg leading-none">×</button>
          </div>
          <p className="text-[11px] text-white/60 leading-relaxed">{def.why}</p>
        </motion.div>
      )}
      {!def && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="sticky top-24 bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl p-5 self-start"
        >
          <p className="text-xs text-black/30 text-center">
            Click the <span className="font-bold">i</span> button next to any field to see what it means and why it matters.
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Raspberry Pi discovery flow ───────────────────────────────────────────────

const PI_STEPS = [
  'Broadcasting discovery packet on local network…',
  'Scanning for AutoBuild Pi dongles…',
  'Pi dongle found — 192.168.1.42',
  'Handshaking with printer controller…',
  'Reading printer identity and firmware version…',
  'Fetching printer specs from controller EEPROM…',
  'Validating specs against known profiles…',
  'Printer profile loaded successfully.',
];

function PiDiscoveryFlow({ onConnected, onBack }: {
  onConnected: (name: string, specs: any) => void;
  onBack: () => void;
}) {
  const [scanning,   setScanning]   = useState(false);
  const [logLines,   setLogLines]   = useState<string[]>([]);
  const [discovered, setDiscovered] = useState(false);
  const [piSpecs,    setPiSpecs]    = useState<any>(null);

  const handleScan = () => {
    setScanning(true); setLogLines([]); setDiscovered(false);
    let i = 0;
    const iv = setInterval(() => {
      setLogLines(prev => [...prev, `> ${PI_STEPS[i]}`]);
      i++;
      if (i >= PI_STEPS.length) {
        clearInterval(iv);
        // Simulate specs read from printer EEPROM via Pi
        const specs = {
          name:             'COBOD BOD2 (via Pi)',
          nozzleDiameter:   25,
          nozzleShape:      'round',
          maxVelocity:      100,
          minFlowRate:      1,
          maxFlowRate:      8,
          printSpaceX:      9000,
          printSpaceY:      6000,
          printSpaceZ:      3500,
          hoseLength:       15,
          hoseInternalDiam: 50,
          pumpType:         'rotor-stator',
          acceleration:     500,
          jerkDeviation:    8,
          aggregatePrinterSize: 4,
          initialSetTime:   45,
          slumpValue:       5,
        };
        setPiSpecs(specs);
        setDiscovered(true);
      }
    }, 480);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl">
      {/* Left */}
      <div>
        <div className="bg-white border border-gray-100 rounded-2xl p-6 mb-4">
          <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center mb-4">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"/>
            </svg>
          </div>
          <h3 className="text-sm font-bold text-black mb-1">Raspberry Pi Wireless Dongle</h3>
          <p className="text-xs text-black/40 leading-relaxed mb-4">
            The AutoBuild Pi dongle connects to your printer's controller via USB serial, then broadcasts specs over your local Wi-Fi. AutoBuild detects it automatically and loads the full printer profile — no manual entry needed.
          </p>
          <div className="space-y-2">
            {[
              'Plug Pi dongle into printer USB port',
              'Connect Pi to site Wi-Fi',
              'Click Scan below',
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-black text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </div>
                <p className="text-xs text-black/60">{step}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onBack}
            className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl text-black hover:bg-gray-50 transition-colors">
            Back
          </button>
          <button onClick={handleScan} disabled={scanning && !discovered}
            className="flex-1 py-2.5 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/90 disabled:opacity-40 transition-colors">
            {scanning && !discovered ? 'Scanning…' : 'Scan Network'}
          </button>
        </div>
      </div>

      {/* Right: log + specs */}
      <div>
        <div className="bg-black rounded-2xl p-5 font-mono text-[11px] min-h-[200px] mb-4">
          {logLines.length === 0 && <p className="text-white/20">Waiting for scan…</p>}
          {logLines.map((line, i) => (
            <motion.p key={i} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
              className={`leading-relaxed ${line.includes('successfully') ? 'text-emerald-400 font-bold' : line.includes('found') ? 'text-amber-400' : 'text-white/50'}`}>
              {line}
            </motion.p>
          ))}
          {scanning && !discovered && (
            <span className="inline-block w-2 h-3.5 bg-white/60 animate-pulse ml-0.5"/>
          )}
        </div>

        {discovered && piSpecs && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="bg-white border border-gray-100 rounded-2xl p-4 mb-4">
            <p className="text-[9px] font-bold text-black/40 uppercase tracking-widest mb-3">Discovered Printer</p>
            <p className="text-sm font-bold text-black mb-3">{piSpecs.name}</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {[
                ['Nozzle',       `${piSpecs.nozzleDiameter}mm ${piSpecs.nozzleShape}`],
                ['Max velocity', `${piSpecs.maxVelocity} mm/s`],
                ['Flow range',   `${piSpecs.minFlowRate}–${piSpecs.maxFlowRate} L/min`],
                ['Print space',  `${piSpecs.printSpaceX}×${piSpecs.printSpaceY}×${piSpecs.printSpaceZ}mm`],
                ['Pump',         piSpecs.pumpType],
                ['Aggregate',    `≤ ${piSpecs.aggregatePrinterSize}mm`],
              ].map(([l, v]) => (
                <div key={l}>
                  <p className="text-[9px] text-black/30 uppercase tracking-wider">{l}</p>
                  <p className="text-xs font-mono font-semibold text-black">{v}</p>
                </div>
              ))}
            </div>
            <button onClick={() => onConnected(piSpecs.name, piSpecs)}
              className="w-full mt-4 py-2.5 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/90 transition-colors">
              Use This Printer
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ── Connect flow (Option A) ───────────────────────────────────────────────────

const LOG_STEPS = [
  'Initialising serial interface…',
  'Sending CONNECT command…',
  'Handshake acknowledged…',
  'Querying printer firmware…',
  'Loading printer profile…',
  'Calibrating extrusion baseline…',
  'Connection established.',
];

function ConnectFlow({ onConnected, onBack }: {
  onConnected: (printer: typeof PRINTERS[0]) => void;
  onBack: () => void;
}) {
  const [selected,   setSelected]   = useState<typeof PRINTERS[0] | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [logLines,   setLogLines]   = useState<string[]>([]);
  const [connected,  setConnected]  = useState(false);

  const handleConnect = () => {
    if (!selected) return;
    setConnecting(true); setLogLines([]);
    let i = 0;
    const iv = setInterval(() => {
      setLogLines(prev => [...prev, `> ${LOG_STEPS[i]}`]);
      i++;
      if (i >= LOG_STEPS.length) { clearInterval(iv); setConnected(true); }
    }, 420);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h2 className="text-sm font-semibold text-black mb-4">Select Printer</h2>
        <div className="space-y-3">
          {PRINTERS.map(p => (
            <button key={p.name}
              onClick={() => { setSelected(p); setConnected(false); setLogLines([]); setConnecting(false); }}
              className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${
                selected?.name === p.name ? 'bg-black border-black' : 'bg-white border-gray-100 hover:border-black'
              }`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className={`text-sm font-semibold ${selected?.name===p.name?'text-white':'text-black'}`}>{p.name}</p>
                  <p className={`text-[11px] mt-0.5 ${selected?.name===p.name?'text-white/50':'text-black/40'}`}>{p.type} · {p.origin}</p>
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

      <div>
        <h2 className="text-sm font-semibold text-black mb-4">Connection Log</h2>
        <div className="bg-black rounded-2xl p-5 font-mono text-[11px] min-h-[280px]">
          {logLines.length === 0 && !connecting && <p className="text-white/20">Select a printer and click Connect…</p>}
          {logLines.map((line, i) => (
            <motion.p key={i} initial={{ opacity:0,x:-4 }} animate={{ opacity:1,x:0 }}
              className={`leading-relaxed ${line.includes('established')?'text-emerald-400 font-bold':'text-white/60'}`}>
              {line}
            </motion.p>
          ))}
          {connecting && !connected && <span className="inline-block w-2 h-3.5 bg-white/60 animate-pulse ml-0.5"/>}
        </div>
        <div className="mt-4 flex gap-3">
          <button onClick={onBack}
            className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl text-black hover:bg-gray-50 transition-colors">
            Back
          </button>
          {!connected ? (
            <button onClick={handleConnect} disabled={!selected || connecting}
              className="flex-1 py-2.5 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/90 disabled:opacity-30 transition-colors">
              {connecting ? 'Connecting…' : 'Connect'}
            </button>
          ) : (
            <motion.button initial={{opacity:0,scale:0.95}} animate={{opacity:1,scale:1}}
              onClick={() => onConnected(selected!)}
              className="flex-1 py-2.5 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/80 transition-colors flex items-center justify-center gap-2">
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

// ── Manual config form (Option B) ─────────────────────────────────────────────

function ManualConfigForm({ onSave, onBack }: {
  onSave: (cfg: ManualConfig) => void;
  onBack: () => void;
}) {
  const [cfg,      setCfg]      = useState<ManualConfig>(DEFAULT_CONFIG);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const set = (key: keyof ManualConfig) => (val: any) => setCfg(c => ({ ...c, [key]: val }));

  const hydraulicVolume = (Math.PI * (cfg.hoseInternalDiam/2/1000)**2 * cfg.hoseLength * 1000).toFixed(2);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-6 max-w-5xl">

      {/* Left: form */}
      <div>
        {/* Printer name */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
          <Field label="Printer Name" type="text" value={cfg.printerName} onChange={set('printerName')}/>
        </div>

        {/* 1. Nozzle */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
          <SectionHeader title="1. Nozzle" subtitle="Shape and size of the concrete extrusion nozzle"/>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field fieldKey="nozzleDiameter" label="Nozzle Diameter" unit="mm"
              value={cfg.nozzleDiameter} onChange={set('nozzleDiameter')}
              min={10} max={50} step={0.5} onFocus={setFocusKey}/>
            <Select fieldKey="nozzleShape" label="Nozzle Shape"
              value={cfg.nozzleShape} onChange={set('nozzleShape')} onFocus={setFocusKey}
              options={[
                { value:'round',       label:'Round — standard, self-centring' },
                { value:'square',      label:'Square — flat-top layers' },
                { value:'rectangular', label:'Rectangular — high aspect ratio' },
                { value:'teeth',       label:'Teeth (serrated) — improved layer bond' },
              ]}
            />
          </div>
        </div>

        {/* 2. Print Space */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
          <SectionHeader title="2. Print Space" subtitle="Machine envelope — maximum build volume"/>
          <div className="grid grid-cols-3 gap-5">
            <Field fieldKey="printSpaceX" label="X" unit="mm"
              value={cfg.printSpaceX} onChange={set('printSpaceX')}
              min={100} max={30000} step={100} onFocus={setFocusKey}/>
            <Field fieldKey="printSpaceY" label="Y" unit="mm"
              value={cfg.printSpaceY} onChange={set('printSpaceY')}
              min={100} max={30000} step={100} onFocus={setFocusKey}/>
            <Field fieldKey="printSpaceZ" label="Z" unit="mm"
              value={cfg.printSpaceZ} onChange={set('printSpaceZ')}
              min={100} max={20000} step={100} onFocus={setFocusKey}/>
          </div>
          <p className="text-[10px] text-black/30 mt-3 font-mono">
            Volume: {((cfg.printSpaceX/1000)*(cfg.printSpaceY/1000)*(cfg.printSpaceZ/1000)).toFixed(1)} m³
          </p>
        </div>

        {/* 3. Pump & Delivery */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
          <SectionHeader title="3. Pump & Delivery" subtitle="Flow rate limits and hydraulic lag parameters"/>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Select fieldKey="pumpType" label="Pump Type"
              value={cfg.pumpType} onChange={set('pumpType')} onFocus={setFocusKey}
              options={[
                { value:'rotor-stator', label:'Rotor-Stator — high pressure, common' },
                { value:'piston',       label:'Piston — precise, high viscosity' },
              ]}
            />
            <Field fieldKey="hoseLength" label="Hose Length" unit="m"
              value={cfg.hoseLength} onChange={set('hoseLength')}
              min={1} max={100} step={0.5} onFocus={setFocusKey}/>
            <div>
              <Field fieldKey="hoseInternalDiam" label="Hose Internal Diameter" unit="mm"
                value={cfg.hoseInternalDiam} onChange={set('hoseInternalDiam')}
                min={20} max={100} step={1} onFocus={setFocusKey}/>
              <p className="text-[10px] text-black/30 mt-1.5 font-mono">Volume in hose: {hydraulicVolume} L</p>
            </div>
            <Field fieldKey="maxFlowRate" label="Max Flow Rate" unit="L/min"
              value={cfg.maxFlowRate} onChange={set('maxFlowRate')}
              min={1} max={40} step={0.5} onFocus={setFocusKey}/>
            <Field fieldKey="minFlowRate" label="Min Flow Rate" unit="L/min"
              value={cfg.minFlowRate} onChange={set('minFlowRate')}
              min={0.1} max={10} step={0.1} onFocus={setFocusKey}/>
          </div>
        </div>

        {/* 4. Machine Kinematics */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
          <SectionHeader title="4. Machine Kinematics" subtitle="Speed limits so the RL agent never exceeds physical capability"/>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field fieldKey="maxVelocity" label="Max Velocity" unit="mm/s"
              value={cfg.maxVelocity} onChange={set('maxVelocity')}
              min={10} max={300} step={5} onFocus={setFocusKey}/>
            <Field fieldKey="acceleration" label="Acceleration" unit="mm/s²"
              value={cfg.acceleration} onChange={set('acceleration')}
              min={50} max={3000} step={50} onFocus={setFocusKey}/>
            <div className="sm:col-span-2">
              <SliderField fieldKey="jerkDeviation" label="Junction Deviation"
                value={cfg.jerkDeviation} onChange={set('jerkDeviation')}
                min={1} max={20} step={0.5} unit=" mm/s" onFocus={setFocusKey}
                formatValue={v => v<=5?`${v} mm/s — Smooth`:v<=12?`${v} mm/s — Balanced`:`${v} mm/s — Aggressive`}
              />
            </div>
          </div>
        </div>

        {/* 5. Aggregate & Material */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
          <SectionHeader title="5. Aggregate & Material" subtitle="Printer-side constraints on material properties"/>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <Field fieldKey="aggregatePrinterSize" label="Max Aggregate Size" unit="mm"
                value={cfg.aggregatePrinterSize} onChange={set('aggregatePrinterSize')}
                min={0} max={20} step={0.5} onFocus={setFocusKey}/>
              {cfg.aggregatePrinterSize > cfg.nozzleDiameter * 0.35 && (
                <p className="text-[10px] text-amber-600 mt-1">
                  Exceeds recommended max ({(cfg.nozzleDiameter*0.35).toFixed(1)}mm) — clog risk
                </p>
              )}
            </div>
            <Field fieldKey="initialSetTime" label="Initial Set Time" unit="min at 20°C"
              value={cfg.initialSetTime} onChange={set('initialSetTime')}
              min={5} max={120} step={1} onFocus={setFocusKey}/>
            <div className="sm:col-span-2">
              <SliderField fieldKey="slumpValue" label="Slump / Workability"
                value={cfg.slumpValue} onChange={set('slumpValue')}
                min={1} max={10} step={0.5} onFocus={setFocusKey}
                formatValue={v => v<=3?`${v}/10 — Stiff`:v<=6?`${v}/10 — Balanced`:`${v}/10 — Wet, may sag`}
              />
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="bg-black rounded-2xl p-5 mb-6">
          <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-4">
            Configuration Summary — What the RL sees
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/10 rounded-xl overflow-hidden">
            {[
              { label:'Nozzle',      value:`${cfg.nozzleDiameter}mm ${cfg.nozzleShape}` },
              { label:'Print Space', value:`${(cfg.printSpaceX/1000).toFixed(1)}×${(cfg.printSpaceY/1000).toFixed(1)}×${(cfg.printSpaceZ/1000).toFixed(1)}m` },
              { label:'Max Vel',     value:`${cfg.maxVelocity} mm/s` },
              { label:'Flow Range',  value:`${cfg.minFlowRate}–${cfg.maxFlowRate} L/min` },
              { label:'Pump',        value:cfg.pumpType },
              { label:'Set Window',  value:`${cfg.initialSetTime} min` },
              { label:'Slump',       value:`${cfg.slumpValue}/10` },
              { label:'Aggregate',   value:`≤ ${cfg.aggregatePrinterSize}mm` },
            ].map((s,i) => (
              <div key={i} className="bg-black px-4 py-3">
                <p className="text-[9px] text-white/30 uppercase tracking-wider mb-1">{s.label}</p>
                <p className="text-sm font-bold text-white font-mono">{s.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={onBack}
            className="px-5 py-3 text-sm border border-gray-200 rounded-xl text-black hover:bg-gray-50 transition-colors">
            Back
          </button>
          <button onClick={() => onSave(cfg)}
            className="flex-1 py-3 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/90 transition-colors">
            Save & Continue
          </button>
        </div>
      </div>

      {/* Right: definition panel */}
      <DefinitionPanel fieldKey={focusKey} onClose={() => setFocusKey(null)} />
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
        printer: { name: printer.name, type: printer.type, nozzle: printer.nozzle, maxSpeed: printer.maxSpeed },
      });
    }
    router.push('/pre-print-optimizer');
  };

  const handlePiConnected = (name: string, specs: any) => {
    if (activeProject) {
      updateProject(activeProject.id, {
        status: 'pre-print',
        printer: {
          name,
          type:     'Gantry',
          nozzle:   `${specs.nozzleDiameter} mm`,
          maxSpeed: `${specs.maxVelocity} mm/s`,
          manualConfig: specs,
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
          maxSpeed: `${cfg.maxVelocity} mm/s`,
          manualConfig: cfg,
        },
      });
    }
    router.push('/pre-print-optimizer');
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <AppNav currentStep="printer"/>
      <div className="max-w-5xl mx-auto px-6 py-8">
        <AnimatePresence mode="wait">

          {/* Choose */}
          {mode === 'choose' && (
            <motion.div key="choose" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}}>
              <div className="mb-8">
                <h1 className="text-2xl font-bold text-black">Printer Setup</h1>
                <p className="text-black/50 text-sm mt-1">How would you like to configure your printer?</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-3xl">

                {/* Pi */}
                <button onClick={() => setMode('pi')}
                  className="group text-left bg-black rounded-2xl p-6 hover:bg-black/90 transition-all">
                  <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center mb-4">
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"/>
                    </svg>
                  </div>
                  <p className="text-white/50 text-xs font-bold mb-1">Recommended</p>
                  <p className="text-white text-base font-semibold mb-2">Pi Wireless Dongle</p>
                  <p className="text-white/40 text-xs leading-relaxed">
                    Plug the AutoBuild Pi into your printer. It auto-discovers the printer name and all specs over Wi-Fi.
                  </p>
                  <div className="mt-4 text-emerald-400 text-xs font-medium">Auto-configure →</div>
                </button>

                {/* Known printer */}
                <button onClick={() => setMode('connect')}
                  className="group text-left bg-white border-2 border-gray-100 rounded-2xl p-6 hover:border-black transition-all">
                  <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center mb-4">
                    <svg className="w-5 h-5 text-black/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z"/>
                    </svg>
                  </div>
                  <p className="text-black/50 text-xs font-bold mb-1">Option A</p>
                  <p className="text-black text-base font-semibold mb-2">Known Printer</p>
                  <p className="text-black/40 text-xs leading-relaxed">
                    Select from COBOD, Apis Cor, ICON and others. Profile loads automatically.
                  </p>
                  <div className="mt-4 text-black/30 text-xs font-medium group-hover:text-black transition-colors">5 printers →</div>
                </button>

                {/* Manual */}
                <button onClick={() => setMode('manual')}
                  className="group text-left bg-white border-2 border-gray-100 rounded-2xl p-6 hover:border-black transition-all">
                  <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center mb-4">
                    <svg className="w-5 h-5 text-black/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z"/>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                    </svg>
                  </div>
                  <p className="text-black/50 text-xs font-bold mb-1">Option B</p>
                  <p className="text-black text-base font-semibold mb-2">Manual Config</p>
                  <p className="text-black/40 text-xs leading-relaxed">
                    Enter nozzle, pump, kinematics and aggregate specs for any custom printer.
                  </p>
                  <div className="mt-4 text-black/30 text-xs font-medium group-hover:text-black transition-colors">5 sections →</div>
                </button>

              </div>
            </motion.div>
          )}

          {/* Pi discovery */}
          {mode === 'pi' && (
            <motion.div key="pi" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}}>
              <div className="flex items-center gap-3 mb-8">
                <button onClick={() => setMode('choose')} className="text-black/40 hover:text-black transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
                  </svg>
                </button>
                <div>
                  <h1 className="text-2xl font-bold text-black">Pi Wireless Dongle</h1>
                  <p className="text-black/40 text-sm">Auto-discover printer over local network</p>
                </div>
              </div>
              <PiDiscoveryFlow onConnected={handlePiConnected} onBack={() => setMode('choose')}/>
            </motion.div>
          )}

          {/* Connect */}
          {mode === 'connect' && (
            <motion.div key="connect" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}}>
              <div className="flex items-center gap-3 mb-8">
                <button onClick={() => setMode('choose')} className="text-black/40 hover:text-black transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
                  </svg>
                </button>
                <div>
                  <h1 className="text-2xl font-bold text-black">Connect to Printer</h1>
                  <p className="text-black/40 text-sm">Select a printer and establish connection</p>
                </div>
              </div>
              <ConnectFlow onConnected={handleConnected} onBack={() => setMode('choose')}/>
            </motion.div>
          )}

          {/* Manual */}
          {mode === 'manual' && (
            <motion.div key="manual" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}}>
              <div className="flex items-center gap-3 mb-8">
                <button onClick={() => setMode('choose')} className="text-black/40 hover:text-black transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
                  </svg>
                </button>
                <div>
                  <h1 className="text-2xl font-bold text-black">Manual Hardware Configuration</h1>
                  <p className="text-black/40 text-sm">Configure your printer's physical properties</p>
                </div>
              </div>
              <ManualConfigForm onSave={handleManualSave} onBack={() => setMode('choose')}/>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}