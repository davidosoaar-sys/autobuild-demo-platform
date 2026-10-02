'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import type { BuildingFloor, Opening } from './WallViewer';
import BetaGuard from '@/components/BetaGuard';

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
interface SheetAnalysis { kind: 'floor_plan' | 'site_plan' | 'section_or_elevation' | 'unknown'; confidence: number; message: string; extractable: boolean; }
interface OpeningCandidate {
  id: string; type: 'door' | 'window' | 'opening'; confidence: number;
  gapStart: [number, number]; gapEnd: [number, number]; widthMm: number;
  sillMm: number; headMm: number;
}

type Seg       = [[number, number], [number, number]];
type Mode      = 'line' | 'color' | 'pattern';
type View      = 'select' | 'review';
type MatchMode = 'both' | 'angle';

type FloorDraft = Omit<BuildingFloor, 'id' | 'segments'>;
interface TimeBlock { id: string; start: string; end: string; }
const toDecimalHour = (t: string) => { const [h, m] = t.split(':').map(Number); return h + m / 60; };

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
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
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input type="number" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Math.max(min ?? 0, Number(e.target.value)))}
          className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm
            outline-none focus:border-black transition-colors" />
        {unit && <span className="text-xs text-gray-500 flex-shrink-0">{unit}</span>}
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
  const [sheet,        setSheet]        = useState<SheetAnalysis | null>(null);
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

  // ── Outline extraction state ──────────────────────────────────────────────
  const [outlineSegments, setOutlineSegments] = useState<Seg[]>([]);
  const [minLenPt,        setMinLenPt]        = useState(20);
  const [hatchMinSegs,    setHatchMinSegs]    = useState(6);
  const [hatchAvgMaxPt,   setHatchAvgMaxPt]   = useState(25);
  const [outlining,       setOutlining]       = useState(false);

  const wallSegments = useMemo<Seg[]>(
    () => [...outlineSegments, ...patternSegments.flat(), ...colorSegments, ...clickedSegments],
    [outlineSegments, patternSegments, colorSegments, clickedSegments],
  );

  // ── Door/window openings ──────────────────────────────────────────────────
  // Detection finds candidate gaps in the current wall selection and guesses
  // a type; nothing affects slicing until the user confirms (or edits) one.
  const [openingCandidates, setOpeningCandidates] = useState<OpeningCandidate[]>([]);
  const [confirmedOpenings, setConfirmedOpenings] = useState<Opening[]>([]);
  const [detectingOpenings, setDetectingOpenings] = useState(false);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [editingOpeningId,  setEditingOpeningId]  = useState<string | null>(null);

  function updateConfirmedOpening(id: string, patch: Partial<Opening>) {
    setConfirmedOpenings(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o));
  }
  const [openingsTruncated,  setOpeningsTruncated]  = useState(false);

  // Global defaults — the height above the floor a new door/window opens at.
  // Applied to freshly detected candidates and to manually placed ones; use
  // "Apply to all windows" to retro-fit these onto ones already on the plan.
  const [windowSillMm, setWindowSillMm] = useState(900);
  const [windowHeadMm, setWindowHeadMm] = useState(2100);
  const [doorHeadMm,   setDoorHeadMm]   = useState(2100);

  function defaultsFor(type: Opening['type']) {
    if (type === 'door')   return { sillMm: 0,           headMm: doorHeadMm };
    if (type === 'window') return { sillMm: windowSillMm, headMm: windowHeadMm };
    return { sillMm: windowSillMm, headMm: windowHeadMm };
  }

  // Resizes an opening to an exact width in mm, keeping its centre point and
  // direction fixed — lets a window/door be dialled in precisely instead of
  // only ever matching whatever distance was clicked or auto-detected.
  function withWidthMm<T extends { gapStart: [number, number]; gapEnd: [number, number]; widthMm: number }>(op: T, widthMm: number): T {
    const [x0, y0] = op.gapStart, [x1, y1] = op.gapEnd;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const curLenPt = Math.hypot(x1 - x0, y1 - y0) || 1;
    const ux = (x1 - x0) / curLenPt, uy = (y1 - y0) / curLenPt;
    const halfLenPt = (Math.max(50, widthMm) / 1000 / PT_TO_M) / 2;
    return { ...op, widthMm: Math.max(50, widthMm), gapStart: [cx - ux * halfLenPt, cy - uy * halfLenPt], gapEnd: [cx + ux * halfLenPt, cy + uy * halfLenPt] };
  }

  // Manual placement — click a start point then an end point on the plan to
  // define a new opening directly, without depending on auto-detection.
  const [manualOpeningMode,  setManualOpeningMode]  = useState(false);
  const [manualOpeningType,  setManualOpeningType]  = useState<Opening['type']>('window');
  const [manualOpeningStart, setManualOpeningStart] = useState<[number, number] | null>(null);

  function placeManualOpening(px: number, py: number) {
    if (!manualOpeningStart) { setManualOpeningStart([px, py]); return; }
    const defaults = defaultsFor(manualOpeningType);
    const widthMm = Math.hypot(px - manualOpeningStart[0], py - manualOpeningStart[1]) * PT_TO_M * 1000;
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    const opening: Opening = {
      id, type: manualOpeningType,
      gapStart: manualOpeningStart, gapEnd: [px, py],
      widthMm, sillMm: defaults.sillMm, headMm: defaults.headMm,
    };
    setConfirmedOpenings(prev => [...prev, opening]);
    setManualOpeningStart(null);
    setStatusMsg(`${manualOpeningType} added at ${defaults.sillMm}–${defaults.headMm}mm above floor.`);
  }

  async function handleDetectOpenings() {
    if (!pdfFile || !wallSegments.length) return;
    setDetectingOpenings(true);
    setActiveCandidateId(null);
    try {
      const fd = new FormData();
      fd.append('file', pdfFile);
      fd.append('segments_json', JSON.stringify(wallSegments));
      const res = await fetch(`${API}/floorplan/detect_openings`, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.error) { setStatusMsg(`Error: ${data.error}`); return; }
      const already = new Set(confirmedOpenings.map(o => `${o.gapStart.join(',')}|${o.gapEnd.join(',')}`));
      const cands: OpeningCandidate[] = (data.candidates ?? []).map((c: any) => ({
        id: c.id, type: c.type, confidence: c.confidence,
        gapStart: c.gap_start, gapEnd: c.gap_end, widthMm: c.width_mm,
        ...defaultsFor(c.type),
      }));
      setOpeningCandidates(cands.filter(c => !already.has(`${c.gapStart.join(',')}|${c.gapEnd.join(',')}`)));
      setOpeningsTruncated(!!data.truncated);
      setStatusMsg(`Found ${cands.length} possible opening${cands.length === 1 ? '' : 's'} — review each below.`);
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message || 'Could not reach backend'}`);
    } finally { setDetectingOpenings(false); }
  }

  function confirmCandidate(id: string, overrides?: Partial<Pick<Opening, 'type' | 'sillMm' | 'headMm'>>) {
    const c = openingCandidates.find(x => x.id === id);
    if (!c) return;
    const confirmed: Opening = {
      id: c.id, type: overrides?.type ?? c.type,
      gapStart: c.gapStart, gapEnd: c.gapEnd, widthMm: c.widthMm,
      sillMm: overrides?.sillMm ?? c.sillMm, headMm: overrides?.headMm ?? c.headMm,
    };
    setConfirmedOpenings(prev => [...prev, confirmed]);
    setOpeningCandidates(prev => prev.filter(x => x.id !== id));
    setActiveCandidateId(null);
  }

  function discardCandidate(id: string) {
    setOpeningCandidates(prev => prev.filter(x => x.id !== id));
    setActiveCandidateId(null);
  }

  function removeConfirmedOpening(id: string) {
    setConfirmedOpenings(prev => prev.filter(o => o.id !== id));
  }

  function applyWindowDefaultsToAll() {
    setConfirmedOpenings(prev => prev.map(o => o.type === 'window' ? { ...o, sillMm: windowSillMm, headMm: windowHeadMm } : o));
    setOpeningCandidates(prev => prev.map(c => c.type === 'window' ? { ...c, sillMm: windowSillMm, headMm: windowHeadMm } : c));
  }

  // ── Extracting flags ──────────────────────────────────────────────────────
  const [extracting,        setExtracting]        = useState(false);
  const [patternExtracting, setPatternExtracting] = useState(false);

  // ── 3D / review state ─────────────────────────────────────────────────────
  const [wallHeightMm,  setWallHeightMm]  = useState(2500);
  const [layerHeightMm, setLayerHeightMm] = useState(50);

  // A building is assembled one floor plan at a time. Each floor keeps the
  // selected plan geometry in its original coordinate system plus an explicit
  // XY offset and Z elevation for alignment in the shared 3D viewer.
  const [buildingFloors, setBuildingFloors] = useState<BuildingFloor[]>([]);
  const [floorDraft, setFloorDraft] = useState<FloorDraft>({
    name: 'Ground floor', wallHeightMm: 2500, elevationMm: 0,
    offsetXmm: 0, offsetYmm: 0,
  });

  // ── Slicer state ──────────────────────────────────────────────────────────
  const [nozzle,       setNozzle]       = useState(25);
  const [compression,  setCompression]  = useState(0.6);
  const [velocity,     setVelocity]     = useState(100);
  const [hoseLength,   setHoseLength]   = useState(15);
  const [flowRate,     setFlowRate]     = useState(8);
  const [acceleration, setAcceleration] = useState(500);
  const [cityInput,    setCityInput]    = useState('');
  const [temperature,  setTemperature]  = useState(20);
  const [humidity,     setHumidity]     = useState(65);
  const [windSpeed,    setWindSpeed]    = useState(8);
  const [printStartHour, setPrintStartHour] = useState('08:00');
  const [timeBlocks,   setTimeBlocks]   = useState<TimeBlock[]>([{ id: 'b0', start: '07:00', end: '17:00' }]);
  const [sliceResult,  setSliceResult]  = useState<any>(null);
  const [slicing,      setSlicing]      = useState(false);
  const [showResults,  setShowResults]  = useState(false);
  const [showSidebar,  setShowSidebar]  = useState(true);

  const layerHeightFromCompression = Math.round(nozzle * compression) / 10;

  const previewFloors = useMemo<BuildingFloor[]>(() => {
    const draft: BuildingFloor | null = wallSegments.length
      ? { id: 'current-selection', segments: wallSegments, ...floorDraft, openings: confirmedOpenings }
      : null;
    return draft ? [...buildingFloors, draft] : buildingFloors;
  }, [buildingFloors, floorDraft, wallSegments, confirmedOpenings]);

  const totalBuildingSegments = useMemo(
    () => previewFloors.reduce((total, floor) => total + floor.segments.length, 0),
    [previewFloors],
  );

  // ── File load ─────────────────────────────────────────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPdfFile(file);
    setPreview(null); setGroups([]); setLegendColors([]); setSheet(null);
    setSelectedColors([]); setClickedSegments([]);
    setSelectedSignature(null);
    setSelectedSignatures([]); setPatternSegments([]); setColorSegments([]);
    setOutlineSegments([]);
    setOpeningCandidates([]); setConfirmedOpenings([]); setActiveCandidateId(null); setEditingOpeningId(null);
    setManualOpeningMode(false); setManualOpeningStart(null);
    setCutGapMode(false); setCutGapStart(null);
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
      setSheet((sd.sheet ?? null) as SheetAnalysis | null);
      setStatusMsg(sd.sheet?.kind === 'site_plan'
        ? `${file.name} · site plan - wall extraction disabled`
        : `${file.name} · ${sd.total_drawings ?? 0} objects` +
          (ld.legend_colors?.length ? ` · ${ld.legend_colors.length} legend colors` : '')
      );
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message || 'Could not reach backend'}`);
    } finally { setLoading(false); }
  }

  function addCurrentFloorToBuilding() {
    if (!wallSegments.length) return;
    const nextFloor: BuildingFloor = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      ...floorDraft,
      segments: wallSegments,
      openings: confirmedOpenings,
    };
    setBuildingFloors(prev => [...prev, nextFloor]);
    setStatusMsg(`${floorDraft.name} added to the building stack (${confirmedOpenings.length} opening${confirmedOpenings.length === 1 ? '' : 's'}). Upload the next floor plan to continue.`);
    setFloorDraft(prev => ({
      ...prev,
      name: `Floor ${buildingFloors.length + 1}`,
      elevationMm: prev.elevationMm + prev.wallHeightMm,
    }));
    clearAllWalls();
    setOpeningCandidates([]); setConfirmedOpenings([]); setActiveCandidateId(null); setEditingOpeningId(null);
    setManualOpeningMode(false); setManualOpeningStart(null);
    setCutGapMode(false); setCutGapStart(null);
    setPdfFile(null); setPreview(null); setGroups([]); setLegendColors([]);
  }

  function removeBuildingFloor(id: string) {
    setBuildingFloors(prev => prev.filter(floor => floor.id !== id));
  }

  // ── Image click ───────────────────────────────────────────────────────────
  async function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!preview || !pdfFile) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pdfX = (e.clientX - rect.left) * (preview.page_width_pt  / rect.width);
    const pdfY = (e.clientY - rect.top)  * (preview.page_height_pt / rect.height);

    if (cutGapMode) {
      if (!cutGapStart) { setCutGapStart([pdfX, pdfY]); return; }
      cutGapInWall(cutGapStart, [pdfX, pdfY]);
      setCutGapStart(null);
      return;
    }

    if (manualOpeningMode) { placeManualOpening(pdfX, pdfY); return; }

    // Clicking directly on an already-selected wall line always deselects it,
    // no matter which mode is active — no need to switch to Line mode first.
    const hitSelected = findWallSegmentNear(pdfX, pdfY, 8);
    if (hitSelected) {
      removeSelectedSegment(hitSelected);
      setStatusMsg('Line removed from selection.');
      return;
    }

    if (mode === 'line') {
      const fd = new FormData();
      fd.append('file', pdfFile); fd.append('px', String(pdfX));
      fd.append('py', String(pdfY)); fd.append('tol', '8');
      try {
        const data = await fetch(`${API}/floorplan/pick`, { method: 'POST', body: fd }).then(r => r.json());
        if (data.hit && data.segment) {
          const seg = data.segment as Seg;
          setClickedSegments(prev => [...prev, seg]);
          setStatusMsg('Line added to selection.');
        }
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

  function distToSegment(px: number, py: number, s: Seg): number {
    const [x0, y0] = s[0], [x1, y1] = s[1];
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return Math.hypot(px - x0, py - y0);
    const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
    return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
  }

  function findWallSegmentNear(px: number, py: number, tolPt: number): Seg | null {
    let best: Seg | null = null, bestD = tolPt;
    for (const s of wallSegments) {
      const d = distToSegment(px, py, s);
      if (d <= bestD) { bestD = d; best = s; }
    }
    return best;
  }

  // Lets a single click undo a previous selection — needed because bulk
  // tools (color, pattern, outline auto-detect) always include a few wrong
  // segments on complex plans, and re-doing the whole selection to fix one
  // line isn't practical.
  function segsMatch(a: Seg, b: Seg, eps = 0.5): boolean {
    const close = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]) < eps;
    return (close(a[0], b[0]) && close(a[1], b[1])) || (close(a[0], b[1]) && close(a[1], b[0]));
  }

  function removeSelectedSegment(seg: Seg): boolean {
    const idxClicked = clickedSegments.findIndex(s => segsMatch(s, seg));
    if (idxClicked !== -1) {
      setClickedSegments(prev => prev.filter((_, i) => i !== idxClicked));
      return true;
    }
    const idxColor = colorSegments.findIndex(s => segsMatch(s, seg));
    if (idxColor !== -1) {
      setColorSegments(prev => prev.filter((_, i) => i !== idxColor));
      return true;
    }
    const idxOutline = outlineSegments.findIndex(s => segsMatch(s, seg));
    if (idxOutline !== -1) {
      setOutlineSegments(prev => prev.filter((_, i) => i !== idxOutline));
      return true;
    }
    for (let i = 0; i < patternSegments.length; i++) {
      const idx = patternSegments[i].findIndex(s => segsMatch(s, seg));
      if (idx !== -1) {
        setPatternSegments(prev => prev.map((arr, ai) => ai === i ? arr.filter((_, j) => j !== idx) : arr));
        return true;
      }
    }
    return false;
  }

  // ── Cut a gap out of a selected wall line ─────────────────────────────────
  // Some plans draw a wall as one continuous stroke across what is actually
  // an opening (the window/door symbol just sits on top, no real break in
  // the line) — click-to-remove can only drop the whole line in that case.
  // This instead splits the line at two clicked points, keeping the two
  // remaining stubs and discarding the span between them.
  const [cutGapMode,  setCutGapMode]  = useState(false);
  const [cutGapStart, setCutGapStart] = useState<[number, number] | null>(null);

  function findSegmentSpanning(pA: [number, number], pB: [number, number], tolPt = 10) {
    type Bucket = 'clicked' | 'color' | 'outline' | 'pattern';
    const candidates: { bucket: Bucket; patternIdx?: number; segIdx: number; seg: Seg }[] = [
      ...clickedSegments.map((seg, segIdx) => ({ bucket: 'clicked' as const, segIdx, seg })),
      ...colorSegments.map((seg, segIdx) => ({ bucket: 'color' as const, segIdx, seg })),
      ...outlineSegments.map((seg, segIdx) => ({ bucket: 'outline' as const, segIdx, seg })),
      ...patternSegments.flatMap((arr, patternIdx) => arr.map((seg, segIdx) => ({ bucket: 'pattern' as const, patternIdx, segIdx, seg }))),
    ];
    let best: typeof candidates[0] | null = null;
    let bestScore = Infinity;
    for (const c of candidates) {
      const [x0, y0] = c.seg[0], [x1, y1] = c.seg[1];
      const dx = x1 - x0, dy = y1 - y0;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-6) continue;
      const proj = (p: [number, number]) => {
        const t = ((p[0] - x0) * dx + (p[1] - y0) * dy) / len2;
        const px = x0 + t * dx, py = y0 + t * dy;
        return { t, perpDist: Math.hypot(p[0] - px, p[1] - py) };
      };
      const a = proj(pA), b = proj(pB);
      if (a.perpDist > tolPt || b.perpDist > tolPt) continue;
      if (a.t < -0.05 || a.t > 1.05 || b.t < -0.05 || b.t > 1.05) continue;
      const score = a.perpDist + b.perpDist;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  function cutGapInWall(pA: [number, number], pB: [number, number]) {
    const found = findSegmentSpanning(pA, pB);
    if (!found) { setStatusMsg('Both clicks need to land on the same selected wall line to cut a gap.'); return; }
    const [x0, y0] = found.seg[0], [x1, y1] = found.seg[1];
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    const tOf = (p: [number, number]) => ((p[0] - x0) * dx + (p[1] - y0) * dy) / len2;
    let tA = Math.max(0, Math.min(1, tOf(pA)));
    let tB = Math.max(0, Math.min(1, tOf(pB)));
    if (tA > tB) [tA, tB] = [tB, tA];
    const pt = (t: number): [number, number] => [x0 + t * dx, y0 + t * dy];
    const MIN_T = 0.01;
    const replacement: Seg[] = [];
    if (tA > MIN_T)     replacement.push([[x0, y0], pt(tA)]);
    if (tB < 1 - MIN_T) replacement.push([pt(tB), [x1, y1]]);

    const applyReplace = (arr: Seg[]) => {
      const out = [...arr];
      out.splice(found.segIdx, 1, ...replacement);
      return out;
    };
    if (found.bucket === 'clicked') setClickedSegments(applyReplace);
    else if (found.bucket === 'color') setColorSegments(applyReplace);
    else if (found.bucket === 'outline') setOutlineSegments(applyReplace);
    else if (found.bucket === 'pattern' && found.patternIdx !== undefined) {
      setPatternSegments(prev => prev.map((arr, i) => i === found.patternIdx ? applyReplace(arr) : arr));
    }
    setStatusMsg('Gap cut into the wall.');
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

  async function handleExtractOutlines() {
    if (!pdfFile) return;
    setOutlining(true);
    try {
      const fd = new FormData();
      fd.append('file',             pdfFile);
      fd.append('min_len_pt',       String(minLenPt));
      fd.append('hatch_min_segs',   String(hatchMinSegs));
      fd.append('hatch_avg_max_pt', String(hatchAvgMaxPt));
      const data = await fetch(`${API}/floorplan/outlines`, { method: 'POST', body: fd }).then(r => r.json());
      if (data.error) { setStatusMsg(`Outline error: ${data.error}`); return; }
      setOutlineSegments((data.segments ?? []) as Seg[]);
      setStatusMsg(`${data.count} outline segments extracted`);
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message || 'Could not reach backend'}`);
    } finally { setOutlining(false); }
  }

  async function handleSlice() {
    if (!previewFloors.length) return;
    setSlicing(true); setSliceResult(null); setShowResults(false);
    try {
      const fd = new FormData();
      fd.append('segments_json',      JSON.stringify(wallSegments));
      fd.append('floors_json', JSON.stringify(previewFloors.map(floor => ({
        name: floor.name,
        segments: floor.segments,
        wall_height_mm: floor.wallHeightMm,
        elevation_mm: floor.elevationMm,
        offset_x_mm: floor.offsetXmm,
        offset_y_mm: floor.offsetYmm,
        openings: (floor.openings ?? []).map(op => ({
          gap_start: op.gapStart, gap_end: op.gapEnd,
          sill_mm: op.sillMm, head_mm: op.headMm,
        })),
      }))));
      fd.append('page_width_pt',      String(preview?.page_width_pt ?? 0));
      fd.append('page_height_pt',     String(preview?.page_height_pt ?? 0));
      fd.append('wall_height_mm',     String(wallHeightMm));
      fd.append('layer_height_mm',    String(layerHeightMm));
      fd.append('nozzle_diameter_mm', String(nozzle));
      fd.append('bead_compression',   String(compression));
      fd.append('max_speed_mm_s',     String(velocity));
      fd.append('base_speed_mm_s',    String(Math.round(velocity * 0.6)));
      fd.append('hose_length_m',      String(hoseLength));
      fd.append('max_mass_flow_l_min',String(flowRate));
      fd.append('acceleration_mm_s2', String(acceleration));
      if (cityInput.trim()) fd.append('city', cityInput.trim());
      fd.append('temperature',        String(temperature));
      fd.append('humidity',           String(humidity));
      fd.append('wind_speed',         String(windSpeed));
      fd.append('print_start_hour',   String(toDecimalHour(printStartHour)));
      fd.append('time_blocks',        JSON.stringify(timeBlocks.map(b => ({ start: b.start, end: b.end }))));
      const data = await fetch(`${API}/floorplan/slice`, { method: 'POST', body: fd }).then(r => r.json());
      if (data.detail || data.error) { setStatusMsg(`Slice error: ${data.detail || data.error}`); return; }
      setSliceResult(data);
      setShowResults(true);
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
    setOutlineSegments([]);
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
  const modeHint = (mode === 'line'
    ? 'Click a line to select it.'
    : mode === 'color'
    ? 'Click any element to select all objects of that color.'
    : 'Click any hatch area to detect its pattern signature.'
  ) + ' Clicking an already-selected line always removes it, in any mode.';

  // ══════════════════════════════════════════════════════════════════════════
  // REVIEW VIEW
  // ══════════════════════════════════════════════════════════════════════════
  if (view === 'review') {
    const inputCls = 'w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:border-black transition-colors text-black';
    function RField({ label, children }: { label: string; children: React.ReactNode }) {
      return (
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-1.5">{label}</label>
          {children}
        </div>
      );
    }
    function RNum({ value, onChange, min, max, step }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
      return <input type="number" value={value} min={min} max={max} step={step ?? 1}
        onChange={e => onChange(Number(e.target.value))} className={inputCls} />;
    }
    function SRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
      return (
        <div className="flex items-center justify-between py-1.5 border-b border-white/6 last:border-0">
          <span className="text-[11px] text-white/40">{label}</span>
          <span className={`text-[11px] font-semibold ${accent ?? 'text-white/80'}`}>{value}</span>
        </div>
      );
    }

    return (
      <>
      {/* ── Fullscreen results overlay (same pattern as regular slicer) ── */}
      <AnimatePresence>
        {sliceResult && showResults && !slicing && (
          <motion.div className="fixed inset-0 overflow-hidden z-50"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <LayerVisualization
              file={null}
              toolpath={sliceResult.toolpath}
              numLayers={sliceResult.geometry.num_layers}
              layerHeight={sliceResult.geometry.layer_height}
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
            <div className={`absolute top-10 right-3 bottom-3 z-20 w-[300px] flex flex-col transition-all duration-300 ${showSidebar ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full pointer-events-none'}`}
              style={{ filter: 'drop-shadow(0 0 30px rgba(0,0,0,0.5))' }}>
              <div className="flex flex-col h-full rounded-2xl overflow-hidden border border-white/10"
                style={{ background: 'rgba(6,6,10,0.82)', backdropFilter: 'blur(24px)' }}>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div className="border-b border-white/8 pb-4">
                    <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1">Est. Print Time</p>
                    <p className="text-3xl font-bold text-white tracking-tight leading-none">{sliceResult.estimated_print_time}</p>
                  </div>
                  <div>
                    <SRow label="Layers"       value={String(sliceResult.geometry.num_layers)} />
                    <SRow label="Layer Height" value={`${sliceResult.printer.layer_height_mm} mm`} />
                    <SRow label="Nozzle"       value={`${sliceResult.printer.nozzle_mm} mm`} />
                    <SRow label="Avg Velocity" value={`${sliceResult.printer.effective_speed?.toFixed(0)} mm/s`} />
                    <SRow label="Pot Life"     value={`${sliceResult.material.pot_life_at_worst} min`} />
                    <SRow label="G-code Lines" value={(sliceResult.gcode_lines ?? 0).toLocaleString()} />
                    {sliceResult.optimization?.time_saved_pct != null && (
                      <SRow label="Travel Saved" value={`${sliceResult.optimization.time_saved_pct}%`} accent="text-emerald-400" />
                    )}
                  </div>
                  {sliceResult.weather && (
                    <div className="border-t border-white/6 pt-3">
                      <p className="text-[10px] text-white/25 uppercase tracking-widest mb-2">Conditions</p>
                      <SRow label="Temperature" value={`${sliceResult.weather.avg?.temperature}°C`} />
                      <SRow label="Humidity"    value={`${sliceResult.weather.avg?.humidity}%`} />
                      <SRow label="Wind"        value={`${sliceResult.weather.avg?.wind_speed} km/h`} />
                    </div>
                  )}
                  <div className="border-t border-white/6 pt-3">
                    <p className="text-[10px] text-white/25 uppercase tracking-widest mb-2">G-code Preview</p>
                    <pre className="text-[9px] text-white/35 font-mono leading-relaxed overflow-x-auto max-h-16 scrollbar-none">
                      {sliceResult.gcode_preview?.split('\n').slice(0, 10).join('\n')}
                    </pre>
                  </div>
                </div>
                <div className="px-4 pb-4 pt-3 border-t border-white/8 flex-shrink-0 space-y-2">
                  <a href={`${API}/gcode/${sliceResult.result_id}`}
                    download={`floorplan_${sliceResult.result_id}.gcode`}
                    className="block w-full py-2.5 text-xs font-semibold bg-white text-black rounded-xl hover:bg-white/90 transition-all text-center">
                    Download .gcode
                  </a>
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

      {/* ── Slicing loading overlay ── */}
      {slicing && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-5">
          <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
          <div className="text-center">
            <p className="text-white font-semibold text-base">Slicing floor plan…</p>
            <p className="text-white/50 text-sm mt-1">{totalBuildingSegments} segments · {previewFloors.length} floor{previewFloors.length === 1 ? '' : 's'}</p>
          </div>
        </div>
      )}

      {/* ── Setup page ── */}
      <div className="min-h-screen bg-gray-50">
        <header className="border-b border-gray-100 bg-white sticky top-0 z-20">
          <div className="max-w-[1400px] mx-auto px-6 py-1 flex items-center justify-between">
            <button onClick={() => router.push('/')} className="-my-4 sm:-my-6">
              <Image src="/Autobuildblack.png" alt="AutoBuild AI" width={400} height={400}
                className="h-24 sm:h-36 w-auto" />
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-500">Floor Plan</span>
              {sliceResult && !slicing && (
                <button onClick={() => setShowResults(true)}
                  className="px-5 py-2 border border-black text-black text-sm font-semibold rounded-xl hover:bg-black hover:text-white transition-all">
                  View Results
                </button>
              )}
              <button onClick={() => setView('select')}
                className="px-4 py-2 border border-gray-200 text-sm font-medium rounded-xl text-gray-500 hover:border-black hover:text-black transition-all">
                ← Wall Selection
              </button>
              <button onClick={handleSlice} disabled={slicing || !previewFloors.length}
                className="px-5 py-2 bg-black text-white text-sm font-semibold rounded-xl hover:bg-black/80 disabled:opacity-40 transition-all">
                {sliceResult ? 'Re-run Slicer' : 'Run Slicer'}
              </button>
            </div>
          </div>
        </header>

        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6 items-start">

          {/* ── Left panel ── */}
          <div className="space-y-4">

            {/* Wall summary */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Wall Selection</h2>
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Segments</span>
                  <span className="font-semibold text-black">{wallSegments.length}</span>
                </div>
                {selectedSignatures.length > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Patterns</span>
                    <span className="font-semibold text-black">{selectedSignatures.length}</span>
                  </div>
                )}
                {reviewSvg && (
                  <div className="mt-3 rounded-xl overflow-hidden border border-gray-100">
                    <svg width="100%" viewBox={`0 0 ${reviewSvg.SVG_W} ${reviewSvg.svgH}`} style={{ display: 'block' }}>
                      <rect width={reviewSvg.SVG_W} height={reviewSvg.svgH} fill="white" />
                      {wallSegments.map((seg, i) => (
                        <line key={i}
                          x1={reviewSvg.tx(seg[0][0])} y1={reviewSvg.ty(seg[0][1])}
                          x2={reviewSvg.tx(seg[1][0])} y2={reviewSvg.ty(seg[1][1])}
                          stroke="#111" strokeWidth={1.5} strokeLinecap="round" />
                      ))}
                    </svg>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">Building Stack</h2>
                <span className="text-xs font-semibold text-black">{previewFloors.length} floor{previewFloors.length === 1 ? '' : 's'}</span>
              </div>
              {previewFloors.map((floor, index) => (
                <div key={floor.id} className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5">
                  <div className="flex justify-between gap-3">
                    <span className="text-xs font-semibold text-black truncate">{index + 1}. {floor.name}</span>
                    <span className="text-xs text-gray-500 whitespace-nowrap">Z {floor.elevationMm} mm</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{floor.segments.length} segments · {floor.wallHeightMm} mm walls · XY {floor.offsetXmm}, {floor.offsetYmm} mm</p>
                </div>
              ))}
              <p className="text-xs text-gray-500 leading-relaxed">Floors share one XY space. Adjust an offset when two drawing origins do not line up.</p>
            </div>

            {/* Wall dimensions */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">Wall Dimensions</h2>
              <div className="grid grid-cols-2 gap-4">
                <RField label="Wall height (mm)">
                  <RNum value={wallHeightMm} onChange={setWallHeightMm} min={100} max={20000} step={50} />
                </RField>
                <RField label="Print layers">
                  <div className={`${inputCls} bg-gray-50 text-gray-500`}>{computedLayers} layers</div>
                </RField>
              </div>
              <p className="text-xs text-gray-500">Scale 1:50 · Layer height set by bead compression below</p>
            </div>

            {/* Printer */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">Printer</h2>
              <div className="grid grid-cols-2 gap-4">
                <RField label="Nozzle (mm)">
                  <RNum value={nozzle} onChange={setNozzle} min={10} max={80} />
                </RField>
                <RField label={`Compression → ${layerHeightFromCompression} mm`}>
                  <RNum value={compression} onChange={setCompression} min={0.4} max={0.9} step={0.05} />
                </RField>
                <RField label="Max velocity (mm/s)">
                  <RNum value={velocity} onChange={setVelocity} min={10} max={300} />
                </RField>
                <RField label="Hose length (m)">
                  <RNum value={hoseLength} onChange={setHoseLength} min={1} max={100} />
                </RField>
                <RField label="Max flow (L/min)">
                  <RNum value={flowRate} onChange={setFlowRate} min={1} max={30} step={0.5} />
                </RField>
                <RField label="Acceleration (mm/s²)">
                  <RNum value={acceleration} onChange={setAcceleration} min={50} max={2000} step={50} />
                </RField>
              </div>
            </div>

            {/* Weather */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">Weather</h2>
              <RField label="City (optional)">
                <input type="text" value={cityInput} onChange={e => setCityInput(e.target.value)}
                  placeholder="e.g. Berlin" className={inputCls} />
              </RField>
              <p className="text-xs text-gray-500">Leave blank to use a live forecast fallback to manual conditions below</p>
              <div className="grid grid-cols-3 gap-3">
                <RField label="Temp (°C)">
                  <RNum value={temperature} onChange={setTemperature} min={-10} max={45} />
                </RField>
                <RField label="Humidity (%)">
                  <RNum value={humidity} onChange={setHumidity} min={0} max={100} />
                </RField>
                <RField label="Wind (km/h)">
                  <RNum value={windSpeed} onChange={setWindSpeed} min={0} max={100} />
                </RField>
              </div>
              <p className="text-xs text-gray-500">Manual conditions, used if no city or the forecast is unavailable</p>
            </div>

            {/* Print schedule */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">Print Schedule</h2>
              <RField label="Start time">
                <input type="time" value={printStartHour} onChange={e => setPrintStartHour(e.target.value)}
                  className={inputCls} />
              </RField>
              <div className="space-y-2">
                {timeBlocks.map((block, idx) => (
                  <div key={block.id} className="border border-gray-100 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Block {idx + 1}</span>
                      {timeBlocks.length > 1 && (
                        <button onClick={() => setTimeBlocks(prev => prev.filter(b => b.id !== block.id))}
                          className="text-gray-500 hover:text-black text-lg leading-none">&times;</button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <RField label="Start">
                        <input type="time" value={block.start}
                          onChange={e => setTimeBlocks(prev => prev.map(b => b.id === block.id ? { ...b, start: e.target.value } : b))}
                          className={inputCls} />
                      </RField>
                      <RField label="End">
                        <input type="time" value={block.end}
                          onChange={e => setTimeBlocks(prev => prev.map(b => b.id === block.id ? { ...b, end: e.target.value } : b))}
                          className={inputCls} />
                      </RField>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setTimeBlocks(prev => [...prev, { id: Math.random().toString(36).slice(2), start: '07:00', end: '17:00' }])}
                className="w-full py-2 text-xs font-medium border border-dashed border-gray-200 rounded-xl text-gray-500 hover:text-black hover:border-black transition-colors">
                + Add Time Block
              </button>
              <p className="text-xs text-gray-500">Work-day windows the print pauses and resumes around</p>
            </div>

          </div>

          {/* ── Right panel — 3D wall preview ── */}
          <div className="rounded-2xl overflow-hidden border border-gray-100 bg-black shadow-sm"
            style={{ minHeight: '560px', height: 'calc(100vh - 160px)', position: 'sticky', top: '120px' }}>
            {previewFloors.length > 0
              ? <WallViewer floors={previewFloors} nozzleMm={nozzle} />
              : (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <svg className="w-10 h-10 text-white/10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <p className="text-white/20 text-sm">Add a floor plan to start the building stack</p>
                </div>
              )
            }
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
      <BetaGuard />

      <header className="border-b border-gray-100 bg-white sticky top-0 z-20 flex-shrink-0">
        <div className="px-6 py-1 flex items-center justify-between">
          <button onClick={() => router.push('/')} className="-my-4 sm:-my-6">
            <Image src="/Autobuildblack.png" alt="AutoBuild AI" width={400} height={400}
              className="h-24 sm:h-36 w-auto" />
          </button>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-500">Floor Plan</span>
            {previewFloors.length > 0 && (
              <button onClick={() => setView('review')}
                className="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm
                  font-semibold rounded-xl hover:bg-black/80 transition-all">
                Review building
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
                className="block w-full text-sm text-gray-500
                  file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0
                  file:text-xs file:font-semibold file:bg-black file:text-white
                  hover:file:bg-black/80 file:cursor-pointer cursor-pointer transition-all" />
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">Upload one architectural floor plan at a time. Site layouts are not supported in this flow.</p>
            </section>

            {sheet && (
              <section className={`p-5 ${sheet.extractable ? 'bg-emerald-50/60' : 'bg-amber-50'}`}>
                <SectionLabel>Drawing Check</SectionLabel>
                <p className={`text-xs font-semibold capitalize ${sheet.extractable ? 'text-emerald-800' : 'text-amber-800'}`}>
                  {sheet.kind.replaceAll('_', ' ')}
                </p>
                <p className="text-xs text-gray-500 leading-relaxed mt-1">{sheet.message}</p>
              </section>
            )}

            {wallSegments.length > 0 && (
              <section className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <SectionLabel>Doors &amp; Windows</SectionLabel>
                  {(confirmedOpenings.length > 0) && (
                    <span className="text-xs font-semibold text-gray-500 -mt-3">{confirmedOpenings.length} confirmed</span>
                  )}
                </div>

                <div className="bg-gray-50 rounded-xl p-3 space-y-2.5">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Window height above floor</p>
                  <div className="grid grid-cols-3 gap-2">
                    <NumInput label="Height" value={windowHeadMm - windowSillMm}
                      onChange={v => setWindowHeadMm(windowSillMm + Math.max(50, v))}
                      min={50} max={5000} step={10} unit="mm" />
                    <NumInput label="Sill" value={windowSillMm}
                      onChange={v => { const h = windowHeadMm - windowSillMm; setWindowSillMm(v); setWindowHeadMm(v + h); }}
                      min={0} max={5000} step={10} unit="mm" />
                    <NumInput label="Head" value={windowHeadMm}
                      onChange={v => setWindowHeadMm(Math.max(windowSillMm + 50, v))}
                      min={50} max={5000} step={10} unit="mm" />
                  </div>
                  <NumInput label="Door height (starts at floor)" value={doorHeadMm} onChange={setDoorHeadMm} min={0} max={5000} step={10} unit="mm" />
                  {confirmedOpenings.some(o => o.type === 'window') && (
                    <button onClick={applyWindowDefaultsToAll}
                      className="w-full py-1.5 text-xs font-semibold text-gray-500 hover:text-black underline underline-offset-2">
                      Apply these heights to all windows already placed
                    </button>
                  )}
                </div>

                <div className="flex gap-1.5">
                  {(['window', 'door'] as const).map(t => (
                    <button key={t}
                      onClick={() => { setManualOpeningType(t); setManualOpeningMode(v => manualOpeningType === t ? !v : true); setManualOpeningStart(null); setCutGapMode(false); setCutGapStart(null); }}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold capitalize transition-all
                        ${manualOpeningMode && manualOpeningType === t ? 'bg-black text-white' : 'bg-white border border-gray-200 text-gray-500 hover:border-black'}`}>
                      {manualOpeningMode && manualOpeningType === t
                        ? (manualOpeningStart ? 'Click end point…' : 'Click start point…')
                        : `Place ${t} manually`}
                    </button>
                  ))}
                </div>
                {manualOpeningMode && (
                  <p className="text-xs text-gray-500 leading-relaxed">
                    Click two points on the plan along the wall to mark the opening — width, and heights, can be fine-tuned to an exact mm value afterward in the list below.
                  </p>
                )}

                <button onClick={handleDetectOpenings} disabled={detectingOpenings || !pdfFile}
                  className="w-full py-2.5 border border-black text-black text-sm font-semibold rounded-xl
                    hover:bg-black hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed
                    flex items-center justify-center gap-2">
                  {detectingOpenings ? (
                    <span className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  ) : null}
                  {detectingOpenings ? 'Scanning…' : 'Detect doors & windows'}
                </button>
                {openingsTruncated && (
                  <p className="text-xs text-amber-600 leading-relaxed">
                    A lot of candidates were found — showing the most plausible ones. If this layer isn&apos;t your wall outline, try selecting the actual wall/window layer instead.
                  </p>
                )}

                {openingCandidates.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500">{openingCandidates.length} candidate{openingCandidates.length === 1 ? '' : 's'} — click a marker on the plan, or review below.</p>
                    {openingCandidates.map(c => (
                      <div key={c.id} className={`rounded-xl border px-3 py-2.5 space-y-2 ${activeCandidateId === c.id ? 'border-black bg-gray-50' : 'border-gray-100'}`}>
                        <button onClick={() => setActiveCandidateId(prev => prev === c.id ? null : c.id)}
                          className="w-full flex items-center justify-between gap-2 text-left">
                          <span className="text-xs font-semibold text-black capitalize">{c.type} · {Math.round(c.widthMm)}mm</span>
                          <span className="text-xs text-gray-500">{Math.round(c.confidence * 100)}% match</span>
                        </button>
                        {activeCandidateId === c.id && (
                          <div className="space-y-2 pt-1">
                            <div className="flex gap-1.5">
                              {(['door', 'window', 'opening'] as const).map(t => (
                                <button key={t}
                                  onClick={() => setOpeningCandidates(prev => prev.map(x => x.id === c.id
                                    ? { ...x, type: t, ...defaultsFor(t) }
                                    : x))}
                                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all
                                    ${c.type === t ? 'bg-black text-white' : 'bg-white border border-gray-200 text-gray-500 hover:border-black'}`}>
                                  {t}
                                </button>
                              ))}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <NumInput label="Width" value={Math.round(c.widthMm)}
                                onChange={v => setOpeningCandidates(prev => prev.map(x => x.id === c.id ? withWidthMm(x, v) : x))}
                                min={50} max={10000} step={10} unit="mm" />
                              <NumInput label="Height" value={c.headMm - c.sillMm}
                                onChange={v => setOpeningCandidates(prev => prev.map(x => x.id === c.id ? { ...x, headMm: x.sillMm + Math.max(50, v) } : x))}
                                min={50} max={5000} step={10} unit="mm" />
                              <NumInput label="Sill" value={c.sillMm}
                                onChange={v => setOpeningCandidates(prev => prev.map(x => x.id === c.id ? { ...x, sillMm: v, headMm: v + (x.headMm - x.sillMm) } : x))}
                                min={0} max={5000} step={10} unit="mm" />
                              <NumInput label="Head" value={c.headMm}
                                onChange={v => setOpeningCandidates(prev => prev.map(x => x.id === c.id ? { ...x, headMm: Math.max(x.sillMm + 50, v) } : x))}
                                min={50} max={5000} step={10} unit="mm" />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => confirmCandidate(c.id)}
                                className="flex-1 py-2 bg-black text-white text-xs font-semibold rounded-lg hover:bg-black/80">
                                Confirm
                              </button>
                              <button onClick={() => discardCandidate(c.id)}
                                className="flex-1 py-2 border border-gray-200 text-gray-500 text-xs font-semibold rounded-lg hover:border-black hover:text-black">
                                Discard
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {confirmedOpenings.length > 0 && (
                  <div className="space-y-1.5 border-t border-gray-100 pt-2.5">
                    {confirmedOpenings.map(o => (
                      <div key={o.id} className={`rounded-lg ${editingOpeningId === o.id ? 'bg-gray-50 border border-gray-200 p-2' : ''}`}>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <button onClick={() => setEditingOpeningId(prev => prev === o.id ? null : o.id)}
                            className="min-w-0 truncate text-black/55 hover:text-black capitalize text-left">
                            {o.type} · {Math.round(o.widthMm)}mm wide · {o.headMm - o.sillMm}mm tall (sill {o.sillMm}mm)
                          </button>
                          <button onClick={() => removeConfirmedOpening(o.id)} className="text-red-600 hover:text-red-800 flex-shrink-0">Remove</button>
                        </div>
                        {editingOpeningId === o.id && (
                          <div className="space-y-2 mt-2">
                            <div className="grid grid-cols-2 gap-2">
                              <NumInput label="Width" value={Math.round(o.widthMm)}
                                onChange={v => updateConfirmedOpening(o.id, withWidthMm(o, v))}
                                min={50} max={10000} step={10} unit="mm" />
                              <NumInput label="Height" value={o.headMm - o.sillMm}
                                onChange={v => updateConfirmedOpening(o.id, { headMm: o.sillMm + Math.max(50, v) })}
                                min={50} max={5000} step={10} unit="mm" />
                              <NumInput label="Sill" value={o.sillMm}
                                onChange={v => updateConfirmedOpening(o.id, { sillMm: v, headMm: v + (o.headMm - o.sillMm) })}
                                min={0} max={5000} step={10} unit="mm" />
                              <NumInput label="Head" value={o.headMm}
                                onChange={v => updateConfirmedOpening(o.id, { headMm: Math.max(o.sillMm + 50, v) })}
                                min={50} max={5000} step={10} unit="mm" />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            <section className="p-5 space-y-3">
              <SectionLabel>Current Floor Placement</SectionLabel>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Floor name</label>
                <input value={floorDraft.name} onChange={e => setFloorDraft(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Ground floor" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-black" />
              </div>
              <NumInput label="Base elevation" value={floorDraft.elevationMm}
                onChange={v => setFloorDraft(prev => ({ ...prev, elevationMm: v }))} min={0} max={100000} step={50} unit="mm" />
              <NumInput label="Wall height" value={floorDraft.wallHeightMm}
                onChange={v => { setFloorDraft(prev => ({ ...prev, wallHeightMm: v })); setWallHeightMm(v); }} min={100} max={20000} step={50} unit="mm" />
              <div className="grid grid-cols-2 gap-3">
                <NumInput label="X offset" value={floorDraft.offsetXmm}
                  onChange={v => setFloorDraft(prev => ({ ...prev, offsetXmm: v }))} min={-50000} max={50000} step={10} unit="mm" />
                <NumInput label="Y offset" value={floorDraft.offsetYmm}
                  onChange={v => setFloorDraft(prev => ({ ...prev, offsetYmm: v }))} min={-50000} max={50000} step={10} unit="mm" />
              </div>
              <button onClick={addCurrentFloorToBuilding} disabled={!wallSegments.length}
                className="w-full py-2.5 bg-black text-white text-sm font-semibold rounded-xl hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed">
                Add current floor to building
              </button>
              {buildingFloors.length > 0 && (
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  {buildingFloors.map((floor, index) => (
                    <div key={floor.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate text-black/55">{index + 1}. {floor.name} · Z {floor.elevationMm} mm</span>
                      <button onClick={() => removeBuildingFloor(floor.id)} className="text-red-600 hover:text-red-800">Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {pdfFile && (
              <section className="p-5 space-y-4">
                <SectionLabel>Wall Outline Extraction</SectionLabel>
                <button
                  onClick={handleExtractOutlines}
                  disabled={outlining || sheet?.extractable === false}
                  className="w-full py-3 bg-black text-white text-sm font-bold rounded-xl
                    hover:bg-black/80 disabled:opacity-40 disabled:cursor-not-allowed transition-all
                    flex items-center justify-center gap-2">
                  {outlining
                    ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>Extracting…</span></>
                    : 'Extract Wall Outlines'}
                </button>
                {outlineSegments.length > 0 && (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">{outlineSegments.length} outline segments</p>
                    <button onClick={() => setOutlineSegments([])}
                      className="text-xs text-gray-500 hover:text-black transition-colors">
                      Clear
                    </button>
                  </div>
                )}
                <div className="space-y-3 pt-1 border-t border-gray-100">
                  <p className="text-xs text-gray-500 pt-1">Tuning thresholds</p>
                  <NumInput label="Min line length (pt)" value={minLenPt}
                    onChange={setMinLenPt} min={1} max={200} step={1} unit="pt" />
                  <NumInput label="Hatch min segments" value={hatchMinSegs}
                    onChange={setHatchMinSegs} min={2} max={30} step={1} />
                  <NumInput label="Hatch avg max (pt)" value={hatchAvgMaxPt}
                    onChange={setHatchAvgMaxPt} min={1} max={100} step={1} unit="pt" />
                  {outlineSegments.length > 0 && (
                    <button
                      onClick={handleExtractOutlines}
                      disabled={outlining}
                      className="w-full py-2 border border-gray-200 text-black/60 text-xs font-semibold
                        rounded-xl hover:border-black hover:text-black disabled:opacity-30 transition-all">
                      {outlining ? 'Extracting…' : 'Re-extract'}
                    </button>
                  )}
                </div>
              </section>
            )}

            {pdfFile && (
              <section className="p-5">
                <SectionLabel>Manual Selection</SectionLabel>
                <div className="flex rounded-xl overflow-hidden border border-gray-200 text-xs font-semibold w-full">
                  {(['line', 'color', 'pattern'] as Mode[]).map(m => (
                    <button key={m} onClick={() => setMode(m)}
                      className={`flex-1 py-2 transition-colors capitalize ${mode === m
                        ? 'bg-black text-white' : 'text-gray-500 hover:text-black'}`}>
                      {m}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2 leading-relaxed">{modeHint}</p>

                {wallSegments.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                    <button
                      onClick={() => { setCutGapMode(v => !v); setCutGapStart(null); setMode('line'); setManualOpeningMode(false); setManualOpeningStart(null); }}
                      className={`w-full py-2.5 rounded-xl text-xs font-semibold transition-all
                        ${cutGapMode ? 'bg-black text-white' : 'border border-gray-200 text-gray-500 hover:border-black hover:text-black'}`}>
                      {cutGapMode ? (cutGapStart ? 'Click end of gap…' : 'Click start of gap…') : 'Cut a gap in a wall'}
                    </button>
                    {cutGapMode && (
                      <p className="text-xs text-gray-500 leading-relaxed">
                        Click two points along one selected (highlighted) wall line — the span between them is removed, splitting the line into two.
                      </p>
                    )}
                  </div>
                )}
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
                        <span className="text-xs font-mono text-gray-500 flex-1 truncate">
                          {sig.angle.toFixed(1)}° · {sig.spacing.toFixed(1)}pt
                          {(sig as any).matchMode === 'angle' && (
                            <span className="ml-1 text-orange-700">loose</span>
                          )}
                        </span>
                        <span className="text-xs text-gray-500 flex-shrink-0">
                          {patternSegments[i]?.length ?? 0}
                        </span>
                        <button onClick={() => removePattern(i)}
                          className="text-xs text-red-600 hover:text-red-800 transition-colors flex-shrink-0">
                          ×
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-0.5">
                      <p className="text-xs text-gray-500">
                        {selectedSignatures.length} pattern{selectedSignatures.length !== 1 ? 's' : ''} · {totalPatternSegs} seg
                      </p>
                      <button onClick={() => { setSelectedSignatures([]); setPatternSegments([]); }}
                        className="text-xs text-gray-500 hover:text-black transition-colors">
                        Clear all
                      </button>
                    </div>
                  </div>
                )}

                {selectedSignature ? (
                  <div className="bg-gray-50 rounded-xl p-3 space-y-1 border border-gray-200">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Detected</p>
                    <p className="text-xs font-mono text-black/70">
                      {selectedSignature.angle.toFixed(1)}° · spacing {selectedSignature.spacing.toFixed(1)} pt
                    </p>
                    <button onClick={() => setSelectedSignature(null)}
                      className="text-xs text-gray-500 hover:text-black transition-colors">
                      Discard
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 italic leading-relaxed">
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
                  <p className="text-xs text-gray-500 mb-2">Matching precision</p>
                  <div className="flex rounded-xl overflow-hidden border border-gray-200 text-xs font-semibold w-full">
                    <button onClick={() => setMatchMode('both')}
                      className={`flex-1 py-2 px-1 transition-colors text-center ${matchMode === 'both'
                        ? 'bg-black text-white' : 'text-gray-500 hover:text-black'}`}>
                      Precise
                    </button>
                    <button onClick={() => setMatchMode('angle')}
                      className={`flex-1 py-2 px-1 transition-colors text-center ${matchMode === 'angle'
                        ? 'bg-orange-500 text-white' : 'text-gray-500 hover:text-black'}`}>
                      Loose
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
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
                            <span className={`text-xs ${on ? 'text-white/50' : 'text-gray-500'}`}>
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
                            <span className="text-xs font-mono text-gray-500 w-16 flex-shrink-0 truncate">
                              {sc || '-'}
                            </span>
                            <span className="text-xs text-gray-500 flex-1 truncate">{g.kind}</span>
                            <span className="text-xs text-gray-500 flex-shrink-0">{g.count}</span>
                            {on && <span className="text-xs text-black/60 flex-shrink-0">✓</span>}
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
                      <p className="text-xs text-gray-500">
                        {selectedColors.length} color{selectedColors.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 italic">No colors selected</p>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <p className="text-xs text-gray-500">
                        {clickedSegments.length} line{clickedSegments.length !== 1 ? 's' : ''} picked
                      </p>
                      {colorSegments.length > 0 && (
                        <p className="text-xs text-gray-500">{colorSegments.length} color seg</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {selectedColors.length > 0 && (
                        <button onClick={() => setSelectedColors([])}
                          className="text-xs text-gray-500 hover:text-black transition-colors">
                          Clear colors
                        </button>
                      )}
                      {clickedSegments.length > 0 && (
                        <button onClick={() => setClickedSegments([])}
                          className="text-xs text-red-600 hover:text-red-800 transition-colors">
                          Clear lines
                        </button>
                      )}
                      {colorSegments.length > 0 && (
                        <button onClick={() => setColorSegments([])}
                          className="text-xs text-blue-600 hover:text-blue-800 transition-colors">
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
                  <p className="text-xs text-gray-500 font-medium">
                    {wallSegments.length} total segments
                  </p>
                  <button onClick={clearAllWalls}
                    className="text-xs text-gray-500 hover:text-black transition-colors">
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
            <p className="text-xs text-gray-500 truncate">{statusMsg}</p>
            <div className="flex items-center gap-4 ml-auto flex-shrink-0">
              {selectedSignatures.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <div className="w-4 h-0.5 bg-violet-400 rounded" />
                  {selectedSignatures.length} pattern{selectedSignatures.length !== 1 ? 's' : ''}
                </div>
              )}
              {clickedSegments.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <div className="w-4 h-0.5 bg-red-400 rounded" />
                  {clickedSegments.length} picked
                </div>
              )}
              {wallSegments.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
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
                  <p className="text-sm text-gray-500">Rendering preview…</p>
                </div>
              )}

              {!loading && preview && (
                <div className="relative w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/png;base64,${preview.image_base64}`}
                    alt="PDF preview"
                    className="w-full h-auto block"
                    style={{ cursor: cutGapMode ? 'not-allowed' : manualOpeningMode ? 'copy' : mode === 'color' ? 'cell' : 'crosshair' }}
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
                    {confirmedOpenings.map(o => {
                      const mx = (o.gapStart[0] + o.gapEnd[0]) / 2, my = (o.gapStart[1] + o.gapEnd[1]) / 2;
                      const color = o.type === 'door' ? '#f97316' : o.type === 'window' ? '#06b6d4' : '#6b7280';
                      return (
                        <g key={o.id}>
                          <line x1={o.gapStart[0]} y1={o.gapStart[1]} x2={o.gapEnd[0]} y2={o.gapEnd[1]}
                            stroke={color} strokeWidth={4} vectorEffect="non-scaling-stroke" />
                          <circle cx={mx} cy={my} r={10} fill={color} stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                        </g>
                      );
                    })}
                    {openingCandidates.map(c => {
                      const mx = (c.gapStart[0] + c.gapEnd[0]) / 2, my = (c.gapStart[1] + c.gapEnd[1]) / 2;
                      const color = c.type === 'door' ? '#f97316' : c.type === 'window' ? '#06b6d4' : '#6b7280';
                      const active = activeCandidateId === c.id;
                      return (
                        <g key={c.id} style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                          onClick={() => setActiveCandidateId(prev => prev === c.id ? null : c.id)}>
                          <line x1={c.gapStart[0]} y1={c.gapStart[1]} x2={c.gapEnd[0]} y2={c.gapEnd[1]}
                            stroke={color} strokeWidth={active ? 4 : 2.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
                          <circle cx={mx} cy={my} r={active ? 14 : 10} fill={active ? color : 'white'}
                            stroke={color} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                        </g>
                      );
                    })}
                    {manualOpeningStart && (
                      <circle cx={manualOpeningStart[0]} cy={manualOpeningStart[1]} r={9}
                        fill="#facc15" stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                    )}
                    {cutGapStart && (
                      <circle cx={cutGapStart[0]} cy={cutGapStart[1]} r={9}
                        fill="#dc2626" stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                    )}
                  </svg>
                </div>
              )}

              {!loading && !preview && (
                <div className="flex flex-col items-center gap-3 py-20">
                  <svg className="w-10 h-10 text-black/10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-sm text-gray-500">PDF preview will appear here</p>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
