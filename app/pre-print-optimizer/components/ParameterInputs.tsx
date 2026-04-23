'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
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
  parameters:         Parameters;
  onChange:           (params: Parameters) => void;
  onWeatherChange?:   (blocks: WeatherBlock[], startHour: number) => void;
  onCementChange?:    (cement: string) => void;
  onCityChange?:      (city: string) => void;
  onStartHourChange?: (hour: number) => void;
}

interface CityResult { name: string; country: string; state: string; display: string; }
interface LiveWeather { temperature: number; humidity: number; wind_speed: number; description: string; pot_life_min: number; risk_score: number; }
interface ForecastHour { hour: number; temperature: number; humidity: number; wind_speed: number; description: string; risk: number; }

export const MATERIALS = [
  { id:'sika-733-3d', name:'Sikacrete®-733 3D', region:'UK / CA / DE', colour:'Grey powder', waterRatio:'13–14%', strength28d:'35 MPa', potLife20c:60, potLife30c:40, potLife10c:80, layerMin:6, layerMax:40, grainSize:3, spreadFlow:130, co2:'Reduced (recycled SCM)' },
  { id:'sika-733w-3d-us', name:'Sikacrete®-733 W 3D', region:'USA', colour:'White powder', waterRatio:'15–17%', strength28d:'50 MPa', potLife20c:60, potLife30c:40, potLife10c:80, layerMin:6, layerMax:20, grainSize:3, spreadFlow:130, co2:'Reduced (recycled waste)' },
  { id:'sika-733w-3d-gcc', name:'Sikacrete®-733 W 3D (GCC)', region:'Gulf / UAE / KSA', colour:'White powder', waterRatio:'15–17%', strength28d:'35 MPa', potLife20c:60, potLife30c:40, potLife10c:80, layerMin:6, layerMax:20, grainSize:3, spreadFlow:130, co2:'Reduced (recycled waste)' },
  { id:'custom', name:'Custom Mortar', region:'—', colour:'—', waterRatio:'—', strength28d:'—', potLife20c:60, potLife30c:40, potLife10c:80, layerMin:6, layerMax:20, grainSize:3, spreadFlow:130, co2:'—' },
];

function hourToLabel(h: number) {
  const hh = Math.floor(h), mm = Math.round((h-hh)*60);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const disp = hh > 12 ? hh-12 : hh === 0 ? 12 : hh;
  return `${disp}:${String(mm).padStart(2,'0')} ${ampm}`;
}

function newBlock(startH: number): WeatherBlock {
  return { id:Math.random().toString(36).slice(2), start_hour:startH, end_hour:startH+2, temperature:26, humidity:60, wind_speed:8, ground_slope:0, notes:'' };
}

function riskColor(r: number) { return r < 20 ? 'text-emerald-500' : r < 50 ? 'text-amber-500' : 'text-red-500'; }

const inputCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-black transition-colors text-black placeholder:text-black/20 bg-white';
const labelCls = 'text-[10px] font-semibold text-black/40 uppercase tracking-widest';

function SliderRow({ label, value, unit, min, max, step, onChange }: {
  label: string; value: number; unit: string; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-sm font-medium text-black">{label}</span>
        <div className="flex items-center gap-1.5">
          <input type="number" value={value} min={min} max={max} step={step}
            onChange={e => onChange(Number(e.target.value))}
            className="w-14 px-2 py-1 text-xs font-mono text-right border border-gray-200 rounded-lg focus:outline-none focus:border-black text-black"/>
          <span className="text-xs text-black/35 w-8">{unit}</span>
        </div>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-0.5 rounded-full appearance-none cursor-pointer accent-black bg-gray-200"/>
      <div className="flex justify-between mt-1.5">
        <span className="text-[10px] text-black/25">{min}{unit}</span>
        <span className="text-[10px] text-black/25">{max}{unit}</span>
      </div>
    </div>
  );
}

function CitySearch({ onSelect, startHour }: { onSelect: (city: string, weather: LiveWeather) => void; startHour: number; }) {
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState<CityResult[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [fetching, setFetching] = useState(false);
  const [open,     setOpen]     = useState(false);
  const [selected, setSelected] = useState('');
  const [weather,  setWeather]  = useState<LiveWeather | null>(null);
  const [forecast, setForecast] = useState<ForecastHour[]>([]);
  const [error,    setError]    = useState('');
  const debounce    = useRef<NodeJS.Timeout | null>(null);
  const cityStrRef  = useRef('');
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; });

  const searchCities = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/weather/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []); setOpen(true);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, []);

  const handleInput = (val: string) => {
    setQuery(val); setError('');
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => searchCities(val), 400);
  };

  const doFetch = useCallback(async (cityStr: string, hour: number) => {
    setFetching(true); setError('');
    try {
      const fRes = await fetch(`${API}/weather/forecast?city=${encodeURIComponent(cityStr)}&start_hour=${hour}&hours=8`);
      if (!fRes.ok) throw new Error();
      const fd = await fRes.json();
      if (!Array.isArray(fd) || fd.length === 0) throw new Error();
      setForecast(fd);
      const p = fd[0];
      const w: LiveWeather = {
        temperature: p.temperature, humidity: p.humidity, wind_speed: p.wind_speed,
        description: p.description, pot_life_min: 60, risk_score: p.risk,
      };
      setWeather(w);
      onSelectRef.current(cityStr, w);
    } catch {
      // fallback: current weather
      try {
        const res = await fetch(`${API}/weather/current?city=${encodeURIComponent(cityStr)}`);
        if (!res.ok) throw new Error();
        const data: LiveWeather = await res.json();
        setWeather(data);
        onSelectRef.current(cityStr, data);
        try {
          const fRes2 = await fetch(`${API}/weather/forecast?city=${encodeURIComponent(cityStr)}&start_hour=${hour}&hours=8`);
          if (fRes2.ok) { const fd2 = await fRes2.json(); if (Array.isArray(fd2)) setForecast(fd2); }
        } catch { /* optional */ }
      } catch {
        setError('Could not fetch weather — using manual sliders'); setWeather(null);
      }
    } finally { setFetching(false); }
  }, []);

  // Re-fetch forecast when startHour changes after a city is already selected
  useEffect(() => {
    if (cityStrRef.current) doFetch(cityStrRef.current, startHour);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startHour]);

  const handleSelect = async (city: CityResult) => {
    setOpen(false); setQuery(city.display); setSelected(city.name);
    setForecast([]);
    const cityStr = `${city.name},${city.country}`;
    cityStrRef.current = cityStr;
    await doFetch(cityStr, startHour);
  };

  return (
    <div>
      <div className="relative">
        <input type="text" value={query} placeholder="Search any city worldwide…"
          onChange={e => handleInput(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          className={inputCls + ' pr-8'}/>
        {loading && (
          <svg className="absolute right-3 top-3 animate-spin w-4 h-4 text-black/20" viewBox="0 0 24 24" fill="none">
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
                <span className="text-black/35 ml-1.5 text-xs">{r.state}{r.state?', ':''}{r.country}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {fetching && (
        <div className="mt-2 flex items-center gap-2 text-xs text-black/35">
          <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          Fetching forecast…
        </div>
      )}
      {error && <p className="mt-1.5 text-[11px] text-amber-600">{error}</p>}

      {weather && !fetching && (
        <div className="mt-3 bg-black rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">{selected}</p>
            <span className="text-[9px] font-medium text-white/40">Forecast · {hourToLabel(startHour)}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { label:'Temp',     value:`${weather.temperature}°C` },
              { label:'Humidity', value:`${weather.humidity}%` },
              { label:'Wind',     value:`${weather.wind_speed.toFixed(1)} km/h` },
            ].map((s,i) => (
              <div key={i} className="bg-white/6 rounded-xl px-2.5 py-2">
                <p className="text-[9px] text-white/30 mb-0.5">{s.label}</p>
                <p className="text-sm font-semibold text-white">{s.value}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between py-2 border-t border-white/8">
            <div><p className="text-[9px] text-white/30 mb-0.5">Env Risk</p><p className={`text-sm font-semibold ${riskColor(weather.risk_score)}`}>{weather.risk_score}/100</p></div>
            <div className="text-right"><p className="text-[9px] text-white/30 mb-0.5">Conditions</p><p className="text-[11px] text-white/50 capitalize">{weather.description}</p></div>
          </div>
          {forecast.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/8">
              <p className="text-[9px] text-white/25 uppercase tracking-widest mb-2">Forecast from {hourToLabel(startHour)}</p>
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                {forecast.map((f,i) => (
                  <div key={i} className={`flex-shrink-0 rounded-xl px-2.5 py-2 text-center min-w-[52px] border ${
                    f.risk>50?'bg-red-500/15 border-red-500/20':f.risk>20?'bg-amber-400/10 border-amber-400/15':'bg-white/5 border-white/5'
                  }`}>
                    <p className="text-[8px] text-white/30 mb-0.5">{hourToLabel(f.hour)}</p>
                    <p className="text-[12px] font-semibold text-white">{f.temperature}°</p>
                    <p className={`text-[8px] font-medium mt-0.5 ${riskColor(f.risk)}`}>{f.risk>50?'High':f.risk>20?'Med':'OK'}</p>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-white/15 mt-2">RL adapts speed per hour block</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ParameterInputs({
  parameters, onChange, onWeatherChange, onCementChange, onCityChange, onStartHourChange,
}: ParameterInputsProps) {
  const [useBlocks,  setUseBlocks]  = useState(false);
  const [startHour,  setStartHour]  = useState(8.0);
  const [blocks,     setBlocks]     = useState<WeatherBlock[]>([newBlock(8)]);
  const [materialId, setMaterialId] = useState('sika-733w-3d-us');
  const [customMix,  setCustomMix]  = useState<Record<string,string>>({});

  const selected = MATERIALS.find(m => m.id === materialId) ?? MATERIALS[0];
  const updateParam = (key: keyof Parameters, value: any) => onChange({ ...parameters, [key]: value });

  const updateBlock = (id: string, key: keyof WeatherBlock, value: any) => {
    const updated = blocks.map(b => b.id===id ? {...b,[key]:value} : b);
    setBlocks(updated); onWeatherChange?.(updated, startHour);
  };

  const addBlock = () => {
    const lastEnd = blocks.length > 0 ? blocks[blocks.length-1].end_hour : startHour;
    const updated = [...blocks, newBlock(lastEnd)];
    setBlocks(updated); onWeatherChange?.(updated, startHour);
  };

  const removeBlock = (id: string) => {
    const updated = blocks.filter(b => b.id!==id);
    setBlocks(updated); onWeatherChange?.(updated, startHour);
  };

  const handleStartHour = (h: number) => {
    setStartHour(h); onWeatherChange?.(blocks, h); onStartHourChange?.(h);
  };

  const handleCityWeather = (city: string, weather: LiveWeather) => {
    onCityChange?.(city);
    onChange({ ...parameters, temperature:Math.round(weather.temperature), humidity:Math.round(weather.humidity), windSpeed:Math.round(weather.wind_speed) });
  };

  return (
    <div className="space-y-4">

      {/* Environmental Conditions */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-50">
          <p className={labelCls}>Environmental Conditions</p>
          <div className="flex items-center gap-0.5 p-0.5 bg-gray-50 border border-gray-100 rounded-xl">
            {[{label:'Single',v:false},{label:'Time blocks',v:true}].map(opt=>(
              <button key={opt.label} onClick={()=>setUseBlocks(opt.v)}
                className={`px-3 py-1.5 text-[11px] font-medium rounded-lg transition-colors ${
                  useBlocks===opt.v?'bg-black text-white':'text-black/40 hover:text-black'
                }`}>{opt.label}</button>
            ))}
          </div>
        </div>

        <div className="px-5 py-5 space-y-5">
          {/* Start time */}
          <div>
            <p className={labelCls + ' mb-2'}>Print Start Time</p>
            <div className="flex items-center gap-3">
              <input type="time"
                value={`${String(Math.floor(startHour)).padStart(2,'0')}:${String(Math.round((startHour%1)*60)).padStart(2,'0')}`}
                onChange={e => { const [hh,mm]=e.target.value.split(':').map(Number); handleStartHour(hh+mm/60); }}
                className="px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-black transition-colors text-black bg-white"/>
              <span className="text-xs text-black/35">{hourToLabel(startHour)}</span>
              <span className="text-[10px] text-black/20 ml-auto hidden sm:block">RL adapts speed to hourly forecast</span>
            </div>
          </div>

          {/* City search */}
          <div>
            <p className={labelCls + ' mb-2'}>Site City <span className="text-black/25 normal-case font-normal">— live weather + forecast</span></p>
            <CitySearch onSelect={handleCityWeather} startHour={startHour}/>
          </div>

          {/* Single sliders */}
          {!useBlocks && (
            <>
              <SliderRow label="Temperature" value={parameters.temperature} unit="°C"   min={5}  max={45}  step={0.5} onChange={v=>updateParam('temperature',v)}/>
              <SliderRow label="Humidity"    value={parameters.humidity}    unit="%"    min={30} max={100} step={1}   onChange={v=>updateParam('humidity',v)}/>
              <SliderRow label="Wind Speed"  value={parameters.windSpeed}   unit="km/h" min={0}  max={60}  step={0.5} onChange={v=>updateParam('windSpeed',v)}/>
            </>
          )}

          {/* Time blocks */}
          {useBlocks && (
            <div className="space-y-3">
              {blocks.map((block,idx)=>(
                <div key={block.id} className="border border-gray-100 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={labelCls}>Block {idx+1}</span>
                      <span className="text-[10px] text-black/35">{hourToLabel(block.start_hour)} – {hourToLabel(block.end_hour)}</span>
                    </div>
                    {blocks.length > 1 && (
                      <button onClick={()=>removeBlock(block.id)} className="text-black/20 hover:text-black text-xl leading-none">&times;</button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[{k:'start_hour',l:'Start hour'},{k:'end_hour',l:'End hour'}].map(f=>(
                      <div key={f.k}>
                        <p className="text-[10px] text-black/35 mb-1">{f.l}</p>
                        <input type="number" min={0} max={24} step={0.5} value={(block as any)[f.k]}
                          onChange={e=>updateBlock(block.id,f.k as keyof WeatherBlock,Number(e.target.value))}
                          className={inputCls}/>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[{k:'temperature',l:'Temp °C',min:5,max:45},{k:'humidity',l:'Humidity %',min:20,max:100},{k:'wind_speed',l:'Wind km/h',min:0,max:60}].map(f=>(
                      <div key={f.k}>
                        <p className="text-[10px] text-black/35 mb-1">{f.l}</p>
                        <input type="number" min={f.min} max={f.max} value={(block as any)[f.k]}
                          onChange={e=>updateBlock(block.id,f.k as keyof WeatherBlock,Number(e.target.value))}
                          className={inputCls}/>
                      </div>
                    ))}
                  </div>
                  <input type="text" placeholder="Notes (optional)" value={block.notes}
                    onChange={e=>updateBlock(block.id,'notes',e.target.value)}
                    className={inputCls + ' text-xs'}/>
                </div>
              ))}
              <button onClick={addBlock}
                className="w-full py-2.5 text-xs font-medium border border-dashed border-gray-200 rounded-xl text-black/35 hover:text-black hover:border-black transition-colors">
                + Add time block
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Material */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-50">
          <p className={labelCls}>Material</p>
          <Link href="/definitions" className="text-[10px] text-black/35 hover:text-black transition-colors underline underline-offset-2">
            View definitions →
          </Link>
        </div>

        <div className="px-5 py-5 space-y-4">
          {/* Selector */}
          <div className="relative">
            <select value={materialId} onChange={e=>{setMaterialId(e.target.value);onCementChange?.(e.target.value);}}
              className={inputCls + ' appearance-none pr-8 cursor-pointer'}>
              {MATERIALS.map(m=>(
                <option key={m.id} value={m.id}>{m.name}{m.region!=='—'?` — ${m.region}`:''}</option>
              ))}
            </select>
            <svg className="absolute right-3 top-3.5 w-3.5 h-3.5 text-black/30 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
            </svg>
          </div>

          {/* Material card */}
          {materialId !== 'custom' && (
            <div className="bg-black rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-white">{selected.name}</p>
                <span className="text-[10px] text-white/35 font-mono">{selected.region}</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 mb-3">
                {[
                  {l:'Pot life 20°C',v:`${selected.potLife20c} min`},
                  {l:'Pot life 30°C',v:`${selected.potLife30c} min`},
                  {l:'Pot life 10°C',v:`${selected.potLife10c} min`},
                  {l:'28d strength', v:selected.strength28d},
                  {l:'Grain size',   v:`≤ ${selected.grainSize} mm`},
                  {l:'Layer height', v:`${selected.layerMin}–${selected.layerMax} mm`},
                  {l:'Water ratio',  v:selected.waterRatio},
                  {l:'Spread flow',  v:`${selected.spreadFlow} mm`},
                  {l:'Colour',       v:selected.colour},
                ].map((s,i)=>(
                  <div key={i} className="bg-white/5 rounded-xl px-2.5 py-2">
                    <p className="text-[8px] text-white/25 mb-0.5">{s.l}</p>
                    <p className="text-[11px] font-semibold text-white leading-tight">{s.v}</p>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-white/20">{selected.co2}</p>
            </div>
          )}

          {/* Custom mortar */}
          {materialId === 'custom' && (
            <div className="space-y-3">
              <p className="text-[10px] text-black/40">Enter your mortar parameters so the RL optimizer can adapt.</p>
              {[
                {k:'pot_life_20c',    l:'Pot life @ 20°C (min)', p:'60',   t:'number'},
                {k:'pot_life_30c',    l:'Pot life @ 30°C (min)', p:'40',   t:'number'},
                {k:'layer_height_min',l:'Min layer height (mm)',  p:'6',    t:'number'},
                {k:'layer_height_max',l:'Max layer height (mm)',  p:'20',   t:'number'},
                {k:'max_grain_mm',    l:'Max grain size (mm)',    p:'3',    t:'number'},
                {k:'spread_flow_mm',  l:'Spread flow (mm)',       p:'130',  t:'number'},
                {k:'w_c_ratio',       l:'W/C ratio',              p:'0.45', t:'number'},
                {k:'mix_name',        l:'Mix name / brand',       p:'e.g. BASF 3D-Print 100', t:'text'},
              ].map(f=>(
                <div key={f.k}>
                  <p className="text-[10px] text-black/40 mb-1">{f.l}</p>
                  <input type={f.t} placeholder={f.p} value={customMix[f.k]??''}
                    onChange={e=>{const u={...customMix,[f.k]:e.target.value};setCustomMix(u);onCementChange?.('custom:'+JSON.stringify(u));}}
                    className={inputCls}/>
                </div>
              ))}
            </div>
          )}

          {/* Batch number */}
          <div>
            <p className={labelCls + ' mb-2'}>Batch Number</p>
            <input type="text" value={parameters.batchNumber}
              onChange={e=>updateParam('batchNumber',e.target.value)}
              placeholder="e.g. BATCH-2024-001"
              className={inputCls + ' font-mono'}/>
          </div>
        </div>
      </div>

    </div>
  );
}