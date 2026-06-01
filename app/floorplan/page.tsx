'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import dynamic from 'next/dynamic';

const WallViewer = dynamic(() => import('./WallViewer'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-sky-200">
      <div className="w-6 h-6 border-2 border-white/40 border-t-white rounded-full animate-spin" />
    </div>
  ),
});

const LayerVisualization = dynamic(
  () => import('@/app/pre-print-optimizer/components/LayerVisualization'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full bg-gray-900">
        <div className="w-6 h-6 border-2 border-white/40 border-t-white rounded-full animate-spin" />
      </div>
    ),
  }
);

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Real-world scale: plan drawn at 1:50.
// pt → paper metres (pt / 72 * 0.0254) → real metres (* 50)
const PT_TO_M = (0.0254 / 72) * 50; // ≈ 0.017638 m per pt at 1:50


interface PreviewData {
  image_base64: string; page_width_pt: number; page_height_pt: number;
  zoom: number; image_width_px: number; image_height_px: number;
}
interface Group {
  fill_hex: string; stroke_hex: string; width: number;
  kind: string; count: number; total_len: number;
}
interface LegendColor { hex: string; legend_count: number; plan_count: number; }
interface HatchSignature { angle: number; spacing: number; }

type Seg       = [[number, number], [number, number]];
type Mode      = 'line' | 'color' | 'pattern';
type View      = 'select' | 'review';
type MatchMode = 'both' | 'angle';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-black/30 mb-3">
      {children}
    </p>
  );
}

function NumInput({ label, value, onChange, min, max, step, unit }: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] text-black/40 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input type="number" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Math.max(min ?? 0, Number(e.target.value)))}
          className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm
            outline-none focus:border-black transition-colors" />
        {unit && <span className="text-[11px] text-black/30 flex-shrink-0">{unit}</span>}
      </div>
    </div>
  );
}

export default function FloorPlanPage() {
  const router = useRouter();

  // ── View ──────────────────────────────────────────────────────────────────
  const [view, setView] = useState<View>('select');

  // ── Core state ────────────────────────────────────────────────────────────
  const [pdfFile,      setPdfFile]      = useState<File | null>(null);
  const [preview,      setPreview]      = useState<PreviewData | null>(null);
  const [groups,       setGroups]       = useState<Group[]>([]);
  const [legendColors, setLegendColors] = useState<LegendColor[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [statusMsg,    setStatusMsg]    = useState('Upload a PDF to begin');

  // ── Selection state ───────────────────────────────────────────────────────
  const [mode,              setMode]              = useState<Mode>('line');
  const [selectedColors,    setSelectedColors]    = useState<string[]>([]);
  const [clickedSegments,   setClickedSegments]   = useState<Seg[]>([]);
  const [selectedSignature, setSelectedSignature] = useState<HatchSignature | null>(null);
  const [angleTol,          setAngleTol]          = useState(8);
  const [spacingTol,        setSpacingTol]        = useState(0.5);
  const [matchMode,         setMatchMode]         = useState<MatchMode>('both');

  // ── Three wall-segment buckets ────────────────────────────────────────────
  const [selectedSignatures, setSelectedSignatures] = useState<HatchSignature[]>([]);
  const [patternSegments,    setPatternSegments]    = useState<Seg[][]>([]);
  const [colorSegments,      setColorSegments]      = useState<Seg[]>([]);

  const wallSegments = useMemo<Seg[]>(
    () => [...patternSegments.flat(), ...colorSegments, ...clickedSegments],
    [patternSegments, colorSegments, clickedSegments],
  );

  // ── Extracting flags ──────────────────────────────────────────────────────
  const [extracting,        setExtracting]        = useState(false);
  const [patternExtracting, setPatternExtracting] = useState(false);

  // ── 3D / review state ─────────────────────────────────────────────────────
  const [wallHeightMm,  setWallHeightMm]  = useState(2500);
  const [layerHeightMm, setLayerHeightMm] = useState(50);

  // ── Slicer state ──────────────────────────────────────────────────────────
  const [nozzleMm,    setNozzleMm]    = useState(25);
  const [speedMmS,    setSpeedMmS]    = useState(60);
  const [cityInput,   setCityInput]   = useState('');
  const [sliceResult, setSliceResult] = useState<any>(null);
  const [slicing,     setSlicing]     = useState(false);

  // ── File load ─────────────────────────────────────────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPdfFile(file);
    setPreview(null); setGroups([]); setLegendColors([]);
    setSelectedColors([]); setClickedSegments([]);
    setSelectedSignature(null);
    setSelectedSignatures([]); setPatternSegments([]); setColorSegments([]);
    setView('select');
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
        (ld.legend_colors?.length ? ` · ${ld.legend_colors.length} legend colors` : '')
      );
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message || 'Could not reach backend'}`);
    } finally { setLoading(false); }
  }

  // ── Image click ───────────────────────────────────────────────────────────
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
    } else if (mode === 'color') {
      const fd = new FormData();
      fd.append('file', pdfFile); fd.append('px', String(pdfX));
      fd.append('py', String(pdfY)); fd.append('tol', '12');
      try {
        const data = await fetch(`${API}/floorplan/color_at`, { method: 'POST', body: fd }).then(r => r.json());
        if (data.hit && data.hex) toggleColor(data.hex);
      } catch { /* silent */ }
    } else {
      const fd = new FormData();
      fd.append('file', pdfFile); fd.append('px', String(pdfX));
      fd.append('py', String(pdfY)); fd.append('tol', '6');
      try {
        const data = await fetch(`${API}/floorplan/signature_at`, { method: 'POST', body: fd }).then(r => r.json());
        if (data.hit) setSelectedSignature({ angle: data.angle, spacing: data.spacing });
      } catch { /* silent */ }
    }
  }

  function toggleColor(hex: string) {
    setSelectedColors(prev => prev.includes(hex) ? prev.filter(h => h !== hex) : [...prev, hex]);
  }

  async function handleExtract() {
    if (!pdfFile) return;
    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append('file', pdfFile); fd.append('color_hex', '');
      fd.append('colors_json',   JSON.stringify(selectedColors));
      fd.append('segments_json', '[]');
      const data = await fetch(`${API}/floorplan/extract`, { method: 'POST', body: fd }).then(r => r.json());
      if (data.error) { setStatusMsg(`Extract error: ${data.error}`); return; }
      setColorSegments((data.segments ?? []) as Seg[]);
      setStatusMsg(`${data.count} color segments extracted`);
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message || 'Could not reach backend'}`);
    } finally { setExtracting(false); }
  }

  async function handleAddPattern() {
    if (!pdfFile || !selectedSignature) return;
    setPatternExtracting(true);
    try {
      const fd = new FormData();
      fd.append('file',        pdfFile);
      fd.append('angle',       String(selectedSignature.angle));
      fd.append('spacing',     String(selectedSignature.spacing));
      fd.append('angle_tol',   String(angleTol));
      fd.append('spacing_tol', String(spacingTol));
      fd.append('match_mode',  matchMode);
      const data = await fetch(`${API}/floorplan/extract_by_signature`, { method: 'POST', body: fd }).then(r => r.json());
      if (data.error) { setStatusMsg(`Pattern error: ${data.error}`); return; }
      const newSegs = (data.segments ?? []) as Seg[];
      setSelectedSignatures(prev => [...prev, { ...selectedSignature, matchMode } as any]);
      setPatternSegments(prev => [...prev, newSegs]);
      setSelectedSignature(null);
      setStatusMsg(`Pattern added · ${data.matched_objects} objects · ${data.count} segments`);
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message || 'Could not reach backend'}`);
    } finally { setPatternExtracting(false); }
  }

  async function handleSlice() {
    if (!wallSegments.length || !preview) return;
    setSlicing(true);
    setSliceResult(null);
    try {
      const fd = new FormData();
      fd.append('segments_json',      JSON.stringify(wallSegments));
      fd.append('page_width_pt',      String(preview.page_width_pt));
      fd.append('page_height_pt',     String(preview.page_height_pt));
      fd.append('wall_height_mm',     String(wallHeightMm));
      fd.append('layer_height_mm',    String(layerHeightMm));
      fd.append('nozzle_diameter_mm', String(nozzleMm));
      fd.append('base_speed_mm_s',    String(speedMmS));
      if (cityInput.trim()) fd.append('city', cityInput.trim());
      const data = await fetch(`${API}/floorplan/slice`, { method: 'POST', body: fd }).then(r => r.json());
      if (data.detail || data.error) {
        setStatusMsg(`Slice error: ${data.detail || data.error}`);
        return;
      }
      setSliceResult(data);
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message || 'Could not reach backend'}`);
    } finally {
      setSlicing(false);
    }
  }

  function removePattern(i: number) {
    setSelectedSignatures(prev => prev.filter((_, idx) => idx !== i));
    setPatternSegments(prev    => prev.filter((_, idx) => idx !== i));
  }

  function clearAllWalls() {
    setSelectedSignatures([]); setPatternSegments([]);
    setColorSegments([]); setClickedSegments([]);
  }

  // ── Review SVG ────────────────────────────────────────────────────────────
  const reviewSvg = useMemo(() => {
    if (!wallSegments.length) return null;
    const SVG_W = 800; const PAD = 20;
    const xs = wallSegments.flatMap(s => [s[0][0], s[1][0]]);
    const ys = wallSegments.flatMap(s => [s[0][1], s[1][1]]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const dataW = maxX - minX || 1;
    const dataH = maxY - minY || 1;
    const scale = (SVG_W - PAD * 2) / Math.max(dataW, dataH);
    const svgH  = dataH * scale + PAD * 2;
    const tx = (x: number) => PAD + (x - minX) * scale;
    const ty = (y: number) => PAD + (y - minY) * scale;
    return { SVG_W, svgH, tx, ty };
  }, [wallSegments]);

  function swatchOf(g: Group) {
    return g.fill_hex !== '-' ? g.fill_hex : g.stroke_hex !== '-' ? g.stroke_hex : '#888';
  }
  function colorOf(g: Group) {
    return g.fill_hex !== '-' ? g.fill_hex : g.stroke_hex !== '-' ? g.stroke_hex : '';
  }

  const hasColorSelection  = selectedColors.length > 0;
  const computedLayers     = Math.max(1, Math.round((wallHeightMm / 1000) / (layerHeightMm / 1000)));
  const totalPatternSegs   = patternSegments.reduce((a, s) => a + s.length, 0);
  const modeHint = mode === 'line'
    ? 'Click any line on the plan to select it individually.'
    : mode === 'color'
    ? 'Click any element to select all objects of that color.'
    : 'Click any hatch area to detect its pattern signature.';

  // ══════════════════════════════════════════════════════════════════════════
  // REVIEW VIEW — side-by-side layout
  // ══════════════════════════════════════════════════════════════════════════
  if (view === 'review') {
    return (
      <>
      {/* Slicing loading overlay */}
      {slicing && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-5">
          <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
          <div className="text-center">
            <p className="text-white font-semibold text-base">Slicing floor plan…</p>
            <p className="text-white/50 text-sm mt-1">{wallSegments.length} segments · {computedLayers} layers</p>
          </div>
        </div>
      )}
      <div className="min-h-screen flex flex-col bg-gray-50">
        <header className="border-b border-gray-100 bg-white sticky top-0 z-20 flex-shrink-0">
          <div className="px-6 py-1 flex items-center justify-between">
            <button onClick={() => router.push('/')} className="-my-4 sm:-my-6">
              <Image src="/Autobuildblack.png" alt="AutoBuild AI" width={400} height={400}
                className="h-24 sm:h-36 w-auto" />
            </button>
            <span className="text-sm font-medium text-black/30">Floor Plan — Review</span>
          </div>
        </header>

        {/* Side-by-side: left = 2D + controls, right = 3D viewer */}
        <div className="flex flex-1 min-h-0 gap-0">

          {/* LEFT — 2D review + controls */}
          <div className="flex flex-col overflow-y-auto bg-gray-50"
            style={{ minWidth: '340px', maxWidth: '45%', width: '45%' }}>
            <div className="p-6 space-y-5 flex-1">

              {/* Header row */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-black tracking-tight">Review walls</h1>
                  <p className="text-xs text-black/40 mt-0.5">
                    {wallSegments.length} segment{wallSegments.length !== 1 ? 's' : ''}
                    {selectedSignatures.length > 0 && ` · ${selectedSignatures.length} pattern${selectedSignatures.length !== 1 ? 's' : ''}`}
                    {colorSegments.length > 0 && ` · ${colorSegments.length} color`}
                    {clickedSegments.length > 0 && ` · ${clickedSegments.length} picked`}
                  </p>
                </div>
                <button onClick={() => setView('select')}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-xl
                    text-xs font-medium text-black/50 hover:border-black hover:text-black transition-all flex-shrink-0">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>
              </div>

              {/* 2D SVG preview */}
              <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                {reviewSvg ? (
                  <svg width="100%" viewBox={`0 0 ${reviewSvg.SVG_W} ${reviewSvg.svgH}`}
                    style={{ display: 'block' }}>
                    <rect width={reviewSvg.SVG_W} height={reviewSvg.svgH} fill="white" />
                    {wallSegments.map((seg, i) => (
                      <line key={i}
                        x1={reviewSvg.tx(seg[0][0])} y1={reviewSvg.ty(seg[0][1])}
                        x2={reviewSvg.tx(seg[1][0])} y2={reviewSvg.ty(seg[1][1])}
                        stroke="#111" strokeWidth={1.5} strokeLinecap="round" />
                    ))}
                  </svg>
                ) : (
                  <div className="flex items-center justify-center py-12">
                    <p className="text-sm text-black/25">No wall segments</p>
                  </div>
                )}
              </div>

              {/* Print parameters */}
              <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
                <SectionLabel>Print parameters</SectionLabel>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <NumInput label="Wall height (mm)" value={wallHeightMm}
                    onChange={setWallHeightMm} min={100} max={20000} step={50} />
                  <NumInput label="Layer height (mm)" value={layerHeightMm}
                    onChange={setLayerHeightMm} min={1} max={500} step={5} />
                </div>
                <p className="text-[11px] text-black/30">{computedLayers} layers · Scale 1:50</p>
              </div>

              {/* Pattern summary */}
              {selectedSignatures.length > 0 && (
                <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
                  <SectionLabel>Patterns ({selectedSignatures.length})</SectionLabel>
                  <div className="space-y-1.5">
                    {selectedSignatures.map((sig, i) => (
                      <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                        <span className="text-[10px] font-mono text-black/50 flex-1 truncate">
                          {sig.angle.toFixed(1)}° · {sig.spacing.toFixed(1)}pt
                          {(sig as any).matchMode === 'angle' && (
                            <span className="ml-1 text-orange-400">loose</span>
                          )}
                        </span>
                        <span className="text-[10px] text-black/25 flex-shrink-0">
                          {patternSegments[i]?.length ?? 0} seg
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Slicer config */}
              <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
                <SectionLabel>Slicer</SectionLabel>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <NumInput label="Nozzle (mm)" value={nozzleMm}
                    onChange={setNozzleMm} min={10} max={100} step={1} />
                  <NumInput label="Speed (mm/s)" value={speedMmS}
                    onChange={setSpeedMmS} min={10} max={200} step={5} />
                </div>
                <div className="mb-3">
                  <label className="block text-[11px] text-black/40 mb-1">City (weather, optional)</label>
                  <input type="text" value={cityInput}
                    onChange={e => setCityInput(e.target.value)}
                    placeholder="e.g. Berlin"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm
                      outline-none focus:border-black transition-colors" />
                </div>
                <button onClick={handleSlice} disabled={slicing}
                  className="w-full py-2.5 bg-black text-white text-sm font-semibold rounded-xl
                    hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                  {slicing ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Slicing…
                    </span>
                  ) : 'Run Slicer'}
                </button>
              </div>

              {/* Slice results */}
              {sliceResult && (
                <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 space-y-4">
                  <SectionLabel>Results</SectionLabel>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      ['Print time', sliceResult.estimated_print_time],
                      ['Layers',     sliceResult.geometry.num_layers],
                      ['Avg speed',  `${sliceResult.printer.effective_speed?.toFixed(0)} mm/s`],
                      ['Pot life',   `${sliceResult.material.pot_life_at_worst} min`],
                    ] as [string, any][]).map(([label, val]) => (
                      <div key={label} className="bg-gray-50 rounded-xl p-3">
                        <p className="text-[10px] text-black/30 uppercase tracking-wider mb-0.5">{label}</p>
                        <p className="text-sm font-semibold text-black">{val}</p>
                      </div>
                    ))}
                  </div>
                  <a href={`${API}/gcode/${sliceResult.result_id}`}
                    download={`floorplan_${sliceResult.result_id}.gcode`}
                    className="block w-full py-2 border border-gray-200 text-sm font-semibold
                      text-center rounded-xl hover:border-black hover:text-black transition-all text-black/50">
                    Download G-code
                  </a>
                </div>
              )}

            </div>
          </div>

          {/* RIGHT — layer visualizer (after slice) or wall preview (before) */}
          <div className="flex-1 min-w-0 min-h-0" style={{ minWidth: '300px', minHeight: '500px' }}>
            {sliceResult ? (
              <LayerVisualization
                file={null}
                toolpath={sliceResult.toolpath}
                numLayers={sliceResult.geometry.num_layers}
                layerHeight={sliceResult.geometry.layer_height}
                nozzleDiameter={nozzleMm / 1000}
              />
            ) : wallSegments.length > 0 ? (
              <WallViewer segments={wallSegments} wallHeightMm={wallHeightMm} />
            ) : (
              <div className="flex items-center justify-center h-full bg-gray-100">
                <p className="text-sm text-black/30">No wall segments selected</p>
              </div>
            )}
          </div>

        </div>
      </div>
      </>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SELECT VIEW
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">

      <header className="border-b border-gray-100 bg-white sticky top-0 z-20 flex-shrink-0">
        <div className="px-6 py-1 flex items-center justify-between">
          <button onClick={() => router.push('/')} className="-my-4 sm:-my-6">
            <Image src="/Autobuildblack.png" alt="AutoBuild AI" width={400} height={400}
              className="h-24 sm:h-36 w-auto" />
          </button>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-black/30">Floor Plan</span>
            {wallSegments.length > 0 && (
              <button onClick={() => setView('review')}
                className="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm
                  font-semibold rounded-xl hover:bg-black/80 transition-all">
                Review selection
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className="w-72 flex-shrink-0 bg-white border-r border-gray-100 overflow-y-auto flex flex-col">
          <div className="flex flex-col flex-1 divide-y divide-gray-100">

            <section className="p-5">
              <SectionLabel>Floor Plan PDF</SectionLabel>
              <input type="file" accept=".pdf" onChange={handleFileChange}
                className="block w-full text-sm text-black/50
                  file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0
                  file:text-xs file:font-semibold file:bg-black file:text-white
                  hover:file:bg-black/80 file:cursor-pointer cursor-pointer transition-all" />
            </section>

            {pdfFile && (
              <section className="p-5">
                <SectionLabel>Click Mode</SectionLabel>
                <div className="flex rounded-xl overflow-hidden border border-gray-200 text-xs font-semibold w-full">
                  {(['line', 'color', 'pattern'] as Mode[]).map(m => (
                    <button key={m} onClick={() => setMode(m)}
                      className={`flex-1 py-2 transition-colors capitalize ${mode === m
                        ? 'bg-black text-white' : 'text-black/40 hover:text-black'}`}>
                      {m}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-black/30 mt-2 leading-relaxed">{modeHint}</p>
              </section>
            )}

            {/* ── Pattern panel ──────────────────────────────────────────── */}
            {pdfFile && mode === 'pattern' && (
              <section className="p-5 space-y-4">
                <SectionLabel>Hatch Patterns</SectionLabel>

                {selectedSignatures.length > 0 && (
                  <div className="space-y-1.5">
                    {selectedSignatures.map((sig, i) => (
                      <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                        <span className="text-[10px] font-mono text-black/50 flex-1 truncate">
                          {sig.angle.toFixed(1)}° · {sig.spacing.toFixed(1)}pt
                          {(sig as any).matchMode === 'angle' && (
                            <span className="ml-1 text-orange-400">loose</span>
                          )}
                        </span>
                        <span className="text-[10px] text-black/25 flex-shrink-0">
                          {patternSegments[i]?.length ?? 0}
                        </span>
                        <button onClick={() => removePattern(i)}
                          className="text-[11px] text-red-400 hover:text-red-600 transition-colors flex-shrink-0">
                          ×
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-0.5">
                      <p className="text-[11px] text-black/40">
                        {selectedSignatures.length} pattern{selectedSignatures.length !== 1 ? 's' : ''} · {totalPatternSegs} seg
                      </p>
                      <button onClick={() => { setSelectedSignatures([]); setPatternSegments([]); }}
                        className="text-[11px] text-black/30 hover:text-black transition-colors">
                        Clear all
                      </button>
                    </div>
                  </div>
                )}

                {selectedSignature ? (
                  <div className="bg-gray-50 rounded-xl p-3 space-y-1 border border-gray-200">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-black/40">Detected</p>
                    <p className="text-xs font-mono text-black/70">
                      {selectedSignature.angle.toFixed(1)}° · spacing {selectedSignature.spacing.toFixed(1)} pt
                    </p>
                    <button onClick={() => setSelectedSignature(null)}
                      className="text-[11px] text-black/30 hover:text-black transition-colors">
                      Discard
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-black/25 italic leading-relaxed">
                    {selectedSignatures.length > 0
                      ? 'Click another hatch to add more patterns.'
                      : 'Click a hatch area to detect its signature.'}
                  </p>
                )}

                {/* Tolerances */}
                <div className="space-y-3">
                  <NumInput label="Angle tolerance (°)" value={angleTol}
                    onChange={setAngleTol} min={1} max={45} step={1} />
                  <NumInput label="Spacing tolerance (pt)" value={spacingTol}
                    onChange={setSpacingTol} min={0.1} max={10} step={0.1} />
                </div>

                {/* Match mode toggle */}
                <div>
                  <p className="text-[11px] text-black/40 mb-2">Matching precision</p>
                  <div className="flex rounded-xl overflow-hidden border border-gray-200 text-xs font-semibold w-full">
                    <button onClick={() => setMatchMode('both')}
                      className={`flex-1 py-2 px-1 transition-colors text-center ${matchMode === 'both'
                        ? 'bg-black text-white' : 'text-black/40 hover:text-black'}`}>
                      Precise
                    </button>
                    <button onClick={() => setMatchMode('angle')}
                      className={`flex-1 py-2 px-1 transition-colors text-center ${matchMode === 'angle'
                        ? 'bg-orange-500 text-white' : 'text-black/40 hover:text-black'}`}>
                      Loose
                    </button>
                  </div>
                  <p className="text-[10px] text-black/30 mt-1.5 leading-relaxed">
                    {matchMode === 'both'
                      ? 'Angle + spacing must match. Avoids grabbing other materials.'
                      : 'Angle only. Catches walls where spacing varies.'}
                  </p>
                </div>

                <button onClick={handleAddPattern}
                  disabled={!selectedSignature || patternExtracting}
                  className="w-full py-2.5 bg-black text-white text-sm font-semibold rounded-xl
                    hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                  {patternExtracting ? 'Matching…' : 'Add this pattern'}
                </button>
              </section>
            )}

            {/* ── Color + line panels ────────────────────────────────────── */}
            {pdfFile && mode !== 'pattern' && (
              <>
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

                {groups.length > 0 && (
                  <section className="p-5">
                    <SectionLabel>All Colors ({groups.length})</SectionLabel>
                    <div className="space-y-0.5 max-h-52 overflow-y-auto -mx-1">
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

                <section className="p-5 space-y-4">
                  <SectionLabel>Selection</SectionLabel>
                  {selectedColors.length > 0 ? (
                    <div>
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {selectedColors.map(h => (
                          <button key={h} onClick={() => toggleColor(h)} title={`Remove ${h}`}
                            className="w-6 h-6 rounded-lg border-2 border-white shadow-sm
                              hover:scale-110 transition-transform ring-1 ring-black/10"
                            style={{ background: h }} />
                        ))}
                      </div>
                      <p className="text-[11px] text-black/40">
                        {selectedColors.length} color{selectedColors.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-black/25 italic">No colors selected</p>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <p className="text-[11px] text-black/40">
                        {clickedSegments.length} line{clickedSegments.length !== 1 ? 's' : ''} picked
                      </p>
                      {colorSegments.length > 0 && (
                        <p className="text-[11px] text-black/40">{colorSegments.length} color seg</p>
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
                      {colorSegments.length > 0 && (
                        <button onClick={() => setColorSegments([])}
                          className="text-[11px] text-blue-400 hover:text-blue-600 transition-colors">
                          Clear extracted
                        </button>
                      )}
                    </div>
                  </div>
                  <button onClick={handleExtract} disabled={!hasColorSelection || extracting}
                    className="w-full py-2.5 bg-black text-white text-sm font-semibold rounded-xl
                      hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                    {extracting ? 'Extracting…' : 'Extract Walls'}
                  </button>
                </section>
              </>
            )}

            {/* Shared: total + clear + review CTA */}
            {wallSegments.length > 0 && (
              <section className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-black/50 font-medium">
                    {wallSegments.length} total segments
                  </p>
                  <button onClick={clearAllWalls}
                    className="text-[11px] text-black/30 hover:text-black transition-colors">
                    Clear all
                  </button>
                </div>
                <button onClick={() => setView('review')}
                  className="w-full py-2.5 border-2 border-black text-black text-sm font-semibold
                    rounded-xl hover:bg-black hover:text-white transition-all flex items-center justify-center gap-2">
                  Review selection
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </section>
            )}

          </div>
        </aside>

        {/* ── Main panel ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          <div className="px-6 py-3 border-b border-gray-100 bg-white flex items-center gap-3 flex-shrink-0">
            {loading && (
              <div className="w-3.5 h-3.5 border-2 border-black/20 border-t-black rounded-full animate-spin flex-shrink-0" />
            )}
            <p className="text-xs text-black/40 truncate">{statusMsg}</p>
            <div className="flex items-center gap-4 ml-auto flex-shrink-0">
              {selectedSignatures.length > 0 && (
                <div className="flex items-center gap-1.5 text-[11px] text-black/40">
                  <div className="w-4 h-0.5 bg-violet-400 rounded" />
                  {selectedSignatures.length} pattern{selectedSignatures.length !== 1 ? 's' : ''}
                </div>
              )}
              {clickedSegments.length > 0 && (
                <div className="flex items-center gap-1.5 text-[11px] text-black/40">
                  <div className="w-4 h-0.5 bg-red-400 rounded" />
                  {clickedSegments.length} picked
                </div>
              )}
              {wallSegments.length > 0 && (
                <div className="flex items-center gap-1.5 text-[11px] text-black/40">
                  <div className="w-4 h-0.5 bg-blue-500 rounded" />
                  {wallSegments.length} total
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 p-6">
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
          </div>
        </div>

      </div>
    </div>
  );
}
