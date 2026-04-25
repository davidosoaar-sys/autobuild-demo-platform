'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { MATERIALS } from '@/app/pre-print-optimizer/components/ParameterInputs';
import { StatRow, FactorRow, ScanIssueRow, Factor } from '@/app/pre-print-optimizer/components/ResultComponents';
import { supabase } from '@/lib/supabase';
import dynamic from 'next/dynamic';

const LayerVisualization = dynamic(
  () => import('@/app/pre-print-optimizer/components/LayerVisualization'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full min-h-[520px]">
        <div className="text-center">
          <motion.div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full mx-auto mb-3"
            animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }} />
          <p className="text-white/30 text-xs">Loading 3D viewer…</p>
        </div>
      </div>
    ),
  },
);

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface CityResult   { name: string; country: string; state: string; display: string; }
interface LiveWeather  { temperature: number; humidity: number; wind_speed: number; description: string; pot_life_min: number; risk_score: number; }
interface ForecastHour { hour: number; temperature: number; humidity: number; wind_speed: number; description: string; risk: number; }

interface LayerStat {
  layer: number; z_height_mm: number; segments: number;
  perimeter_mm: number; area_cm2: number; complexity: number;
  print_speed_mm_s: number; risk_score: number; temperature_c?: number;
}

interface SlicerResult {
  result_id?: string;
  estimated_print_time: string;
  estimated_print_time_s?: number;
  cement?: { display_name?: string; open_time_min: number; risk_score?: number };
  geometry: { total_layers: number; num_layers?: number; layer_height?: number; bounds_x?: [number,number]; bounds_y?: [number,number]; total_height_m?: number };
  printer: { layer_height_mm: number; nozzle_mm: number; effective_speed: number };
  weather: { city: string; source?: string; avg: { temperature: number; humidity: number; wind_speed: number }; worst?: { temperature: number } };
  toolpath: unknown[];
  gcode_full: string;
  gcode_lines: number;
  elapsed_seconds?: number;
  optimization?: { time_saved_pct: number; env_risk_score: number; total_travel_mm: number; naive_travel_mm: number; total_segments: number };
  layer_stats?: LayerStat[];
}

interface TimeBlock { id: string; start: string; end: string; }

interface CustomMix {
  potLife10c: number; potLife20c: number; potLife30c: number;
  layerMin: number;   layerMax: number;
  grainSize: number;  spreadFlow: number;
  waterRatio: string; strength28d: string;
}

type SidebarPanel = 'results' | 'layers' | 'changes' | 'scan';

const DEFAULT_CUSTOM: CustomMix = {
  potLife10c: 80, potLife20c: 60, potLife30c: 40,
  layerMin: 6,   layerMax: 20,
  grainSize: 3,  spreadFlow: 130,
  waterRatio: '15–17%', strength28d: '—',
};

const todayStr   = () => new Date().toISOString().split('T')[0];
const nowTimeStr = () => { const d = new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
const toDecimalHour = (t: string) => { const [h, m] = t.split(':').map(Number); return h + m / 60; };
const fmtTime = (t: string) => { const [h, m] = t.split(':').map(Number); const ampm = h >= 12 ? 'PM' : 'AM'; return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ampm}`; };
const newBlock = (): TimeBlock => ({ id: Math.random().toString(36).slice(2), start: '07:00', end: '17:00' });

function interpolateHourly(raw: ForecastHour[], fromHour: number, count: number): ForecastHour[] {
  const result: ForecastHour[] = [];
  for (let i = 0; i < count; i++) {
    const h = fromHour + i;
    let before: ForecastHour | undefined;
    let after:  ForecastHour | undefined;
    for (const f of raw) {
      if (f.hour <= h) before = f;
      else if (!after) { after = f; break; }
    }
    if (!before && !after) break;
    if (!before)                     { result.push({ ...after!,  hour: h }); continue; }
    if (!after || before.hour === h) { result.push({ ...before,  hour: h }); continue; }
    const t = (h - before.hour) / (after.hour - before.hour);
    result.push({
      hour:        h,
      temperature: Math.round((before.temperature + (after.temperature - before.temperature) * t) * 10) / 10,
      humidity:    Math.round( before.humidity    + (after.humidity    - before.humidity)    * t),
      wind_speed:  Math.round((before.wind_speed  + (after.wind_speed  - before.wind_speed)  * t) * 10) / 10,
      description: t < 0.5 ? before.description : after.description,
      risk:        Math.round( before.risk        + (after.risk        - before.risk)        * t),
    });
  }
  return result;
}

function riskColor(r: number) { return r < 20 ? 'text-emerald-400' : r < 50 ? 'text-amber-400' : 'text-red-400'; }
function hourToLabel(h: number) {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const disp = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh;
  return `${disp}:${String(mm).padStart(2, '0')} ${ampm}`;
}

function buildSlicerFactors(result: SlicerResult, cementId: string, selectedMat: typeof MATERIALS[0] | undefined): Factor[] {
  const avg   = result.weather?.avg ?? {};
  const opt   = result.optimization;
  const factors: Factor[] = [];

  const temp = avg.temperature ?? 20;
  if (temp > 30)      factors.push({ label: 'High Temperature', value: `${temp}°C`, impact: `Speed increased ~${Math.round((temp-30)*1.5)}% to outrun cement setting`, ok: false });
  else if (temp < 15) factors.push({ label: 'Low Temperature',  value: `${temp}°C`, impact: 'Slower curing — speed reduced for stronger bonding', ok: false });
  else                factors.push({ label: 'Temperature',      value: `${temp}°C`, impact: 'Optimal range — no speed adjustment required', ok: true });

  const hum = avg.humidity ?? 65;
  if (hum < 50)      factors.push({ label: 'Low Humidity',  value: `${hum}%`, impact: 'Dry air — travel moves minimised', ok: false });
  else if (hum > 80) factors.push({ label: 'High Humidity', value: `${hum}%`, impact: 'Slow drying — speed slightly reduced', ok: false });
  else               factors.push({ label: 'Humidity',      value: `${hum}%`, impact: 'Good range — workability maintained', ok: true });

  const wind = avg.wind_speed ?? 8;
  if (wind > 15)    factors.push({ label: 'High Wind',     value: `${wind} km/h`, impact: 'Windward walls prioritised in segment sequence', ok: false });
  else if (wind > 8) factors.push({ label: 'Moderate Wind', value: `${wind} km/h`, impact: 'Minor adjustment to elevated layer order', ok: false });
  else              factors.push({ label: 'Wind Speed',    value: `${wind} km/h`, impact: 'Calm conditions — no wind compensation needed', ok: true });

  const openTime  = result.cement?.open_time_min ?? selectedMat?.potLife20c ?? 60;
  const riskScore = result.cement?.risk_score    ?? opt?.env_risk_score ?? 0;
  factors.push({
    label: selectedMat?.name ?? cementId, value: `${openTime} min open time`,
    impact: `Risk ${riskScore}/100 — ${riskScore < 20 ? 'low risk' : 'speed adjusted'}`, ok: riskScore < 20,
  });
  if (opt && opt.time_saved_pct > 0) factors.push({ label: 'RL Travel Optimisation', value: `${opt.time_saved_pct}% saved`, impact: `Travel reduced from ${opt.naive_travel_mm}mm to ${opt.total_travel_mm}mm`, ok: true });
  return factors;
}

function CitySearch({
  onSelect, printDate, startTime, onForecastChange,
}: {
  onSelect: (cityStr: string, weather: LiveWeather) => void;
  printDate: string;
  startTime: string;
  onForecastChange?: (data: { temperature: number; humidity: number; wind_speed: number } | null) => void;
}) {
  const [query,               setQuery]               = useState('');
  const [results,             setResults]             = useState<CityResult[]>([]);
  const [loading,             setLoading]             = useState(false);
  const [fetching,            setFetching]            = useState(false);
  const [open,                setOpen]                = useState(false);
  const [selected,            setSelected]            = useState('');
  const [weather,             setWeather]             = useState<LiveWeather | null>(null);
  const [forecast,            setForecast]            = useState<ForecastHour[]>([]);
  const [forecastUnavailable, setForecastUnavailable] = useState(false);
  const [error,               setError]               = useState('');
  const debounce    = useRef<NodeJS.Timeout | null>(null);
  const cityStrRef  = useRef('');
  const onSelectRef = useRef(onSelect);
  const onFCRef     = useRef(onForecastChange);
  useEffect(() => { onSelectRef.current = onSelect; onFCRef.current = onForecastChange; });

  const isOutOfRange = (dateStr: string) => {
    const today  = new Date(); today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr + 'T00:00:00');
    return (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24) > 5;
  };

  const search = useCallback(async (q: string) => {
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
    if (val.length === 0) {
      cityStrRef.current = '';
      setSelected(''); setWeather(null); setForecast([]); setForecastUnavailable(false);
      onSelectRef.current('', { temperature: 20, humidity: 65, wind_speed: 8, description: '', pot_life_min: 60, risk_score: 0 });
      onFCRef.current?.(null);
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(val), 400);
  };

  const doFetch = useCallback(async (cityStr: string, hour: number) => {
    setFetching(true); setError(''); setWeather(null); setForecast([]);
    const fetchFrom = Math.floor(hour / 3) * 3;
    try {
      const fRes = await fetch(`${API}/weather/forecast?city=${encodeURIComponent(cityStr)}&start_hour=${fetchFrom}&hours=12`);
      if (!fRes.ok) throw new Error();
      const fd = await fRes.json();
      if (!Array.isArray(fd) || fd.length === 0) throw new Error();
      setForecast(fd);
      const planned = interpolateHourly(fd, hour, 1)[0] ?? fd[0];
      const w: LiveWeather = { temperature: planned.temperature, humidity: planned.humidity, wind_speed: planned.wind_speed, description: planned.description, pot_life_min: 60, risk_score: planned.risk };
      setWeather(w);
      onSelectRef.current(cityStr, w);
      onFCRef.current?.({ temperature: planned.temperature, humidity: planned.humidity, wind_speed: planned.wind_speed });
    } catch {
      setError('Could not fetch forecast for this date');
      onFCRef.current?.(null);
    } finally { setFetching(false); }
  }, []);

  useEffect(() => {
    if (!cityStrRef.current) return;
    if (isOutOfRange(printDate)) {
      setForecastUnavailable(true); setWeather(null); setForecast([]);
      onFCRef.current?.(null); return;
    }
    setForecastUnavailable(false);
    doFetch(cityStrRef.current, toDecimalHour(startTime));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printDate, startTime]);

  const handleSelect = async (city: CityResult) => {
    setOpen(false); setQuery(city.display); setSelected(city.name);
    setForecastUnavailable(false); setForecast([]);
    const cs = `${city.name},${city.country}`;
    cityStrRef.current = cs;
    if (isOutOfRange(printDate)) {
      setForecastUnavailable(true);
      onSelectRef.current(cs, { temperature: 20, humidity: 65, wind_speed: 8, description: '', pot_life_min: 60, risk_score: 0 });
      onFCRef.current?.(null); return;
    }
    await doFetch(cs, toDecimalHour(startTime));
  };

  const forecastLabel = (() => {
    try {
      const d = new Date(printDate + 'T00:00:00');
      return `${d.toLocaleDateString('en-US', { weekday: 'long' })} ${d.toLocaleDateString('en-US', { day: 'numeric', month: 'long' })} at ${fmtTime(startTime)}`;
    } catch { return fmtTime(startTime); }
  })();

  const iCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-black transition-colors text-black placeholder:text-black/25 bg-white pr-8';

  return (
    <div>
      <div className="relative">
        <input type="text" value={query} placeholder="Search any city worldwide…"
          onChange={e => handleInput(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          className={iCls} />
        {loading && (
          <svg className="absolute right-3 top-3 animate-spin w-4 h-4 text-black/20" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {open && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-30 overflow-hidden">
            {results.map((r, i) => (
              <button key={i} onClick={() => handleSelect(r)}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
                <span className="font-medium text-black">{r.name}</span>
                <span className="text-black/35 ml-1.5 text-xs">{r.state}{r.state ? ', ' : ''}{r.country}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {fetching && (
        <div className="mt-2 flex items-center gap-2 text-xs text-black/35">
          <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Fetching forecast…
        </div>
      )}
      {error && <p className="mt-1.5 text-[11px] text-black/35">{error}</p>}
      {selected && forecastUnavailable && !fetching && (
        <div className="mt-3 bg-black rounded-2xl p-4">
          <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-2">{selected}</p>
          <p className="text-xs text-white/40">Forecast unavailable — enter conditions manually below</p>
        </div>
      )}
      {weather && !fetching && !forecastUnavailable && (
        <div className="mt-3 bg-black rounded-2xl p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">{selected}</p>
            <span className="text-[9px] text-white/30">Forecast</span>
          </div>
          <p className="text-[10px] text-white/50 mb-3">{forecastLabel}</p>
          <div className="grid grid-cols-3 gap-2">
            {[{ label: 'Temp', value: `${weather.temperature}°C` }, { label: 'Humidity', value: `${weather.humidity}%` }, { label: 'Wind', value: `${weather.wind_speed.toFixed(1)} km/h` }].map((s, i) => (
              <div key={i} className="bg-white/6 rounded-xl px-2.5 py-2">
                <p className="text-[9px] text-white/30 mb-0.5">{s.label}</p>
                <p className="text-sm font-semibold text-white">{s.value}</p>
              </div>
            ))}
          </div>
          {forecast.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/8">
              <p className="text-[9px] text-white/25 uppercase tracking-widest mb-2">8-hour outlook</p>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {interpolateHourly(forecast, toDecimalHour(startTime), 8).map((f, i) => (
                  <div key={i} className={`flex-shrink-0 rounded-xl px-2.5 py-2 text-center min-w-[52px] border ${f.risk > 50 ? 'bg-red-500/15 border-red-500/20' : f.risk > 20 ? 'bg-amber-400/10 border-amber-400/15' : 'bg-white/5 border-white/5'}`}>
                    <p className="text-[8px] text-white/30 mb-0.5">{hourToLabel(f.hour)}</p>
                    <p className="text-[12px] font-semibold text-white">{f.temperature}°</p>
                    <p className={`text-[8px] font-medium mt-0.5 ${riskColor(f.risk)}`}>{f.risk > 50 ? 'High' : f.risk > 20 ? 'Med' : 'OK'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const inputCls  = 'w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:border-black transition-colors text-black';
const selectCls = 'w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black transition-colors text-black';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, min, max, step }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <input type="number" value={value} min={min} max={max} step={step ?? 1}
      onChange={e => onChange(Number(e.target.value))} className={inputCls} />
  );
}

export default function SlicerTool() {
  const router       = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file,        setFile]        = useState<File | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [result,      setResult]      = useState<SlicerResult | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [error,       setError]       = useState('');
  const [sliceSaved,  setSliceSaved]  = useState(false);
  const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel>('results');
  const [showSidebar,  setShowSidebar]  = useState(true);

  // Weather
  const [cityStr,          setCityStr]          = useState('');
  const [printDate,        setPrintDate]        = useState<string>(todayStr);
  const [startTime,        setStartTime]        = useState<string>(nowTimeStr);
  const [forecastWeather,  setForecastWeather]  = useState<{ temperature: number; humidity: number; wind_speed: number } | null>(null);
  const [manualTemp,       setManualTemp]       = useState(20);
  const [manualHumidity,   setManualHumidity]   = useState(65);
  const [manualWind,       setManualWind]       = useState(8);

  // Printer
  const [nozzle,       setNozzle]       = useState(25);
  const [compression,  setCompression]  = useState(0.6);
  const [velocity,     setVelocity]     = useState(100);
  const [hoseLength,   setHoseLength]   = useState(15);
  const [flowRate,     setFlowRate]     = useState(8);
  const [acceleration, setAcceleration] = useState(500);

  // Cement
  const [cementId,  setCementId]  = useState('sika-733w-3d-us');
  const [customMix, setCustomMix] = useState<CustomMix>(DEFAULT_CUSTOM);

  // Infill (Task 8)
  const [infillPattern, setInfillPattern] = useState('none');
  const [infillDensity, setInfillDensity] = useState(0.4);

  // Time blocks (Task 9)
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([newBlock()]);

  const layerHeightMm = Math.round(nozzle * compression) / 10;
  const selectedMat   = MATERIALS.find(m => m.id === cementId);
  const isCustom      = cementId === 'custom';

  const setCustomField = <K extends keyof CustomMix>(k: K, v: CustomMix[K]) =>
    setCustomMix(prev => ({ ...prev, [k]: v }));

  const handleFile = (f: File | null) => { setFile(f); setResult(null); setShowResults(false); setError(''); };

  const addTimeBlock = () => setTimeBlocks(prev => [...prev, newBlock()]);
  const addBreak = () => {
    const last = timeBlocks[timeBlocks.length - 1];
    const breakEnd = last?.end ?? '17:00';
    const [bh, bm] = breakEnd.split(':').map(Number);
    const resumeH  = bh + 1;
    setTimeBlocks(prev => [...prev, { id: Math.random().toString(36).slice(2), start: `${String(resumeH).padStart(2,'0')}:00`, end: `${String(resumeH+8).padStart(2,'0')}:00` }]);
  };
  const removeTimeBlock = (id: string) => setTimeBlocks(prev => prev.filter(b => b.id !== id));

  const totalBlockHours = timeBlocks.reduce((sum, b) => {
    const s = toDecimalHour(b.start), e = toDecimalHour(b.end);
    return sum + Math.max(0, e - s);
  }, 0);

  const run = async () => {
    if (!file) return;
    setLoading(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file',                 file);
      fd.append('nozzle_diameter_mm',   String(nozzle));
      fd.append('bead_compression',     String(compression));
      fd.append('max_speed_mm_s',       String(velocity));
      fd.append('base_speed_mm_s',      String(Math.round(velocity * 0.6)));
      fd.append('hose_length_m',        String(hoseLength));
      fd.append('max_mass_flow_l_min',  String(flowRate));
      fd.append('acceleration_mm_s2',   String(acceleration));
      fd.append('cement_mix_name',      cementId);
      if (cityStr) fd.append('city',    cityStr);
      fd.append('print_date',           printDate);
      fd.append('print_start_hour',     String(toDecimalHour(startTime)));
      fd.append('temperature',          String(forecastWeather?.temperature ?? manualTemp));
      fd.append('humidity',             String(forecastWeather?.humidity    ?? manualHumidity));
      fd.append('wind_speed',           String(forecastWeather?.wind_speed  ?? manualWind));
      // Infill
      fd.append('infill_pattern',       infillPattern);
      fd.append('infill_density',       String(infillDensity));
      // Time blocks
      fd.append('time_blocks',          JSON.stringify(timeBlocks.map(b => ({ start: b.start, end: b.end }))));

      const res = await fetch(`${API}/optimize`, { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).detail || `Server error ${res.status}`);
      }
      const sliceData: SlicerResult = await res.json();
      setResult(sliceData); setShowResults(true);
      setSidebarPanel('results');
      // Auto-save
      try {
        const { error } = await supabase.from('saved_slices').insert({
          source: 'slicer', user_id: null, project_id: null,
          file_name: file.name, gcode_url: null,
          print_time:       sliceData.estimated_print_time ?? null,
          num_layers:       sliceData.geometry?.total_layers ?? null,
          travel_saved_pct: sliceData.optimization?.time_saved_pct ?? null,
          material:         cementId,
          city:             cityStr || null,
          print_date:       printDate,
          print_start_hour: toDecimalHour(startTime),
          temperature:      forecastWeather?.temperature ?? manualTemp,
          humidity:         forecastWeather?.humidity    ?? manualHumidity,
          wind_speed:       forecastWeather?.wind_speed  ?? manualWind,
          result_json:      sliceData,
        });
        if (error) console.error('Slice save error:', error);
        else setSliceSaved(true);
      } catch (e) { console.error('Slice save exception:', e); }
    } catch (e: any) {
      setError(e.message || 'Optimization failed');
    } finally { setLoading(false); }
  };

  const saveSlice = async () => {
    if (!result || !file) return;
    try {
      const { data, error } = await supabase.from('saved_slices').insert({
        source: 'slicer', user_id: null, project_id: null,
        file_name: file.name, gcode_url: null,
        print_time: result.estimated_print_time ?? null,
        num_layers: result.geometry?.total_layers ?? null,
        travel_saved_pct: result.optimization?.time_saved_pct ?? null,
        material: cementId,
        city: cityStr || null,
        print_date: printDate,
        print_start_hour: toDecimalHour(startTime),
        temperature: result.weather?.avg?.temperature ?? forecastWeather?.temperature ?? manualTemp,
        humidity:    result.weather?.avg?.humidity    ?? forecastWeather?.humidity    ?? manualHumidity,
        wind_speed:  result.weather?.avg?.wind_speed  ?? forecastWeather?.wind_speed  ?? manualWind,
        result_json: result,
      });
      if (error) console.error('Slice save error:', error);
      else { setSliceSaved(true); }
    } catch (e) { console.error('Slice save exception:', e); }
  };

  const dl = (content: string, filename: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    a.download = filename; a.click();
  };

  const basename  = file?.name?.replace(/\.[^.]+$/, '') ?? 'print';
  const numLayers = result?.geometry?.total_layers ?? result?.geometry?.num_layers ?? 0;
  const factors   = result ? buildSlicerFactors(result, cementId, selectedMat) : [];

  return (
    <>
      {/* ── Fullscreen results overlay ── */}
      <AnimatePresence>
        {result && showResults && !loading && (
          <motion.div className="fixed inset-0 overflow-hidden z-50"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <LayerVisualization
              file={file!}
              toolpath={result.toolpath as any}
              numLayers={numLayers}
              layerHeight={result.printer.layer_height_mm / 1000}
              nozzleDiameter={nozzle / 1000}
              fullscreen
              onBack={() => setShowResults(false)}
            />

            {/* Sidebar toggle */}
            <button onClick={() => setShowSidebar(v => !v)}
              className="absolute top-3 right-3 z-30 w-7 h-7 rounded-xl flex items-center justify-center transition-all hover:bg-white/10"
              style={{ background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(10px)' }}>
              <svg className="w-3.5 h-3.5 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {showSidebar
                  ? <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  : <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />}
              </svg>
            </button>

            {/* Glass sidebar */}
            <div className={`absolute top-10 right-3 bottom-3 z-20 w-[310px] flex flex-col transition-all duration-300 ${showSidebar ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full pointer-events-none'}`}
              style={{ filter: 'drop-shadow(0 0 30px rgba(0,0,0,0.5))' }}>
              <div className="flex flex-col h-full rounded-2xl overflow-hidden border border-white/10"
                style={{ background: 'rgba(6,6,10,0.78)', backdropFilter: 'blur(24px)' }}>

                {/* Tabs */}
                <div className="flex items-center border-b border-white/8 flex-shrink-0 px-3">
                  {(['results', 'layers', 'changes', 'scan'] as SidebarPanel[]).map(panel => (
                    <button key={panel} onClick={() => setSidebarPanel(panel)}
                      className={`relative py-3 px-2 text-[11px] font-medium transition-all mr-1 capitalize ${sidebarPanel === panel ? 'text-white' : 'text-white/30 hover:text-white/60'}`}>
                      {panel}
                      {sidebarPanel === panel && <span className="absolute bottom-0 left-0 right-0 h-px bg-white rounded-full" />}
                    </button>
                  ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-3">
                  <AnimatePresence mode="wait">

                    {sidebarPanel === 'results' && (
                      <motion.div key="res" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <div className="pt-1 pb-4 border-b border-white/8 mb-3">
                          <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1">Est. Print Time</p>
                          <p className="text-3xl font-bold text-white tracking-tight leading-none">{result.estimated_print_time}</p>
                        </div>
                        <div className="mb-3">
                          <StatRow label="Layers"       value={String(numLayers)}                                delay={0.02}/>
                          <StatRow label="Layer Height" value={`${result.printer.layer_height_mm} mm`}          delay={0.04}/>
                          <StatRow label="Nozzle"       value={`${result.printer.nozzle_mm} mm`}                delay={0.06}/>
                          <StatRow label="Print Speed"  value={`${result.printer.effective_speed} mm/s`}        delay={0.08}/>
                          <StatRow label="G-code Lines" value={result.gcode_lines.toLocaleString()}             delay={0.10}/>
                          <StatRow label="Material"     value={isCustom ? 'Custom' : (selectedMat?.name ?? cementId)} delay={0.12}/>
                          {result.optimization && (
                            <StatRow label="Travel Saved" value={`${result.optimization.time_saved_pct}%`} accent="text-emerald-400" delay={0.14}/>
                          )}
                          {result.elapsed_seconds != null && (
                            <StatRow label="Computed In" value={`${result.elapsed_seconds}s`} delay={0.16}/>
                          )}
                        </div>
                        <div className="border-t border-white/6 pt-3 mb-3">
                          <p className="text-[10px] text-white/25 uppercase tracking-widest mb-2">Conditions</p>
                          <StatRow label="Temperature" value={`${result.weather.avg.temperature}°C`}    delay={0.18}/>
                          <StatRow label="Humidity"    value={`${result.weather.avg.humidity}%`}         delay={0.20}/>
                          <StatRow label="Wind"        value={`${result.weather.avg.wind_speed} km/h`}   delay={0.22}/>
                          {result.optimization && (
                            <StatRow label="Env Risk"
                              value={`${result.optimization.env_risk_score}/100`}
                              accent={result.optimization.env_risk_score < 20 ? 'text-emerald-400' : result.optimization.env_risk_score < 50 ? 'text-amber-400' : 'text-red-400'}
                              delay={0.24}/>
                          )}
                        </div>
                        <div className="border-t border-white/6 pt-3 mb-3">
                          <p className="text-[10px] text-white/25 uppercase tracking-widest mb-2">Print Strategy</p>
                          <StatRow label="Date"  value={printDate}        delay={0.26}/>
                          <StatRow label="Start" value={fmtTime(startTime)} delay={0.28}/>
                          <StatRow label="City"  value={result.weather.city !== 'manual' ? result.weather.city : 'Manual'} delay={0.30}/>
                        </div>
                        {(() => {
                          const estMin  = result.estimated_print_time_s ? result.estimated_print_time_s / 60 : null;
                          const openMin = result.cement?.open_time_min ?? (isCustom ? customMix.potLife20c : selectedMat?.potLife20c ?? null);
                          if (estMin === null || openMin === null) return null;
                          const over = estMin > openMin;
                          return (
                            <div className="rounded-xl px-3 py-2.5 border border-white/8 bg-white/4 mb-3">
                              <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1">Pot Life Check</p>
                              <p className={`text-[11px] font-semibold ${over ? 'text-amber-300' : 'text-emerald-300'}`}>
                                {over ? `Exceeds open time — plan a batch break` : `${Math.round(openMin - estMin)} min margin remaining`}
                              </p>
                            </div>
                          );
                        })()}
                        <div className="border-t border-white/6 pt-3">
                          <p className="text-[10px] text-white/25 uppercase tracking-widest mb-2">G-code Preview</p>
                          <pre className="text-[9px] text-white/35 font-mono leading-relaxed overflow-x-auto max-h-16 scrollbar-none">{result.gcode_full?.split('\n').slice(0,10).join('\n')}</pre>
                        </div>
                      </motion.div>
                    )}

                    {sidebarPanel === 'layers' && (
                      <motion.div key="layers" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
                        {(result.layer_stats ?? []).length > 0 && (() => {
                          const stats  = result.layer_stats!;
                          const speeds = stats.map(ls => ls.print_speed_mm_s);
                          const minS   = Math.min(...speeds);
                          const maxS   = Math.max(...speeds);
                          const tempColor = (t: number) => t < 15 ? '#60a5fa' : t <= 25 ? '#e5e5e5' : t <= 30 ? '#fbbf24' : '#f87171';
                          return (
                            <div className="rounded-xl border border-white/8 p-3 mb-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[9px] text-white/40 uppercase tracking-wider">Speed profile</span>
                                <span className="text-[9px] font-mono text-white/25">{minS}–{maxS} mm/s</span>
                              </div>
                              <div className="flex items-end gap-px h-16 w-full overflow-hidden rounded-lg">
                                {stats.map((ls, i) => {
                                  const h  = maxS === minS ? 50 : ((ls.print_speed_mm_s - minS) / (maxS - minS)) * 100;
                                  return (
                                    <div key={i} className="flex-1 flex flex-col justify-end group relative">
                                      <div className="rounded-sm transition-opacity group-hover:opacity-100 opacity-80"
                                        style={{ height: `${Math.max(8, h)}%`, background: tempColor(ls.temperature_c ?? 20) }} />
                                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:flex items-center z-10 pointer-events-none">
                                        <div className="rounded-lg px-2 py-1 text-[8px] font-mono text-white whitespace-nowrap" style={{ background: 'rgba(0,0,0,0.85)' }}>
                                          L{ls.layer+1} · {ls.print_speed_mm_s}mm/s · {ls.temperature_c??'—'}°C
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                        <p className="text-[9px] text-white/25 uppercase tracking-wider pt-1">Per-layer detail</p>
                        {(result.layer_stats ?? []).map((ls, i) => {
                          const layerTimeSec = ls.print_speed_mm_s > 0 ? ls.perimeter_mm / ls.print_speed_mm_s : 0;
                          const layerTimeStr = layerTimeSec < 60 ? `${Math.round(layerTimeSec)}s` : `${Math.floor(layerTimeSec/60)}m ${Math.round(layerTimeSec%60)}s`;
                          return (
                            <motion.div key={i} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.008 }}
                              className="rounded-xl p-2.5 border border-white/5 bg-white/4 hover:bg-white/6 transition-colors">
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[10px] font-bold text-white">Layer {ls.layer+1}</span>
                                <span className="text-[9px] font-mono text-white/30">{ls.z_height_mm}mm</span>
                              </div>
                              <div className="grid grid-cols-3 gap-1 mb-1.5">
                                {[['Est. time', layerTimeStr], ['Speed', `${ls.print_speed_mm_s}mm/s`], ['Risk', `${ls.risk_score}/100`]].map(([l, v]) => (
                                  <div key={l} className="rounded-lg px-2 py-1.5 border border-white/6 bg-white/3 text-center">
                                    <p className="text-[8px] text-white/25 mb-0.5">{l}</p>
                                    <p className="text-[10px] font-bold font-mono text-white">{v}</p>
                                  </div>
                                ))}
                              </div>
                              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                                {[['Segments', String(ls.segments)], ['Perimeter', `${ls.perimeter_mm}mm`]].map(([l, v]) => (
                                  <div key={l} className="flex justify-between">
                                    <span className="text-[9px] text-white/25">{l}</span>
                                    <span className="text-[9px] font-mono text-white/60">{v}</span>
                                  </div>
                                ))}
                              </div>
                            </motion.div>
                          );
                        })}
                        {(!result.layer_stats || result.layer_stats.length === 0) && (
                          <p className="text-[11px] text-white/30 text-center py-8">No layer data available</p>
                        )}
                      </motion.div>
                    )}

                    {sidebarPanel === 'changes' && (
                      <motion.div key="chg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
                        {factors.map((f, i) => <FactorRow key={i} {...f} delay={i * 0.05} />)}
                        {factors.length === 0 && <p className="text-[11px] text-white/30 text-center py-8">Run optimizer to see changes</p>}
                      </motion.div>
                    )}

                    {sidebarPanel === 'scan' && (
                      <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <p className="text-[11px] text-white/25 text-center py-8">Scan data unavailable in standalone slicer</p>
                      </motion.div>
                    )}

                  </AnimatePresence>
                </div>

                {/* Actions */}
                <div className="px-4 pb-4 pt-3 border-t border-white/8 flex-shrink-0 space-y-2">
                  <button onClick={saveSlice} disabled={sliceSaved}
                    className={`w-full py-2.5 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2 ${sliceSaved ? 'bg-emerald-500/20 text-emerald-300 cursor-default' : 'bg-white/10 text-white hover:bg-white/20 border border-white/15'}`}>
                    {sliceSaved ? '✓ Saved to My Slices' : 'Save to My Slices'}
                  </button>
                  <button onClick={() => dl(result.gcode_full, `${basename}.gcode`)}
                    className="w-full py-2.5 text-xs font-semibold bg-white text-black rounded-xl hover:bg-white/90 transition-all">
                    Download .gcode
                  </button>
                  <button onClick={() => dl(result.gcode_full, `${basename}_gcode.txt`)}
                    className="w-full py-2.5 text-xs font-semibold border border-white/20 text-white rounded-xl hover:bg-white/10 transition-all">
                    G-code .txt
                  </button>
                  <button onClick={() => setShowResults(false)}
                    className="w-full py-2 text-[11px] text-white/30 hover:text-white/60 transition-colors text-center">
                    ← Back to setup
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Normal setup page ── */}
      <div className="min-h-screen bg-gray-50">

        {/* Header */}
        <header className="border-b border-gray-100 bg-white sticky top-0 z-10 overflow-visible">
          <div className="max-w-[1400px] mx-auto px-6 py-1 flex items-center justify-between">
            <button onClick={() => router.push('/')} className="-my-4 sm:-my-6">
              <Image src="/Autobuildwhite.png" alt="AutoBuild AI" width={400} height={400} className="h-24 sm:h-36 w-auto" />
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-black/40">RL Slicer</span>
              {result && !loading && (
                <button onClick={() => setShowResults(true)}
                  className="px-5 py-2 border border-black text-black text-sm font-semibold rounded-xl hover:bg-black hover:text-white transition-all">
                  View Results
                </button>
              )}
              {file && !loading && (
                <button onClick={run}
                  className="px-5 py-2 bg-black text-white text-sm font-semibold rounded-xl hover:bg-black/80 transition-all">
                  {result ? 'Re-run' : 'Run Optimizer'}
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6 items-start">

          {/* ── Left panel ── */}
          <div className="space-y-4">

            {/* Upload */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
              <h2 className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-4">Model</h2>
              <div
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                onDragOver={e => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${file ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-black hover:bg-gray-50'}`}>
                {file ? (
                  <>
                    <p className="text-sm font-semibold text-black truncate">{file.name}</p>
                    <p className="text-[10px] text-black/30 mt-1">{(file.size / 1024).toFixed(0)} KB · Click to replace</p>
                  </>
                ) : (
                  <>
                    <svg className="w-8 h-8 text-black/20 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-sm font-medium text-black/40">Drop STL / OBJ here</p>
                    <p className="text-[10px] text-black/25 mt-1">or click to browse</p>
                  </>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept=".stl,.obj,.stp,.step" className="hidden"
                onChange={e => handleFile(e.target.files?.[0] ?? null)} />
            </div>

            {/* Printer */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4">
              <h2 className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Printer</h2>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Nozzle (mm)"><NumInput value={nozzle} onChange={setNozzle} min={10} max={80} /></Field>
                <Field label={`Compression → ${layerHeightMm} mm`}><NumInput value={compression} onChange={setCompression} min={0.4} max={0.9} step={0.05} /></Field>
                <Field label="Max velocity (mm/s)"><NumInput value={velocity} onChange={setVelocity} min={10} max={300} /></Field>
                <Field label="Hose length (m)"><NumInput value={hoseLength} onChange={setHoseLength} min={1} max={100} /></Field>
                <Field label="Max flow (L/min)"><NumInput value={flowRate} onChange={setFlowRate} min={1} max={30} step={0.5} /></Field>
                <Field label="Acceleration (mm/s²)"><NumInput value={acceleration} onChange={setAcceleration} min={50} max={2000} step={50} /></Field>
              </div>
            </div>

            {/* Cement */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4">
              <h2 className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Cement Mix</h2>
              <select value={cementId} onChange={e => setCementId(e.target.value)} className={selectCls}>
                {MATERIALS.map(m => <option key={m.id} value={m.id}>{m.name} — {m.region}</option>)}
              </select>
              {!isCustom && selectedMat && (
                <div className="grid grid-cols-2 gap-2">
                  {[['Pot life 20°C', `${selectedMat.potLife20c} min`], ['Strength 28d', selectedMat.strength28d], ['Layer range', `${selectedMat.layerMin}–${selectedMat.layerMax} mm`], ['Water ratio', selectedMat.waterRatio]].map(([k, v]) => (
                    <div key={k} className="bg-gray-50 rounded-xl px-3 py-2">
                      <p className="text-[9px] text-black/30 uppercase tracking-wide">{k}</p>
                      <p className="text-xs font-semibold text-black">{v}</p>
                    </div>
                  ))}
                </div>
              )}
              {isCustom && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Pot life 10°C"><NumInput value={customMix.potLife10c} onChange={v => setCustomField('potLife10c', v)} min={10} max={240} /></Field>
                    <Field label="Pot life 20°C"><NumInput value={customMix.potLife20c} onChange={v => setCustomField('potLife20c', v)} min={10} max={240} /></Field>
                    <Field label="Pot life 30°C"><NumInput value={customMix.potLife30c} onChange={v => setCustomField('potLife30c', v)} min={5} max={120} /></Field>
                    <Field label="Grain size (mm)"><NumInput value={customMix.grainSize} onChange={v => setCustomField('grainSize', v)} min={0.1} max={10} step={0.1} /></Field>
                    <Field label="Layer min (mm)"><NumInput value={customMix.layerMin} onChange={v => setCustomField('layerMin', v)} min={1} max={50} /></Field>
                    <Field label="Layer max (mm)"><NumInput value={customMix.layerMax} onChange={v => setCustomField('layerMax', v)} min={1} max={100} /></Field>
                  </div>
                </div>
              )}
            </div>

            {/* Infill — Task 8 */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4">
              <h2 className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Infill Pattern</h2>
              <div className="flex gap-2">
                {(['none', 'zigzag', 'hexagonal'] as const).map(p => (
                  <button key={p} onClick={() => setInfillPattern(p)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${infillPattern === p ? 'bg-black text-white' : 'bg-gray-100 text-black/50 hover:text-black'}`}>
                    {p === 'none' ? 'None' : p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
              {infillPattern !== 'none' && (
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-black">Infill Density</span>
                      <div className="flex items-center gap-1.5">
                        <input type="number" value={infillDensity} min={0.2} max={0.8} step={0.05}
                          onChange={e => setInfillDensity(Number(e.target.value))}
                          className="w-16 px-2 py-1 text-xs font-mono text-right border border-gray-200 rounded-lg focus:outline-none focus:border-black text-black" />
                      </div>
                    </div>
                    <input type="range" min={0.2} max={0.8} step={0.05} value={infillDensity}
                      onChange={e => setInfillDensity(Number(e.target.value))}
                      className="w-full h-0.5 rounded-full appearance-none cursor-pointer accent-black bg-gray-200" />
                    <div className="flex justify-between mt-1.5">
                      <span className="text-[10px] text-black/25">0.2</span>
                      <span className="text-[10px] text-black/25">0.8</span>
                    </div>
                  </div>
                  {infillDensity < 0.4 && (
                    <p className="text-[10px] text-amber-600 font-medium">Low density — consider ≥ 0.4 for structural integrity</p>
                  )}
                </div>
              )}
            </div>

            {/* Weather */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4">
              <h2 className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Weather</h2>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Print Date">
                  <input type="date" value={printDate} onChange={e => setPrintDate(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Start Time">
                  <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className={inputCls} />
                </Field>
              </div>
              <CitySearch onSelect={cs => setCityStr(cs)} printDate={printDate} startTime={startTime} onForecastChange={setForecastWeather} />
              {!cityStr && <p className="text-[10px] text-black/25 -mt-2">Optional — leave blank to enter manually</p>}
              {(!cityStr || !forecastWeather) && (
                <div className="space-y-3 pt-1">
                  <p className="text-[10px] text-black/30">{cityStr ? 'Forecast unavailable — enter manually' : 'No city selected — enter manually'}</p>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Temp (°C)"><NumInput value={manualTemp} onChange={setManualTemp} min={5} max={45} step={0.5} /></Field>
                    <Field label="Humidity (%)"><NumInput value={manualHumidity} onChange={setManualHumidity} min={20} max={100} /></Field>
                    <Field label="Wind (km/h)"><NumInput value={manualWind} onChange={setManualWind} min={0} max={60} step={0.5} /></Field>
                  </div>
                </div>
              )}
            </div>

            {/* Working Hours / Time Blocks — Task 9 */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Working Hours</h2>
                <span className="text-[10px] text-black/25">{totalBlockHours.toFixed(1)} hrs / day</span>
              </div>

              {/* Timeline visualization */}
              <div className="relative h-6 bg-gray-50 rounded-lg overflow-hidden border border-gray-100">
                {timeBlocks.map(b => {
                  const s = toDecimalHour(b.start);
                  const e = toDecimalHour(b.end);
                  const left  = Math.max(0, (s / 24) * 100);
                  const width = Math.max(0, ((e - s) / 24) * 100);
                  return (
                    <div key={b.id}
                      className="absolute top-0 bottom-0 bg-black/80 rounded-sm"
                      style={{ left: `${left}%`, width: `${width}%` }} />
                  );
                })}
                {[0, 6, 12, 18, 24].map(h => (
                  <div key={h} className="absolute top-0 bottom-0 w-px bg-gray-200" style={{ left: `${(h/24)*100}%` }}>
                    <span className="absolute -bottom-5 -translate-x-1/2 text-[8px] text-black/25">{h}h</span>
                  </div>
                ))}
              </div>
              <div className="h-4" />

              {timeBlocks.map((block, idx) => (
                <div key={block.id} className="border border-gray-100 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-black/40 uppercase tracking-widest">Block {idx + 1}</span>
                    {timeBlocks.length > 1 && (
                      <button onClick={() => removeTimeBlock(block.id)} className="text-black/20 hover:text-black text-lg leading-none">&times;</button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Start">
                      <input type="time" value={block.start} onChange={e => setTimeBlocks(prev => prev.map(b => b.id === block.id ? { ...b, start: e.target.value } : b))} className={inputCls} />
                    </Field>
                    <Field label="End">
                      <input type="time" value={block.end} onChange={e => setTimeBlocks(prev => prev.map(b => b.id === block.id ? { ...b, end: e.target.value } : b))} className={inputCls} />
                    </Field>
                  </div>
                </div>
              ))}

              <div className="flex gap-2">
                <button onClick={addBreak}
                  className="flex-1 py-2 text-xs font-medium border border-dashed border-gray-200 rounded-xl text-black/35 hover:text-black hover:border-black transition-colors">
                  + Add Break
                </button>
                <button onClick={addTimeBlock}
                  className="flex-1 py-2 text-xs font-medium border border-dashed border-gray-200 rounded-xl text-black/35 hover:text-black hover:border-black transition-colors">
                  + Add Time Block
                </button>
              </div>
            </div>

            {/* Run (mobile) */}
            <button onClick={run} disabled={!file || loading}
              className="w-full py-3 bg-black text-white text-sm font-semibold rounded-xl hover:bg-black/80 disabled:opacity-40 disabled:cursor-not-allowed transition-all lg:hidden">
              {loading ? 'Optimising…' : result ? 'Re-run' : 'Run Optimizer'}
            </button>

            {error && (
              <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-600 font-medium">{error}</div>
            )}
          </div>

          {/* ── Right panel ── */}
          <div className="space-y-4">
            <div className="bg-black rounded-2xl overflow-hidden shadow-sm" style={{ minHeight: 520 }}>
              {file ? (
                <LayerVisualization
                  file={file}
                  toolpath={(result?.toolpath ?? []) as any}
                  numLayers={result?.geometry.total_layers ?? 0}
                  layerHeight={(result?.printer.layer_height_mm ?? layerHeightMm) / 1000}
                  nozzleDiameter={nozzle}
                />
              ) : (
                <div className="flex items-center justify-center min-h-[520px]">
                  <div className="text-center px-6">
                    <svg className="w-14 h-14 text-white/10 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    <p className="text-white/25 text-sm font-medium">Upload a model to preview</p>
                    <p className="text-white/15 text-xs mt-1">Then run the optimizer to generate the animated toolpath</p>
                  </div>
                </div>
              )}
            </div>
            {result && !loading && !showResults && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                className="bg-black rounded-2xl px-5 py-4 shadow-sm flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-white">Optimization complete</p>
                  <p className="text-xs text-white/40 mt-0.5">{result.estimated_print_time} · {numLayers} layers</p>
                </div>
                <button onClick={() => setShowResults(true)}
                  className="flex-shrink-0 px-4 py-2 bg-white text-black text-xs font-semibold rounded-xl hover:bg-white/90 transition-all">
                  View Results →
                </button>
              </motion.div>
            )}
          </div>
        </div>

        {/* Loading overlay */}
        <AnimatePresence>
          {loading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center gap-6">
              <motion.div className="w-12 h-12 border-2 border-black border-t-transparent rounded-full"
                animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} />
              <div className="text-center">
                <p className="text-base font-semibold text-black">Running RL Optimizer</p>
                <p className="text-sm text-black/40 mt-1">Slicing model and computing adaptive toolpath…</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
