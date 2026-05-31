'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import dynamic from 'next/dynamic';

const LayerVisualization = dynamic(
  () => import('../pre-print-optimizer/components/LayerVisualization'),
  { ssr: false, loading: () => (
    <div className="flex items-center justify-center h-full">
      <div className="w-6 h-6 border-2 border-black/20 border-t-black rounded-full animate-spin" />
    </div>
  )},
);

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Temporary visualization-only scale: 1 PDF point → 0.01 m.
// Replace with a real scale factor derived from the drawing's stated scale (e.g. 1:50).
const PT_TO_M = 0.01;

interface Segment { x0: number; y0: number; x1: number; y1: number; gap?: boolean; }
type Layer = Segment[];

interface PreviewData {
  image_base64: string; page_width_pt: number; page_height_pt: number;
  zoom: number; image_width_px: number; image_height_px: number;
}
interface Group {
  fill_hex: string; stroke_hex: string; width: number;
  kind: string; count: number; total_len: number;
}
interface LegendColor { hex: string; legend_count: number; plan_count: number; }

type Seg  = [[number, number], [number, number]];
type Mode = 'line' | 'color';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-black/30 mb-3">
      {children}
    </p>
  );
}

export default function FloorPlanPage() {
  const router = useRouter();

  const [pdfFile,         setPdfFile]         = useState<File | null>(null);
  const [preview,         setPreview]         = useState<PreviewData | null>(null);
  const [groups,          setGroups]          = useState<Group[]>([]);
  const [legendColors,    setLegendColors]    = useState<LegendColor[]>([]);
  const [selectedColors,  setSelectedColors]  = useState<string[]>([]);
  const [clickedSegments, setClickedSegments] = useState<Seg[]>([]);
  const [wallSegments,    setWallSegments]    = useState<Seg[]>([]);
  const [mode,            setMode]            = useState<Mode>('line');
  const [loading,         setLoading]         = useState(false);
  const [extracting,      setExtracting]      = useState(false);
  const [statusMsg,       setStatusMsg]       = useState('Upload a PDF to begin');
  const [wallHeightMm,    setWallHeightMm]    = useState(2500);
  const [layerHeightMm,   setLayerHeightMm]   = useState(50);
  const [toolpath,        setToolpath]        = useState<Layer[] | null>(null);
  const [numLayers3d,     setNumLayers3d]     = useState(0);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPdfFile(file);
    setPreview(null); setGroups([]); setLegendColors([]);
    setSelectedColors([]); setClickedSegments([]); setWallSegments([]); setToolpath(null);
    if (!file) { setStatusMsg('Upload a PDF to begin'); return; }
    setLoading(true); setStatusMsg('Loading…');
    try {
      const fd1 = new FormData(); fd1.append('file', file);
      const fd2 = new FormData(); fd2.append('file', file);
      const fd3 = new FormData(); fd3.append('file', file);
      const [r1, r2, r3] = await Promise.all([
        fetch(`${API}/floorplan/preview`,       { method: 'POST', body: fd1 }),
        fetch(`${API}/floorplan/scan`,          { method: 'POST', body: fd2 }),
        fetch(`${API}/floorplan/legend_colors`, { method: 'POST', body: fd3 }),
      ]);
      const [pd, sd, ld] = await Promise.all([r1.json(), r2.json(), r3.json()]);
      if (pd.error) { setStatusMsg(`Error: ${pd.error}`); return; }
      setPreview(pd as PreviewData);
      setGroups((sd.groups ?? []) as Group[]);
      setLegendColors((ld.legend_colors ?? []) as LegendColor[]);
      setStatusMsg(
        `${file.name} · ${sd.total_drawings ?? 0} objects` +
        (ld.legend_colors?.length ? ` · ${ld.legend_colors.length} legend colors detected` : '')
      );
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message || 'Could not reach backend'}`);
    } finally { setLoading(false); }
  }

  async function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!preview || !pdfFile) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pdfX = (e.clientX - rect.left) * (preview.page_width_pt  / rect.width);
    const pdfY = (e.clientY - rect.top)  * (preview.page_height_pt / rect.height);
    if (mode === 'line') {
      const fd = new FormData();
      fd.append('file', pdfFile); fd.append('px', String(pdfX));
      fd.append('py', String(pdfY)); fd.append('tol', '8');
      try {
        const data = await fetch(`${API}/floorplan/pick`, { method: 'POST', body: fd }).then(r => r.json());
        if (data.hit && data.segment) setClickedSegments(prev => [...prev, data.segment as Seg]);
      } catch { /* silent */ }
    } else {
      const fd = new FormData();
      fd.append('file', pdfFile); fd.append('px', String(pdfX));
      fd.append('py', String(pdfY)); fd.append('tol', '12');
      try {
        const data = await fetch(`${API}/floorplan/color_at`, { method: 'POST', body: fd }).then(r => r.json());
        if (data.hit && data.hex) toggleColor(data.hex);
      } catch { /* silent */ }
    }
  }

  function toggleColor(hex: string) {
    setSelectedColors(prev => prev.includes(hex) ? prev.filter(h => h !== hex) : [...prev, hex]);
  }

  async function handleExtract() {
    if (!pdfFile) return;
    setExtracting(true); setToolpath(null);
    try {
      const fd = new FormData();
      fd.append('file', pdfFile); fd.append('color_hex', '');
      fd.append('colors_json', JSON.stringify(selectedColors));
      fd.append('segments_json', JSON.stringify(clickedSegments));
      const data = await fetch(`${API}/floorplan/extract`, { method: 'POST', body: fd }).then(r => r.json());
      if (data.error) { setStatusMsg(`Extract error: ${data.error}`); return; }
      setWallSegments((data.segments ?? []) as Seg[]);
      setStatusMsg(`${data.count} wall segments extracted`);
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message || 'Could not reach backend'}`);
    } finally { setExtracting(false); }
  }

  function handleVisualize() {
    if (!wallSegments.length) return;
    const base: Layer = wallSegments.map(s => ({
      x0: s[0][0] * PT_TO_M, y0: s[0][1] * PT_TO_M,
      x1: s[1][0] * PT_TO_M, y1: s[1][1] * PT_TO_M,
    }));
    const n = Math.max(1, Math.round((wallHeightMm / 1000) / (layerHeightMm / 1000)));
    setNumLayers3d(n);
    setToolpath(Array.from({ length: n }, () => base));
  }

  function swatchOf(g: Group) {
    return g.fill_hex !== '-' ? g.fill_hex : g.stroke_hex !== '-' ? g.stroke_hex : '#888';
  }
  function colorOf(g: Group) {
    return g.fill_hex !== '-' ? g.fill_hex : g.stroke_hex !== '-' ? g.stroke_hex : '';
  }

  const computedLayers = Math.max(1, Math.round((wallHeightMm / 1000) / (layerHeightMm / 1000)));
  const hasSelection   = selectedColors.length > 0 || clickedSegments.length > 0;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="border-b border-gray-100 bg-white sticky top-0 z-20 flex-shrink-0">
        <div className="px-6 py-1 flex items-center justify-between">
          <button onClick={() => router.push('/')} className="-my-4 sm:-my-6">
            <Image src="/Autobuildblack.png" alt="AutoBuild AI" width={400} height={400}
              className="h-24 sm:h-36 w-auto" />
          </button>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-black/30">Floor Plan</span>
          </div>
        </div>
      </header>

      {/* ── Two-column body ───────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className="w-72 flex-shrink-0 bg-white border-r border-gray-100 overflow-y-auto flex flex-col">
          <div className="flex flex-col flex-1 divide-y divide-gray-100">

            {/* Upload */}
            <section className="p-5">
              <SectionLabel>Floor Plan PDF</SectionLabel>
              <input
                type="file" accept=".pdf" onChange={handleFileChange}
                className="block w-full text-sm text-black/50
                  file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0
                  file:text-xs file:font-semibold file:bg-black file:text-white
                  hover:file:bg-black/80 file:cursor-pointer cursor-pointer transition-all"
              />
            </section>

            {/* Click mode — shown after PDF loaded */}
            {pdfFile && (
              <section className="p-5">
                <SectionLabel>Click Mode</SectionLabel>
                <div className="flex rounded-xl overflow-hidden border border-gray-200 text-xs font-semibold w-full">
                  <button onClick={() => setMode('line')}
                    className={`flex-1 py-2 transition-colors ${mode === 'line'
                      ? 'bg-black text-white' : 'text-black/40 hover:text-black'}`}>
                    Line pick
                  </button>
                  <button onClick={() => setMode('color')}
                    className={`flex-1 py-2 transition-colors ${mode === 'color'
                      ? 'bg-black text-white' : 'text-black/40 hover:text-black'}`}>
                    Color pick
                  </button>
                </div>
                <p className="text-[11px] text-black/30 mt-2 leading-relaxed">
                  {mode === 'line'
                    ? 'Click any line on the plan to select it individually.'
                    : 'Click any element to select all objects of that color.'}
                </p>
              </section>
            )}

            {/* Legend colors */}
            {legendColors.length > 0 && (
              <section className="p-5">
                <SectionLabel>Legend Colors</SectionLabel>
                <div className="flex flex-col gap-1.5">
                  {legendColors.map(lc => {
                    const on = selectedColors.includes(lc.hex);
                    return (
                      <button key={lc.hex} onClick={() => toggleColor(lc.hex)}
                        className={`flex items-center gap-3 w-full px-3 py-2 rounded-xl border
                          text-xs font-medium transition-all text-left ${on
                            ? 'bg-black text-white border-black'
                            : 'border-gray-100 hover:border-gray-300 bg-gray-50'}`}>
                        <span className="w-5 h-5 rounded-md flex-shrink-0 border border-black/10"
                          style={{ background: lc.hex }} />
                        <span className="font-mono flex-1">{lc.hex}</span>
                        <span className={`text-[11px] ${on ? 'text-white/50' : 'text-black/30'}`}>
                          {lc.plan_count} obj
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* All vector colors */}
            {groups.length > 0 && (
              <section className="p-5">
                <SectionLabel>All Colors ({groups.length})</SectionLabel>
                <div className="space-y-0.5 max-h-56 overflow-y-auto -mx-1">
                  {groups.map((g, i) => {
                    const sc = colorOf(g);
                    const on = sc !== '' && selectedColors.includes(sc);
                    return (
                      <button key={i} onClick={() => sc && toggleColor(sc)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg
                          text-left transition-colors ${on ? 'bg-black/5' : 'hover:bg-gray-50'}`}>
                        <span className="w-4 h-4 rounded flex-shrink-0 border border-gray-200"
                          style={{ background: swatchOf(g) }} />
                        <span className="text-[10px] font-mono text-black/40 w-16 flex-shrink-0 truncate">
                          {sc || '-'}
                        </span>
                        <span className="text-[11px] text-black/50 flex-1 truncate">{g.kind}</span>
                        <span className="text-[10px] text-black/25 flex-shrink-0">{g.count}</span>
                        {on && <span className="text-[10px] text-black/60 flex-shrink-0">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Selection summary + actions */}
            {pdfFile && (
              <section className="p-5 space-y-4">
                <SectionLabel>Selection</SectionLabel>

                {/* Color swatches */}
                {selectedColors.length > 0 ? (
                  <div>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {selectedColors.map(h => (
                        <button key={h} onClick={() => toggleColor(h)} title={`Remove ${h}`}
                          className="w-6 h-6 rounded-lg border-2 border-white shadow-sm
                            hover:scale-110 transition-transform ring-1 ring-black/10"
                          style={{ background: h }} />
                      ))}
                    </div>
                    <p className="text-[11px] text-black/40">
                      {selectedColors.length} color{selectedColors.length !== 1 ? 's' : ''} selected
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] text-black/25 italic">No colors selected</p>
                )}

                {/* Line count */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] text-black/40">
                      {clickedSegments.length} line{clickedSegments.length !== 1 ? 's' : ''} picked
                    </p>
                    {wallSegments.length > 0 && (
                      <p className="text-[11px] text-black/40 mt-0.5">
                        {wallSegments.length} segments extracted
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {selectedColors.length > 0 && (
                      <button onClick={() => setSelectedColors([])}
                        className="text-[11px] text-black/30 hover:text-black transition-colors">
                        Clear colors
                      </button>
                    )}
                    {clickedSegments.length > 0 && (
                      <button onClick={() => setClickedSegments([])}
                        className="text-[11px] text-red-400 hover:text-red-600 transition-colors">
                        Clear lines
                      </button>
                    )}
                    {wallSegments.length > 0 && (
                      <button onClick={() => setWallSegments([])}
                        className="text-[11px] text-blue-400 hover:text-blue-600 transition-colors">
                        Clear walls
                      </button>
                    )}
                  </div>
                </div>

                {/* Extract button */}
                <button
                  onClick={handleExtract}
                  disabled={!hasSelection || extracting}
                  className="w-full py-2.5 bg-black text-white text-sm font-semibold rounded-xl
                    hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                  {extracting ? 'Extracting…' : 'Extract Walls'}
                </button>
              </section>
            )}

            {/* 3D visualisation settings */}
            {wallSegments.length > 0 && (
              <section className="p-5 space-y-4">
                <SectionLabel>3D Visualisation</SectionLabel>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] text-black/40 mb-1">Wall height (mm)</label>
                    <input type="number" min={100} max={20000} step={50}
                      value={wallHeightMm}
                      onChange={e => setWallHeightMm(Math.max(1, Number(e.target.value)))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm
                        outline-none focus:border-black transition-colors" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-black/40 mb-1">Layer height (mm)</label>
                    <input type="number" min={1} max={500} step={5}
                      value={layerHeightMm}
                      onChange={e => setLayerHeightMm(Math.max(1, Number(e.target.value)))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm
                        outline-none focus:border-black transition-colors" />
                  </div>
                </div>

                <p className="text-[11px] text-black/30">{computedLayers} layers</p>

                <button onClick={handleVisualize}
                  className="w-full py-2.5 border-2 border-black text-black text-sm font-semibold
                    rounded-xl hover:bg-black hover:text-white transition-all">
                  Visualize in 3D
                </button>

                {toolpath && (
                  <button onClick={() => setToolpath(null)}
                    className="w-full text-[11px] text-black/30 hover:text-black transition-colors">
                    Hide viewer
                  </button>
                )}
              </section>
            )}

          </div>
        </aside>

        {/* ── Main panel ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto flex flex-col">

          {/* Status bar */}
          <div className="px-6 py-3 border-b border-gray-100 bg-white flex items-center gap-3 flex-shrink-0">
            {loading && (
              <div className="w-3.5 h-3.5 border-2 border-black/20 border-t-black rounded-full animate-spin flex-shrink-0" />
            )}
            <p className="text-xs text-black/40 truncate">{statusMsg}</p>
            {(clickedSegments.length > 0 || wallSegments.length > 0) && (
              <div className="flex items-center gap-4 ml-auto flex-shrink-0">
                {clickedSegments.length > 0 && (
                  <div className="flex items-center gap-1.5 text-[11px] text-black/40">
                    <div className="w-4 h-0.5 bg-red-400 rounded" />
                    {clickedSegments.length} picked
                  </div>
                )}
                {wallSegments.length > 0 && (
                  <div className="flex items-center gap-1.5 text-[11px] text-black/40">
                    <div className="w-4 h-0.5 bg-blue-500 rounded" />
                    {wallSegments.length} extracted
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="flex-1 p-6 space-y-4">
            <div className={`rounded-2xl overflow-hidden border bg-white shadow-sm flex items-center justify-center
              ${preview ? 'border-gray-100' : 'border-2 border-dashed border-gray-200'}`}
              style={{ minHeight: '480px' }}>

              {loading && (
                <div className="flex flex-col items-center gap-3 py-20">
                  <div className="w-7 h-7 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                  <p className="text-sm text-black/30">Rendering preview…</p>
                </div>
              )}

              {!loading && preview && (
                <div className="relative w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/png;base64,${preview.image_base64}`}
                    alt="PDF preview"
                    className="w-full h-auto block"
                    style={{ cursor: mode === 'color' ? 'cell' : 'crosshair' }}
                    onClick={handleImageClick}
                  />
                  <svg
                    style={{ position: 'absolute', top: 0, left: 0,
                      width: '100%', height: '100%', pointerEvents: 'none' }}
                    viewBox={`0 0 ${preview.page_width_pt} ${preview.page_height_pt}`}
                    preserveAspectRatio="none"
                  >
                    {wallSegments.map((seg, i) => (
                      <line key={`w${i}`}
                        x1={seg[0][0]} y1={seg[0][1]} x2={seg[1][0]} y2={seg[1][1]}
                        stroke="#3b82f6" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                    ))}
                    {clickedSegments.map((seg, i) => (
                      <line key={`c${i}`}
                        x1={seg[0][0]} y1={seg[0][1]} x2={seg[1][0]} y2={seg[1][1]}
                        stroke="#ef4444" strokeWidth={3} vectorEffect="non-scaling-stroke" />
                    ))}
                  </svg>
                </div>
              )}

              {!loading && !preview && (
                <div className="flex flex-col items-center gap-3 py-20">
                  <svg className="w-10 h-10 text-black/10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-sm text-black/25">PDF preview will appear here</p>
                </div>
              )}
            </div>

            {/* 3D viewer */}
            {toolpath && (
              <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm"
                style={{ height: '600px' }}>
                <LayerVisualization
                  file={null}
                  toolpath={toolpath as any}
                  numLayers={numLayers3d}
                  layerHeight={layerHeightMm / 1000}
                  nozzleDiameter={0.025}
                />
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
