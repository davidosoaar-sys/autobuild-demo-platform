'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface PreviewData {
  image_base64:    string;
  page_width_pt:   number;
  page_height_pt:  number;
  zoom:            number;
  image_width_px:  number;
  image_height_px: number;
}

interface Group {
  fill_hex:  string;
  stroke_hex: string;
  width:     number;
  kind:      string;
  count:     number;
  total_len: number;
}

interface LegendColor {
  hex:          string;
  legend_count: number;
  plan_count:   number;
}

type Seg  = [[number, number], [number, number]];
type Mode = 'line' | 'color';

export default function FloorPlanPage() {
  const router = useRouter();

  const [pdfFile,        setPdfFile]        = useState<File | null>(null);
  const [preview,        setPreview]        = useState<PreviewData | null>(null);
  const [groups,         setGroups]         = useState<Group[]>([]);
  const [legendColors,   setLegendColors]   = useState<LegendColor[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);   // multi-color set
  const [clickedSegments, setClickedSegments] = useState<Seg[]>([]);    // line-mode picks
  const [wallSegments,   setWallSegments]   = useState<Seg[]>([]);
  const [mode,           setMode]           = useState<Mode>('line');
  const [loading,        setLoading]        = useState(false);
  const [extracting,     setExtracting]     = useState(false);
  const [statusMsg,      setStatusMsg]      = useState('No PDF uploaded');

  // ── File upload: preview + scan + legend in parallel ──────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPdfFile(file);
    setPreview(null);
    setGroups([]);
    setLegendColors([]);
    setSelectedColors([]);
    setClickedSegments([]);
    setWallSegments([]);

    if (!file) { setStatusMsg('No PDF uploaded'); return; }

    setLoading(true);
    setStatusMsg('Rendering preview…');

    try {
      const fd1 = new FormData(); fd1.append('file', file);
      const fd2 = new FormData(); fd2.append('file', file);
      const fd3 = new FormData(); fd3.append('file', file);

      const [previewRes, scanRes, legendRes] = await Promise.all([
        fetch(`${API}/floorplan/preview`,       { method: 'POST', body: fd1 }),
        fetch(`${API}/floorplan/scan`,          { method: 'POST', body: fd2 }),
        fetch(`${API}/floorplan/legend_colors`, { method: 'POST', body: fd3 }),
      ]);

      const previewData = await previewRes.json();
      const scanData    = await scanRes.json();
      const legendData  = await legendRes.json();

      if (previewData.error) { setStatusMsg(`Error: ${previewData.error}`); return; }

      setPreview(previewData as PreviewData);
      setGroups((scanData.groups ?? []) as Group[]);
      setLegendColors((legendData.legend_colors ?? []) as LegendColor[]);
      setStatusMsg(
        `${file.name} · ${previewData.image_width_px}×${previewData.image_height_px}px` +
        ` · ${scanData.total_drawings ?? 0} vector objects` +
        (legendData.legend_colors?.length ? ` · ${legendData.legend_colors.length} legend colors` : '')
      );
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message || 'Could not reach backend'}`);
    } finally {
      setLoading(false);
    }
  }

  // ── Image click — branches on mode ────────────────────────────────────────
  async function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!preview || !pdfFile) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pdfX = (e.clientX - rect.left) * (preview.page_width_pt  / rect.width);
    const pdfY = (e.clientY - rect.top)  * (preview.page_height_pt / rect.height);

    if (mode === 'line') {
      // Pick individual segment
      const fd = new FormData();
      fd.append('file', pdfFile);
      fd.append('px',  String(pdfX));
      fd.append('py',  String(pdfY));
      fd.append('tol', '8');
      try {
        const res  = await fetch(`${API}/floorplan/pick`, { method: 'POST', body: fd });
        const data = await res.json();
        if (data.hit && data.segment) {
          setClickedSegments(prev => [...prev, data.segment as Seg]);
        }
      } catch { /* silent */ }
    } else {
      // Color mode — get color of nearest object
      const fd = new FormData();
      fd.append('file', pdfFile);
      fd.append('px',  String(pdfX));
      fd.append('py',  String(pdfY));
      fd.append('tol', '12');
      try {
        const res  = await fetch(`${API}/floorplan/color_at`, { method: 'POST', body: fd });
        const data = await res.json();
        if (data.hit && data.hex) {
          toggleColor(data.hex);
        }
      } catch { /* silent */ }
    }
  }

  // ── Color set helpers ──────────────────────────────────────────────────────
  function toggleColor(hex: string) {
    setSelectedColors(prev =>
      prev.includes(hex) ? prev.filter(h => h !== hex) : [...prev, hex]
    );
  }

  // ── Extract ────────────────────────────────────────────────────────────────
  async function handleExtract() {
    if (!pdfFile) return;
    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append('file',          pdfFile);
      fd.append('color_hex',     '');
      fd.append('colors_json',   JSON.stringify(selectedColors));
      fd.append('segments_json', JSON.stringify(clickedSegments));
      const res  = await fetch(`${API}/floorplan/extract`, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.error) { setStatusMsg(`Extract error: ${data.error}`); return; }
      setWallSegments((data.segments ?? []) as Seg[]);
      setStatusMsg(`Extracted ${data.count} wall segments`);
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message || 'Could not reach backend'}`);
    } finally {
      setExtracting(false);
    }
  }

  function groupSwatchColor(g: Group) {
    return g.fill_hex !== '-' ? g.fill_hex : g.stroke_hex !== '-' ? g.stroke_hex : '#888';
  }
  function groupSelectColor(g: Group) {
    return g.fill_hex !== '-' ? g.fill_hex : g.stroke_hex !== '-' ? g.stroke_hex : '';
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Header */}
      <header className="border-b border-gray-100 bg-white sticky top-0 z-10 overflow-visible">
        <div className="max-w-[1400px] mx-auto px-6 py-1 flex items-center justify-between">
          <button onClick={() => router.push('/')} className="-my-4 sm:-my-6">
            <Image src="/Autobuildblack.png" alt="AutoBuild AI" width={400} height={400}
              className="h-24 sm:h-36 w-auto" />
          </button>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-black/40">Floor Plan</span>
            <button
              onClick={handleExtract}
              disabled={!pdfFile || extracting}
              className="px-5 py-2 bg-black text-white text-sm font-semibold rounded-xl
                hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              {extracting ? 'Extracting…' : 'Extract Walls'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center px-4 py-10">
        <div className="w-full max-w-4xl space-y-6">

          {/* Heading */}
          <div>
            <h1 className="text-2xl font-bold text-black tracking-tight">Floor Plan to Print Path</h1>
            <p className="text-sm text-black/40 mt-1.5">
              Upload a PDF floor plan to extract wall geometry and generate a concrete print path.
            </p>
          </div>

          {/* Upload */}
          <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
            <label className="block text-xs font-semibold text-black/50 uppercase tracking-wider mb-3">
              Upload Floor Plan PDF
            </label>
            <input
              type="file" accept=".pdf" onChange={handleFileChange}
              className="block w-full text-sm text-black/60
                file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0
                file:text-sm file:font-semibold file:bg-black file:text-white
                hover:file:bg-black/80 file:cursor-pointer cursor-pointer transition-all"
            />
            <p className="text-xs text-black/30 mt-2">{statusMsg}</p>
          </div>

          {/* Legend color buttons */}
          {legendColors.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
              <p className="text-xs font-semibold text-black/50 uppercase tracking-wider mb-3">
                Legend Colors ({legendColors.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {legendColors.map((lc) => {
                  const on = selectedColors.includes(lc.hex);
                  return (
                    <button key={lc.hex} onClick={() => toggleColor(lc.hex)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium
                        transition-all ${on
                          ? 'bg-black text-white border-black'
                          : 'bg-white text-black/60 border-gray-200 hover:border-black'}`}>
                      <span className="w-4 h-4 rounded border border-white/20 flex-shrink-0"
                        style={{ background: lc.hex }} />
                      <span className="font-mono">{lc.hex}</span>
                      <span className={on ? 'text-white/50' : 'text-black/30'}>
                        {lc.plan_count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Scan color list */}
          {groups.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
              <p className="text-xs font-semibold text-black/50 uppercase tracking-wider mb-3">
                All Vector Colors ({groups.length}) — click to toggle
              </p>
              <div className="max-h-48 overflow-y-auto divide-y divide-gray-50 -mx-2">
                {groups.map((g, i) => {
                  const sc = groupSelectColor(g);
                  const on = sc !== '' && selectedColors.includes(sc);
                  return (
                    <button key={i} onClick={() => sc && toggleColor(sc)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg transition-colors
                        ${on ? 'bg-black/5' : 'hover:bg-gray-50'}`}>
                      <div className="w-5 h-5 rounded border border-gray-200 flex-shrink-0"
                        style={{ background: groupSwatchColor(g) }} />
                      <span className="text-[11px] font-mono text-black/40 w-20 flex-shrink-0">{sc || '-'}</span>
                      <span className="text-xs text-black/60 flex-1 truncate">{g.kind}</span>
                      <span className="text-xs text-black/30 flex-shrink-0">{g.count} obj</span>
                      <span className="text-[11px] text-black/20 flex-shrink-0 ml-1">{g.total_len.toFixed(0)}pt</span>
                      {on && <span className="text-xs text-black flex-shrink-0 ml-1">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Mode toggle + counters + clear buttons */}
          {pdfFile && (
            <div className="flex flex-wrap items-center gap-4">

              {/* Mode toggle */}
              <div className="flex items-center bg-white border border-gray-200 rounded-xl overflow-hidden text-xs font-semibold">
                <button onClick={() => setMode('line')}
                  className={`px-3 py-1.5 transition-colors ${mode === 'line' ? 'bg-black text-white' : 'text-black/40 hover:text-black'}`}>
                  Line pick
                </button>
                <button onClick={() => setMode('color')}
                  className={`px-3 py-1.5 transition-colors ${mode === 'color' ? 'bg-black text-white' : 'text-black/40 hover:text-black'}`}>
                  Color pick
                </button>
              </div>

              {/* Selected colors swatches */}
              {selectedColors.length > 0 && (
                <div className="flex items-center gap-1.5">
                  {selectedColors.map(h => (
                    <button key={h} onClick={() => toggleColor(h)} title={`Remove ${h}`}
                      className="w-5 h-5 rounded border-2 border-white shadow hover:scale-110 transition-transform"
                      style={{ background: h }} />
                  ))}
                  <span className="text-xs text-black/30 ml-1">{selectedColors.length} color{selectedColors.length !== 1 ? 's' : ''}</span>
                </div>
              )}

              <span className="text-xs text-black/40">Lines: {clickedSegments.length}</span>
              <span className="text-xs text-black/40">Extracted: {wallSegments.length}</span>

              {selectedColors.length > 0 && (
                <button onClick={() => setSelectedColors([])}
                  className="text-xs text-orange-400 hover:text-orange-600 transition-colors">
                  Clear colors
                </button>
              )}
              {clickedSegments.length > 0 && (
                <button onClick={() => setClickedSegments([])}
                  className="text-xs text-red-400 hover:text-red-600 transition-colors">
                  Clear clicks
                </button>
              )}
              {wallSegments.length > 0 && (
                <button onClick={() => setWallSegments([])}
                  className="text-xs text-blue-400 hover:text-blue-600 transition-colors">
                  Clear walls
                </button>
              )}
            </div>
          )}

          {/* Preview box */}
          <div className="bg-white border-2 border-dashed border-gray-200 rounded-2xl overflow-hidden
            flex items-center justify-center" style={{ minHeight: '400px' }}>

            {loading && (
              <div className="flex flex-col items-center gap-3 py-16">
                <div className="w-6 h-6 border-2 border-black/20 border-t-black rounded-full animate-spin" />
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
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                    pointerEvents: 'none' }}
                  viewBox={`0 0 ${preview.page_width_pt} ${preview.page_height_pt}`}
                  preserveAspectRatio="none"
                >
                  {wallSegments.map((seg, i) => (
                    <line key={`w${i}`}
                      x1={seg[0][0]} y1={seg[0][1]} x2={seg[1][0]} y2={seg[1][1]}
                      stroke="#2563eb" strokeWidth={2} vectorEffect="non-scaling-stroke" />
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
              <p className="text-sm text-black/30 select-none">PDF preview will appear here</p>
            )}
          </div>

          {/* Legend */}
          {(clickedSegments.length > 0 || wallSegments.length > 0) && (
            <div className="flex flex-wrap items-center gap-6 text-xs text-black/50">
              {clickedSegments.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-0.5 bg-red-400" />
                  <span>Clicked lines ({clickedSegments.length})</span>
                </div>
              )}
              {wallSegments.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-0.5 bg-blue-600" />
                  <span>Extracted walls ({wallSegments.length})</span>
                </div>
              )}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
