'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useProjects } from '@/lib/project-store';
import AppNav from '@/components/AppNav';

type SetupMode = 'choose' | 'connect' | 'manual' | 'pi';

interface ManualConfig {
  printerName: string; nozzleDiameter: number; nozzleShape: 'round'|'square'|'rectangular'|'teeth';
  beadCompression: number;
  hoseLength: number; hoseInternalDiam: number;
  maxFlowRate: number; minFlowRate: number; maxVelocity: number; acceleration: number;
}

const DEFAULT_CONFIG: ManualConfig = {
  printerName:'Custom Printer', nozzleDiameter:25, nozzleShape:'round', beadCompression:0.6,
  hoseLength:15, hoseInternalDiam:50, maxFlowRate:8, minFlowRate:1,
  maxVelocity:100, acceleration:500,
};

const FIELD_DEFS: Record<string,{title:string;why:string;unit:string}> = {
  nozzleDiameter:   {title:'Nozzle Diameter',unit:'mm',why:'Sets the width of each concrete bead. Smaller = higher resolution, slower. Larger = faster, less detail.'},
  nozzleShape:      {title:'Nozzle Shape',unit:'—',why:'Round is self-centring. Square gives flat-top layers. Rectangular suits high aspect-ratio beads. Teeth improves mechanical keying between layers.'},
  beadCompression:  {title:'Bead Compression',unit:'ratio',why:'Layer height = nozzle diameter × this value. 0.5 = conservative. 0.6 = industry standard. 0.8 = aggressive. Pi auto-calibrates from test extrusion.'},
  hoseLength:       {title:'Hose Length',unit:'m',why:'Used to calculate hydraulic lag — delay between pump command and concrete exiting nozzle.'},
  hoseInternalDiam: {title:'Hose Internal Diameter',unit:'mm',why:'Combined with hose length gives volume in transit. Used for lag time and pressure drop.'},
  maxFlowRate:      {title:'Max Flow Rate',unit:'L/min',why:'Physical maximum pump can deliver. Sets maximum achievable print speed.'},
  minFlowRate:      {title:'Min Flow Rate',unit:'L/min',why:'Minimum stable flow. Sets floor on print speed during slow sections.'},
  maxVelocity:      {title:'Max Velocity',unit:'mm/s',why:'Maximum print head travel speed. RL agent never exceeds this.'},
  acceleration:     {title:'Acceleration',unit:'mm/s²',why:'How quickly the print head changes speed. Low = smooth, consistent beads. High = faster but may vary bead width at corners.'},
};

const PRINTERS = [
  {name:'COBOD BOD2',type:'Gantry',nozzle:'25 mm',maxSpeed:'100 mm/s',origin:'Denmark',desc:'Industry-leading gantry, deployed in 50+ countries'},
  {name:'COBOD BOD3',type:'Gantry',nozzle:'30 mm',maxSpeed:'150 mm/s',origin:'Denmark',desc:'Next-gen multi-material with steel reinforcement support'},
  {name:'Tektaio T1',type:'Gantry',nozzle:'30 mm',maxSpeed:'120 mm/s',origin:'UK',desc:'High-throughput gantry for large footprint structures'},
  {name:'Apis Cor',type:'Crane',nozzle:'22 mm',maxSpeed:'75 mm/s',origin:'USA',desc:'Portable crane-type with rapid on-site deployment'},
  {name:'ICON Vulcan',type:'Gantry',nozzle:'28 mm',maxSpeed:'90 mm/s',origin:'USA',desc:'Lavacrete system, US military and NASA programs'},
];

function Field({fieldKey,label,unit,value,onChange,type='number',min,max,step,onFocus,children}:{
  fieldKey?:string;label:string;unit?:string;value?:number|string;onChange?:(v:any)=>void;
  type?:'number'|'text';min?:number;max?:number;step?:number;onFocus?:(k:string)=>void;children?:React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <label className="text-xs font-medium text-black">{label}</label>
        {unit&&<span className="text-[10px] text-black/30">({unit})</span>}
        {fieldKey&&FIELD_DEFS[fieldKey]&&(
          <button type="button" onClick={()=>onFocus?.(fieldKey)}
            className="ml-auto w-4 h-4 rounded-full border border-black/20 flex items-center justify-center hover:border-black transition-colors">
            <span className="text-[9px] text-black/40 font-bold">i</span>
          </button>
        )}
      </div>
      {children??<input type={type} value={value} min={min} max={max} step={step}
        onFocus={()=>fieldKey&&onFocus?.(fieldKey)}
        onChange={e=>onChange?.(type==='number'?Number(e.target.value):e.target.value)}
        className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-black transition-colors text-black"/>}
    </div>
  );
}

function Select({fieldKey,label,value,onChange,options,onFocus}:{
  fieldKey?:string;label:string;value:string;onChange:(v:string)=>void;
  options:{value:string;label:string}[];onFocus?:(k:string)=>void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <label className="text-xs font-medium text-black">{label}</label>
        {fieldKey&&FIELD_DEFS[fieldKey]&&(
          <button type="button" onClick={()=>onFocus?.(fieldKey)}
            className="ml-auto w-4 h-4 rounded-full border border-black/20 flex items-center justify-center hover:border-black transition-colors">
            <span className="text-[9px] text-black/40 font-bold">i</span>
          </button>
        )}
      </div>
      <select value={value} onChange={e=>onChange(e.target.value)} onFocus={()=>fieldKey&&onFocus?.(fieldKey)}
        className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-black transition-colors text-black bg-white appearance-none cursor-pointer">
        {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function SliderField({fieldKey,label,value,onChange,min,max,step,unit,formatValue,onFocus}:{
  fieldKey?:string;label:string;value:number;onChange:(v:number)=>void;
  min:number;max:number;step:number;unit?:string;formatValue?:(v:number)=>string;onFocus?:(k:string)=>void;
}) {
  const display=formatValue?formatValue(value):`${value}${unit??''}`;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <label className="text-xs font-medium text-black">{label}</label>
        {fieldKey&&FIELD_DEFS[fieldKey]&&(
          <button type="button" onClick={()=>onFocus?.(fieldKey)}
            className="w-4 h-4 rounded-full border border-black/20 flex items-center justify-center hover:border-black transition-colors">
            <span className="text-[9px] text-black/40 font-bold">i</span>
          </button>
        )}
        <span className="ml-auto text-xs font-mono font-bold text-black">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onFocus={()=>fieldKey&&onFocus?.(fieldKey)} onChange={e=>onChange(Number(e.target.value))}
        className="w-full accent-black h-1"/>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-black/25">{min}{unit}</span>
        <span className="text-[10px] text-black/25">{max}{unit}</span>
      </div>
    </div>
  );
}

function DefinitionPanel({fieldKey,onClose}:{fieldKey:string|null;onClose:()=>void}) {
  const def=fieldKey?FIELD_DEFS[fieldKey]:null;
  return (
    <AnimatePresence>
      {def?(
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:8}}
          className="bg-black rounded-2xl p-5 lg:sticky lg:top-24 lg:self-start">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1">Field Definition</p>
              <p className="text-sm font-bold text-white">{def.title}</p>
              {def.unit!=='—'&&<p className="text-[10px] font-mono text-white/40 mt-0.5">Unit: {def.unit}</p>}
            </div>
            <button onClick={onClose} className="text-white/30 hover:text-white transition-colors text-lg leading-none">×</button>
          </div>
          <p className="text-[11px] text-white/60 leading-relaxed">{def.why}</p>
        </motion.div>
      ):(
        <motion.div initial={{opacity:0}} animate={{opacity:1}}
          className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl p-5 hidden lg:block lg:sticky lg:top-24 lg:self-start">
          <p className="text-xs text-black/30 text-center">
            Click the <span className="font-bold">i</span> button next to any field to see what it means.
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const PI_STEPS=['Broadcasting discovery packet…','Scanning for AutoBuild Pi dongles…','Pi dongle found — 192.168.1.42','Handshaking with printer controller…','Reading printer identity…','Fetching printer specs from EEPROM…','Validating against known profiles…','Printer profile loaded successfully.'];

function PiDiscoveryFlow({onConnected,onBack}:{onConnected:(name:string,specs:any)=>void;onBack:()=>void}) {
  const [scanning,setScanning]=useState(false);
  const [logLines,setLogLines]=useState<string[]>([]);
  const [discovered,setDiscovered]=useState(false);
  const [piSpecs,setPiSpecs]=useState<any>(null);

  const handleScan=()=>{
    setScanning(true);setLogLines([]);setDiscovered(false);let i=0;
    const iv=setInterval(()=>{
      setLogLines(prev=>[...prev,`> ${PI_STEPS[i]}`]);i++;
      if(i>=PI_STEPS.length){
        clearInterval(iv);
        const specs={name:'COBOD BOD2 (via Pi)',nozzleDiameter:25,nozzleShape:'round',beadCompression:0.6,maxVelocity:100,minFlowRate:1,maxFlowRate:8,printSpaceX:9000,printSpaceY:6000,printSpaceZ:3500,hoseLength:15,hoseInternalDiam:50,pumpType:'rotor-stator',acceleration:500,jerkDeviation:8,aggregatePrinterSize:4,initialSetTime:45,slumpValue:5};
        setPiSpecs(specs);setDiscovered(true);
      }
    },480);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl">
      <div>
        <div className="bg-white border border-gray-100 rounded-2xl p-5 sm:p-6 mb-4">
          <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center mb-4">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"/>
            </svg>
          </div>
          <h3 className="text-sm font-bold text-black mb-1">Raspberry Pi Wireless Dongle</h3>
          <p className="text-xs text-black/40 leading-relaxed mb-4">AutoBuild Pi connects to your printer via USB, then broadcasts specs over Wi-Fi. No manual entry needed.</p>
          <div className="space-y-2">
            {['Plug Pi dongle into printer USB port','Connect Pi to site Wi-Fi','Click Scan below'].map((step,i)=>(
              <div key={i} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-black text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">{i+1}</div>
                <p className="text-xs text-black/60">{step}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onBack} className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl text-black hover:bg-gray-50 transition-colors">Back</button>
          <button onClick={handleScan} disabled={scanning&&!discovered}
            className="flex-1 py-2.5 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/90 disabled:opacity-40 transition-colors">
            {scanning&&!discovered?'Scanning…':'Scan Network'}
          </button>
        </div>
      </div>
      <div>
        <div className="bg-black rounded-2xl p-5 font-mono text-[11px] min-h-[160px] mb-4">
          {logLines.length===0&&<p className="text-white/20">Waiting for scan…</p>}
          {logLines.map((line,i)=>(
            <motion.p key={i} initial={{opacity:0,x:-4}} animate={{opacity:1,x:0}}
              className={`leading-relaxed ${line.includes('successfully')?'text-emerald-400 font-bold':line.includes('found')?'text-amber-400':'text-white/50'}`}>
              {line}
            </motion.p>
          ))}
          {scanning&&!discovered&&<span className="inline-block w-2 h-3.5 bg-white/60 animate-pulse ml-0.5"/>}
        </div>
        {discovered&&piSpecs&&(
          <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="bg-white border border-gray-100 rounded-2xl p-4 mb-4">
            <p className="text-[9px] font-bold text-black/40 uppercase tracking-widest mb-3">Discovered Printer</p>
            <p className="text-sm font-bold text-black mb-3">{piSpecs.name}</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {[['Nozzle',`${piSpecs.nozzleDiameter}mm ${piSpecs.nozzleShape}`],['Bead Compression',`${piSpecs.beadCompression}× → ${(piSpecs.nozzleDiameter*piSpecs.beadCompression).toFixed(1)}mm`],['Max velocity',`${piSpecs.maxVelocity} mm/s`],['Flow range',`${piSpecs.minFlowRate}–${piSpecs.maxFlowRate} L/min`]].map(([l,v])=>(
                <div key={l}><p className="text-[9px] text-black/30 uppercase tracking-wider">{l}</p><p className="text-xs font-mono font-semibold text-black">{v}</p></div>
              ))}
            </div>
            <button onClick={()=>onConnected(piSpecs.name,piSpecs)} className="w-full mt-4 py-2.5 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/90 transition-colors">Use This Printer</button>
          </motion.div>
        )}
      </div>
    </div>
  );
}

const LOG_STEPS=['Initialising serial interface…','Sending CONNECT command…','Handshake acknowledged…','Querying printer firmware…','Loading printer profile…','Calibrating extrusion baseline…','Connection established.'];

function ConnectFlow({onConnected,onBack}:{onConnected:(printer:typeof PRINTERS[0])=>void;onBack:()=>void}) {
  const [selected,setSelected]=useState<typeof PRINTERS[0]|null>(null);
  const [connecting,setConnecting]=useState(false);
  const [logLines,setLogLines]=useState<string[]>([]);
  const [connected,setConnected]=useState(false);

  const handleConnect=()=>{
    if(!selected)return;setConnecting(true);setLogLines([]);let i=0;
    const iv=setInterval(()=>{setLogLines(prev=>[...prev,`> ${LOG_STEPS[i]}`]);i++;if(i>=LOG_STEPS.length){clearInterval(iv);setConnected(true);}},420);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h2 className="text-sm font-semibold text-black mb-4">Select Printer</h2>
        <div className="space-y-3">
          {PRINTERS.map(p=>(
            <button key={p.name} onClick={()=>{setSelected(p);setConnected(false);setLogLines([]);setConnecting(false);}}
              className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${selected?.name===p.name?'bg-black border-black':'bg-white border-gray-100 hover:border-black'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className={`text-sm font-semibold ${selected?.name===p.name?'text-white':'text-black'}`}>{p.name}</p>
                  <p className={`text-[11px] mt-0.5 ${selected?.name===p.name?'text-white/50':'text-black/40'}`}>{p.type} · {p.origin}</p>
                </div>
                <div className="text-right flex-shrink-0 ml-2">
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
        <div className="bg-black rounded-2xl p-5 font-mono text-[11px] min-h-[200px]">
          {logLines.length===0&&!connecting&&<p className="text-white/20">Select a printer and click Connect…</p>}
          {logLines.map((line,i)=>(
            <motion.p key={i} initial={{opacity:0,x:-4}} animate={{opacity:1,x:0}}
              className={`leading-relaxed ${line.includes('established')?'text-emerald-400 font-bold':'text-white/60'}`}>{line}</motion.p>
          ))}
          {connecting&&!connected&&<span className="inline-block w-2 h-3.5 bg-white/60 animate-pulse ml-0.5"/>}
        </div>
        <div className="mt-4 flex gap-3">
          <button onClick={onBack} className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl text-black hover:bg-gray-50 transition-colors">Back</button>
          {!connected?(
            <button onClick={handleConnect} disabled={!selected||connecting}
              className="flex-1 py-2.5 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/90 disabled:opacity-30 transition-colors">
              {connecting?'Connecting…':'Connect'}
            </button>
          ):(
            <motion.button initial={{opacity:0,scale:0.95}} animate={{opacity:1,scale:1}}
              onClick={()=>onConnected(selected!)}
              className="flex-1 py-2.5 text-sm font-semibold bg-black text-white rounded-xl flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
              Continue to Pre-Print
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
}

function ManualConfigForm({onSave,onBack}:{onSave:(cfg:ManualConfig)=>void;onBack:()=>void}) {
  const [cfg,setCfg]=useState<ManualConfig>(DEFAULT_CONFIG);
  const [focusKey,setFocusKey]=useState<string|null>(null);
  const set=(key:keyof ManualConfig)=>(val:any)=>setCfg(c=>({...c,[key]:val}));
  const hydraulicVolume=(Math.PI*(cfg.hoseInternalDiam/2/1000)**2*cfg.hoseLength*1000).toFixed(2);
  const computedLayerH=(cfg.nozzleDiameter*cfg.beadCompression).toFixed(1);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-6 max-w-5xl">
      <div>
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
          <Field label="Printer Name" type="text" value={cfg.printerName} onChange={set('printerName')}/>
        </div>

        {/* 1. Nozzle */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
          <div className="mb-5"><h3 className="text-xs font-bold text-black uppercase tracking-widest">1. Nozzle</h3><p className="text-[11px] text-black/40 mt-0.5">Shape, size, and bead compression factor</p></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field fieldKey="nozzleDiameter" label="Nozzle Diameter" unit="mm" value={cfg.nozzleDiameter} onChange={set('nozzleDiameter')} min={10} max={50} step={0.5} onFocus={setFocusKey}/>
            <Select fieldKey="nozzleShape" label="Nozzle Shape" value={cfg.nozzleShape} onChange={set('nozzleShape')} onFocus={setFocusKey}
              options={[{value:'round',label:'Round — standard'},{value:'square',label:'Square — flat-top'},{value:'rectangular',label:'Rectangular — high aspect'},{value:'teeth',label:'Teeth — improved bond'}]}/>
          </div>
          <div className="mt-5">
            <SliderField fieldKey="beadCompression" label="Bead Compression" value={cfg.beadCompression} onChange={set('beadCompression')}
              min={0.5} max={0.8} step={0.01} onFocus={setFocusKey}
              formatValue={v=>{const lh=(cfg.nozzleDiameter*v).toFixed(1);if(v<=0.54)return `${v.toFixed(2)}× — Conservative (${lh}mm)`;if(v<=0.64)return `${v.toFixed(2)}× — Standard (${lh}mm)`;if(v<=0.74)return `${v.toFixed(2)}× — Fast build (${lh}mm)`;return `${v.toFixed(2)}× — Aggressive (${lh}mm)`;}}/>
            <div className="mt-3 flex items-center justify-between px-3 py-2.5 bg-gray-50 rounded-xl border border-gray-100">
              <span className="text-[10px] text-black/40">Computed layer height</span>
              <span className="text-sm font-bold font-mono text-black">{computedLayerH} mm</span>
            </div>
          </div>
        </div>

        {/* 2. Delivery */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
          <div className="mb-5"><h3 className="text-xs font-bold text-black uppercase tracking-widest">2. Delivery</h3><p className="text-[11px] text-black/40 mt-0.5">Hose geometry and flow rate limits</p></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field fieldKey="hoseLength" label="Hose Length" unit="m" value={cfg.hoseLength} onChange={set('hoseLength')} min={1} max={100} step={0.5} onFocus={setFocusKey}/>
            <div>
              <Field fieldKey="hoseInternalDiam" label="Hose Internal Diameter" unit="mm" value={cfg.hoseInternalDiam} onChange={set('hoseInternalDiam')} min={20} max={100} step={1} onFocus={setFocusKey}/>
              <p className="text-[10px] text-black/30 mt-1.5 font-mono">Volume in hose: {hydraulicVolume} L</p>
            </div>
            <Field fieldKey="maxFlowRate" label="Max Flow Rate" unit="L/min" value={cfg.maxFlowRate} onChange={set('maxFlowRate')} min={1} max={40} step={0.5} onFocus={setFocusKey}/>
            <Field fieldKey="minFlowRate" label="Min Flow Rate" unit="L/min" value={cfg.minFlowRate} onChange={set('minFlowRate')} min={0.1} max={10} step={0.1} onFocus={setFocusKey}/>
          </div>
        </div>

        {/* 3. Kinematics */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
          <div className="mb-5"><h3 className="text-xs font-bold text-black uppercase tracking-widest">3. Machine Kinematics</h3></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field fieldKey="maxVelocity" label="Max Velocity" unit="mm/s" value={cfg.maxVelocity} onChange={set('maxVelocity')} min={10} max={300} step={5} onFocus={setFocusKey}/>
            <Field fieldKey="acceleration" label="Acceleration" unit="mm/s²" value={cfg.acceleration} onChange={set('acceleration')} min={50} max={3000} step={50} onFocus={setFocusKey}/>
          </div>
        </div>

        {/* Summary */}
        <div className="bg-black rounded-2xl p-5 mb-6">
          <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-4">Configuration Summary</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-white/10 rounded-xl overflow-hidden">
            {[
              {label:'Nozzle',      value:`${cfg.nozzleDiameter}mm ${cfg.nozzleShape}`},
              {label:'Layer Height',value:`${computedLayerH}mm`},
              {label:'Max Velocity',value:`${cfg.maxVelocity} mm/s`},
              {label:'Flow Range',  value:`${cfg.minFlowRate}–${cfg.maxFlowRate} L/min`},
              {label:'Acceleration',value:`${cfg.acceleration} mm/s²`},
              {label:'Hose',        value:`${cfg.hoseLength}m × ${cfg.hoseInternalDiam}mm`},
            ].map((s,i)=>(
              <div key={i} className="bg-black px-3 sm:px-4 py-3">
                <p className="text-[9px] text-white/30 uppercase tracking-wider mb-1">{s.label}</p>
                <p className="text-xs sm:text-sm font-bold text-white font-mono truncate">{s.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Definition panel — mobile only (shown inline) */}
        <div className="xl:hidden mb-5">
          <DefinitionPanel fieldKey={focusKey} onClose={()=>setFocusKey(null)}/>
        </div>

        <div className="flex gap-3">
          <button onClick={onBack} className="px-5 py-3 text-sm border border-gray-200 rounded-xl text-black hover:bg-gray-50 transition-colors">Back</button>
          <button onClick={()=>onSave(cfg)} className="flex-1 py-3 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/90 transition-colors">Save & Continue</button>
        </div>
      </div>

      {/* Definition panel — desktop sidebar */}
      <div className="hidden xl:block">
        <DefinitionPanel fieldKey={focusKey} onClose={()=>setFocusKey(null)}/>
      </div>
    </div>
  );
}

export default function PrinterSetupPage() {
  const router=useRouter();
  const {activeProject,updateProject}=useProjects();
  const [mode,setMode]=useState<SetupMode>('choose');

  const handleConnected=(printer:typeof PRINTERS[0])=>{
    if(activeProject)updateProject(activeProject.id,{status:'pre-print',printer:{name:printer.name,type:printer.type,nozzle:printer.nozzle,maxSpeed:printer.maxSpeed}});
    router.push('/pre-print-optimizer');
  };

  const handlePiConnected=(name:string,specs:any)=>{
    if(activeProject)updateProject(activeProject.id,{status:'pre-print',printer:{name,type:'Gantry',nozzle:`${specs.nozzleDiameter} mm`,maxSpeed:`${specs.maxVelocity} mm/s`,manualConfig:specs}});
    router.push('/pre-print-optimizer');
  };

  const handleManualSave=(cfg:ManualConfig)=>{
    if(activeProject)updateProject(activeProject.id,{status:'pre-print',printer:{name:cfg.printerName,type:'Custom',nozzle:`${cfg.nozzleDiameter} mm`,maxSpeed:`${cfg.maxVelocity} mm/s`,layerHeight:cfg.nozzleDiameter*cfg.beadCompression,manualConfig:cfg}});
    router.push('/pre-print-optimizer');
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <AppNav currentStep="printer"/>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <AnimatePresence mode="wait">

          {mode==='choose'&&(
            <motion.div key="choose" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}}>
              <div className="mb-6 sm:mb-8">
                <h1 className="text-xl sm:text-2xl font-bold text-black">Printer Setup</h1>
                <p className="text-black/50 text-sm mt-1">How would you like to configure your printer?</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5 max-w-2xl">
                <button onClick={()=>setMode('pi')} className="group text-left bg-white border-2 border-gray-100 rounded-2xl p-5 sm:p-6 hover:border-black transition-all">
                  <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center mb-4">
                    <svg className="w-5 h-5 text-black/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"/>
                    </svg>
                  </div>
                  <p className="text-black/50 text-xs font-bold mb-1">Recommended</p>
                  <p className="text-black text-base font-semibold mb-2">Wireless Connection</p>
                  <p className="text-black/40 text-xs leading-relaxed">Plug the AutoBuild Pi into your printer. Auto-discovers all specs over Wi-Fi.</p>
                  <div className="mt-4 text-black/30 text-xs font-medium group-hover:text-black transition-colors">Auto-configure →</div>
                </button>
                <button onClick={()=>setMode('manual')} className="group text-left bg-white border-2 border-gray-100 rounded-2xl p-5 sm:p-6 hover:border-black transition-all">
                  <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center mb-4">
                    <svg className="w-5 h-5 text-black/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z"/>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                    </svg>
                  </div>
                  <p className="text-black/50 text-xs font-bold mb-1">Option A</p>
                  <p className="text-black text-base font-semibold mb-2">Manual Config</p>
                  <p className="text-black/40 text-xs leading-relaxed">Enter nozzle, pump, kinematics and aggregate specs for any custom printer.</p>
                  <div className="mt-4 text-black/30 text-xs font-medium group-hover:text-black transition-colors">3 sections →</div>
                </button>
              </div>
            </motion.div>
          )}

          {mode==='pi'&&(
            <motion.div key="pi" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}}>
              <div className="flex items-center gap-3 mb-6 sm:mb-8">
                <button onClick={()=>setMode('choose')} className="text-black/40 hover:text-black transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
                </button>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold text-black">Pi Wireless Dongle</h1>
                  <p className="text-black/40 text-sm">Auto-discover printer over local network</p>
                </div>
              </div>
              <PiDiscoveryFlow onConnected={handlePiConnected} onBack={()=>setMode('choose')}/>
            </motion.div>
          )}

          {mode==='manual'&&(
            <motion.div key="manual" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}}>
              <div className="flex items-center gap-3 mb-6 sm:mb-8">
                <button onClick={()=>setMode('choose')} className="text-black/40 hover:text-black transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
                </button>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold text-black">Manual Configuration</h1>
                  <p className="text-black/40 text-sm">Configure your printer's physical properties</p>
                </div>
              </div>
              <ManualConfigForm onSave={handleManualSave} onBack={()=>setMode('choose')}/>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}