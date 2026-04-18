'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useProjects, ManualPrinterConfig } from '@/lib/project-store';
import AppNav from '@/components/AppNav';
import ParameterInputs from './components/ParameterInputs';
import FileUpload, { SiteDimensions } from './components/FileUpload';
import LayerVisualization from './components/LayerVisualization';
import { ScanResult } from './components/ScanBanner';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type Phase        = 'idle' | 'optimizing' | 'done' | 'error';
type ActiveTab    = 'setup' | 'results';
type SidebarPanel = 'results' | 'changes' | 'layers' | 'scan';
type ViewMode     = 'environment' | 'dark' | 'light';

interface CementInfo   { display_name: string; open_time_min: number; risk_score: number; }
interface PrinterInfo  { name: string; nozzle_mm: number; layer_height_mm: number; effective_speed: number; mix_compatible: boolean; }
interface WeatherInfo  { blocks_used: number; avg_conditions: Record<string,number>; worst_block: Record<string,number>; }
interface OptInfo      { time_saved_pct: number; env_risk_score: number; total_travel_mm: number; naive_travel_mm: number; total_segments: number; }
interface GeoInfo      { num_layers: number; layer_height: number; total_segments: number; file_name: string; total_height_m: number; bounds_x: [number,number]; bounds_y: [number,number]; bounds_z: [number,number]; }

interface LayerStat {
  layer: number; z_height_mm: number; segments: number;
  perimeter_mm: number; area_cm2: number; complexity: number;
  print_speed_mm_s: number; risk_score: number;
  temperature_c?: number;
}

interface OptimizeResult {
  result_id: string; elapsed_seconds: number;
  geometry:  GeoInfo;
  printer?:  PrinterInfo;
  cement?:   CementInfo;
  weather?:  WeatherInfo;
  optimization: OptInfo;
  toolpath: { x0: number; y0: number; x1: number; y1: number }[][];
  gcode_lines: number; gcode_preview: string; gcode_full?: string;
  layer_stats?: LayerStat[];
  estimated_print_time?: string;
  estimated_print_time_s?: number;
}

interface WeatherBlock { id: string; start_hour: number; end_hour: number; temperature: number; humidity: number; wind_speed: number; ground_slope: number; notes: string; }
interface Parameters   { temperature: number; humidity: number; windSpeed: number; groundSlope: number; cementMix: string; batchNumber: string; }

function fmtTime(m: number): string {
  if (m < 1)  return `${Math.round(m * 60)}s`;
  if (m < 60) return `${Math.round(m)} min`;
  return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
}

function calcEstFinish(startHour: number, printTimeSec: number): string {
  const totalMin  = printTimeSec / 60;
  const finishH   = startHour + totalMin / 60;
  const hh        = Math.floor(finishH) % 24;
  const mm        = Math.round((finishH % 1) * 60);
  const ampm      = hh >= 12 ? 'PM' : 'AM';
  const disp      = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh;
  return `${disp}:${String(mm).padStart(2,'0')} ${ampm}`;
}

// ── Factors ───────────────────────────────────────────────────────────────────

interface Factor { label: string; value: string; impact: string; ok: boolean; }

function buildFactors(result: OptimizeResult, params: Parameters): Factor[] {
  const avg:   Record<string,number> = result.weather?.avg_conditions  ?? {};
  const worst: Record<string,number> = result.weather?.worst_block     ?? {};
  const cement: Partial<CementInfo>  = result.cement  ?? {};
  const opt:    OptInfo              = result.optimization;
  const factors: Factor[] = [];

  const temp = (worst['temperature'] ?? avg['temperature'] ?? params.temperature) as number;
  if (temp > 30) factors.push({ label:'High Temperature', value:`${temp}°C`, impact:`Speed increased ~${Math.round((temp-30)*1.5)}% to outrun cement setting time`, ok:false });
  else if (temp < 15) factors.push({ label:'Low Temperature', value:`${temp}°C`, impact:'Slower curing — print speed reduced for stronger layer bonding', ok:false });
  else factors.push({ label:'Temperature', value:`${temp}°C`, impact:'Optimal range — no speed adjustment required', ok:true });

  const hum = (avg['humidity'] ?? params.humidity) as number;
  if (hum < 50) factors.push({ label:'Low Humidity', value:`${hum}%`, impact:'Dry air — travel moves minimised to reduce exposed surface time', ok:false });
  else if (hum > 80) factors.push({ label:'High Humidity', value:`${hum}%`, impact:'Slow drying — speed slightly reduced to allow layer curing', ok:false });
  else factors.push({ label:'Humidity', value:`${hum}%`, impact:'Good range — material workability maintained throughout print', ok:true });

  const wind = (avg['wind_speed'] ?? params.windSpeed) as number;
  if (wind > 15) factors.push({ label:'High Wind', value:`${wind} km/h`, impact:'Windward walls prioritised in segment sequence', ok:false });
  else if (wind > 8) factors.push({ label:'Moderate Wind', value:`${wind} km/h`, impact:'Minor adjustment to elevated layer segment order', ok:false });
  else factors.push({ label:'Wind Speed', value:`${wind} km/h`, impact:'Calm conditions — no wind compensation needed', ok:true });

  const openTime   = cement.open_time_min ?? 45;
  const riskScore  = cement.risk_score    ?? 0;
  const cementName = cement.display_name  ?? params.cementMix;
  factors.push({
    label: cementName, value: `${openTime} min open time`,
    impact: `Risk ${riskScore}/100 — ${riskScore < 20 ? 'low risk under current conditions' : 'speed adjusted to compensate'}`,
    ok: riskScore < 20,
  });
  if ((opt.time_saved_pct ?? 0) > 0) factors.push({ label:'RL Travel Optimisation', value:`${opt.time_saved_pct}% saved`, impact:`Travel reduced from ${opt.naive_travel_mm}mm to ${opt.total_travel_mm}mm`, ok:true });
  if ((result.weather?.blocks_used ?? 0) > 1) factors.push({ label:'Time-Based Weather', value:`${result.weather!.blocks_used} blocks`, impact:'Print speed varied dynamically across time windows', ok:true });
  return factors;
}

// ── Loading overlay ───────────────────────────────────────────────────────────

const STEPS = [
  { label:'Parsing 3D geometry',        detail:'Reading STL/OBJ mesh · computing bounds' },
  { label:'Slicing into layers',         detail:'Generating printable segments per layer' },
  { label:'Initialising RL agent',       detail:'Loading trained PPO policy' },
  { label:'Running agent on each layer', detail:'Selecting optimal segment order' },
  { label:'Adapting to conditions',      detail:'Temperature · humidity · wind' },
  { label:'Generating G-code',          detail:'Converting toolpath to printer commands' },
];

function LoadingOverlay({ fileName, onCancel }: { fileName:string; onCancel:()=>void }) {
  const [pct, setPct] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => {
      setPct(p => {
        const next = Math.min(p + Math.random() * 8, 95);
        setStepIdx(Math.min(Math.floor((next / 95) * STEPS.length), STEPS.length - 1));
        return next;
      });
    }, 1600);
    return () => clearInterval(iv);
  }, []);

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0,transition:{duration:0.3}}}
      className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center">
      <div className="flex flex-col items-center w-full max-w-sm px-10">

        <p className="text-white text-xl font-semibold tracking-tight mb-1">Optimizing</p>
        <p className="text-white/30 text-[11px] font-mono mb-10 truncate max-w-full text-center">{fileName}</p>

        {/* Progress bar */}
        <div className="w-full mb-3">
          <div className="w-full h-0.5 bg-white/10 rounded-full overflow-hidden">
            <motion.div className="h-full bg-white rounded-full"
              animate={{width:`${pct}%`}} transition={{duration:1.2, ease:'easeOut'}}/>
          </div>
          <div className="flex justify-between mt-2">
            <p className="text-white/30 text-[10px] font-mono">{STEPS[stepIdx]?.label}</p>
            <p className="text-white/25 text-[10px] font-mono">{Math.round(pct)}%</p>
          </div>
        </div>

        <button onClick={onCancel}
          className="mt-16 text-white/15 hover:text-white/40 text-[10px] transition-colors tracking-widest uppercase">
          Cancel
        </button>
      </div>
    </motion.div>
  );
}

// ── Stat row — clean minimal ──────────────────────────────────────────────────

function StatRow({ label, value, highlight, delay=0, accent }: {
  label:string; value:string; highlight?:boolean; delay?:number; accent?:string;
}) {
  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay,duration:0.25}}
      className="flex items-center justify-between py-2.5 border-b border-white/6 last:border-0">
      <span className="text-[11px] text-white/35 font-medium">{label}</span>
      <span className={`text-[12px] font-semibold font-mono ${accent ?? (highlight ? 'text-white' : 'text-white/75')}`}>{value}</span>
    </motion.div>
  );
}

function FactorRow({ label, value, impact, ok, delay=0 }: { label:string; value:string; impact:string; ok:boolean; delay?:number }) {
  return (
    <motion.div initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} transition={{delay,duration:0.25}}
      className="py-3 border-b border-white/6 last:border-0">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div className={`w-1 h-1 rounded-full ${ok?'bg-emerald-400':'bg-amber-400'}`}/>
          <span className="text-[11px] font-medium text-white/70">{label}</span>
        </div>
        <span className={`text-[10px] font-mono font-semibold ${ok?'text-emerald-400':'text-amber-400'}`}>{value}</span>
      </div>
      <p className="text-[10px] text-white/30 leading-relaxed pl-3">{impact}</p>
    </motion.div>
  );
}

// ── Scan issue row ────────────────────────────────────────────────────────────

const SEV_DOT:   Record<string,string> = { error:'bg-red-500', warning:'bg-amber-400', info:'bg-blue-400' };
const SEV_BADGE: Record<string,string> = {
  error:   'bg-red-500/10 text-red-400 border-red-500/20',
  warning: 'bg-amber-400/10 text-amber-300 border-amber-400/20',
  info:    'bg-blue-400/10 text-blue-300 border-blue-400/20',
};
const SEV_WRAP: Record<string,string> = {
  error:   'border-red-500/15 bg-red-500/5',
  warning: 'border-amber-400/15 bg-amber-400/4',
  info:    'border-white/8 bg-white/3',
};

function ScanIssueRow({ issue, delay=0 }: { issue: any; delay?: number }) {
  const [open, setOpen] = useState(issue.severity === 'error');
  return (
    <motion.div initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} transition={{delay,duration:0.25}}
      className={`rounded-xl border overflow-hidden ${SEV_WRAP[issue.severity] ?? 'border-white/8 bg-white/3'}`}>
      <button onClick={()=>setOpen(v=>!v)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-white/3 transition-colors">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${SEV_DOT[issue.severity] ?? 'bg-white/30'}`}/>
        <span className="flex-1 text-[10px] font-semibold text-white/80 leading-tight">{issue.title}</span>
        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${SEV_BADGE[issue.severity] ?? ''}`}>{issue.severity}</span>
        <svg className={`w-3 h-3 text-white/20 flex-shrink-0 transition-transform ${open?'rotate-180':''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}}
            transition={{duration:0.18}} className="overflow-hidden">
            <div className="px-3 pb-3 space-y-1.5 border-t border-white/5 pt-2">
              <p className="text-[9px] text-white/40 leading-relaxed">{issue.detail}</p>
              <div className="rounded-lg px-2 py-1.5 border border-white/5 bg-white/3">
                <p className="text-[8px] text-white/25 uppercase tracking-wider mb-0.5">Fix</p>
                <p className="text-[9px] text-white/50 leading-relaxed">{issue.recommendation}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function PrePrintOptimizer() {
  const router = useRouter();
  const { activeProject, updateProject } = useProjects();

  const [activeTab,     setActiveTab]     = useState<ActiveTab>('setup');
  const [sidebarPanel,  setSidebarPanel]  = useState<SidebarPanel>('results');
  const [showSidebar,   setShowSidebar]   = useState(true);
  const [viewMode,      setViewMode]      = useState<ViewMode>('environment');
  const [modelScale,    setModelScale]    = useState(1.0);
  const [printScale,    setPrintScale]    = useState(1.0);
  const [file,          setFile]          = useState<File | null>(null);
  const [sitePlanData,  setSitePlanData]  = useState<import('./components/SitePlanReader').SitePlanData | null>(null);
  const [site,          setSite]          = useState<SiteDimensions>({ width:12, length:10, slope:0 });
  const [parameters,    setParameters]    = useState<Parameters>({ temperature:24, humidity:65, windSpeed:8, groundSlope:0, cementMix:'standard', batchNumber:'' });
  const [weatherBlocks, setWeatherBlocks] = useState<WeatherBlock[]>([]);
  const [weatherStart,  setWeatherStart]  = useState(8.0);
  const [city,          setCity]          = useState('');
  const [phase,         setPhase]         = useState<Phase>('idle');
  const [scanResult,    setScanResult]    = useState<ScanResult | null>(null);
  const [result,        setResult]        = useState<OptimizeResult | null>(null);
  const [errorMsg,      setErrorMsg]      = useState('');
  const [totalLayers,   setTotalLayers]   = useState(activeProject?.totalLayers || 100);
  const [printSpeed,    setPrintSpeed]    = useState(activeProject?.printSpeed  || 60);
  const [showConfirm,   setShowConfirm]   = useState(false);
  const [stepIdx,       setStepIdx]       = useState(0);

  useEffect(() => {
    setScanResult(null);
    if (phase === 'error') setPhase('idle');
  }, [file]);

  const handleParamsChange = (p: Parameters) => setParameters(p);

  const handleOptimize = async () => {
    if (!file) return;
    setPhase('optimizing'); setErrorMsg(''); setStepIdx(0);
    const ticker = setInterval(() => setStepIdx(i => Math.min(i+1, STEPS.length-1)), 950);
    try {
      const mc        = activeProject?.printer?.manualConfig as ManualPrinterConfig | undefined;
      const nozzleMm  = (mc?.nozzleDiameter   != null ? mc.nozzleDiameter   : parseFloat(activeProject?.printer?.nozzle    ?? '25')  || 25)  as number;
      const beadComp  = (mc?.beadCompression  != null ? mc.beadCompression  : 0.6) as number;
      const maxSpd    = (mc?.maxVelocity      != null ? mc.maxVelocity      : parseFloat(activeProject?.printer?.maxSpeed  ?? '100') || 100) as number;
      const minSpd    = (mc?.minFlowRate      != null ? mc.minFlowRate      : 15)  as number;
      const flowRate  = (mc?.maxFlowRate      != null ? mc.maxFlowRate      : 8)   as number;
      const hoseLen   = (mc?.hoseLength       != null ? mc.hoseLength       : 15)  as number;
      const hoseDiam  = (mc?.hoseInternalDiam != null ? mc.hoseInternalDiam : 50)  as number;
      const accel     = (mc?.acceleration     != null ? mc.acceleration     : 500) as number;
      const layerH    = (nozzleMm * beadComp) / 1000;

      // Silent scan
      try {
        const sf = new FormData();
        sf.append('file', file);
        sf.append('nozzle_diameter_mm', String(nozzleMm));
        sf.append('layer_height_m',     String(layerH));
        const sr = await fetch(`${API}/scan`, { method:'POST', body:sf });
        if (sr.ok) {
          const sd: ScanResult = await sr.json();
          setScanResult(sd);
          if (sd.info?.layer_count) setTotalLayers(sd.info.layer_count);
        }
      } catch { /* silent */ }

      // Optimize
      const form = new FormData();
      form.append('file',                  file);
      form.append('printer_name',          activeProject?.printer?.name || 'Custom Printer');
      form.append('nozzle_diameter_mm',    String(nozzleMm));
      form.append('bead_compression',      String(beadComp));
      form.append('max_speed_mm_s',        String(maxSpd));
      form.append('min_speed_mm_s',        String(minSpd));
      form.append('max_mass_flow_l_min',   String(flowRate));
      form.append('hose_length_m',         String(hoseLen));
      form.append('hose_internal_diam_mm', String(hoseDiam));
      form.append('acceleration_mm_s2',    String(accel));
      form.append('cement_mix_name',       parameters.cementMix);
      form.append('temperature',           String(parameters.temperature));
      form.append('humidity',              String(parameters.humidity));
      form.append('wind_speed',            String(parameters.windSpeed));
      form.append('ground_slope',          '0');
      form.append('print_speed',           String(printSpeed));
      form.append('print_start_hour',      String(weatherStart));
      form.append('print_scale',           String(printScale));
      if (city) form.append('city', city);
      if (weatherBlocks.length > 0) form.append('weather_blocks', JSON.stringify(weatherBlocks));

      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), 20 * 60 * 1000);
      const res = await fetch(`${API}/optimize`, { method:'POST', body:form, signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) { const e = await res.json().catch(()=>({detail:'Unknown'})); throw new Error(e.detail); }
      const data: OptimizeResult = await res.json();
      setResult(data);
      if (data.geometry.num_layers > 0) setTotalLayers(data.geometry.num_layers);
      setPhase('done');
      setActiveTab('results');
      setSidebarPanel(scanResult && scanResult.counts.total > 0 ? 'scan' : 'results');
    } catch (e: any) {
      setErrorMsg(e.message || 'Optimisation failed');
      setPhase('error');
    } finally {
      clearInterval(ticker);
    }
  };

  const downloadGCode = (ext: 'gcode' | 'txt') => {
    if (!result) return;
    const content = result.gcode_full ?? result.gcode_preview ?? '';
    const blob = new Blob([content], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `autobuild_${result.result_id.slice(0, 8)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const beginPrint = () => {
    if (!activeProject || !result) return;
    updateProject(activeProject.id, {
      status:      'printing',
      totalLayers,
      printSpeed,
      report: {
        // existing
        generatedAt:    new Date().toISOString(),
        duration:       result.estimated_print_time ?? '—',
        totalLayers:    result.geometry.num_layers,
        layersPrinted:  0,
        errorsDetected: 0,
        errorRate:      '0%',
        alerts:         [],
        printerName:    activeProject.printer.name ?? '—',
        printerModel:   activeProject.printer.type ?? '—',
        structureType:  activeProject.structureType ?? '—',
        // new fields for report page
        printStartedAt:  new Date().toISOString(),
        materialName:    result.cement?.display_name ?? parameters.cementMix,
        batchNumber:     parameters.batchNumber || '—',
        gcodeLines:      result.gcode_lines,
        gcodeRef:        `autobuild_${result.result_id?.slice(0,8) ?? 'unknown'}.gcode`,
        totalSegments:   result.optimization.total_segments,
        layerHeight:     result.printer?.layer_height_mm ?? '—',
        nozzle:          result.printer?.nozzle_mm ?? '—',
        travelSaved:     result.optimization.time_saved_pct,
        computedIn:      result.elapsed_seconds,
        envRisk:         result.optimization.env_risk_score,
        conditions: {
          temperature: parameters.temperature,
          humidity:    parameters.humidity,
          windSpeed:   parameters.windSpeed,
        },
        events: [
          { time: new Date().toISOString(), label: 'Print started',        type: 'info' },
          { time: new Date().toISOString(), label: 'G-code sent to printer', type: 'info' },
        ],
      },
    });
    router.push('/live-monitoring');
  };

  // Slope always 0 — foundation handles it
  const resolvedSite: SiteDimensions = { ...site, slope: 0 };
  const isResults = activeTab === 'results' && !!result;
  const factors   = result ? buildFactors(result, parameters) : [];

  // Estimated finish time
  const estFinish = result?.estimated_print_time_s
    ? calcEstFinish(weatherStart, result.estimated_print_time_s)
    : null;

  const scanBadge = scanResult
    ? scanResult.counts.errors   > 0 ? { txt: String(scanResult.counts.errors),   cls:'bg-red-500'    }
    : scanResult.counts.warnings > 0 ? { txt: String(scanResult.counts.warnings), cls:'bg-amber-400'  }
    : { txt:'✓', cls:'bg-emerald-500' }
    : null;

  return (
    <div className={isResults ? 'fixed inset-0 overflow-hidden' : 'min-h-screen bg-gray-50 pb-24'}>
      {isResults && <style>{`footer{display:none!important}`}</style>}

      <AnimatePresence>
        {phase==='optimizing' && (
          <LoadingOverlay fileName={file?.name??''} onCancel={()=>{setPhase('idle');setStepIdx(0);}}/>
        )}
      </AnimatePresence>

      {/* ── RESULTS ── */}
      {isResults && result && (
        <motion.div className="absolute inset-0" initial={{opacity:0}} animate={{opacity:1}}>
          <LayerVisualization
            file={file} toolpath={result.toolpath}
            numLayers={result.geometry.num_layers} layerHeight={result.geometry.layer_height}
            nozzleDiameter={(result.printer?.nozzle_mm ?? 25) / 1000}
            site={resolvedSite} fullscreen
            externalMode={viewMode} onModeChange={setViewMode}
            modelScale={modelScale} sitePlan={sitePlanData}
            onBack={()=>setActiveTab('setup')}
            modelDimensions={result.geometry.bounds_x && result.geometry.bounds_z ? {
              x: result.geometry.bounds_x[1] - result.geometry.bounds_x[0],
              y: result.geometry.bounds_y[1] - result.geometry.bounds_y[0],
              z: result.geometry.total_height_m,
            } : undefined}
          />

          {/* Sidebar toggle */}
          <button onClick={()=>setShowSidebar(v=>!v)}
            className="absolute top-3 right-3 z-30 w-7 h-7 rounded-xl flex items-center justify-center transition-all hover:bg-white/10"
            style={{background:'rgba(0,0,0,0.28)',backdropFilter:'blur(10px)'}}>
            <svg className="w-3.5 h-3.5 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {showSidebar
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                : <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>}
            </svg>
          </button>

          {/* Glass sidebar */}
          <div className={`absolute top-10 right-3 bottom-3 z-20 w-[310px] flex flex-col transition-all duration-300 ${showSidebar?'opacity-100 translate-x-0':'opacity-0 translate-x-full pointer-events-none'}`}
            style={{filter:'drop-shadow(0 0 30px rgba(0,0,0,0.5))'}}>
            <div className="flex flex-col h-full rounded-2xl overflow-hidden border border-white/10"
              style={{background:'rgba(6,6,10,0.78)',backdropFilter:'blur(24px)'}}>

              {/* Tabs */}
              <div className="flex items-center border-b border-white/8 flex-shrink-0 px-3">
                {([
                  {id:'results' as SidebarPanel, label:'Results'},
                  {id:'layers'  as SidebarPanel, label:'Layers' },
                  {id:'changes' as SidebarPanel, label:'Changes'},
                  {id:'scan'    as SidebarPanel, label:'Scan'   },
                ]).map(panel=>(
                  <button key={panel.id} onClick={()=>setSidebarPanel(panel.id)}
                    className={`relative py-3 px-2 text-[11px] font-medium transition-all mr-1 ${
                      sidebarPanel===panel.id ? 'text-white' : 'text-white/30 hover:text-white/60'
                    }`}>
                    {panel.label}
                    {sidebarPanel===panel.id && (
                      <span className="absolute bottom-0 left-0 right-0 h-px bg-white rounded-full"/>
                    )}
                    {panel.id==='scan' && scanBadge && (
                      <span className={`absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 rounded-full text-[8px] font-bold text-white flex items-center justify-center ${scanBadge.cls}`}>
                        {scanBadge.txt}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-3">
                <AnimatePresence mode="wait">

                  {sidebarPanel==='results' && (
                    <motion.div key="res" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>

                      {/* Hero — print time */}
                      <div className="pt-1 pb-4 border-b border-white/8 mb-3">
                        <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1">Est. Print Time</p>
                        <p className="text-3xl font-bold text-white tracking-tight leading-none mb-1">{result.estimated_print_time ?? '—'}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-[10px] text-white/30">
                            Starts {weatherStart < 12 ? `${Math.floor(weatherStart)}:00 AM` : `${Math.floor(weatherStart)-12||12}:00 PM`}
                          </span>
                          {estFinish && (
                            <>
                              <span className="text-white/15">·</span>
                              <span className="text-[10px] text-white/50">Finish {estFinish}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Key stats — flat list */}
                      <div className="mb-3">
                        <StatRow label="Layers"         value={String(result.geometry.num_layers)}                            delay={0.04}/>
                        <StatRow label="Layer Height"   value={`${result.printer?.layer_height_mm ?? '—'} mm`}                delay={0.06}/>
                        <StatRow label="Nozzle"         value={`${result.printer?.nozzle_mm ?? '—'} mm`}                     delay={0.08}/>
                        <StatRow label="Print Speed"    value={`${result.printer?.effective_speed ?? printSpeed} mm/s`}       delay={0.10}/>
                        <StatRow label="Travel Saved"   value={`${result.optimization.time_saved_pct}%`} accent="text-emerald-400" delay={0.12}/>
                        <StatRow label="Total Segments" value={String(result.optimization.total_segments)}                    delay={0.14}/>
                        <StatRow label="G-code Lines"   value={String(result.gcode_lines)}                                    delay={0.16}/>
                        <StatRow label="Computed In"    value={`${result.elapsed_seconds}s`}                                  delay={0.18}/>
                      </div>

                      {/* Conditions */}
                      <div className="border-t border-white/6 pt-3 mb-3">
                        <p className="text-[10px] text-white/25 uppercase tracking-widest mb-2">Conditions</p>
                        <div className="space-y-0">
                          <StatRow label="Temperature"  value={`${parameters.temperature}°C`}  delay={0.20}/>
                          <StatRow label="Humidity"     value={`${parameters.humidity}%`}       delay={0.22}/>
                          <StatRow label="Wind"         value={`${parameters.windSpeed} km/h`}  delay={0.24}/>
                          <StatRow label="Env Risk"
                            value={`${result.optimization.env_risk_score}/100`}
                            accent={result.optimization.env_risk_score < 20 ? 'text-emerald-400' : result.optimization.env_risk_score < 50 ? 'text-amber-400' : 'text-red-400'}
                            delay={0.26}/>
                        </div>
                      </div>

                      {/* Model scale */}
                      <div className="border-t border-white/6 pt-3 mb-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] text-white/25 uppercase tracking-widest">Model Scale</p>
                          <span className="text-[11px] font-mono font-semibold text-white/60">{modelScale.toFixed(2)}×</span>
                        </div>
                        <input type="range" min={0.1} max={3.0} step={0.05} value={modelScale}
                          onChange={e=>setModelScale(Number(e.target.value))}
                          className="w-full accent-white h-px mb-1"/>
                        <div className="flex justify-between text-[9px] text-white/20 mt-1">
                          <span>0.1×</span><span>1×</span><span>3×</span>
                        </div>
                        {modelScale !== 1.0 && (
                          <button onClick={()=>setModelScale(1.0)}
                            className="mt-2 text-[10px] text-white/25 hover:text-white/50 transition-colors">
                            Reset to 1×
                          </button>
                        )}
                      </div>

                      {/* G-code preview */}
                      <div className="border-t border-white/6 pt-3">
                        <p className="text-[10px] text-white/25 uppercase tracking-widest mb-2">G-code Preview</p>
                        <pre className="text-[9px] text-white/35 font-mono leading-relaxed overflow-x-auto max-h-20 scrollbar-none">{result.gcode_preview}</pre>
                      </div>

                    </motion.div>
                  )}

                  {sidebarPanel==='layers' && (
                    <motion.div key="layers" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="space-y-2">
                      {(result.layer_stats??[]).length > 0 && (() => {
                        const stats  = result.layer_stats!;
                        const speeds = stats.map(ls => ls.print_speed_mm_s);
                        const minS   = Math.min(...speeds);
                        const maxS   = Math.max(...speeds);
                        const tempColor = (t: number) => {
                          if (t < 15) return '#60a5fa';
                          if (t <= 25) return '#e5e5e5';
                          if (t <= 30) return '#fbbf24';
                          return '#f87171';
                        };
                        return (
                          <div className="rounded-xl border border-white/8 p-3" style={{background:'rgba(255,255,255,0.04)'}}>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[9px] text-white/40 uppercase tracking-wider">Speed profile</span>
                              <span className="text-[9px] font-mono text-white/25">{minS}–{maxS} mm/s</span>
                            </div>
                            <div className="flex items-end gap-px h-16 w-full overflow-hidden rounded-lg">
                              {stats.map((ls, i) => {
                                const h  = maxS === minS ? 50 : ((ls.print_speed_mm_s - minS) / (maxS - minS)) * 100;
                                const cl = tempColor(ls.temperature_c ?? 20);
                                return (
                                  <div key={i} className="flex-1 flex flex-col justify-end group relative">
                                    <div className="rounded-sm transition-opacity group-hover:opacity-100 opacity-80"
                                      style={{ height: `${Math.max(8, h)}%`, background: cl }}/>
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                                      <div className="rounded-lg px-2 py-1 text-[8px] font-mono text-white whitespace-nowrap"
                                        style={{background:'rgba(0,0,0,0.85)'}}>
                                        L{ls.layer+1} · {ls.print_speed_mm_s}mm/s · {ls.temperature_c??'—'}°C
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="flex items-center gap-3 mt-2">
                              {[{color:'#60a5fa',label:'< 15°C'},{color:'#e5e5e5',label:'15–25°C'},{color:'#fbbf24',label:'25–30°C'},{color:'#f87171',label:'> 30°C'}].map(l => (
                                <div key={l.label} className="flex items-center gap-1">
                                  <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{background:l.color}}/>
                                  <span className="text-[8px] text-white/25">{l.label}</span>
                                </div>
                              ))}
                            </div>
                            <div className="flex justify-between mt-1.5">
                              <span className="text-[8px] text-white/15 font-mono">Layer 1</span>
                              <span className="text-[8px] text-white/15 font-mono">Layer {stats.length}</span>
                            </div>
                          </div>
                        );
                      })()}

                      <p className="text-[9px] text-white/25 uppercase tracking-wider pt-1">Per-layer detail</p>
                      {(result.layer_stats??[]).map((ls,i)=>{
                        const layerTimeSec = ls.print_speed_mm_s > 0 ? ls.perimeter_mm / ls.print_speed_mm_s : 0;
                        const layerTimeStr = layerTimeSec < 60 ? `${Math.round(layerTimeSec)}s` : `${Math.floor(layerTimeSec/60)}m ${Math.round(layerTimeSec%60)}s`;
                        const temp = ls.temperature_c ?? '—';
                        const tempColor =
                          typeof temp === 'number' && temp > 30 ? 'text-red-400'
                          : typeof temp === 'number' && temp > 25 ? 'text-amber-300'
                          : typeof temp === 'number' && temp < 15 ? 'text-blue-400'
                          : 'text-white/60';
                        return (
                          <motion.div key={i} initial={{opacity:0,x:8}} animate={{opacity:1,x:0}} transition={{delay:i*0.008}}
                            className="rounded-xl p-2.5 border border-white/5 bg-white/4 hover:bg-white/6 transition-colors">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-bold text-white">Layer {ls.layer+1}</span>
                              <span className="text-[9px] font-mono text-white/30">{ls.z_height_mm}mm</span>
                            </div>
                            <div className="grid grid-cols-3 gap-1 mb-2">
                              <div className="rounded-lg px-2 py-1.5 border border-white/6 bg-white/3 text-center">
                                <p className="text-[8px] text-white/25 mb-0.5">Est. time</p>
                                <p className="text-[10px] font-bold font-mono text-white">{layerTimeStr}</p>
                              </div>
                              <div className="rounded-lg px-2 py-1.5 border border-white/6 bg-white/3 text-center">
                                <p className="text-[8px] text-white/25 mb-0.5">Temp</p>
                                <p className={`text-[10px] font-bold font-mono ${tempColor}`}>{typeof temp === 'number' ? `${temp}°C` : '—'}</p>
                              </div>
                              <div className="rounded-lg px-2 py-1.5 border border-white/6 bg-white/3 text-center">
                                <p className="text-[8px] text-white/25 mb-0.5">Speed</p>
                                <p className="text-[10px] font-bold font-mono text-white">{ls.print_speed_mm_s}<span className="text-[7px] text-white/30">mm/s</span></p>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                              {[['Segments',String(ls.segments)],['Perimeter',`${ls.perimeter_mm}mm`],['Area',`${ls.area_cm2}cm²`],['Risk',`${ls.risk_score}/100`]].map(([l,v])=>(
                                <div key={l} className="flex justify-between">
                                  <span className="text-[9px] text-white/25">{l}</span>
                                  <span className="text-[9px] font-mono text-white/60">{v}</span>
                                </div>
                              ))}
                            </div>
                            <div className="mt-1.5 h-0.5 bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{width:`${ls.risk_score}%`,background:ls.risk_score<20?'#22c55e':ls.risk_score<50?'#f59e0b':'#ef4444'}}/>
                            </div>
                          </motion.div>
                        );
                      })}
                      {(!result.layer_stats||result.layer_stats.length===0)&&(
                        <p className="text-[11px] text-white/30 text-center py-8">No layer data available</p>
                      )}
                    </motion.div>
                  )}

                  {sidebarPanel==='changes' && (
                    <motion.div key="chg" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="space-y-2">
                      {factors.map((f,i)=><FactorRow key={i} {...f} delay={i*0.05}/>)}
                    </motion.div>
                  )}

                  {sidebarPanel==='scan' && (
                    <motion.div key="scan" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="space-y-2">
                      {scanResult ? (
                        <>
                          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/8 bg-white/4 mb-1">
                            <div className="relative flex-shrink-0 w-10 h-10">
                              <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                                <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3"/>
                                <circle cx="18" cy="18" r="14" fill="none"
                                  stroke={scanResult.verdict==='ready'?'#10b981':scanResult.verdict==='caution'?'#fbbf24':'#ef4444'}
                                  strokeWidth="3" strokeDasharray={`${(scanResult.score/100)*87.96} 87.96`} strokeLinecap="round"/>
                              </svg>
                              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white">{scanResult.score}</span>
                            </div>
                            <div>
                              <p className={`text-[11px] font-bold ${scanResult.verdict==='ready'?'text-emerald-400':scanResult.verdict==='caution'?'text-amber-300':'text-red-400'}`}>
                                {scanResult.verdict==='ready'?'Printable':scanResult.verdict==='caution'?'Review required':'Issues found'}
                              </p>
                              <p className="text-[9px] text-white/30 mt-0.5">{scanResult.verdict_msg}</p>
                            </div>
                          </div>
                          {scanResult.info?.dimensions_m && (
                            <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 pb-1">
                              {[
                                ['W',`${(scanResult.info.dimensions_m.width*1000).toFixed(0)}mm`],
                                ['D',`${(scanResult.info.dimensions_m.depth*1000).toFixed(0)}mm`],
                                ['H',`${(scanResult.info.dimensions_m.height*1000).toFixed(0)}mm`],
                                ['Layers',String(scanResult.info.layer_count??'—')],
                                ...(scanResult.info.gap_events?[['Gaps',String(scanResult.info.gap_events)]]:[] as any),
                                ...(scanResult.info.min_wall_thickness_mm!=null?[['Min wall',`${scanResult.info.min_wall_thickness_mm}mm`]]:[] as any),
                              ].map(([l,v])=>(
                                <span key={l} className="text-[9px] font-mono text-white/25">
                                  <span className="text-white/15">{l} </span>{v}
                                </span>
                              ))}
                            </div>
                          )}
                          {scanResult.issues.length > 0
                            ? scanResult.issues.map((issue,i)=><ScanIssueRow key={issue.id} issue={issue} delay={i*0.04}/>)
                            : <p className="text-[11px] text-white/30 text-center py-6">No issues found</p>
                          }
                        </>
                      ) : (
                        <p className="text-[11px] text-white/25 text-center py-8">Scan data unavailable</p>
                      )}
                    </motion.div>
                  )}

                </AnimatePresence>
              </div>

              {/* Actions */}
              <div className="px-4 pb-4 pt-3 border-t border-white/8 flex-shrink-0 space-y-2">
                <div className="relative group">
                  <button className="w-full py-2.5 text-xs font-medium rounded-xl border border-white/10 text-white/40 hover:text-white hover:border-white/25 transition-all">
                    Download G-code ↓
                  </button>
                  <div className="absolute bottom-full left-0 right-0 mb-1 hidden group-hover:flex flex-col gap-1 z-50">
                    <button onClick={()=>downloadGCode('gcode')}
                      className="w-full py-2 text-xs font-medium rounded-xl border border-white/15 text-white bg-black/90 hover:bg-white/10 transition-all backdrop-blur-md">
                      Download .gcode
                    </button>
                    <button onClick={()=>downloadGCode('txt')}
                      className="w-full py-2 text-xs font-medium rounded-xl border border-white/15 text-white bg-black/90 hover:bg-white/10 transition-all backdrop-blur-md">
                      Download .txt
                    </button>
                  </div>
                </div>
                {showConfirm ? (
                  <div className="flex gap-2">
                    <button onClick={beginPrint} className="flex-1 py-2.5 bg-white text-black text-xs font-semibold rounded-xl hover:bg-white/90 transition-colors">Confirm</button>
                    <button onClick={()=>setShowConfirm(false)} className="flex-1 py-2.5 border border-white/10 text-white/40 text-xs rounded-xl hover:text-white transition-colors">Cancel</button>
                  </div>
                ) : (
                  <button onClick={()=>setShowConfirm(true)}
                    className="w-full py-2.5 bg-white text-black text-xs font-semibold rounded-xl hover:bg-white/90 transition-colors">
                    Begin Print
                  </button>
                )}
                <p className="text-[9px] text-white/15 font-mono text-center pt-1">
                  {result.geometry.num_layers} layers · {result.estimated_print_time} · {resolvedSite.width}m × {resolvedSite.length}m
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── SETUP ── */}
      {!isResults && (
        <motion.div initial={{opacity:0}} animate={{opacity:1}}>
          <AppNav currentStep="pre-print"/>
          <div className="bg-white border-b border-gray-100 sticky top-14 z-10">
            <div className="max-w-7xl mx-auto px-6">
              <div className="flex items-center gap-1 py-2">
                <button className="px-4 py-2 text-sm font-medium rounded-xl bg-black text-white">Setup</button>
                <button onClick={()=>phase==='done'&&setActiveTab('results')} disabled={phase!=='done'}
                  className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${phase==='done'?'text-black/50 hover:text-black hover:bg-gray-100':'text-black/20 cursor-not-allowed'}`}>
                  Results
                  {phase==='done'&&<span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">Ready</span>}
                </button>
                <div className="flex-1"/>
                <button onClick={handleOptimize} disabled={!file||phase==='optimizing'}
                  className="px-5 py-2 bg-black text-white text-sm font-semibold rounded-xl hover:bg-black/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  Optimise Print Path
                </button>
              </div>
            </div>
          </div>

          {phase==='error'&&(
            <div className="max-w-7xl mx-auto px-6 pt-6">
              <div className="bg-white border border-red-100 rounded-2xl p-5 flex items-center justify-between mb-6">
                <div><p className="text-sm font-semibold text-black">Optimisation failed</p><p className="text-xs text-black/40 mt-0.5">{errorMsg}</p></div>
                <button onClick={()=>setPhase('idle')} className="px-4 py-2 bg-black text-white text-xs font-semibold rounded-xl">Try again</button>
              </div>
            </div>
          )}

          <div className="max-w-7xl mx-auto px-6 py-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <FileUpload
                  file={file} onFileChange={setFile}
                  onScaleChange={setPrintScale}
                />
                <ParameterInputs parameters={parameters} onChange={handleParamsChange}
                  onWeatherChange={(b,h)=>{setWeatherBlocks(b);setWeatherStart(h);}}
                  onCementChange={(c:string)=>setParameters(p=>({...p,cementMix:c}))}
                  onCityChange={setCity}
                  onStartHourChange={(h)=>setWeatherStart(h)}
                />
              </div>
              <div>
                <LayerVisualization file={file} toolpath={[]} numLayers={0}
                  layerHeight={0.04} site={resolvedSite} modelScale={modelScale} sitePlan={sitePlanData}/>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}