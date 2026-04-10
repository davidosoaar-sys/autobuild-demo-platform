'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface WeatherBlock {
  id: string; start_hour: number; end_hour: number;
  temperature: number; humidity: number; wind_speed: number;
  ground_slope: number; notes: string;
}

interface Parameters {
  temperature: number; humidity: number; windSpeed: number;
  groundSlope: number; cementMix: string; batchNumber: string;
}

interface ParameterInputsProps {
  parameters:       Parameters;
  onChange:         (params: Parameters) => void;
  onWeatherChange?: (blocks: WeatherBlock[], startHour: number) => void;
  onCementChange?:  (cement: string) => void;
  onCityChange?:    (city: string) => void;
}

interface CityResult {
  name: string; country: string; state: string; display: string;
}

interface LiveWeather {
  temperature: number; humidity: number; wind_speed: number;
  description: string; pot_life_min: number; risk_score: number;
}

// ── Material catalogue ────────────────────────────────────────────────────────

export const MATERIALS = [
  {
    id:             'sika-733-3d',
    name:           'Sikacrete®-733 3D',
    region:         'UK / CA / DE',
    colour:         'Grey powder',
    waterRatio:     '13–14%',
    strength28d:    '35 MPa',
    potLife20c:     60,
    potLife30c:     40,
    potLife10c:     80,
    layerMin:       6,
    layerMax:       40,
    grainSize:      3,
    spreadFlow:     130,
    density:        2.2,
    co2:            'Reduced (recycled SCM)',
  },
  {
    id:             'sika-733w-3d-us',
    name:           'Sikacrete®-733 W 3D',
    region:         'USA',
    colour:         'White powder',
    waterRatio:     '15–17%',
    strength28d:    '50 MPa',
    potLife20c:     60,
    potLife30c:     40,
    potLife10c:     80,
    layerMin:       6,
    layerMax:       20,
    grainSize:      3,
    spreadFlow:     130,
    density:        2.1,
    co2:            'Reduced (recycled waste)',
  },
  {
    id:             'sika-733w-3d-gcc',
    name:           'Sikacrete®-733 W 3D (GCC)',
    region:         'Gulf / UAE / KSA',
    colour:         'White powder',
    waterRatio:     '15–17%',
    strength28d:    '35 MPa',
    potLife20c:     60,
    potLife30c:     40,
    potLife10c:     80,
    layerMin:       6,
    layerMax:       20,
    grainSize:      3,
    spreadFlow:     130,
    density:        2.1,
    co2:            'Reduced (recycled waste)',
  },
  {
    id:             'custom',
    name:           'Custom Mortar',
    region:         '—',
    colour:         '—',
    waterRatio:     '—',
    strength28d:    '—',
    potLife20c:     60,
    potLife30c:     40,
    potLife10c:     80,
    layerMin:       6,
    layerMax:       20,
    grainSize:      3,
    spreadFlow:     130,
    density:        2.1,
    co2:            '—',
  },
];

function hourToLabel(h: number): string {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const disp = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh;
  return `${disp}:${String(mm).padStart(2, '0')} ${ampm}`;
}

function newBlock(startH: number): WeatherBlock {
  return { id: Math.random().toString(36).slice(2), start_hour: startH, end_hour: startH + 2, temperature: 26, humidity: 60, wind_speed: 8, ground_slope: 2, notes: '' };
}

function potLifeColor(min: number): string {
  if (min >= 60) return 'text-emerald-600';
  if (min >= 45) return 'text-amber-500';
  return 'text-red-500';
}

// ── City search ───────────────────────────────────────────────────────────────

function CitySearch({ onSelect }: { onSelect: (city: string, weather: LiveWeather) => void }) {
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState<CityResult[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [fetching, setFetching] = useState(false);
  const [open,     setOpen]     = useState(false);
  const [selected, setSelected] = useState('');
  const [weather,  setWeather]  = useState<LiveWeather | null>(null);
  const [error,    setError]    = useState('');
  const debounce = useRef<NodeJS.Timeout | null>(null);

  const searchCities = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    try {
      const res  = await fetch(`${API}/weather/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
      setOpen(true);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, []);

  const handleInput = (val: string) => {
    setQuery(val); setError('');
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => searchCities(val), 400);
  };

  const handleSelect = async (city: CityResult) => {
    setOpen(false); setQuery(city.display); setSelected(city.name);
    setFetching(true); setError('');
    try {
      const res  = await fetch(`${API}/weather/current?city=${encodeURIComponent(city.name + ',' + city.country)}`);
      if (!res.ok) throw new Error('City not found');
      const data: LiveWeather = await res.json();
      setWeather(data); onSelect(city.name + ',' + city.country, data);
    } catch {
      setError('Could not fetch weather — using manual input'); setWeather(null);
    } finally { setFetching(false); }
  };

  return (
    <div className="mb-5">
      <label className="text-xs font-medium text-black mb-1.5 block">
        Site City
        <span className="text-black/30 font-normal ml-1.5">— fetches live weather</span>
      </label>
      <div className="relative">
        <input type="text" value={query} placeholder="Search any city worldwide…"
          onChange={e => handleInput(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-black transition-colors text-black placeholder:text-black/20 pr-8"
        />
        {loading && (
          <svg className="absolute right-3 top-3 animate-spin w-4 h-4 text-black/30" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        )}
        {open && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-30 overflow-hidden">
            {results.map((r, i) => (
              <button key={i} onClick={() => handleSelect(r)}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
                <span className="font-medium text-black">{r.name}</span>
                <span className="text-black/40 ml-1.5 text-xs">{r.state}{r.state ? ', ' : ''}{r.country}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {fetching && (
        <div className="mt-2 flex items-center gap-2 text-xs text-black/40">
          <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          Fetching live weather…
        </div>
      )}
      {error && <p className="mt-1.5 text-[11px] text-amber-600">{error}</p>}
      {weather && !fetching && (
        <div className="mt-3 bg-black rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">Live Weather · {selected}</p>
            <span className="text-[10px] text-emerald-400 font-medium">● Live</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { label:'Temp',     value:`${weather.temperature}°C` },
              { label:'Humidity', value:`${weather.humidity}%` },
              { label:'Wind',     value:`${weather.wind_speed.toFixed(1)} km/h` },
            ].map((s, i) => (
              <div key={i} className="bg-white/5 rounded-lg px-2.5 py-2">
                <p className="text-[9px] text-white/30 uppercase tracking-wider mb-0.5">{s.label}</p>
                <p className="text-sm font-bold text-white">{s.value}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] text-white/30 uppercase tracking-wider mb-0.5">Pot Life</p>
              <p className={`text-sm font-bold ${potLifeColor(weather.pot_life_min)} brightness-150`}>{weather.pot_life_min} min</p>
            </div>
            <div className="text-right">
              <p className="text-[9px] text-white/30 uppercase tracking-wider mb-0.5">Env Risk</p>
              <p className="text-sm font-bold text-white">{weather.risk_score}/100</p>
            </div>
          </div>
          <p className="text-[10px] text-white/25 mt-2 capitalize">{weather.description}</p>
          <p className="text-[9px] text-white/15 mt-1">Parameters auto-filled. You can still adjust manually.</p>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ParameterInputs({
  parameters, onChange, onWeatherChange, onCementChange, onCityChange,
}: ParameterInputsProps) {
  const [useBlocks,  setUseBlocks]  = useState(false);
  const [startHour,  setStartHour]  = useState(8.0);
  const [blocks,     setBlocks]     = useState<WeatherBlock[]>([newBlock(8)]);
  const [materialId, setMaterialId] = useState('sika-733w-3d-us');
  const [customMix,  setCustomMix]  = useState<Record<string, string>>({});

  const selectedMaterial = MATERIALS.find(m => m.id === materialId) ?? MATERIALS[0];

  const updateParam = (key: keyof Parameters, value: any) =>
    onChange({ ...parameters, [key]: value });

  const updateBlock = (id: string, key: keyof WeatherBlock, value: any) => {
    const updated = blocks.map(b => b.id === id ? { ...b, [key]: value } : b);
    setBlocks(updated); onWeatherChange?.(updated, startHour);
  };

  const addBlock = () => {
    const lastEnd = blocks.length > 0 ? blocks[blocks.length - 1].end_hour : startHour;
    const updated = [...blocks, newBlock(lastEnd)];
    setBlocks(updated); onWeatherChange?.(updated, startHour);
  };

  const removeBlock = (id: string) => {
    const updated = blocks.filter(b => b.id !== id);
    setBlocks(updated); onWeatherChange?.(updated, startHour);
  };

  const handleCityWeather = (city: string, weather: LiveWeather) => {
    onCityChange?.(city);
    onChange({ ...parameters, temperature: Math.round(weather.temperature), humidity: Math.round(weather.humidity), windSpeed: Math.round(weather.wind_speed) });
  };

  const handleMaterialChange = (id: string) => {
    setMaterialId(id);
    onCementChange?.(id);
  };

  const ENV_FIELDS = [
    { key:'temperature' as keyof Parameters, label:'Temperature', unit:'°C',   min:5,  max:45, step:0.5 },
    { key:'humidity'    as keyof Parameters, label:'Humidity',    unit:'%',    min:30, max:100, step:1 },
    { key:'windSpeed'   as keyof Parameters, label:'Wind Speed',  unit:'km/h', min:0,  max:60, step:0.5 },
    { key:'groundSlope' as keyof Parameters, label:'Ground Slope', unit:'°',  min:0,  max:15, step:0.1 },
  ];

  return (
    <div className="space-y-4">

      {/* Environmental Conditions */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[10px] font-semibold text-black/40 uppercase tracking-widest">Environmental Conditions</h2>
          <div className="flex items-center gap-1 bg-gray-50 border border-gray-100 rounded-xl p-1">
            <button onClick={() => setUseBlocks(false)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors ${!useBlocks?'bg-black text-white':'text-black/40 hover:text-black'}`}>
              Single
            </button>
            <button onClick={() => setUseBlocks(true)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors ${useBlocks?'bg-black text-white':'text-black/40 hover:text-black'}`}>
              Time blocks
            </button>
          </div>
        </div>

        <CitySearch onSelect={handleCityWeather}/>

        {!useBlocks && (
          <div className="space-y-5">
            {ENV_FIELDS.map(f => (
              <div key={f.key}>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-black">{f.label}</label>
                  <div className="flex items-center gap-1.5">
                    <input type="number" value={parameters[f.key] as number}
                      onChange={e => updateParam(f.key, Number(e.target.value))}
                      className="w-14 px-2 py-1 text-xs font-mono text-right border border-gray-200 rounded-lg focus:outline-none focus:border-black text-black"/>
                    <span className="text-xs text-black/40">{f.unit}</span>
                  </div>
                </div>
                <input type="range" min={f.min} max={f.max} step={f.step}
                  value={parameters[f.key] as number}
                  onChange={e => updateParam(f.key, Number(e.target.value))}
                  className="w-full h-1 bg-gray-100 rounded-full appearance-none cursor-pointer accent-black"/>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-black/25">{f.min}{f.unit}</span>
                  <span className="text-[10px] text-black/25">{f.max}{f.unit}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {useBlocks && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-black flex-shrink-0">Print starts at</label>
              <input type="number" min={0} max={23} step={0.5} value={startHour}
                onChange={e => { setStartHour(Number(e.target.value)); onWeatherChange?.(blocks, Number(e.target.value)); }}
                className="w-20 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-black text-black"/>
              <span className="text-xs text-black/40">{hourToLabel(startHour)}</span>
            </div>
            <div className="space-y-3">
              {blocks.map((block, idx) => (
                <div key={block.id} className="border border-gray-100 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold text-black/30 uppercase tracking-wider">Block {idx+1}</span>
                      <span className="text-[10px] text-black/40">{hourToLabel(block.start_hour)} – {hourToLabel(block.end_hour)}</span>
                    </div>
                    {blocks.length > 1 && (
                      <button onClick={() => removeBlock(block.id)} className="text-black/20 hover:text-black">&times;</button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-[10px] text-black/40 mb-1 block">Start (hour)</label>
                      <input type="number" min={0} max={23} step={0.5} value={block.start_hour}
                        onChange={e => updateBlock(block.id,'start_hour',Number(e.target.value))}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-black text-black"/>
                    </div>
                    <div>
                      <label className="text-[10px] text-black/40 mb-1 block">End (hour)</label>
                      <input type="number" min={0} max={24} step={0.5} value={block.end_hour}
                        onChange={e => updateBlock(block.id,'end_hour',Number(e.target.value))}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-black text-black"/>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { key:'temperature', label:'Temp °C',    min:5,  max:45 },
                      { key:'humidity',    label:'Humidity %', min:20, max:100 },
                      { key:'wind_speed',  label:'Wind km/h',  min:0,  max:60 },
                      { key:'ground_slope',label:'Slope °',    min:0,  max:15 },
                    ].map(f => (
                      <div key={f.key}>
                        <label className="text-[10px] text-black/40 mb-1 block">{f.label}</label>
                        <input type="number" min={f.min} max={f.max} value={(block as any)[f.key]}
                          onChange={e => updateBlock(block.id, f.key as keyof WeatherBlock, Number(e.target.value))}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-black text-black"/>
                      </div>
                    ))}
                  </div>
                  <input type="text" placeholder="Notes (optional)" value={block.notes}
                    onChange={e => updateBlock(block.id,'notes',e.target.value)}
                    className="w-full mt-3 px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:border-black text-black placeholder:text-black/20"/>
                </div>
              ))}
            </div>
            <button onClick={addBlock}
              className="w-full py-2 text-xs font-medium border border-dashed border-gray-300 rounded-xl text-black/40 hover:text-black hover:border-black transition-colors">
              Add time block
            </button>
          </div>
        )}
      </div>

      {/* Material */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[10px] font-semibold text-black/40 uppercase tracking-widest">Material</h2>
          <Link href="/definitions"
            className="text-[10px] font-semibold text-black/40 hover:text-black transition-colors underline underline-offset-2">
            View definitions →
          </Link>
        </div>

        {/* Dropdown */}
        <div className="mb-4">
          <select
            value={materialId}
            onChange={e => handleMaterialChange(e.target.value)}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-black transition-colors text-black bg-white appearance-none cursor-pointer"
          >
            {MATERIALS.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}{m.region !== '—' ? ` — ${m.region}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Selected material quick stats */}
        {materialId !== 'custom' && (
          <div className="bg-black rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-white">{selectedMaterial.name}</p>
              <span className="text-[10px] text-white/40 font-mono">{selectedMaterial.region}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label:'Pot life 20°C', value:`${selectedMaterial.potLife20c} min` },
                { label:'Pot life 30°C', value:`${selectedMaterial.potLife30c} min` },
                { label:'Pot life 10°C', value:`${selectedMaterial.potLife10c} min` },
                { label:'28d strength',  value:selectedMaterial.strength28d },
                { label:'Grain size',    value:`≤ ${selectedMaterial.grainSize} mm` },
                { label:'Layer height',  value:`${selectedMaterial.layerMin}–${selectedMaterial.layerMax} mm` },
                { label:'Water ratio',   value:selectedMaterial.waterRatio },
                { label:'Spread flow',   value:`${selectedMaterial.spreadFlow} mm` },
                { label:'Colour',        value:selectedMaterial.colour },
              ].map((s, i) => (
                <div key={i} className="bg-white/5 rounded-lg px-2.5 py-2">
                  <p className="text-[8px] text-white/30 uppercase tracking-wide mb-0.5">{s.label}</p>
                  <p className="text-[11px] font-semibold text-white">{s.value}</p>
                </div>
              ))}
            </div>
            <p className="text-[9px] text-white/25 mt-3">{selectedMaterial.co2}</p>
          </div>
        )}

        {/* Custom mortar */}
        {materialId === 'custom' && (
          <div className="space-y-3">
            <p className="text-[10px] text-black/40 mb-3">
              Enter your mortar parameters so the RL optimizer can adapt print speed, wait times, and risk scoring to your mix.
            </p>
            {[
              { key:'pot_life_20c',     label:'Pot life @ 20°C (min)',  placeholder:'60',   type:'number' },
              { key:'pot_life_30c',     label:'Pot life @ 30°C (min)',  placeholder:'40',   type:'number' },
              { key:'layer_height_min', label:'Min layer height (mm)',   placeholder:'6',    type:'number' },
              { key:'layer_height_max', label:'Max layer height (mm)',   placeholder:'20',   type:'number' },
              { key:'max_grain_mm',     label:'Max grain size (mm)',     placeholder:'3',    type:'number' },
              { key:'spread_flow_mm',   label:'Spread flow (mm)',        placeholder:'130',  type:'number' },
              { key:'w_c_ratio',        label:'W/C ratio',               placeholder:'0.45', type:'number' },
              { key:'mix_name',         label:'Mix name / brand',        placeholder:'e.g. BASF 3D-Print 100', type:'text' },
            ].map(field => (
              <div key={field.key}>
                <label className="block text-[11px] font-medium text-black/50 mb-1">{field.label}</label>
                <input type={field.type} placeholder={field.placeholder}
                  value={customMix[field.key] ?? ''}
                  onChange={e => {
                    const updated = { ...customMix, [field.key]: e.target.value };
                    setCustomMix(updated);
                    onCementChange?.('custom:' + JSON.stringify(updated));
                  }}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-black text-black placeholder:text-black/20"/>
              </div>
            ))}
          </div>
        )}

        {/* Batch number */}
        <div className="mt-4">
          <label className="block text-xs font-medium text-black mb-1.5">Batch Number</label>
          <input type="text" value={parameters.batchNumber}
            onChange={e => updateParam('batchNumber', e.target.value)}
            placeholder="e.g. BATCH-2024-001"
            className="w-full px-3 py-2.5 text-sm font-mono border border-gray-200 rounded-xl focus:outline-none focus:border-black text-black placeholder:text-black/20 placeholder:font-sans"/>
        </div>
      </div>

    </div>
  );
}