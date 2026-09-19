'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, TransformControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { useMemo, useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import * as THREE from 'three';

// Must match PT_TO_M in page.tsx — 1:50 real-world scale
const PT_TO_M = (0.0254 / 72) * 50;
// Fallback only — the real value is the printer's nozzle diameter, passed in
// as a prop, since that's what the slicer itself uses as wall thickness.
const DEFAULT_WALL_THICKNESS_M = 0.025;

type Seg = [[number, number], [number, number]];
type TransformMode = 'translate' | 'rotate' | 'scale';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface Opening {
  id: string;
  type: 'door' | 'window' | 'opening';
  gapStart: [number, number];
  gapEnd: [number, number];
  widthMm: number;
  sillMm: number;
  headMm: number;
}

export interface BuildingFloor {
  id: string;
  name: string;
  segments: Seg[];
  wallHeightMm: number;
  elevationMm: number;
  offsetXmm: number;
  offsetYmm: number;
  openings?: Opening[];
}

const FLOOR_COLORS = ['#d0c0a8', '#b9c9d6', '#c7b8c9', '#c8d0b0', '#d6c3b6'];

// A window/door placed manually (rather than found as a natural gap by
// detection) doesn't remove anything from the plan's own wall segments — so
// without this, the original solid wall stays exactly where the opening is,
// coincident with the translucent highlight pane. Which one wins depends on
// viewing angle and z-fighting, so the window can appear to vanish from one
// side. Clipping every confirmed opening out of the wall geometry here,
// unconditionally, makes it correct regardless of how the opening was made.
//
// The check is anchored to the OPENING's own line, not each wall segment's
// own direction. A wall selected as many short adjacent segments (common
// from color/pattern/hatch selection) makes each little segment's own
// direction numerically noisy — anchoring to it meant some fragments under
// an opening clipped correctly and others didn't, leaving solid debris that
// blocked the view from one side without blocking it from the other.
function clipSegmentsForOpenings(segments: Seg[], openings: Opening[]): Seg[] {
  let result = segments;
  for (const op of openings) {
    const [gx0, gy0] = op.gapStart, [gx1, gy1] = op.gapEnd;
    const gdx = gx1 - gx0, gdy = gy1 - gy0;
    const gapLen = Math.hypot(gdx, gdy);
    if (gapLen < 1e-6) continue;
    const ux = gdx / gapLen, uy = gdy / gapLen; // unit vector along the opening
    const nx = -uy, ny = ux;                    // perpendicular to it
    const TOL_PT = 6;

    const next: Seg[] = [];
    for (const s of result) {
      const [x0, y0] = s[0], [x1, y1] = s[1];
      // Both endpoints must sit close to the opening's own line.
      const off0 = (x0 - gx0) * nx + (y0 - gy0) * ny;
      const off1 = (x1 - gx0) * nx + (y1 - gy0) * ny;
      if (Math.abs(off0) > TOL_PT || Math.abs(off1) > TOL_PT) { next.push(s); continue; }
      // Project both endpoints onto the opening's own axis (0 at its start,
      // gapLen at its end) so overlap is measured against one stable ruler.
      const t0 = (x0 - gx0) * ux + (y0 - gy0) * uy;
      const t1 = (x1 - gx0) * ux + (y1 - gy0) * uy;
      const segMin = Math.min(t0, t1), segMax = Math.max(t0, t1);
      const overlapStart = Math.max(segMin, 0);
      const overlapEnd   = Math.min(segMax, gapLen);
      if (overlapEnd - overlapStart < 0.001) { next.push(s); continue; }
      const pointAtT = (t: number): [number, number] => [gx0 + ux * t, gy0 + uy * t];
      const startPoint = t0 <= t1 ? s[0] : s[1];
      const endPoint   = t0 <= t1 ? s[1] : s[0];
      if (overlapStart > segMin + 0.001) next.push([startPoint, pointAtT(overlapStart)]);
      if (overlapEnd   < segMax - 0.001) next.push([pointAtT(overlapEnd), endPoint]);
    }
    result = next;
  }
  return result;
}

// A wall built from Outline Extraction + Color + Pattern + manual clicks can
// end up with the same physical line selected more than once — each tool
// reconstructs coordinates slightly differently, so the duplicates aren't
// pixel-identical. A duplicate that just misses an opening's clip tolerance
// leaves a thin ghost fragment of solid wall behind, invisible from some
// angles but blocking the view from others.
function dedupeSegments(segments: Seg[], tolPt = 2): Seg[] {
  const out: Seg[] = [];
  const close = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]) < tolPt;
  const matches = (a: Seg, b: Seg) => (close(a[0], b[0]) && close(a[1], b[1])) || (close(a[0], b[1]) && close(a[1], b[0]));
  for (const s of segments) {
    if (!out.some(o => matches(o, s))) out.push(s);
  }
  return out;
}

function Walls({ floors, wallThicknessM, cx, cz, wallsGroupRef }: {
  floors: BuildingFloor[]; wallThicknessM: number; cx: number; cz: number;
  wallsGroupRef: React.MutableRefObject<THREE.Group | null>;
}) {
  const walls = useMemo(() => floors.flatMap((floor, floorIndex) => {
    const color = FLOOR_COLORS[floorIndex % FLOOR_COLORS.length];
    const clippedSegments = clipSegmentsForOpenings(dedupeSegments(floor.segments), floor.openings ?? []);
    const solid = clippedSegments.flatMap((seg, i) => {
      const x0 = seg[0][0] * PT_TO_M, y0 = seg[0][1] * PT_TO_M;
      const x1 = seg[1][0] * PT_TO_M, y1 = seg[1][1] * PT_TO_M;
      const dx = x1 - x0, dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) return [];
      return [{
        key: `${floor.id}-${i}`,
        x:   (x0 + x1) / 2 + floor.offsetXmm / 1000 - cx,
        y:   floor.elevationMm / 1000 + floor.wallHeightMm / 2000,
        z:  -((y0 + y1) / 2) - floor.offsetYmm / 1000 - cz,
        len,
        rot: -Math.atan2(dy, dx),
        height: floor.wallHeightMm / 1000,
        color,
      }];
    });
    // A confirmed door/window fills its plan gap back in with wall — except
    // between sill and head height, where it stays open. Rendered as up to
    // two stacked boxes (below the sill, above the head) instead of one.
    const openingFillers = (floor.openings ?? []).flatMap((op, i) => {
      const x0 = op.gapStart[0] * PT_TO_M, y0 = op.gapStart[1] * PT_TO_M;
      const x1 = op.gapEnd[0] * PT_TO_M, y1 = op.gapEnd[1] * PT_TO_M;
      const dx = x1 - x0, dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) return [];
      const rot = -Math.atan2(dy, dx);
      const bx = (x0 + x1) / 2 + floor.offsetXmm / 1000 - cx;
      const bz = -((y0 + y1) / 2) - floor.offsetYmm / 1000 - cz;
      const sillM = op.sillMm / 1000, headM = op.headMm / 1000, topM = floor.wallHeightMm / 1000;
      const boxes = [];
      if (sillM > 0.01) {
        boxes.push({ key: `${floor.id}-op${i}-sill`, x: bx, y: floor.elevationMm / 1000 + sillM / 2, z: bz, len, rot, height: sillM, color });
      }
      if (topM - headM > 0.01) {
        boxes.push({ key: `${floor.id}-op${i}-head`, x: bx, y: floor.elevationMm / 1000 + headM + (topM - headM) / 2, z: bz, len, rot, height: topM - headM, color });
      }
      return boxes;
    });
    return [...solid, ...openingFillers];
  }), [floors, cx, cz]);

  // The open band itself (sill→head) is otherwise just empty space — nothing
  // to see. Fill it with a translucent, brightly-coloured pane so a door or
  // window is obvious in the 3D view rather than reading as a random gap.
  const OPENING_COLOR: Record<Opening['type'], string> = {
    door: '#f97316', window: '#22d3ee', opening: '#9ca3af',
  };
  const highlights = useMemo(() => floors.flatMap(floor => (floor.openings ?? []).flatMap((op, i) => {
    const x0 = op.gapStart[0] * PT_TO_M, y0 = op.gapStart[1] * PT_TO_M;
    const x1 = op.gapEnd[0] * PT_TO_M, y1 = op.gapEnd[1] * PT_TO_M;
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return [];
    const sillM = op.sillMm / 1000, headM = Math.max(op.sillMm / 1000, op.headMm / 1000);
    const bandH = Math.max(0.02, headM - sillM);
    return [{
      key: `${floor.id}-hl${i}`,
      x: (x0 + x1) / 2 + floor.offsetXmm / 1000 - cx,
      y: floor.elevationMm / 1000 + sillM + bandH / 2,
      z: -((y0 + y1) / 2) - floor.offsetYmm / 1000 - cz,
      len, rot: -Math.atan2(dy, dx), height: bandH,
      color: OPENING_COLOR[op.type],
    }];
  })), [floors, cx, cz]);

  return (
    <>
      {/* Solid walls only — this is the group handed to the STL/GLB exporter,
          so the translucent door/window highlight panes below (a UI aid, not
          part of the real building) don't end up baked into the export as
          stray solid slabs sitting across what should be an open gap. */}
      <group ref={wallsGroupRef}>
        {walls.map(w => (
          <mesh key={w.key}
            position={[w.x, w.y, w.z]}
            rotation={[0, w.rot, 0]}
            castShadow receiveShadow>
            <boxGeometry args={[w.len, w.height, wallThicknessM]} />
            <meshStandardMaterial color={w.color} roughness={0.85} metalness={0.02} />
          </mesh>
        ))}
      </group>
      {highlights.map(h => (
        <mesh key={h.key} position={[h.x, h.y, h.z]} rotation={[0, h.rot, 0]}>
          {/* A fixed clearance, not a percentage of wall thickness — a %
              margin shrinks along with thin (real, nozzle-width) walls until
              it's below the depth buffer's precision, which is exactly what
              caused the highlight to randomly win or lose z-fighting against
              the wall depending on viewing angle. */}
          <boxGeometry args={[h.len, h.height, wallThicknessM + 0.02]} />
          <meshStandardMaterial color={h.color} transparent opacity={0.45}
            emissive={h.color} emissiveIntensity={0.3} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  );
}

interface WallViewerProps { floors: BuildingFloor[]; nozzleMm?: number; }

export default function WallViewer({ floors, nozzleMm }: WallViewerProps) {
  const wallThicknessM = nozzleMm ? nozzleMm / 1000 : DEFAULT_WALL_THICKNESS_M;
  const { cx, cz, span, top, width, depth } = useMemo(() => {
    const allSegments = floors.flatMap(f => f.segments.map(s => ({ s, f })));
    if (!allSegments.length) return { cx: 0, cz: 0, span: 10, top: 3, width: 10, depth: 10 };
    const xs = allSegments.flatMap(({ s, f }) => [
      s[0][0] * PT_TO_M + f.offsetXmm / 1000,
      s[1][0] * PT_TO_M + f.offsetXmm / 1000,
    ]);
    const zs = allSegments.flatMap(({ s, f }) => [
      -(s[0][1] * PT_TO_M) - f.offsetYmm / 1000,
      -(s[1][1] * PT_TO_M) - f.offsetYmm / 1000,
    ]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    return {
      cx:   (minX + maxX) / 2,
      cz:   (minZ + maxZ) / 2,
      span: Math.max(maxX - minX, maxZ - minZ, 10),
      top: Math.max(...floors.map(f => (f.elevationMm + f.wallHeightMm) / 1000), 3),
      width: Math.max(maxX - minX, 0.1),
      depth: Math.max(maxZ - minZ, 0.1),
    };
  }, [floors]);

  const d   = span * 1.2;
  const cam: [number,number,number] = [cx + d * 0.6, top + d * 0.5, cz + d * 0.7];
  const tgt: [number,number,number] = [cx, top / 2, cz];
  // A far plane fixed at 5000 regardless of scene size wastes almost all of
  // the depth buffer's precision on a building that only spans a few tens of
  // metres — scaling both planes to the actual scene keeps enough precision
  // to tell a thin (real, nozzle-width) wall apart from a highlight pane
  // sitting just millimetres in front of it.
  const farPlane = Math.max(50, d * 4);

  // ── Manipulate / export the extracted building model ─────────────────────
  const buildingGroupRef = useRef<THREE.Group | null>(null); // TransformControls target — walls + highlights, pivoted at the building's own center
  const wallsGroupRef    = useRef<THREE.Group | null>(null); // solid walls only — what actually gets exported
  const orbitRef          = useRef<any>(null);
  const [enableTransform, setEnableTransform] = useState(false);
  const [transformMode,   setTransformMode]   = useState<TransformMode>('translate');
  const [buildingScale,   setBuildingScale]   = useState({ x: 1, y: 1, z: 1 });
  const [isExporting,     setIsExporting]     = useState<'stl'|'glb'|null>(null);

  // A newly-loaded floor plan is a fresh model — a previous plan's manual
  // move/rotate/resize shouldn't carry over onto it. Set imperatively (and
  // only here) rather than via a `position` JSX prop on the group below —
  // that group is also mutated directly by TransformControls drags and the
  // dimension inputs, and a prop value would silently overwrite those on
  // every unrelated re-render (e.g. the scale readout updating mid-drag).
  // useLayoutEffect so the reset lands before the next paint, not after —
  // otherwise a freshly-loaded plan flashes at the world origin for a frame.
  useLayoutEffect(() => {
    if (buildingGroupRef.current) {
      buildingGroupRef.current.position.set(cx, 0, cz);
      buildingGroupRef.current.rotation.set(0, 0, 0);
      buildingGroupRef.current.scale.set(1, 1, 1);
    }
    setBuildingScale({ x: 1, y: 1, z: 1 });
  }, [floors, cx, cz]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return; // don't steal keys from the dimension fields
      if (e.key === 'Escape') setEnableTransform(false);
      if (!e.ctrlKey && !e.metaKey) {
        if (e.key === 't' || e.key === 'T') setEnableTransform(v => !v);
        if (e.key === 'g' || e.key === 'G') setTransformMode('translate');
        if (e.key === 'r' || e.key === 'R') setTransformMode('rotate');
        if (e.key === 's' || e.key === 'S') setTransformMode('scale');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Exporters bake in matrixWorld, so whatever the user dragged/typed is
  // captured automatically — no need to touch the geometry itself.
  const handleExport = useCallback(async (format: 'stl'|'glb') => {
    const group = wallsGroupRef.current;
    if (!group) return;
    setIsExporting(format);
    try {
      group.updateMatrixWorld(true);
      if (format === 'stl') {
        const { STLExporter } = await import('three/examples/jsm/exporters/STLExporter.js');
        const result = new STLExporter().parse(group, { binary: true }) as unknown as DataView;
        const bytes = new Uint8Array(result.buffer as ArrayBuffer, result.byteOffset, result.byteLength);
        downloadBlob(new Blob([bytes], { type: 'application/sla' }), 'autobuild-building.stl');
      } else {
        const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
        new GLTFExporter().parse(
          group,
          (result) => downloadBlob(new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' }), 'autobuild-building.glb'),
          (err) => console.error('GLB export failed', err),
          { binary: true },
        );
      }
    } finally {
      setIsExporting(null);
    }
  }, []);

  const hasBuilding = floors.some(f => f.segments.length > 0);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas shadows camera={{ position: cam, fov: 50, near: 0.05, far: farPlane }}
        style={{ background: '#87ceeb', width: '100%', height: '100%' }}>
        <ambientLight intensity={0.55} color="#fff8ee" />
        <directionalLight
          position={[cx + span, top * 3 + 10, cz + span]}
          intensity={1.6} castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-span * 1.5}
          shadow-camera-right={span * 1.5}
          shadow-camera-top={span * 1.5}
          shadow-camera-bottom={-span * 1.5}
          shadow-camera-near={0.5}
          shadow-camera-far={top * 6 + span * 4}
        />
        {/* Pivoted at the building's own center (cx, cz), not the world
            origin — so Move/Rotate/Scale (and the Width/Depth number fields)
            act around the building itself, the way Blender's object origin
            does, instead of the whole thing sliding off as it's resized. */}
        <group ref={buildingGroupRef}>
          <Walls floors={floors} wallThicknessM={wallThicknessM} cx={cx} cz={cz} wallsGroupRef={wallsGroupRef} />
        </group>
        {/* Ground plane */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
          <planeGeometry args={[span * 4, span * 4]} />
          <meshStandardMaterial color="#5c7a3a" roughness={1} />
        </mesh>
        {enableTransform && buildingGroupRef.current && (
          <TransformControls
            object={buildingGroupRef.current}
            mode={transformMode}
            onMouseDown={() => { if (orbitRef.current) orbitRef.current.enabled = false; }}
            onMouseUp={()   => { if (orbitRef.current) orbitRef.current.enabled = true;  }}
            onObjectChange={() => {
              const s = buildingGroupRef.current?.scale;
              if (s) setBuildingScale({ x: s.x, y: s.y, z: s.z });
            }}
          />
        )}
        <OrbitControls ref={orbitRef} target={tgt} makeDefault />
        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <GizmoViewport />
        </GizmoHelper>
      </Canvas>

      {hasBuilding && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 flex-wrap max-w-[calc(100%-24px)]">
          <button onClick={() => setEnableTransform(v => !v)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all ${enableTransform ? 'text-white' : 'text-white/35 hover:text-white/70'}`}
            style={{ background: enableTransform ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.28)', backdropFilter: 'blur(10px)' }}>
            Transform
          </button>
          <div className="w-px h-4 bg-white/15 mx-0.5" />
          <button onClick={() => handleExport('stl')} disabled={!!isExporting} title="Export as STL"
            className="px-2.5 py-1 text-[11px] font-medium rounded-lg text-white/35 hover:text-white/70 transition-all disabled:opacity-50"
            style={{ background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(10px)' }}>
            {isExporting === 'stl' ? '…' : 'STL'}
          </button>
          <button onClick={() => handleExport('glb')} disabled={!!isExporting} title="Export as GLB"
            className="px-2.5 py-1 text-[11px] font-medium rounded-lg text-white/35 hover:text-white/70 transition-all disabled:opacity-50"
            style={{ background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(10px)' }}>
            {isExporting === 'glb' ? '…' : 'GLB'}
          </button>

          {enableTransform && (
            <>
              <div className="w-px h-4 bg-white/15 mx-0.5" />
              {([
                { m: 'translate' as TransformMode, label: 'Move' },
                { m: 'rotate'    as TransformMode, label: 'Rotate' },
                { m: 'scale'     as TransformMode, label: 'Scale' },
              ]).map(opt => (
                <button key={opt.m} onClick={() => setTransformMode(opt.m)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all ${transformMode === opt.m ? 'text-white' : 'text-white/35 hover:text-white/70'}`}
                  style={{ background: transformMode === opt.m ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.28)', backdropFilter: 'blur(10px)' }}>
                  {opt.label}
                </button>
              ))}
              <div className="w-px h-4 bg-white/15 mx-0.5" />
              {([
                { axis: 'x' as const, label: 'Width', base: width },
                { axis: 'z' as const, label: 'Depth', base: depth },
                { axis: 'y' as const, label: 'Height', base: top },
              ]).map(({ axis, label, base }) => {
                const current = base * buildingScale[axis];
                return (
                  <label key={axis} className="flex items-center gap-1 pl-1">
                    <span className="text-[10px] text-white/35">{label}</span>
                    <input
                      type="number" step={0.1} min={0.1}
                      value={Number(current.toFixed(2))}
                      onChange={e => {
                        const v = parseFloat(e.target.value);
                        if (!isFinite(v) || v <= 0 || base <= 0 || !buildingGroupRef.current) return;
                        const newScale = v / base;
                        buildingGroupRef.current.scale[axis] = newScale;
                        setBuildingScale(prev => ({ ...prev, [axis]: newScale }));
                      }}
                      className="w-14 px-1.5 py-1 text-[11px] font-mono rounded-md text-white bg-white/10 border border-white/10 focus:outline-none focus:border-white/30"
                    />
                  </label>
                );
              })}
              <span className="text-[10px] text-white/25 pl-0.5">m</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
