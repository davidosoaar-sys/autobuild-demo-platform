'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CameraView, BeadEventLog, AlertBanner, DefectDetectionPanel,
  type Camera, type BeadAnalysis,
} from '@/app/live-monitoring/page';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface AlertEntry { time: string; msg: string; level: 'info' | 'warn' | 'error'; }
interface CityResult  { name: string; country: string; state: string; display: string; }
interface LiveWeather { temperature: number; humidity: number; wind_speed: number; description: string; }

type ActiveTab = 'monitor' | 'defects';

function TempWidget() {
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState<CityResult[]>([]);
  const [open,     setOpen]     = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [fetching, setFetching] = useState(false);
  const [weather,  setWeather]  = useState<LiveWeather | null>(null);
  const [cityName, setCityName] = useState('');
  const debounce = useRef<NodeJS.Timeout | null>(null);

  const search = async (q: string) => {
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/weather/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
      setOpen(true);
    } catch { setResults([]); }
    finally { setLoading(false); }
  };

  const handleInput = (val: string) => {
    setQuery(val);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(val), 400);
  };

  const handleSelect = async (city: CityResult) => {
    setOpen(false); setQuery(city.display); setCityName(city.name);
    setFetching(true);
    try {
      const res = await fetch(`${API}/weather/current?city=${encodeURIComponent(`${city.name},${city.country}`)}`);
      if (res.ok) setWeather(await res.json());
    } catch { /* silent */ }
    finally { setFetching(false); }
  };

  const iCls = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-black transition-colors text-black placeholder:text-black/25 bg-white pr-8';

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-3">Site Temperature</h3>
      <div className="relative">
        <input value={query} onChange={e => handleInput(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search city for live temperature…" className={iCls} />
        {loading && (
          <svg className="absolute right-3 top-2.5 animate-spin w-4 h-4 text-black/20" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {open && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-30 overflow-hidden">
            {results.map((r, i) => (
              <button key={i} onClick={() => handleSelect(r)}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0">
                <span className="font-medium text-black">{r.name}</span>
                <span className="text-black/35 ml-1.5 text-xs">{r.state}{r.state ? ', ' : ''}{r.country}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {fetching && <p className="text-[11px] text-black/30 mt-2">Fetching weather…</p>}

      {weather && !fetching && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { label: 'Temperature', value: `${Math.round(weather.temperature)}°C` },
            { label: 'Humidity',    value: `${Math.round(weather.humidity)}%` },
            { label: 'Wind',        value: `${Math.round(weather.wind_speed)} km/h` },
          ].map(s => (
            <div key={s.label} className="bg-black rounded-xl px-3 py-2.5">
              <p className="text-[9px] text-white/30 uppercase tracking-wide mb-0.5">{s.label}</p>
              <p className="text-sm font-bold text-white">{s.value}</p>
            </div>
          ))}
          <div className="col-span-3 flex items-center gap-2 px-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] text-black/30 capitalize">{cityName} · {weather.description}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function StandaloneMonitor() {
  const router   = useRouter();
  const startRef = useRef(Date.now());
  const [elapsed,     setElapsed]     = useState(0);
  const [cameras,     setCameras]     = useState<Camera[]>([]);
  const [beadLog,     setBeadLog]     = useState<BeadAnalysis[]>([]);
  const [alertLog,    setAlertLog]    = useState<AlertEntry[]>([]);
  const [activeAlert, setActiveAlert] = useState<BeadAnalysis | null>(null);
  const [activeTab,   setActiveTab]   = useState<ActiveTab>('monitor');

  useEffect(() => {
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);

  const fmtElapsed = () => {
    const h = Math.floor(elapsed / 3600), m = Math.floor((elapsed % 3600) / 60), s = elapsed % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`;
  };

  const addAlert = useCallback((msg: string, level: 'info' | 'warn' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setAlertLog(prev => [{ time, msg, level }, ...prev.slice(0, 49)]);
  }, []);

  const handleBeadLog = useCallback((analysis: BeadAnalysis) => {
    setBeadLog(prev => [analysis, ...prev.slice(0, 99)]);
    const level: 'info' | 'warn' | 'error' = analysis.severity === 'high' ? 'error' : analysis.severity === 'medium' ? 'warn' : 'info';
    const msg = analysis.verdict === 'unclear'
      ? `Bead unclear — ${analysis.cameraLabel}`
      : `[${analysis.cameraLabel}] ${analysis.verdict}${analysis.angle_deviation !== 0 ? ` ${analysis.angle_deviation > 0 ? '+' : ''}${analysis.angle_deviation.toFixed(1)}°` : ''}${analysis.defect_type !== 'none' ? ` · ${analysis.defect_type}` : ''}`;
    addAlert(msg, level);
  }, [addAlert]);

  const handleBeadAlert = useCallback((analysis: BeadAnalysis) => setActiveAlert(analysis), []);

  const addCamera    = () => { const id = String(Date.now()); setCameras(prev => [...prev, { id, label: `Camera ${prev.length + 1}`, angle: 'front', active: true }]); };
  const removeCamera = (id: string) => setCameras(prev => prev.filter(c => c.id !== id));
  const updateAngle  = (id: string, angle: Camera['angle']) => setCameras(prev => prev.map(c => c.id === id ? { ...c, angle } : c));
  const renameCamera = (id: string, label: string) => setCameras(prev => prev.map(c => c.id === id ? { ...c, label } : c));

  return (
    <div className="min-h-screen bg-gray-50 pb-6">

      {/* Header */}
      <header className="border-b border-gray-100 bg-white sticky top-0 z-10 overflow-visible">
        <div className="max-w-7xl mx-auto px-6 py-1 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/')} className="-my-4 sm:-my-6">
              <Image src="/Autobuildblack.png" alt="AutoBuild AI" width={400} height={400} className="h-24 sm:h-36 w-auto" />
            </button>
            <span className="w-px h-5 bg-gray-200" />
            <span className="text-sm font-medium text-black/40">Live Monitor</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              {(['monitor', 'defects'] as ActiveTab[]).map(t => (
                <button key={t} onClick={() => setActiveTab(t)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-xl capitalize transition-all ${activeTab === t ? 'bg-black text-white' : 'text-black/40 hover:text-black hover:bg-gray-100'}`}>
                  {t === 'monitor' ? 'Monitor' : 'Defect Analysis'}
                </button>
              ))}
            </div>
            <span className="text-2xl font-bold font-mono text-black tracking-tight">{fmtElapsed()}</span>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {activeAlert && <AlertBanner analysis={activeAlert} onDismiss={() => setActiveAlert(null)} />}
      </AnimatePresence>

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 pt-6 space-y-4">

        <AnimatePresence mode="wait">

          {activeTab === 'monitor' && (
            <motion.div key="monitor" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="space-y-4">

              {/* Temperature */}
              <TempWidget />

              {/* Camera grid */}
              <div className={`grid gap-4 ${
                cameras.length === 0 ? 'grid-cols-1' :
                cameras.length === 1 ? 'grid-cols-1' :
                cameras.length <= 4  ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
              }`}>
                {cameras.map(cam => (
                  <div key={cam.id} className="relative group">
                    <CameraView camera={cam} onAngleChange={updateAngle} onRename={renameCamera}
                      onRemove={removeCamera} onBeadAlert={handleBeadAlert} onBeadLog={handleBeadLog} />
                    <button onClick={() => removeCamera(cam.id)}
                      className="absolute top-10 right-2 w-5 h-5 bg-black/70 text-white rounded-full text-[10px] opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center hover:bg-red-600 z-20">
                      ×
                    </button>
                  </div>
                ))}
                <button onClick={addCamera}
                  className="aspect-video rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-2 hover:border-black hover:bg-gray-50 transition-all group min-h-[160px]">
                  <div className="w-10 h-10 rounded-full border-2 border-gray-200 group-hover:border-black flex items-center justify-center transition-all">
                    <span className="text-gray-300 group-hover:text-black text-xl">+</span>
                  </div>
                  <span className="text-xs text-black/30 group-hover:text-black transition-all">Add Camera</span>
                </button>
              </div>

              {/* Bead log */}
              {beadLog.length > 0 && <BeadEventLog entries={beadLog} />}

              {/* System log */}
              <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                <h3 className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-3">System Log</h3>
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {alertLog.length === 0 && <p className="text-xs text-black/25 text-center py-3">No events</p>}
                  {alertLog.map((a, i) => (
                    <div key={i} className={`flex gap-2 px-2 py-1 rounded-lg text-[11px] ${a.level === 'error' ? 'bg-red-50 text-red-700' : a.level === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-black/50'}`}>
                      <span className="font-mono opacity-50 flex-shrink-0">{a.time}</span>
                      <span className="truncate">{a.msg}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'defects' && (
            <motion.div key="defects" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <DefectDetectionPanel onAlert={addAlert} />
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
