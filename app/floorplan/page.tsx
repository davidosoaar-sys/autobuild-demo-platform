'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface PreviewData {
  image_base64:   string;
  page_width_pt:  number;
  page_height_pt: number;
  zoom:           number;
  image_width_px: number;
  image_height_px: number;
}

interface Group {
  fill_hex:   string;
  stroke_hex: string;
  width:      number;
  kind:       string;
  count:      number;
  total_len:  number;
}

type Seg = [[number, number], [number, number]];

export default function FloorPlanPage() {
  const router = useRouter();

  const [pdfFile,          setPdfFile]          = useState<File | null>(null);
  const [preview,          setPreview]          = useState<PreviewData | null>(null);
  const [groups,           setGroups]           = useState<Group[]>([]);
  const [selectedColorHex, setSelectedColorHex] = useState('');
  const [clickedSegments,  setClickedSegments]  = useState<Seg[]>([]);
  const [wallSegments,     setWallSegments]     = useState<Seg[]>([]);
  const [loading,          setLoading]          = useState(false);
  const [extracting,       setExtracting]       = useState(false);
  const [statusMsg,        setStatusMsg]        = useState('No PDF uploaded');

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPdfFile(file);
    setPreview(null);
    setGroups([]);
    setSelectedColorHex('');
    setClickedSegments([]);
    setWallSegments([]);

    if (!file) { setStatusMsg('No PDF uploaded'); return; }

    setLoading(true);
    setStatusMsg('Rendering preview…');

    try {
      const fd1 = new FormData(); fd1.append('file', file);
      const fd2 = new FormData(); fd2.append('file', file);
      const [previewRes, scanRes] = await Promise.all([
        fetch(`${API}/floorplan/preview`, { method: 'POST', body: fd1 }),
        fetch(`${API}/floorplan/scan`,    { method: 'POST', body: fd2 }),
      ]);
      const previewData = await previewRes.json();
      const scanData    = await scanRes.json();

      if (previewData.error) { setStatusMsg(`Error: ${previewData.error}`); return; }

      setPreview(previewData as PreviewData);
      setGroups((scanData.groups ?? []) as Group[]);
      setStatusMsg(
        `${file.name} · ${previewData.image_width_px}×${previewData.image_height_px}px` +
        ` · ${scanData.total_drawings ?? 0} vector objects`
      );
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message || 'Could not reach backend'}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!preview || !pdfFile) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pdfX = (e.clientX - rect.left)  * (preview.page_width_pt  / rect.width);
    const pdfY = (e.clientY - rect.top)   * (preview.page_height_pt / rect.height);

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
    } catch { /* silent — click miss is not an error */ }
  }

  async function handleExtract() {
    if (!pdfFile) return;
    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append('file',          pdfFile);
      fd.append('color_hex',     selectedColorHex);
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

  function swatchColor(g: Group): string {
    return g.fill_hex !== '-' ? g.fill_hex : g.stroke_hex !== '-' ? g.stroke_hex : '#888888';
  }
  function selectColor(g: Group): string {
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

      {/* Main */}
      <main className="flex-1 flex flex-col items-center px-4 py-10">
        <div className="w-full max-w-4xl space-y-6">

          {/* Heading */}
          <div>
            <h1 className="text-2xl font-bold text-black tracking-tight">
              Floor Plan to Print Path
            </h1>
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

          {/* Color groups */}
          {groups.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-black/50 uppercase tracking-wider">
                  Detected Vector Colors ({groups.length})
                </p>
                {selectedColorHex && (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded border border-gray-200 flex-shrink-0"
                      style={{ background: selectedColorHex }} />
                    <span className="text-xs font-mono text-black/60">{selectedColorHex}</span>
                    <button onClick={() => setSelectedColorHex('')}
                      className="text-xs text-black/30 hover:text-black ml-1 leading-none">×</button>
                  </div>
                )}
              </div>
              <div className="max-h-52 overflow-y-auto divide-y divide-gray-50 -mx-2">
                {groups.map((g, i) => {
                  const sc = selectColor(g);
                  const isSelected = sc !== '' && selectedColorHex === sc;
                  return (
                    <button key={i} onClick={() => sc && setSelectedColorHex(sc)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg transition-colors
                        ${isSelected ? 'bg-black/5' : 'hover:bg-gray-50'}`}>
                      <div className="w-5 h-5 rounded border border-gray-200 flex-shrink-0"
                        style={{ background: swatchColor(g) }} />
                      <span className="text-[11px] font-mono text-black/40 w-20 flex-shrink-0">
                        {sc || '-'}
                      </span>
                      <span className="text-xs text-black/60 flex-1 truncate">{g.kind}</span>
                      <span className="text-xs text-black/30 flex-shrink-0">{g.count} obj</span>
                      <span className="text-[11px] text-black/20 flex-shrink-0 ml-1">
                        {g.total_len.toFixed(0)}pt
                      </span>
                      {isSelected && (
                        <span className="text-xs text-black flex-shrink-0 ml-1">✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Counters + clear buttons */}
          {pdfFile && (
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-xs text-black/40">
                Color filter:{' '}
                {selectedColorHex
                  ? <span className="font-mono">{selectedColorHex}</span>
                  : 'none'}
              </span>
              <span className="text-xs text-black/40">
                Clicked: {clickedSegments.length} seg
              </span>
              <span className="text-xs text-black/40">
                Extracted: {wallSegments.length} seg
              </span>
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
                  style={{ cursor: 'crosshair' }}
                  onClick={handleImageClick}
                />
                {/* SVG overlay — viewBox matches PDF point space so segments render directly */}
                <svg
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                    pointerEvents: 'none' }}
                  viewBox={`0 0 ${preview.page_width_pt} ${preview.page_height_pt}`}
                  preserveAspectRatio="none"
                >
                  {wallSegments.map((seg, i) => (
                    <line key={`w${i}`}
                      x1={seg[0][0]} y1={seg[0][1]} x2={seg[1][0]} y2={seg[1][1]}
                      stroke="#2563eb" strokeWidth={2}
                      vectorEffect="non-scaling-stroke" />
                  ))}
                  {clickedSegments.map((seg, i) => (
                    <line key={`c${i}`}
                      x1={seg[0][0]} y1={seg[0][1]} x2={seg[1][0]} y2={seg[1][1]}
                      stroke="#ef4444" strokeWidth={3}
                      vectorEffect="non-scaling-stroke" />
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
            <div className="flex items-center gap-6 text-xs text-black/50">
              {clickedSegments.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-0.5 bg-red-400" />
                  <span>Clicked ({clickedSegments.length})</span>
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
