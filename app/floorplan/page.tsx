'use client';

import { useState, useMemo } from 'react';
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
interface HatchSignature { angle: number; spacing: number; }

type Seg  = [[number, number], [number, number]];
type Mode = 'line' | 'color' | 'pattern';
type View = 'select' | 'review';

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
  const [mode,             setMode]             = useState<Mode>('line');
  const [selectedColors,   setSelectedColors]   = useState<string[]>([]);
  const [clickedSegments,  setClickedSegments]  = useState<Seg[]>([]);
  const [selectedSignature,setSelectedSignature]= useState<HatchSignature | null>(null); // pending detect
  const [angleTol,         setAngleTol]         = useState(8);
  const [spacingTol,       setSpacingTol]       = useState(0.5);

  // ── Three separate wall-segment buckets ───────────────────────────────────
  // Kept separate so patterns, color extraction, and line-clicks don't stomp on each other.
  const [selectedSignatures, setSelectedSignatures] = useState<HatchSignature[]>([]); // added patterns
  const [patternSegments,    setPatternSegments]    = useState<Seg[][]>([]);          // parallel: segs per pattern
  const [colorSegments,      setColorSegments]      = useState<Seg[]>([]);            // from color/line extraction

  // wallSegments is derived — pattern segs + color segs + individual clicked lines
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
  const [toolpath,      setToolpath]      = useState<Layer[] | null>(null);
  const [numLayers3d,   setNumLayers3d]   = useState(0);

  // ── File load ─────────────────────────────────────────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPdfFile(file);
    setPreview(null); setGroups([]); setLegendColors([]);
    setSelectedColors([]); setClickedSegments([]);
    setSelectedSignature(null);
    setSelectedSignatures([]); setPatternSegments([]); setColorSegments([]);
    setToolpath(null); setView('select');
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

  // ── Extract color/line walls (replaces colorSegments bucket) ──────────────
  async function handleExtract() {
    if (!pdfFile) return;
    setExtracting(true); setToolpath(null);
    try {
      const fd = new FormData();
      fd.append('file', pdfFile); fd.append('color_hex', '');
      fd.append('colors_json',   JSON.stringify(selectedColors));
      fd.append('segments_json', '[]'); // clicked lines live in their own bucket
      const data = await fetch(`${API}/floorplan/extract`, { method: 'POST', body: fd }).then(r => r.json());
      if (data.error) { setStatusMsg(`Extract error: ${data.error}`); return; }
      setColorSegments((data.segments ?? []) as Seg[]);
      setStatusMsg(`${data.count} color segments extracted`);
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message || 'Could not reach backend'}`);
    } finally { setExtracting(false); }
  }

  // ── Add a pattern (appends to patternSegments + selectedSignatures) ───────
  async function handleAddPattern() {
    if (!pdfFile || !selectedSignature) return;
    setPatternExtracting(true); setToolpath(null);
    try {
      const fd = new FormData();
      fd.append('file',        pdfFile);
      fd.append('angle',       String(selectedSignature.angle));
      fd.append('spacing',     String(selectedSignature.spacing));
      fd.append('angle_tol',   String(angleTol));
      fd.append('spacing_tol', String(spacingTol));
      const data = await fetch(`${API}/floorplan/extract_by_signature`, { method: 'POST', body: fd }).then(r => r.json());
      if (data.error) { setStatusMsg(`Pattern error: ${data.error}`); return; }
      const newSegs = (data.segments ?? []) as Seg[];
      setSelectedSignatures(prev => [...prev, selectedSignature]);
      setPatternSegments(prev => [...prev, newSegs]);
      setSelectedSignature(null); // clear pending after adding
      setStatusMsg(`Pattern added · ${data.matched_objects} objects · ${data.count} segments`);
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message || 'Could not reach backend'}`);
    } finally { setPatternExtracting(false); }
  }

  function removePattern(i: number) {
    setSelectedSignatures(prev => prev.filter((_, idx) => idx !== i));
    setPatternSegments(prev    => prev.filter((_, idx) => idx !== i));
    setToolpath(null);
  }

  function clearAllWalls() {
    setSelectedSignatures([]); setPatternSegments([]);
    setColorSegments([]); setClickedSegments([]);
    setToolpath(null);
  }

  // ── Generate 3D ───────────────────────────────────────────────────────────
  function handleGenerate() {
    if (!wallSegments.length) return;
    // Real-world scale: plan is drawn at 1:50.
    // pt → paper metres (pt / 72 * 0.0254) → real metres (* 50)
    const PT_TO_M = (0.0254 / 72) * 50; // ≈ 0.017638 m per pt at 1:50
    const base: Layer = wallSegments.map(s => ({
      x0: s[0][0] * PT_TO_M, y0: s[0][1] * PT_TO_M,
      x1: s[1][0] * PT_TO_M, y1: s[1][1] * PT_TO_M,
    }));
    const n = Math.max(1, Math.round((wallHeightMm / 1000) / (layerHeightMm / 1000)));
    setNumLayers3d(n);
    setToolpath(Array.from({ length: n }, () => base));
  }

  // ── Review SVG ────────────────────────────────────────────────────────────
  const reviewSvg = useMemo(() => {
    if (!wallSegments.length) return null;
    const SVG_W = 900; const PAD = 24;
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

  const hasColorLineSelection = selectedColors.length > 0;
  const computedLayers = Math.max(1, Math.round((wallHeightMm / 1000) / (layerHeightMm / 1000)));
  const modeHint = mode === 'line'
    ? 'Click any line on the plan to select it individually.'
    : mode === 'color'
    ? 'Click any element to select all objects of that color.'
    : 'Click any hatch area to detect its pattern signature.';
  const totalPatternSegs = patternSegments.reduce((a, s) => a + s.length, 0);

  // ══════════════════════════════════════════════════════════════════════════
  // REVIEW VIEW
  // ══════════════════════════════════════════════════════════════════════════
  if (view === 'review') {
    return (
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

        <main className="flex-1 flex flex-col items-center px-6 py-10">
          <div className="w-full max-w-4xl space-y-8">

            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-black tracking-tight">Review selected walls</h1>
                <p className="text-sm text-black/40 mt-1">
                  {wallSegments.length} segment{wallSegments.length !== 1 ? 's' : ''} selected
                  {selectedSignatures.length > 0 && ` · ${selectedSignatures.length} pattern${selectedSignatures.length !== 1 ? 's' : ''}`}
                  {colorSegments.length > 0 && ` · ${colorSegments.length} color seg`}
                  {clickedSegments.length > 0 && ` · ${clickedSegments.length} picked`}
                </p>
              </div>
              <button onClick={() => { setToolpath(null); setView('select'); }}
                className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl
                  text-sm font-medium text-black/60 hover:border-black hover:text-black transition-all">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to add more
              </button>
            </div>

            {/* 2D wall preview */}
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
                <div className="flex items-center justify-center py-20">
                  <p className="text-sm text-black/25">No wall segments to display</p>
                </div>
              )}
            </div>

            {/* Height controls + generate */}
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
              <SectionLabel>Print parameters</SectionLabel>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <NumInput label="Wall height (mm)" value={wallHeightMm}
                  onChange={setWallHeightMm} min={100} max={20000} step={50} />
                <NumInput label="Layer height (mm)" value={layerHeightMm}
                  onChange={setLayerHeightMm} min={1} max={500} step={5} />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-xs text-black/30">{computedLayers} layers</p>
                  <p className="text-[11px] text-black/25">Scale: 1:50 (real-world metres)</p>
                </div>
                <button onClick={handleGenerate}
                  className="px-6 py-2.5 bg-black text-white text-sm font-semibold rounded-xl
                    hover:bg-black/80 transition-all">
                  Generate 3D
                </button>
              </div>
            </div>

            {toolpath && (
              <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm"
                style={{ height: '600px' }}>
                <LayerVisualization
                  file={null as any}
                  toolpath={toolpath as any}
                  numLayers={numLayers3d}
                  layerHeight={layerHeightMm / 1000}
                  nozzleDiameter={0.025}
                />
              </div>
            )}

          </div>
        </main>
      </div>
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

            {/* Upload */}
            <section className="p-5">
              <SectionLabel>Floor Plan PDF</SectionLabel>
              <input type="file" accept=".pdf" onChange={handleFileChange}
                className="block w-full text-sm text-black/50
                  file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0
                  file:text-xs file:font-semibold file:bg-black file:text-white
                  hover:file:bg-black/80 file:cursor-pointer cursor-pointer transition-all" />
            </section>

            {/* Click mode */}
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

                {/* Added patterns list */}
                {selectedSignatures.length > 0 && (
                  <div className="space-y-1.5">
                    {selectedSignatures.map((sig, i) => (
                      <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                        <span className="text-[10px] font-mono text-black/50 flex-1 truncate">
                          {sig.angle.toFixed(1)}° · {sig.spacing.toFixed(1)}pt
                        </span>
                        <span className="text-[10px] text-black/25 flex-shrink-0">
                          {patternSegments[i]?.length ?? 0} seg
                        </span>
                        <button onClick={() => removePattern(i)}
                          className="text-[11px] text-red-400 hover:text-red-600 transition-colors flex-shrink-0 ml-1">
                          ×
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-0.5">
                      <p className="text-[11px] text-black/40">
                        {selectedSignatures.length} pattern{selectedSignatures.length !== 1 ? 's' : ''} · {totalPatternSegs} seg
                      </p>
                      <button onClick={() => { setSelectedSignatures([]); setPatternSegments([]); setToolpath(null); }}
                        className="text-[11px] text-black/30 hover:text-black transition-colors">
                        Clear all
                      </button>
                    </div>
                  </div>
                )}

                {/* Pending detected signature */}
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
                      : 'Click a hatch area on the plan or legend to detect its signature.'}
                  </p>
                )}

                {/* Tolerances */}
                <div className="space-y-3">
                  <NumInput label="Angle tolerance (°)" value={angleTol}
                    onChange={setAngleTol} min={1} max={45} step={1} />
                  <NumInput label="Spacing tolerance (pt)" value={spacingTol}
                    onChange={setSpacingTol} min={0.1} max={10} step={0.1} />
                </div>

                {/* Add button */}
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
                  <button onClick={handleExtract} disabled={!hasColorLineSelection || extracting}
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
