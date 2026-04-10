'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';

// ── Material data ─────────────────────────────────────────────────────────────

const MATERIALS = [
  {
    id:          'sika-733-3d',
    name:        'Sikacrete®-733 3D',
    region:      'UK / CA / DE',
    colour:      'Grey powder',
    waterRatio:  '13–14%',
    strength28d: '35 MPa',
    strength1d:  '10 MPa',
    potLife10c:  80,
    potLife20c:  60,
    potLife30c:  40,
    initSet5c:   '165 min',
    initSet20c:  '90 min',
    initSet30c:  '70 min',
    finalSet5c:  '285 min',
    finalSet20c: '120 min',
    finalSet30c: '95 min',
    layerMin:    6,
    layerMax:    40,
    grainSize:   3,
    spreadFlow:  130,
    density:     2.2,
    co2:         'Reduced — contains recycled SCM (supplementary cementitious material)',
    packaging:   '25 kg bag · 1000 kg big bag',
    shelfLife:   '9 months from production',
    tempMin:     5,
    tempMax:     30,
    notes:       'Fibre-reinforced. Longer open time for large-scale printing. Adjustable consistency for temperature variations.',
  },
  {
    id:          'sika-733w-3d-us',
    name:        'Sikacrete®-733 W 3D',
    region:      'USA',
    colour:      'White powder',
    waterRatio:  '15–17%',
    strength28d: '50 MPa',
    strength1d:  '10 MPa',
    potLife10c:  80,
    potLife20c:  60,
    potLife30c:  40,
    initSet5c:   '—',
    initSet20c:  '—',
    initSet30c:  '—',
    finalSet5c:  '—',
    finalSet20c: '—',
    finalSet30c: '—',
    layerMin:    6,
    layerMax:    20,
    grainSize:   3,
    spreadFlow:  130,
    density:     2.1,
    co2:         'Reduced — contains recycled waste material as cement replacement',
    packaging:   '55 lb bag · 2000 lb Super Sack',
    shelfLife:   '9 months from production',
    tempMin:     5,
    tempMax:     30,
    notes:       'Higher compressive strength than standard 733 3D. White colour. Fibre-reinforced. Suitable for warm climates.',
  },
  {
    id:          'sika-733w-3d-gcc',
    name:        'Sikacrete®-733 W 3D (GCC)',
    region:      'Gulf / UAE / KSA / Oman',
    colour:      'White powder',
    waterRatio:  '15–17%',
    strength28d: '35 MPa',
    strength1d:  '10 MPa',
    potLife10c:  80,
    potLife20c:  60,
    potLife30c:  40,
    initSet5c:   '—',
    initSet20c:  '—',
    initSet30c:  '—',
    finalSet5c:  '—',
    finalSet20c: '—',
    finalSet30c: '—',
    layerMin:    6,
    layerMax:    20,
    grainSize:   3,
    spreadFlow:  130,
    density:     2.1,
    co2:         'Reduced — contains recycled waste material as cement replacement',
    packaging:   '25 kg bag · 1500 kg bag',
    shelfLife:   '6 months from production',
    tempMin:     5,
    tempMax:     30,
    notes:       'Same formula as US version. Tested at 25°C — hence lower declared 28d strength. Optimised for hot climate conditions.',
  },
];

const LAYER_CIRCLE_TIMES = [
  { height: '0.5 cm (5 mm)',  time: '25 sec' },
  { height: '1.0 cm (10 mm)', time: '50 sec' },
  { height: '2.0 cm (20 mm)', time: '100 sec' },
];

// ── Printer field definitions ─────────────────────────────────────────────────

const PRINTER_FIELDS = [
  {
    section: 'Nozzle',
    fields: [
      { name:'Nozzle Diameter', unit:'mm', rl:true,
        desc:'Sets the width of each concrete bead. The slicer uses this to compute bead footprint and print path spacing. Smaller = higher resolution, slower build. Larger = faster, less geometric detail.' },
      { name:'Nozzle Shape', unit:'—', rl:false,
        desc:'Round is self-centring and most common. Square gives flat-top layers with better inter-layer mechanical bond. Rectangular suits high aspect-ratio beads. Teeth (serrated) improves keying between layers by creating a textured interface.' },
    ],
  },
  {
    section: 'Print Space',
    fields: [
      { name:'Print Space X / Y / Z', unit:'mm', rl:true,
        desc:'Machine envelope — the maximum travel distance in each axis. The optimizer validates that sliced toolpaths fit within these limits before generating G-code. Toolpaths exceeding the envelope are flagged as errors.' },
    ],
  },
  {
    section: 'Pump & Delivery',
    fields: [
      { name:'Pump Type', unit:'—', rl:true,
        desc:'Rotor-stator pumps are the industry standard for 3DCP — high pressure, continuous flow, handles stiff mixes. Piston pumps give more precise volumetric control for high-viscosity or fibre-reinforced mixes. Each type has different lag characteristics.' },
      { name:'Hose Length', unit:'m', rl:true,
        desc:'The RL agent uses this to calculate hydraulic lag — the delay between a pump command change and the moment concrete actually exits the nozzle. Longer hose = more material in transit = earlier pump stop/start commands in G-code.' },
      { name:'Hose Internal Diameter', unit:'mm', rl:true,
        desc:'Combined with hose length this gives the total volume of concrete in the delivery system at any moment. Used to calculate lag time and pressure drop. Narrower hose = higher velocity = faster response but more pressure.' },
      { name:'Max Flow Rate', unit:'L/min', rl:true,
        desc:'Physical maximum the pump can deliver. The slicer uses this with bead geometry to compute the maximum achievable print speed without starving the nozzle. Print speed is always the minimum of: velocity limit and flow-rate-limited speed.' },
      { name:'Min Flow Rate', unit:'L/min', rl:true,
        desc:'Minimum stable flow before the pump surges or the mix segregates in the hose. Sets the floor on print speed during slow cornering or fine detail sections. Below this threshold, concrete quality becomes unreliable.' },
    ],
  },
  {
    section: 'Machine Kinematics',
    fields: [
      { name:'Max Velocity', unit:'mm/s', rl:true,
        desc:'Maximum print head travel speed. The RL agent never commands motion above this. This is separate from the flow-rate-limited speed — the actual speed ceiling is always the lower of the two.' },
      { name:'Acceleration', unit:'mm/s²', rl:true,
        desc:'How quickly the print head changes speed. Low acceleration = smooth motion, less vibration, consistent bead width around corners. High acceleration = faster print but may cause bead width variation and layer displacement on lightweight frames.' },
      { name:'Junction Deviation', unit:'mm/s', rl:false,
        desc:'Controls speed through direction changes (corners). Low values = slow smooth corners, better quality, less vibration. High values = fast aggressive cornering. Tune to your frame stiffness and layer quality requirements.' },
    ],
  },
  {
    section: 'Aggregate & Material (Printer Side)',
    fields: [
      { name:'Max Aggregate Size', unit:'mm', rl:true,
        desc:'The largest aggregate particle the printer can pass without blockage. The material system warns if the selected mix has aggregate larger than this value. General rule: max aggregate < 35% of nozzle diameter. Exceeding this causes pump blockages.' },
      { name:'Initial Set Time', unit:'min at 20°C', rl:true,
        desc:'Time window before the mix loses workability at 20°C. The RL agent uses this with live temperature data to urgency-tune print speed — hotter conditions shorten this window, increasing print speed to finish layers before the material stiffens.' },
      { name:'Slump / Workability', unit:'/10', rl:true,
        desc:'How fluid the mix is. Higher slump = more flowable, easier to pump, but may sag on steep wall sections. Lower = stiffer, self-supporting, harder to pump. Tune to your mix design and printing angle requirements.' },
    ],
  },
];

// ── Shared components ─────────────────────────────────────────────────────────

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-xs text-black/50">{label}</span>
      <span className="text-xs font-semibold font-mono text-black">{value}</span>
    </div>
  );
}

// ── Material tab ──────────────────────────────────────────────────────────────

function MaterialTab() {
  const [selected, setSelected] = useState(MATERIALS[0].id);
  const mat = MATERIALS.find(m => m.id === selected) ?? MATERIALS[0];

  return (
    <div>
      {/* Material selector */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {MATERIALS.map(m => (
          <button key={m.id} onClick={() => setSelected(m.id)}
            className={`px-4 py-2 text-sm font-semibold rounded-xl border transition-all ${
              selected === m.id
                ? 'bg-black text-white border-black'
                : 'bg-white text-black/50 border-gray-200 hover:border-black hover:text-black'
            }`}>
            {m.name}
            <span className={`ml-2 text-[10px] font-normal ${selected===m.id?'text-white/40':'text-black/30'}`}>
              {m.region}
            </span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={selected}
          initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
          className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Col 1: Identity + full spec */}
          <div className="space-y-4">
            <div className="bg-black rounded-2xl p-5">
              <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1">Material</p>
              <p className="text-base font-bold text-white mb-0.5">{mat.name}</p>
              <p className="text-xs text-white/40 mb-4">{mat.region}</p>
              <div className="space-y-0">
                {[
                  { label:'Colour',       value: mat.colour },
                  { label:'Water ratio',  value: mat.waterRatio },
                  { label:'28d strength', value: mat.strength28d },
                  { label:'1d strength',  value: mat.strength1d },
                  { label:'Grain size',   value:`≤ ${mat.grainSize} mm` },
                  { label:'Layer height', value:`${mat.layerMin}–${mat.layerMax} mm` },
                  { label:'Spread flow',  value:`${mat.spreadFlow} mm` },
                  { label:'Density',      value:`${mat.density} kg/L` },
                  { label:'Packaging',    value: mat.packaging },
                  { label:'Shelf life',   value: mat.shelfLife },
                  { label:'Ambient temp', value:`${mat.tempMin}–${mat.tempMax}°C` },
                ].map((s,i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-white/6 last:border-0">
                    <span className="text-[10px] text-white/35">{s.label}</span>
                    <span className="text-[10px] font-semibold text-white font-mono text-right max-w-[55%]">{s.value}</span>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-white/25 mt-3 leading-relaxed">{mat.co2}</p>
            </div>

            {/* Notes */}
            <div className="bg-white border border-gray-100 rounded-2xl p-4">
              <p className="text-[9px] font-semibold text-black/40 uppercase tracking-widest mb-2">Notes</p>
              <p className="text-[11px] text-black/60 leading-relaxed">{mat.notes}</p>
            </div>
          </div>

          {/* Col 2: Pot life + set times + circle times */}
          <div className="space-y-4">

            {/* Pot life table */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <p className="text-[9px] font-semibold text-black/40 uppercase tracking-widest mb-4">Pot Life & Set Times</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 text-black/40 font-medium">Temp</th>
                    <th className="text-right py-2 text-black/40 font-medium">Pot life</th>
                    <th className="text-right py-2 text-black/40 font-medium">Initial set</th>
                    <th className="text-right py-2 text-black/40 font-medium">Final set</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { temp:'5°C',  pot:`${mat.potLife10c} min`, init:mat.initSet5c,  final:mat.finalSet5c  },
                    { temp:'20°C', pot:`${mat.potLife20c} min`, init:mat.initSet20c, final:mat.finalSet20c },
                    { temp:'30°C', pot:`${mat.potLife30c} min`, init:mat.initSet30c, final:mat.finalSet30c },
                  ].map((row,i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0">
                      <td className="py-2.5 font-mono font-bold text-black">{row.temp}</td>
                      <td className="py-2.5 text-right font-bold text-black">{row.pot}</td>
                      <td className="py-2.5 text-right text-black/50">{row.init}</td>
                      <td className="py-2.5 text-right text-black/40">{row.final}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[9px] text-black/30 mt-3 leading-relaxed">
                Pot life is based on material temperature after extrusion — when it starts to stiffen. Agitating during this time prolongs it. The RL optimizer uses these values with live temperature to adapt print speed dynamically.
              </p>
            </div>

            {/* Layer circle times */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <p className="text-[9px] font-semibold text-black/40 uppercase tracking-widest mb-1">Minimum Layer Circle Times</p>
              <p className="text-[10px] text-black/30 mb-3">At 20°C — extend at lower temperatures or lower humidity</p>
              <div className="space-y-2">
                {LAYER_CIRCLE_TIMES.map((row,i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2.5 bg-gray-50 rounded-xl">
                    <span className="text-xs font-medium text-black">{row.height}</span>
                    <span className="text-xs font-bold font-mono text-black">{row.time}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Vertical speed limit */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <p className="text-[9px] font-semibold text-black/40 uppercase tracking-widest mb-2">Vertical Build Rate Limit</p>
              <p className="text-2xl font-bold text-black">{'< 1.2'} <span className="text-sm font-normal text-black/40">cm/min</span></p>
              <p className="text-[10px] text-black/40 mt-2 leading-relaxed">
                Maximum rate the build height can increase. The RL optimizer enforces this when computing layer cycle times to prevent fresh layer collapse.
              </p>
            </div>

            {/* Application notes */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <p className="text-[9px] font-semibold text-black/40 uppercase tracking-widest mb-3">Application Notes</p>
              <ul className="space-y-2">
                {[
                  'Use SikaPump® Start-1 to prime pump lines.',
                  'Continuously monitor pot life of mixed material.',
                  'Do not allow mixed material to stand in warm temperatures.',
                  'Keep pump lines wetted and cool.',
                  'Use warm water at low temps, cold water at high temps.',
                  'Cure with minimum 40% relative humidity.',
                  'Do not cure in direct sun or windy conditions.',
                ].map((note,i) => (
                  <li key={i} className="flex items-start gap-2 text-[10px] text-black/50">
                    <span className="w-1 h-1 rounded-full bg-black/20 mt-1.5 flex-shrink-0"/>
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Col 3: Comparison */}
          <div>
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-[9px] font-semibold text-black/40 uppercase tracking-widest">All Variants Compared</p>
              </div>
              <div className="divide-y divide-gray-50">
                {[
                  { label:'Region',       fn:(m:typeof MATERIALS[0]) => m.region },
                  { label:'Colour',       fn:(m:typeof MATERIALS[0]) => m.colour },
                  { label:'Water ratio',  fn:(m:typeof MATERIALS[0]) => m.waterRatio },
                  { label:'28d strength', fn:(m:typeof MATERIALS[0]) => m.strength28d },
                  { label:'Pot life 20°C',fn:(m:typeof MATERIALS[0]) => `${m.potLife20c} min` },
                  { label:'Pot life 30°C',fn:(m:typeof MATERIALS[0]) => `${m.potLife30c} min` },
                  { label:'Layer height', fn:(m:typeof MATERIALS[0]) => `${m.layerMin}–${m.layerMax}mm` },
                  { label:'Grain size',   fn:(m:typeof MATERIALS[0]) => `≤${m.grainSize}mm` },
                  { label:'Shelf life',   fn:(m:typeof MATERIALS[0]) => m.shelfLife },
                ].map((row,i) => (
                  <div key={i} className="px-4 py-2.5">
                    <p className="text-[9px] text-black/35 uppercase tracking-wider mb-1.5">{row.label}</p>
                    <div className="space-y-1">
                      {MATERIALS.map(m => (
                        <div key={m.id} className={`flex items-center justify-between rounded-lg px-2 py-1 ${m.id===selected?'bg-black':'bg-gray-50'}`}>
                          <span className={`text-[9px] ${m.id===selected?'text-white/50':'text-black/30'}`}>{m.name.replace('Sikacrete®-','')}</span>
                          <span className={`text-[9px] font-mono font-semibold ${m.id===selected?'text-white':'text-black'}`}>{row.fn(m)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ── Printer tab ───────────────────────────────────────────────────────────────

function PrinterTab() {
  return (
    <div className="space-y-6">
      {PRINTER_FIELDS.map((section, si) => (
        <div key={si}>
          <h3 className="text-xs font-bold text-black uppercase tracking-widest mb-3">{section.section}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {section.fields.map((field, fi) => (
              <motion.div key={fi}
                initial={{ opacity:0, y:4 }} animate={{ opacity:1, y:0 }}
                transition={{ delay: fi * 0.04 }}
                className="bg-white border border-gray-100 rounded-2xl p-4">
                <div className="flex items-start justify-between mb-1.5">
                  <p className="text-sm font-bold text-black">{field.name}</p>
                  {field.rl && (
                    <span className="text-[8px] font-bold text-black/40 bg-black/5 px-1.5 py-0.5 rounded-full ml-2 flex-shrink-0 whitespace-nowrap">
                      RL uses this
                    </span>
                  )}
                </div>
                {field.unit !== '—' && (
                  <p className="text-[9px] font-mono text-black/30 mb-2">Unit: {field.unit}</p>
                )}
                <p className="text-[11px] text-black/55 leading-relaxed">{field.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = 'material' | 'printer';

export default function DefinitionsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('material');

  return (
    <div className="min-h-screen bg-gray-50 pb-16">

      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <button onClick={() => router.back()}
            className="text-black/40 hover:text-black transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
            </svg>
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-black">Definitions</h1>
            <p className="text-xs text-black/40">Material specs and printer field explanations</p>
          </div>
          {/* Tab toggle */}
          <div className="flex items-center gap-1 bg-gray-50 border border-gray-100 rounded-xl p-1">
            <button onClick={() => setTab('material')}
              className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${tab==='material'?'bg-black text-white':'text-black/40 hover:text-black'}`}>
              Material
            </button>
            <button onClick={() => setTab('printer')}
              className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${tab==='printer'?'bg-black text-white':'text-black/40 hover:text-black'}`}>
              Printer
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          {tab === 'material' && (
            <motion.div key="material" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
              <MaterialTab/>
            </motion.div>
          )}
          {tab === 'printer' && (
            <motion.div key="printer" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
              <PrinterTab/>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}