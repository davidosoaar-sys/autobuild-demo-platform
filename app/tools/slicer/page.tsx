'use client';

import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MATERIALS } from '@/app/pre-print-optimizer/components/ParameterInputs';
import dynamic from 'next/dynamic';

const LayerVisualization = dynamic(
  () => import('@/app/pre-print-optimizer/components/LayerVisualization'),
  { ssr: false },
);

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface SlicerResult {
  result_id: string;
  estimated_print_time: string;
  geometry: { total_layers: number; bounding_box?: { x_mm: number; y_mm: number; z_mm: number } };
  printer: { layer_height_mm: number; nozzle_mm: number; effective_speed: number };
  weather: { city: string; avg: { temperature: number; humidity: number; wind_speed: number } };
  optimization: { avg_risk_score?: number };
  toolpath: unknown[];
  gcode_full: string;
  gcode_lines: number;
  cement?: { display_name?: string };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:border-black transition-colors';
const selectCls = 'w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black transition-colors';

export default function SlicerTool() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file,       setFile]       = useState<File | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [result,     setResult]     = useState<SlicerResult | null>(null);
  const [error,      setError]      = useState('');

  // Printer params
  const [nozzle,       setNozzle]       = useState(25);
  const [compression,  setCompression]  = useState(0.6);
  const [velocity,     setVelocity]     = useState(100);
  const [hoseLength,   setHoseLength]   = useState(15);
  const [flowRate,     setFlowRate]     = useState(8);
  const [acceleration, setAcceleration] = useState(500);

  // Cement + city
  const [cementId, setCementId] = useState('sika-733w-3d-us');
  const [city,     setCity]     = useState('');

  const layerHeight = Math.round(nozzle * compression) / 10;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setResult(null);
    setError('');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); setResult(null); setError(''); }
  };

  const run = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('nozzle_diameter_mm',    String(nozzle));
      fd.append('bead_compression',      String(compression));
      fd.append('max_speed_mm_s',        String(velocity));
      fd.append('base_speed_mm_s',       String(Math.round(velocity * 0.6)));
      fd.append('hose_length_m',         String(hoseLength));
      fd.append('max_mass_flow_l_min',   String(flowRate));
      fd.append('acceleration_mm_s2',    String(acceleration));
      fd.append('cement_mix_name',       cementId);
      if (city.trim()) fd.append('city', city.trim());

      const res = await fetch(`${API}/optimize`, { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Server error ${res.status}`);
      }
      const data: SlicerResult = await res.json();
      setResult(data);
    } catch (e: any) {
      setError(e.message || 'Optimization failed');
    } finally {
      setLoading(false);
    }
  };

  const downloadGcode = () => {
    if (!result) return;
    const blob = new Blob([result.gcode_full], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${file?.name?.replace(/\.[^.]+$/, '') ?? 'print'}.gcode`;
    a.click(); URL.revokeObjectURL(url);
  };

  const downloadTxt = () => {
    if (!result) return;
    const lines = [
      `AutoBuild AI — Slicer Report`,
      `File: ${file?.name}`,
      ``,
      `Print time: ${result.estimated_print_time}`,
      `Layers: ${result.geometry.total_layers}`,
      `Layer height: ${result.printer.layer_height_mm} mm`,
      `Nozzle: ${result.printer.nozzle_mm} mm`,
      `Effective speed: ${result.printer.effective_speed} mm/s`,
      `G-code lines: ${result.gcode_lines}`,
      ``,
      `Weather: ${result.weather.city}`,
      `  Temperature: ${result.weather.avg.temperature}°C`,
      `  Humidity: ${result.weather.avg.humidity}%`,
      `  Wind: ${result.weather.avg.wind_speed} km/h`,
    ].join('\n');
    const blob = new Blob([lines], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${file?.name?.replace(/\.[^.]+$/, '') ?? 'print'}_report.txt`;
    a.click(); URL.revokeObjectURL(url);
  };

  const selectedMat = MATERIALS.find(m => m.id === cementId);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-base font-bold text-black">AutoBuild AI</span>
            <span className="w-px h-4 bg-gray-200" />
            <span className="text-sm font-medium text-black/40">RL Slicer</span>
          </div>
          {file && !loading && (
            <button onClick={run}
              className="px-5 py-2 bg-black text-white text-sm font-semibold rounded-xl hover:bg-black/80 transition-all">
              Run Optimizer
            </button>
          )}
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">

        {/* ── Left panel ── */}
        <div className="space-y-4">

          {/* Upload */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
            <h2 className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-4">Model</h2>
            <div
              onDrop={handleDrop}
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
            <input ref={fileInputRef} type="file" accept=".stl,.obj,.stp,.step" className="hidden" onChange={handleFile} />
          </div>

          {/* Printer params */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4">
            <h2 className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Printer</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Nozzle (mm)">
                <input type="number" value={nozzle} min={10} max={80} onChange={e => setNozzle(Number(e.target.value))} className={inputCls} />
              </Field>
              <Field label={`Compression → ${layerHeight} mm`}>
                <input type="number" value={compression} min={0.4} max={0.9} step={0.05} onChange={e => setCompression(Number(e.target.value))} className={inputCls} />
              </Field>
              <Field label="Max velocity (mm/s)">
                <input type="number" value={velocity} min={10} max={300} onChange={e => setVelocity(Number(e.target.value))} className={inputCls} />
              </Field>
              <Field label="Hose length (m)">
                <input type="number" value={hoseLength} min={1} max={100} onChange={e => setHoseLength(Number(e.target.value))} className={inputCls} />
              </Field>
              <Field label="Max flow (L/min)">
                <input type="number" value={flowRate} min={1} max={30} step={0.5} onChange={e => setFlowRate(Number(e.target.value))} className={inputCls} />
              </Field>
              <Field label="Acceleration (mm/s²)">
                <input type="number" value={acceleration} min={50} max={2000} step={50} onChange={e => setAcceleration(Number(e.target.value))} className={inputCls} />
              </Field>
            </div>
          </div>

          {/* Cement */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-3">
            <h2 className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Cement Mix</h2>
            <select value={cementId} onChange={e => setCementId(e.target.value)} className={selectCls}>
              {MATERIALS.map(m => (
                <option key={m.id} value={m.id}>{m.name} — {m.region}</option>
              ))}
            </select>
            {selectedMat && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                {[
                  ['Pot life 20°C', `${selectedMat.potLife20c} min`],
                  ['Strength 28d',  selectedMat.strength28d],
                  ['Layer range',   `${selectedMat.layerMin}–${selectedMat.layerMax} mm`],
                  ['Water ratio',   selectedMat.waterRatio],
                ].map(([k, v]) => (
                  <div key={k} className="bg-gray-50 rounded-xl px-3 py-2">
                    <p className="text-[9px] text-black/30 uppercase tracking-wide">{k}</p>
                    <p className="text-xs font-semibold text-black">{v}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Weather */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
            <h2 className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-3">Weather (optional)</h2>
            <Field label="City">
              <input type="text" value={city} placeholder="e.g. London, Dubai, New York"
                onChange={e => setCity(e.target.value)} className={inputCls} />
            </Field>
            <p className="text-[10px] text-black/25 mt-2">Leave blank to use default conditions</p>
          </div>

          {/* Run button (mobile) */}
          <button onClick={run} disabled={!file || loading}
            className="w-full py-3 bg-black text-white text-sm font-semibold rounded-xl hover:bg-black/80 disabled:opacity-40 disabled:cursor-not-allowed transition-all lg:hidden">
            {loading ? 'Optimising…' : 'Run Optimizer'}
          </button>

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-600 font-medium">
              {error}
            </div>
          )}
        </div>

        {/* ── Right panel ── */}
        <div className="space-y-4">

          {/* 3D viewer */}
          <div className="bg-black rounded-2xl overflow-hidden shadow-sm" style={{ minHeight: 420 }}>
            {result ? (
              <LayerVisualization
                file={file}
                toolpath={result.toolpath as any}
                numLayers={result.geometry.total_layers}
                layerHeight={result.printer.layer_height_mm / 1000}
                nozzleDiameter={result.printer.nozzle_mm}
              />
            ) : (
              <div className="flex items-center justify-center h-full min-h-[420px]">
                <div className="text-center">
                  <svg className="w-12 h-12 text-white/10 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <p className="text-white/20 text-sm">Upload a model and run the optimizer</p>
                </div>
              </div>
            )}
          </div>

          {/* Results */}
          <AnimatePresence>
            {result && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Results</h2>
                  <div className="flex gap-2">
                    <button onClick={downloadGcode}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-black text-white text-[11px] font-semibold rounded-xl hover:bg-black/80 transition-all">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      .gcode
                    </button>
                    <button onClick={downloadTxt}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-black text-[11px] font-semibold rounded-xl hover:bg-gray-50 transition-all">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Report
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {[
                    { label: 'Print Time',    value: result.estimated_print_time },
                    { label: 'Layers',        value: String(result.geometry.total_layers) },
                    { label: 'Layer Height',  value: `${result.printer.layer_height_mm} mm` },
                    { label: 'G-code Lines',  value: result.gcode_lines.toLocaleString() },
                    { label: 'Avg Speed',     value: `${result.printer.effective_speed} mm/s` },
                    { label: 'Material',      value: selectedMat?.name ?? cementId },
                    { label: 'Weather',       value: result.weather.city !== 'manual' ? result.weather.city : 'Default' },
                    { label: 'Avg Temp',      value: `${result.weather.avg.temperature}°C` },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-gray-50 rounded-xl px-3 py-2.5">
                      <p className="text-[9px] text-black/30 uppercase tracking-wide mb-0.5">{label}</p>
                      <p className="text-sm font-semibold text-black truncate">{value}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
              <p className="text-sm text-black/40 mt-1">Slicing model and computing toolpath…</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
