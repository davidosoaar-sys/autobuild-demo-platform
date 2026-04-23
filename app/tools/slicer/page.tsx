'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { MATERIALS } from '@/app/pre-print-optimizer/components/ParameterInputs';
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

interface SlicerResult {
  estimated_print_time: string;
  estimated_print_time_s?: number;
  cement?: { open_time_min: number };
  geometry: { total_layers: number };
  printer: { layer_height_mm: number; nozzle_mm: number; effective_speed: number };
  weather: { city: string; avg: { temperature: number; humidity: number; wind_speed: number } };
  toolpath: unknown[];
  gcode_full: string;
  gcode_lines: number;
}

interface CustomMix {
  potLife10c: number; potLife20c: number; potLife30c: number;
  layerMin: number;   layerMax: number;
  grainSize: number;  spreadFlow: number;
  waterRatio: string; strength28d: string;
}

const DEFAULT_CUSTOM: CustomMix = {
  potLife10c: 80, potLife20c: 60, potLife30c: 40,
  layerMin: 6,   layerMax: 20,
  grainSize: 3,  spreadFlow: 130,
  waterRatio: '15–17%', strength28d: '—',
};

const todayStr  = () => new Date().toISOString().split('T')[0];
const nowTimeStr = () => { const d = new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
const toDecimalHour = (t: string) => { const [h, m] = t.split(':').map(Number); return h + m / 60; };
const fmtTime = (t: string) => { const [h, m] = t.split(':').map(Number); const ampm = h >= 12 ? 'PM' : 'AM'; return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ampm}`; };

function riskColor(r: number) { return r < 20 ? 'text-emerald-400' : r < 50 ? 'text-amber-400' : 'text-red-400'; }
function hourToLabel(h: number) {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const disp = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh;
  return `${disp}:${String(mm).padStart(2, '0')} ${ampm}`;
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
      onFCRef.current?.({ temperature: p.temperature, humidity: p.humidity, wind_speed: p.wind_speed });
    } catch {
      setError('Could not fetch forecast for this date');
      onFCRef.current?.(null);
    } finally { setFetching(false); }
  }, []);

  // Re-fetch when printDate or startTime changes (if city already selected)
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
      onFCRef.current?.(null);
      return;
    }
    await doFetch(cs, toDecimalHour(startTime));
  };

  const forecastLabel = (() => {
    try {
      const d       = new Date(printDate + 'T00:00:00');
      const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
      const date    = d.toLocaleDateString('en-US', { day: 'numeric', month: 'long' });
      return `${weekday} ${date} at ${fmtTime(startTime)}`;
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

      {/* Forecast unavailable — beyond 5-day window */}
      {selected && forecastUnavailable && !fetching && (
        <div className="mt-3 bg-black rounded-2xl p-4">
          <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-2">{selected}</p>
          <p className="text-xs text-white/40 leading-relaxed">
            Forecast unavailable for this date — please enter conditions manually below
          </p>
        </div>
      )}

      {/* Forecast card */}
      {weather && !fetching && !forecastUnavailable && (
        <div className="mt-3 bg-black rounded-2xl p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">{selected}</p>
            <span className="text-[9px] text-white/30">Forecast</span>
          </div>
          <p className="text-[10px] text-white/50 mb-3">{forecastLabel}</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Temp',     value: `${weather.temperature}°C` },
              { label: 'Humidity', value: `${weather.humidity}%` },
              { label: 'Wind',     value: `${weather.wind_speed.toFixed(1)} km/h` },
            ].map((s, i) => (
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
                {forecast.map((f, i) => (
                  <div key={i} className={`flex-shrink-0 rounded-xl px-2.5 py-2 text-center min-w-[52px] border ${
                    f.risk > 50 ? 'bg-red-500/15 border-red-500/20' : f.risk > 20 ? 'bg-amber-400/10 border-amber-400/15' : 'bg-white/5 border-white/5'
                  }`}>
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
  const [cityStr,        setCityStr]        = useState('');
  const [printDate,      setPrintDate]      = useState<string>(todayStr);
  const [startTime,      setStartTime]      = useState<string>(nowTimeStr);
  const [forecastWeather, setForecastWeather] = useState<{ temperature: number; humidity: number; wind_speed: number } | null>(null);
  const [manualTemp,     setManualTemp]     = useState(20);
  const [manualHumidity, setManualHumidity] = useState(65);
  const [manualWind,     setManualWind]     = useState(8);

  // Printer
  const [nozzle,       setNozzle]       = useState(25);
  const [compression,  setCompression]  = useState(0.6);
  const [velocity,     setVelocity]     = useState(100);
  const [hoseLength,   setHoseLength]   = useState(15);
  const [flowRate,     setFlowRate]     = useState(8);
  const [acceleration, setAcceleration] = useState(500);

  // Cement
  const [cementId,   setCementId]   = useState('sika-733w-3d-us');
  const [customMix,  setCustomMix]  = useState<CustomMix>(DEFAULT_CUSTOM);

  const layerHeightMm = Math.round(nozzle * compression) / 10;
  const selectedMat   = MATERIALS.find(m => m.id === cementId);
  const isCustom      = cementId === 'custom';

  const setCustomField = <K extends keyof CustomMix>(k: K, v: CustomMix[K]) =>
    setCustomMix(prev => ({ ...prev, [k]: v }));

  const handleFile = (f: File | null) => { setFile(f); setResult(null); setShowResults(false); setError(''); };

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
      const res = await fetch(`${API}/optimize`, { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).detail || `Server error ${res.status}`);
      }
      setResult(await res.json()); setShowResults(true);
    } catch (e: any) {
      setError(e.message || 'Optimization failed');
    } finally { setLoading(false); }
  };

  const dl = (content: string, filename: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    a.download = filename; a.click();
  };

  const basename = file?.name?.replace(/\.[^.]+$/, '') ?? 'print';

  const reportContent = result ? [
    'AutoBuild AI — Slicer Report', `File: ${file?.name}`, '',
    `Print time:   ${result.estimated_print_time}`,
    `Layers:       ${result.geometry.total_layers}`,
    `Layer height: ${result.printer.layer_height_mm} mm`,
    `Nozzle:       ${result.printer.nozzle_mm} mm`,
    `Speed:        ${result.printer.effective_speed} mm/s`,
    `G-code lines: ${result.gcode_lines}`, '',
    `Material:     ${isCustom ? 'Custom Mortar' : (selectedMat?.name ?? cementId)}`,
    isCustom ? `Pot life 20°C: ${customMix.potLife20c} min` : `Pot life 20°C: ${selectedMat?.potLife20c} min`,
    '', `Print strategy:`,
    `  Date:  ${printDate}`,
    `  Start: ${fmtTime(startTime)}`,
    '', `Weather: ${result.weather.city}`,
    `  Temp: ${result.weather.avg.temperature}°C`,
    `  Humidity: ${result.weather.avg.humidity}%`,
    `  Wind: ${result.weather.avg.wind_speed} km/h`,
  ].join('\n') : '';

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
              numLayers={result.geometry.total_layers}
              layerHeight={result.printer.layer_height_mm / 1000}
              nozzleDiameter={nozzle / 1000}
              fullscreen
              onBack={() => setShowResults(false)}
            />

            {/* Glass sidebar */}
            <div className="absolute top-3 right-3 bottom-3 z-20 w-[300px] rounded-2xl flex flex-col"
              style={{ background: 'rgba(6,6,10,0.82)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.10)' }}>

              {/* Sidebar header */}
              <div className="px-5 py-4 border-b border-white/8 flex items-center justify-between flex-shrink-0">
                <div className="min-w-0">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-white/40">Slicer Results</p>
                  <p className="text-xs font-medium text-white mt-0.5 truncate max-w-[200px]">{file?.name}</p>
                </div>
                <button onClick={() => setShowResults(false)}
                  className="text-white/40 hover:text-white text-xl leading-none transition-colors flex-shrink-0 ml-2">×</button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

                {/* Print time hero */}
                <div className="text-center py-2">
                  <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1.5">Estimated Print Time</p>
                  <p className="text-3xl font-bold text-white">{result.estimated_print_time}</p>
                </div>

                {/* Stats list */}
                <div className="space-y-0">
                  {[
                    ['Layers',       String(result.geometry.total_layers)],
                    ['Layer Height', `${result.printer.layer_height_mm} mm`],
                    ['G-code Lines', result.gcode_lines.toLocaleString()],
                    ['Avg Speed',    `${result.printer.effective_speed} mm/s`],
                    ['Material',     isCustom ? 'Custom Mortar' : (selectedMat?.name ?? cementId)],
                    ['Weather',      result.weather.city !== 'manual' ? result.weather.city : 'Default'],
                    ['Avg Temp',     `${result.weather.avg.temperature}°C`],
                    ['Humidity',     `${result.weather.avg.humidity}%`],
                    ['Wind',         `${result.weather.avg.wind_speed} km/h`],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between py-2 border-b border-white/6">
                      <span className="text-[10px] text-white/40">{label}</span>
                      <span className="text-xs font-semibold text-white">{value}</span>
                    </div>
                  ))}
                </div>

                {/* Pot life warning */}
                {(() => {
                  const estMin  = result.estimated_print_time_s ? result.estimated_print_time_s / 60 : null;
                  const openMin = result.cement?.open_time_min
                    ?? (isCustom ? customMix.potLife20c : selectedMat?.potLife20c ?? null);
                  if (estMin === null || openMin === null) return null;
                  const over = estMin > openMin;
                  return (
                    <div className="bg-black rounded-2xl px-4 py-3.5 space-y-1">
                      <p className="text-[9px] font-semibold uppercase tracking-widest text-white/40">Pot Life Check</p>
                      <p className="text-xs font-semibold text-white">
                        {over
                          ? `Print time (${Math.round(estMin)} min) exceeds open time (${openMin} min) — plan a batch break`
                          : `Within open time — ${Math.round(openMin - estMin)} min margin remaining`}
                      </p>
                    </div>
                  );
                })()}

                {/* Print Strategy */}
                <div className="space-y-0">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-white/40 mb-2">Print Strategy</p>
                  {[
                    ['Date',       printDate],
                    ['Start',      fmtTime(startTime)],
                    ['Open time',  (() => {
                      const openMin = result.cement?.open_time_min
                        ?? (isCustom ? customMix.potLife20c : selectedMat?.potLife20c ?? null);
                      const estMin  = result.estimated_print_time_s ? Math.round(result.estimated_print_time_s / 60) : null;
                      if (openMin === null) return '—';
                      return estMin !== null ? `${openMin} min open · ${estMin} min est` : `${openMin} min`;
                    })()],
                    ['Conditions', (() => {
                      const t = result.weather.avg.temperature;
                      const h = result.weather.avg.humidity;
                      const w = result.weather.avg.wind_speed;
                      return `${t}°C · ${h}% RH · ${w.toFixed(1)} km/h`;
                    })()],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between py-2 border-b border-white/6">
                      <span className="text-[10px] text-white/40">{label}</span>
                      <span className="text-xs font-semibold text-white">{value}</span>
                    </div>
                  ))}
                </div>

                {/* Downloads */}
                <div className="space-y-2 pt-1">
                  <button onClick={() => dl(result.gcode_full, `${basename}.gcode`)}
                    className="w-full py-2.5 text-xs font-semibold bg-white text-black rounded-xl hover:bg-white/90 transition-all flex items-center justify-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download .gcode
                  </button>
                  <button onClick={() => dl(result.gcode_full, `${basename}_gcode.txt`)}
                    className="w-full py-2.5 text-xs font-semibold border border-white/20 text-white rounded-xl hover:bg-white/10 transition-all flex items-center justify-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    G-code .txt
                  </button>
                  <button onClick={() => dl(reportContent, `${basename}_report.txt`)}
                    className="w-full py-2.5 text-xs font-semibold border border-white/10 text-white/50 rounded-xl hover:bg-white/5 transition-all flex items-center justify-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Report .txt
                  </button>
                </div>

                {/* Back to setup */}
                <button onClick={() => setShowResults(false)}
                  className="w-full py-2 text-[11px] font-medium text-white/30 hover:text-white/60 transition-colors text-center">
                  ← Back to setup
                </button>
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
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  file ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-black hover:bg-gray-50'
                }`}
              >
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
                <Field label="Nozzle (mm)">
                  <NumInput value={nozzle} onChange={setNozzle} min={10} max={80} />
                </Field>
                <Field label={`Compression → ${layerHeightMm} mm`}>
                  <NumInput value={compression} onChange={setCompression} min={0.4} max={0.9} step={0.05} />
                </Field>
                <Field label="Max velocity (mm/s)">
                  <NumInput value={velocity} onChange={setVelocity} min={10} max={300} />
                </Field>
                <Field label="Hose length (m)">
                  <NumInput value={hoseLength} onChange={setHoseLength} min={1} max={100} />
                </Field>
                <Field label="Max flow (L/min)">
                  <NumInput value={flowRate} onChange={setFlowRate} min={1} max={30} step={0.5} />
                </Field>
                <Field label="Acceleration (mm/s²)">
                  <NumInput value={acceleration} onChange={setAcceleration} min={50} max={2000} step={50} />
                </Field>
              </div>
            </div>

            {/* Cement mix */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4">
              <h2 className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Cement Mix</h2>
              <select value={cementId} onChange={e => setCementId(e.target.value)} className={selectCls}>
                {MATERIALS.map(m => (
                  <option key={m.id} value={m.id}>{m.name} — {m.region}</option>
                ))}
              </select>

              {/* Standard material info */}
              {!isCustom && selectedMat && (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['Pot life 20°C', `${selectedMat.potLife20c} min`],
                    ['Strength 28d',   selectedMat.strength28d],
                    ['Layer range',   `${selectedMat.layerMin}–${selectedMat.layerMax} mm`],
                    ['Water ratio',    selectedMat.waterRatio],
                    ['Grain size',    `≤${selectedMat.grainSize} mm`],
                    ['Spread flow',   `${selectedMat.spreadFlow} mm`],
                  ].map(([k, v]) => (
                    <div key={k} className="bg-gray-50 rounded-xl px-3 py-2">
                      <p className="text-[9px] text-black/30 uppercase tracking-wide">{k}</p>
                      <p className="text-xs font-semibold text-black">{v}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Custom mortar editable params */}
              {isCustom && (
                <div className="space-y-4">
                  <p className="text-[10px] text-black/40">Enter your mortar properties</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Pot life 10°C (min)">
                      <NumInput value={customMix.potLife10c} onChange={v => setCustomField('potLife10c', v)} min={10} max={240} />
                    </Field>
                    <Field label="Pot life 20°C (min)">
                      <NumInput value={customMix.potLife20c} onChange={v => setCustomField('potLife20c', v)} min={10} max={240} />
                    </Field>
                    <Field label="Pot life 30°C (min)">
                      <NumInput value={customMix.potLife30c} onChange={v => setCustomField('potLife30c', v)} min={5} max={120} />
                    </Field>
                    <Field label="Grain size (mm)">
                      <NumInput value={customMix.grainSize} onChange={v => setCustomField('grainSize', v)} min={0.1} max={10} step={0.1} />
                    </Field>
                    <Field label="Layer min (mm)">
                      <NumInput value={customMix.layerMin} onChange={v => setCustomField('layerMin', v)} min={1} max={50} />
                    </Field>
                    <Field label="Layer max (mm)">
                      <NumInput value={customMix.layerMax} onChange={v => setCustomField('layerMax', v)} min={1} max={100} />
                    </Field>
                    <Field label="Spread flow (mm)">
                      <NumInput value={customMix.spreadFlow} onChange={v => setCustomField('spreadFlow', v)} min={80} max={300} />
                    </Field>
                    <Field label="Strength 28d">
                      <input value={customMix.strength28d} onChange={e => setCustomField('strength28d', e.target.value)}
                        placeholder="e.g. 40 MPa" className={inputCls} />
                    </Field>
                  </div>
                  <Field label="Water ratio">
                    <input value={customMix.waterRatio} onChange={e => setCustomField('waterRatio', e.target.value)}
                      placeholder="e.g. 14–16%" className={inputCls} />
                  </Field>
                  <div className="bg-black rounded-xl p-3 grid grid-cols-3 gap-2">
                    {[
                      ['10°C', `${customMix.potLife10c} min`],
                      ['20°C', `${customMix.potLife20c} min`],
                      ['30°C', `${customMix.potLife30c} min`],
                    ].map(([t, v]) => (
                      <div key={t} className="text-center">
                        <p className="text-[9px] text-white/30 mb-0.5">{t}</p>
                        <p className="text-xs font-bold text-white">{v}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Weather */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4">
              <h2 className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Weather</h2>

              {/* Date + time always visible */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Print Date">
                  <input type="date" value={printDate} onChange={e => setPrintDate(e.target.value)}
                    className={inputCls} />
                </Field>
                <Field label="Start Time">
                  <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                    className={inputCls} />
                </Field>
              </div>

              {/* City search — passes date+time for forecast */}
              <CitySearch
                onSelect={(cs) => setCityStr(cs)}
                printDate={printDate}
                startTime={startTime}
                onForecastChange={setForecastWeather}
              />
              {!cityStr && <p className="text-[10px] text-black/25 -mt-2">Optional — leave blank to enter conditions manually</p>}

              {/* Manual conditions — shown when no city or forecast unavailable */}
              {(!cityStr || !forecastWeather) && (
                <div className="space-y-3 pt-1">
                  <p className="text-[10px] text-black/30">
                    {cityStr ? 'Forecast unavailable — enter conditions manually' : 'No city selected — enter conditions manually'}
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Temp (°C)">
                      <NumInput value={manualTemp} onChange={setManualTemp} min={5} max={45} step={0.5} />
                    </Field>
                    <Field label="Humidity (%)">
                      <NumInput value={manualHumidity} onChange={setManualHumidity} min={20} max={100} />
                    </Field>
                    <Field label="Wind (km/h)">
                      <NumInput value={manualWind} onChange={setManualWind} min={0} max={60} step={0.5} />
                    </Field>
                  </div>
                </div>
              )}
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

            {/* 3D viewer */}
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

            {/* Hint when result is ready */}
            {result && !loading && !showResults && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                className="bg-black rounded-2xl px-5 py-4 shadow-sm flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-white">Optimization complete</p>
                  <p className="text-xs text-white/40 mt-0.5">{result.estimated_print_time} · {result.geometry.total_layers} layers</p>
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
