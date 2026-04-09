'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useProjects } from '@/lib/project-store';
import AppNav from '@/components/AppNav';
import ParameterInputs from './components/ParameterInputs';
import FileUpload, { SiteDimensions } from './components/FileUpload';
import LayerVisualization from './components/LayerVisualization';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type Phase        = 'idle' | 'optimizing' | 'done' | 'error';
type ActiveTab    = 'setup' | 'results';
type SidebarPanel = 'results' | 'changes' | 'layers';
type ViewMode     = 'environment' | 'void-dark' | 'void-light';

interface CementInfo   { display_name: string; open_time_min: number; risk_score: number; }
interface PrinterInfo  { name: string; nozzle_mm: number; layer_height_mm: number; effective_speed: number; mix_compatible: boolean; }
interface WeatherInfo  { blocks_used: number; avg_conditions: Record<string,number>; worst_block: Record<string,number>; }
interface OptInfo      { time_saved_pct: number; env_risk_score: number; total_travel_mm: number; naive_travel_mm: number; total_segments: number; }
interface GeoInfo      { num_layers: number; layer_height: number; total_segments: number; file_name: string; total_height_m: number; bounds_x: [number,number]; bounds_y: [number,number]; bounds_z: [number,number]; }

interface LayerStat {
  layer: number; z_height_mm: number; segments: number;
  perimeter_mm: number; area_cm2: number; complexity: number;
  print_speed_mm_s: number; risk_score: number;
}

interface OptimizeResult {
  result_id: string; elapsed_seconds: number;
  geometry:  GeoInfo;
  printer?:  PrinterInfo;
  cement?:   CementInfo;
  weather?:  WeatherInfo;
  optimization: OptInfo;
  toolpath: { x0: number; y0: number; x1: number; y1: number }[][];
  gcode_lines: number; gcode_preview: string;
  layer_stats?: LayerStat[];
  estimated_print_time?: string;
}

interface WeatherBlock { id: string; start_hour: number; end_hour: number; temperature: number; humidity: number; wind_speed: number; ground_slope: number; notes: string; }
interface Parameters   { temperature: number; humidity: number; windSpeed: number; groundSlope: number; cementMix: string; batchNumber: string; }

function fmtTime(m: number): string {
  if (m < 1)  return `${Math.round(m * 60)}s`;
  if (m < 60) return `${Math.round(m)} min`;
  return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
}

function calcEstTime(r: OptimizeResult, speed: number): string {
  const s = r.printer?.effective_speed ?? speed;
  return fmtTime(Math.max(r.optimization.total_travel_mm / s / 60 + (r.geometry.num_layers * 2) / 60, 1));
}

// ── Build factors — properly typed ───────────────────────────────────────────

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

  const slope = (avg['ground_slope'] ?? params.groundSlope) as number;
  if (slope > 5) factors.push({ label:'Steep Slope', value:`${slope}°`, impact:'Sequence starts uphill to prevent fresh bead drift', ok:false });
  else if (slope > 2) factors.push({ label:'Ground Slope', value:`${slope}°`, impact:'Mild slope — start position adjusted for bead stability', ok:false });
  else factors.push({ label:'Ground', value:`${slope}° slope`, impact:'Level site — no topographic compensation required', ok:true });

  const openTime   = cement.open_time_min ?? 45;
  const riskScore  = cement.risk_score    ?? 0;
  const cementName = cement.display_name  ?? params.cementMix;
  factors.push({
    label: cementName,
    value: `${openTime} min open time`,
    impact: `Risk ${riskScore}/100 — ${riskScore < 20 ? 'low risk under current conditions' : 'speed adjusted to compensate'}`,
    ok: riskScore < 20,
  });

  if ((opt.time_saved_pct ?? 0) > 0) {
    factors.push({
      label: 'RL Travel Optimisation',
      value: `${opt.time_saved_pct}% saved`,
      impact: `Travel reduced from ${opt.naive_travel_mm}mm to ${opt.total_travel_mm}mm`,
      ok: true,
    });
  }

  if ((result.weather?.blocks_used ?? 0) > 1) {
    factors.push({
      label: 'Time-Based Weather',
      value: `${result.weather!.blocks_used} blocks`,
      impact: 'Print speed varied dynamically across time windows',
      ok: true,
    });
  }

  return factors;
}

// ── Particle field ────────────────────────────────────────────────────────────

function ParticleField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d')!; let id: number;
    const resize = () => { c.width = window.innerWidth; c.height = window.innerHeight; };
    resize(); window.addEventListener('resize', resize);
    const pts = Array.from({length:55}, () => ({
      x:Math.random()*c.width, y:Math.random()*c.height,
      vx:(Math.random()-0.5)*0.35, vy:(Math.random()-0.5)*0.35,
      r:Math.random()*1.4+0.3, a:Math.random()*0.35+0.05,
    }));
    const draw = () => {
      ctx.clearRect(0,0,c.width,c.height);
      pts.forEach(p => {
        p.x+=p.vx; p.y+=p.vy;
        if(p.x<0)p.x=c.width; if(p.x>c.width)p.x=0;
        if(p.y<0)p.y=c.height; if(p.y>c.height)p.y=0;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
        ctx.fillStyle=`rgba(255,255,255,${p.a})`; ctx.fill();
      });
      for(let i=0;i<pts.length;i++) for(let j=i+1;j<pts.length;j++){
        const dx=pts[i].x-pts[j].x,dy=pts[i].y-pts[j].y,d=Math.sqrt(dx*dx+dy*dy);
        if(d<110){ctx.beginPath();ctx.moveTo(pts[i].x,pts[i].y);ctx.lineTo(pts[j].x,pts[j].y);ctx.strokeStyle=`rgba(255,255,255,${0.05*(1-d/110)})`;ctx.lineWidth=0.5;ctx.stroke();}
      }
      id=requestAnimationFrame(draw);
    };
    draw();
    return ()=>{cancelAnimationFrame(id);window.removeEventListener('resize',resize);};
  },[]);
  return <canvas ref={ref} className="absolute inset-0 w-full h-full"/>;
}

// ── Loading overlay ───────────────────────────────────────────────────────────

const STEPS = [
  { label:'Parsing 3D geometry',         detail:'Reading STL/OBJ mesh · computing bounds' },
  { label:'Slicing into layers',          detail:'Generating printable segments per layer' },
  { label:'Initialising RL agent',        detail:'Loading trained PPO policy' },
  { label:'Running agent on each layer',  detail:'Selecting optimal segment order' },
  { label:'Adapting to conditions',       detail:'Temperature · humidity · wind · slope' },
  { label:'Generating G-code',           detail:'Converting toolpath to printer commands' },
];

function LoadingOverlay({ fileName, onCancel }: { fileName:string; onCancel:()=>void }) {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setPct(p => Math.min(p + Math.random() * 12, 95));
    }, 1400);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0,transition:{duration:0.3}}}
      className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center">

      <div className="flex flex-col items-center w-full max-w-xs px-8">
        {/* Pulsing dot */}
        <motion.div className="w-3 h-3 rounded-full bg-white mb-10"
          animate={{opacity:[1,0.2,1]}} transition={{duration:1.4,repeat:Infinity}}/>

        <p className="text-white text-lg font-semibold tracking-tight mb-1">Optimizing...</p>
        <p className="text-white/30 text-[11px] font-mono mb-8 truncate max-w-full text-center">{fileName}</p>

        {/* Progress bar */}
        <div className="w-full h-0.5 bg-white/10 rounded-full overflow-hidden mb-2">
          <motion.div className="h-full bg-white rounded-full"
            animate={{width:`${pct}%`}} transition={{duration:0.9,ease:'easeOut'}}/>
        </div>
        <p className="text-white/25 text-[10px] font-mono self-end">{Math.round(pct)}%</p>

        <button onClick={onCancel}
          className="mt-12 text-white/15 hover:text-white/40 text-[10px] transition-colors tracking-widest uppercase">
          Cancel
        </button>
      </div>
    </motion.div>
  );
}

// ── Stat row ──────────────────────────────────────────────────────────────────

function StatRow({ label, value, highlight, delay=0 }: { label:string; value:string; highlight?:boolean; delay?:number }) {
  return (
    <motion.div initial={{opacity:0,x:10}} animate={{opacity:1,x:0}} transition={{delay,duration:0.3}}
      className={`flex items-center justify-between px-3 py-2.5 rounded-xl border ${
        highlight?'bg-white/15 border-white/20':'bg-white/5 hover:bg-white/8 border-white/5'
      }`}>
      <span className={`text-[11px] ${highlight?'text-white/70':'text-white/40'}`}>{label}</span>
      <span className={`text-[12px] font-bold font-mono ${highlight?'text-white':'text-white/80'}`}>{value}</span>
    </motion.div>
  );
}

function FactorRow({ label, value, impact, ok, delay=0 }: { label:string; value:string; impact:string; ok:boolean; delay?:number }) {
  return (
    <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{delay,duration:0.3}}
      className={`rounded-xl p-3 border ${ok?'border-white/8 bg-white/5':'border-amber-400/20 bg-amber-400/8'}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${ok?'bg-emerald-400':'bg-amber-400'}`}/>
          <span className="text-[11px] font-semibold text-white">{label}</span>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ok?'bg-emerald-400/15 text-emerald-300':'bg-amber-400/15 text-amber-300'}`}>{value}</span>
      </div>
      <p className="text-[10px] text-white/35 leading-relaxed pl-3.5">{impact}</p>
    </motion.div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function PrePrintOptimizer() {
  const router = useRouter();
  const { activeProject, updateProject } = useProjects();

  const [activeTab,     setActiveTab]     = useState<ActiveTab>('setup');
  const [sidebarPanel,  setSidebarPanel]  = useState<SidebarPanel>('results');
  const [viewMode,      setViewMode]      = useState<ViewMode>('environment');
  const [modelScale,    setModelScale]    = useState(1.0);
  const [file,          setFile]          = useState<File | null>(null);
  const [sitePlanData,  setSitePlanData]  = useState<import('./components/SitePlanReader').SitePlanData | null>(null);
  const [site,          setSite]          = useState<SiteDimensions>({ width:12, length:10, slope:0 });
  const [parameters,    setParameters]    = useState<Parameters>({ temperature:24, humidity:65, windSpeed:8, groundSlope:2, cementMix:'standard', batchNumber:'' });
  const [weatherBlocks, setWeatherBlocks] = useState<WeatherBlock[]>([]);
  const [weatherStart,  setWeatherStart]  = useState(8.0);
  const [city,          setCity]          = useState('');
  const [phase,         setPhase]         = useState<Phase>('idle');
  const [result,        setResult]        = useState<OptimizeResult | null>(null);
  const [errorMsg,      setErrorMsg]      = useState('');
  const [totalLayers,   setTotalLayers]   = useState(activeProject?.totalLayers || 100);
  const [printSpeed,    setPrintSpeed]    = useState(activeProject?.printSpeed  || 60);
  const [showConfirm,   setShowConfirm]   = useState(false);
  const [stepIdx,       setStepIdx]       = useState(0);

  const handleParamsChange = (p: Parameters) => {
    setParameters(p);
    setSite(s => ({ ...s, slope: p.groundSlope }));
  };

  const handleOptimize = async () => {
    if (!file) return;
    setPhase('optimizing'); setErrorMsg(''); setStepIdx(0);
    const ticker = setInterval(() => setStepIdx(i => Math.min(i+1, STEPS.length-1)), 950);
    try {
      const form = new FormData();
      form.append('file',             file);
      form.append('printer_name',     activeProject?.printer.name || 'COBOD BOD2');
      form.append('cement_mix_name',  parameters.cementMix);
      form.append('temperature',      String(parameters.temperature));
      form.append('humidity',         String(parameters.humidity));
      form.append('wind_speed',       String(parameters.windSpeed));
      form.append('ground_slope',     String(parameters.groundSlope));
      form.append('print_speed',      String(printSpeed));
      form.append('print_start_hour', String(weatherStart));
      form.append('max_layers',       '150');  // cap for 3D viewer performance
      if (city) form.append('city', city);
      if (weatherBlocks.length > 0) form.append('weather_blocks', JSON.stringify(weatherBlocks));

      const res = await fetch(`${API}/optimize`, { method:'POST', body:form });
      if (!res.ok) { const e = await res.json().catch(()=>({detail:'Unknown'})); throw new Error(e.detail); }
      const data: OptimizeResult = await res.json();
      setResult(data);
      if (data.geometry.num_layers > 0) setTotalLayers(data.geometry.num_layers);
      setPhase('done'); setActiveTab('results');
    } catch (e: any) {
      setErrorMsg(e.message || 'Optimisation failed');
      setPhase('error');
    } finally {
      clearInterval(ticker);
    }
  };

  const downloadGCode = async () => {
    if (!result) return;
    const t = await (await fetch(`${API}/gcode/${result.result_id}`)).text();
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([t], {type:'text/plain'})),
      download: `autobuild_${result.result_id.slice(0,8)}.gcode`,
    });
    a.click();
  };

  const beginPrint = () => {
    if (!activeProject) return;
    updateProject(activeProject.id, { status:'printing', totalLayers, printSpeed });
    router.push('/live-monitoring');
  };

  const resolvedSite: SiteDimensions = { ...site, slope: parameters.groundSlope };
  const isResults = activeTab === 'results' && !!result;
  const estTime   = result ? calcEstTime(result, printSpeed) : null;
  const factors   = result ? buildFactors(result, parameters) : [];

  return (
    <div className={isResults ? 'fixed inset-0 overflow-hidden' : 'min-h-screen bg-gray-50 pb-24'}>
      {isResults && (
        <style>{`footer { display: none !important; }`}</style>
      )}

      <AnimatePresence>
        {phase === 'optimizing' && (
          <LoadingOverlay fileName={file?.name??''} onCancel={()=>{setPhase('idle');setStepIdx(0);}}/>
        )}
      </AnimatePresence>

      {/* ── RESULTS — full viewport ── */}
      {isResults && result && (
        <motion.div className="absolute inset-0" initial={{opacity:0}} animate={{opacity:1}}>

          {/* 3D canvas */}
          <LayerVisualization
            file={file}
            toolpath={result.toolpath}
            numLayers={result.geometry.num_layers}
            layerHeight={result.geometry.layer_height}
            site={resolvedSite} fullscreen
            externalMode={viewMode} onModeChange={setViewMode}
            modelScale={modelScale}
            sitePlan={sitePlanData}
            modelDimensions={result.geometry.bounds_x && result.geometry.bounds_z ? {
              x: result.geometry.bounds_x[1] - result.geometry.bounds_x[0],
              y: result.geometry.bounds_y[1] - result.geometry.bounds_y[0],
              z: result.geometry.total_height_m,
            } : undefined}
          />

          {/* ── Thin floating header — does NOT block canvas ── */}
          <div className="absolute top-0 left-0 right-0 z-30 flex items-center px-4 py-1.5 gap-2"
            style={{background:'linear-gradient(to bottom,rgba(0,0,0,0.55) 0%,transparent 100%)'}}>
            <button onClick={()=>setActiveTab('setup')}
              className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-white/50 hover:text-white transition-colors rounded-lg hover:bg-white/8">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
              Setup
            </button>
            <div className="w-px h-3 bg-white/15"/>
            <span className="text-xs font-semibold text-white px-2 py-1 rounded-lg bg-white/10 border border-white/10">
              Results
            </span>
            <div className="flex-1"/>
            <span className="text-[10px] text-white/25 font-mono hidden sm:block">{file?.name}</span>
          </div>

          {/* ── Glass panel — right, starts just below thin header ── */}
          <div className="absolute top-10 right-3 bottom-3 z-20 w-[310px] flex flex-col"
            style={{filter:'drop-shadow(0 0 30px rgba(0,0,0,0.5))'}}>
            <div className="flex flex-col h-full rounded-2xl overflow-hidden border border-white/10"
              style={{background:'rgba(6,6,10,0.78)',backdropFilter:'blur(24px)'}}>

              {/* Panel tabs */}
              <div className="flex items-center p-1.5 gap-1 border-b border-white/8 flex-shrink-0">
                {([
                  {id:'results' as SidebarPanel, label:'Results'},
                  {id:'layers'  as SidebarPanel, label:'Layers'},
                  {id:'changes' as SidebarPanel, label:'Changes'},
                ]).map(panel=>(
                  <button key={panel.id} onClick={()=>setSidebarPanel(panel.id)}
                    className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${
                      sidebarPanel===panel.id
                        ?'bg-white/12 text-white border border-white/10'
                        :'text-white/35 hover:text-white/70'
                    }`}>
                    {panel.label}
                  </button>
                ))}
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto p-3">
                <AnimatePresence mode="wait">

                  {sidebarPanel==='results' && (
                    <motion.div key="res" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="space-y-1.5">
                      <StatRow label="Est. Print Time"   value={result.estimated_print_time??estTime??'—'}        highlight delay={0.00}/>
                      <StatRow label="Layers"            value={String(result.geometry.num_layers)}              delay={0.03}/>
                      <StatRow label="Layer Height"      value={`${result.printer?.layer_height_mm??'—'} mm`}   delay={0.06}/>
                      <StatRow label="Nozzle"            value={`${result.printer?.nozzle_mm??'—'} mm`}         delay={0.09}/>
                      <StatRow label="Total Segments"    value={String(result.optimization.total_segments)}      delay={0.12}/>
                      <StatRow label="Travel Saved"      value={`${result.optimization.time_saved_pct}%`}       delay={0.15}/>
                      <StatRow label="Env Risk"          value={`${result.optimization.env_risk_score}/100`}    delay={0.18}/>
                      <StatRow label="Print Speed"       value={`${result.printer?.effective_speed??printSpeed} mm/s`} delay={0.21}/>
                      <StatRow label="G-code Lines"      value={String(result.gcode_lines)}                     delay={0.24}/>
                      <StatRow label="Computed In"       value={`${result.elapsed_seconds}s`}                   delay={0.27}/>

                      {/* Model scale slider */}
                      <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.30}}
                        className="rounded-xl p-3 border border-white/8 mt-2"
                        style={{background:'rgba(255,255,255,0.04)'}}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[11px] text-white/50">Model Scale</span>
                          <span className="text-[11px] font-mono font-bold text-white">{modelScale.toFixed(2)}×</span>
                        </div>
                        <input type="range" min={0.1} max={3.0} step={0.05} value={modelScale}
                          onChange={e=>setModelScale(Number(e.target.value))}
                          className="w-full accent-white mb-1"/>
                        <div className="flex justify-between text-[9px] text-white/20">
                          <span>0.1×</span><span>1×</span><span>3×</span>
                        </div>
                        <button onClick={()=>setModelScale(1.0)}
                          className="w-full mt-2 py-1 text-[10px] text-white/30 hover:text-white/60 border border-white/8 rounded-lg transition-colors">
                          Reset to 1×
                        </button>
                      </motion.div>

                      {/* G-code preview */}
                      <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.34}}
                        className="rounded-xl p-3 border border-white/6"
                        style={{background:'rgba(255,255,255,0.04)'}}>
                        <p className="text-[9px] text-white/25 uppercase tracking-wider mb-1.5">G-code preview</p>
                        <pre className="text-[9px] text-white/40 font-mono leading-relaxed overflow-x-auto max-h-20">{result.gcode_preview}</pre>
                      </motion.div>
                    </motion.div>
                  )}

                  {sidebarPanel==='layers' && (
                    <motion.div key="layers" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="space-y-1.5">
                      <p className="text-[9px] text-white/25 uppercase tracking-wider mb-2">Per-Layer Statistics</p>
                      {(result.layer_stats ?? []).map((ls, i) => (
                        <motion.div key={i}
                          initial={{opacity:0, x:8}} animate={{opacity:1, x:0}}
                          transition={{delay: i * 0.01}}
                          className="rounded-xl p-2.5 border border-white/5 bg-white/4 hover:bg-white/6 transition-colors">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-bold text-white">Layer {ls.layer + 1}</span>
                            <span className="text-[9px] font-mono text-white/30">{ls.z_height_mm} mm</span>
                          </div>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                            {[
                              ['Segments',  String(ls.segments)],
                              ['Perimeter', `${ls.perimeter_mm} mm`],
                              ['Area',      `${ls.area_cm2} cm²`],
                              ['Speed',     `${ls.print_speed_mm_s} mm/s`],
                              ['Risk',      `${ls.risk_score}/100`],
                              ['Complexity',`${Math.round(ls.complexity * 100)}%`],
                            ].map(([label, value]) => (
                              <div key={label} className="flex justify-between">
                                <span className="text-[9px] text-white/25">{label}</span>
                                <span className="text-[9px] font-mono text-white/60">{value}</span>
                              </div>
                            ))}
                          </div>
                          {/* Risk bar */}
                          <div className="mt-1.5 h-0.5 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all"
                              style={{
                                width: `${ls.risk_score}%`,
                                background: ls.risk_score < 20 ? '#22c55e' : ls.risk_score < 50 ? '#f59e0b' : '#ef4444'
                              }}/>
                          </div>
                        </motion.div>
                      ))}
                      {(!result.layer_stats || result.layer_stats.length === 0) && (
                        <p className="text-[11px] text-white/30 text-center py-8">No layer data available</p>
                      )}
                    </motion.div>
                  )}

                  {sidebarPanel==='changes' && (
                    <motion.div key="chg" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="space-y-2">
                      {factors.map((f,i)=>(
                        <FactorRow key={i} {...f} delay={i*0.05}/>
                      ))}
                    </motion.div>
                  )}

                </AnimatePresence>
              </div>

              {/* Actions */}
              <div className="p-3 border-t border-white/8 flex-shrink-0 space-y-2">
                <button onClick={downloadGCode}
                  className="w-full py-2.5 text-xs font-semibold rounded-xl border border-white/15 text-white/60 hover:text-white hover:border-white/30 hover:bg-white/5 transition-all">
                  Download G-code
                </button>
                <AnimatePresence mode="wait">
                  {showConfirm ? (
                    <motion.div key="c" initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="flex gap-2">
                      <button onClick={beginPrint}
                        className="flex-1 py-2.5 bg-emerald-500 text-white text-xs font-semibold rounded-xl hover:bg-emerald-400 transition-colors">
                        Confirm
                      </button>
                      <button onClick={()=>setShowConfirm(false)}
                        className="flex-1 py-2.5 border border-white/12 text-white/50 text-xs font-semibold rounded-xl hover:text-white transition-colors">
                        Cancel
                      </button>
                    </motion.div>
                  ) : (
                    <motion.button key="b" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
                      onClick={()=>setShowConfirm(true)}
                      className="w-full py-2.5 bg-white text-black text-xs font-semibold rounded-xl hover:bg-white/90 transition-colors">
                      Begin Print
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>

              {/* Footer */}
              <div className="px-3 py-2 border-t border-white/5 flex-shrink-0">
                <p className="text-[9px] text-white/20 font-mono">
                  {result.geometry.num_layers} layers · {estTime} · {resolvedSite.width}m × {resolvedSite.length}m
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── SETUP TAB ── */}
      {!isResults && (
        <motion.div initial={{opacity:0}} animate={{opacity:1}}>
          <AppNav currentStep="pre-print"/>
          <div className="bg-white border-b border-gray-100 sticky top-14 z-10">
            <div className="max-w-7xl mx-auto px-6">
              <div className="flex items-center gap-1 py-2">
                <button className="px-4 py-2 text-sm font-medium rounded-xl bg-black text-white">Setup</button>
                <button onClick={()=>phase==='done'&&setActiveTab('results')} disabled={phase!=='done'}
                  className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${
                    phase==='done'?'text-black/50 hover:text-black hover:bg-gray-100':'text-black/20 cursor-not-allowed'
                  }`}>
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
                <FileUpload file={file} onFileChange={setFile} onSiteChange={setSite} onSitePlanParsed={setSitePlanData}/>
                <ParameterInputs parameters={parameters} onChange={handleParamsChange}
                  onWeatherChange={(b,h)=>{setWeatherBlocks(b);setWeatherStart(h);}}
                  onCementChange={(c:string)=>setParameters(p=>({...p,cementMix:c}))}
                  onCityChange={setCity}
                />
                <div className="bg-white border border-gray-100 rounded-2xl p-5">
                  <h3 className="text-[10px] font-semibold text-black/40 uppercase tracking-widest mb-4">Print Configuration</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-black mb-1.5">Total Layers</label>
                      <input type="number" value={totalLayers} min={1}
                        onChange={e=>setTotalLayers(parseInt(e.target.value)||1)}
                        className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-black text-black"/>
                      <p className="text-[10px] text-black/30 mt-1">Auto-set from geometry</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1.5">Print Speed (mm/s)</label>
                      <input type="number" value={printSpeed} min={1}
                        onChange={e=>setPrintSpeed(parseInt(e.target.value)||1)}
                        className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-black text-black"/>
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <LayerVisualization file={file} toolpath={[]} numLayers={0}
                  layerHeight={0.04} site={resolvedSite} modelScale={modelScale}
                  sitePlan={sitePlanData}/>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}