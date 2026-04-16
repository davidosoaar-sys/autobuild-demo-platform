'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Line, TransformControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'framer-motion';

interface Segment { x0: number; y0: number; x1: number; y1: number; gap?: boolean; }
type Layer         = Segment[];
type ViewMode      = 'environment' | 'void-dark' | 'void-light';
type TransformMode = 'translate' | 'rotate' | 'scale';

export interface SiteDimensions { width: number; length: number; slope: number; }

interface LayerVisualizationProps {
  file:             File | null;
  toolpath:         Layer[];
  numLayers:        number;
  layerHeight:      number;
  nozzleDiameter?:  number;
  site?:            SiteDimensions;
  fullscreen?:      boolean;
  externalMode?:    ViewMode;
  onModeChange?:    (m: ViewMode) => void;
  modelScale?:      number;
  sitePlan?:        import('./SitePlanReader').SitePlanData | null;
  pathColor?:       string;
  modelDimensions?: { x: number; y: number; z: number };
}

// ── Sky ───────────────────────────────────────────────────────────────────────

function SkySphere() {
  return (
    <mesh>
      <sphereGeometry args={[500, 32, 16]} />
      <meshBasicMaterial color="#87ceeb" side={THREE.BackSide} />
    </mesh>
  );
}

// ── Ground with site plan overlays ───────────────────────────────────────────

import type { SitePlanData } from './SitePlanReader';

function SiteGround({ site, mode, sitePlan }: {
  site: SiteDimensions; mode: ViewMode; sitePlan?: SitePlanData | null;
}) {
  const w = Math.max(site.width  || 12, 2);
  const l = Math.max(site.length || 10, 2);
  const slopeRad = (site.slope * Math.PI) / 180;
  const isVoid = mode !== 'environment';
  const isDark = mode === 'void-dark';

  const roadW = sitePlan?.road.width_m ?? 6;
  const roadGeometry = (() => {
    if (!sitePlan?.road.present) return null;
    const s = sitePlan.road.side;
    if (s === 'north') return { x:0, z:-(l/2+roadW/2), rw:w+roadW*2, rl:roadW, rot:0 };
    if (s === 'south') return { x:0, z:(l/2+roadW/2),  rw:w+roadW*2, rl:roadW, rot:0 };
    if (s === 'east')  return { x:(w/2+roadW/2), z:0,  rw:roadW, rl:l+roadW*2, rot:0 };
    if (s === 'west')  return { x:-(w/2+roadW/2), z:0, rw:roadW, rl:l+roadW*2, rot:0 };
    return null;
  })();

  const house = sitePlan?.house;
  const hx = house ? (house.offset_x - 0.5) * w : 0;
  const hz = house ? (house.offset_z - 0.5) * l : 0;
  const hw  = house?.width  ?? 0;
  const hl  = house?.length ?? 0;

  return (
    <group rotation={[slopeRad, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[w, l]} />
        <meshStandardMaterial
          color={isVoid ? (isDark ? '#141414' : '#e8e8e8') : '#4a7a3a'}
          roughness={0.9}
        />
      </mesh>

      {([
        [[-w/2,0.015,-l/2],[w/2,0.015,-l/2]],
        [[w/2,0.015,-l/2],[w/2,0.015,l/2]],
        [[w/2,0.015,l/2],[-w/2,0.015,l/2]],
        [[-w/2,0.015,l/2],[-w/2,0.015,-l/2]],
      ] as [number,number,number][][]).map((pts,i)=>(
        <Line key={i} points={pts}
          color={isDark ? '#22c55e' : isVoid ? '#555' : '#5a9a4a'}
          lineWidth={1.5}
        />
      ))}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]} receiveShadow>
        <planeGeometry args={[w * 8, l * 8]} />
        <meshStandardMaterial
          color={isVoid ? (isDark ? '#080808' : '#d8d8d8') : '#3d6b2e'}
          roughness={0.95}
        />
      </mesh>

      {roadGeometry && (
        <group position={[roadGeometry.x, 0.008, roadGeometry.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[roadGeometry.rw, roadGeometry.rl]} />
            <meshStandardMaterial color="#555555" roughness={0.85}/>
          </mesh>
          <Line
            points={[
              [-roadGeometry.rw/2, 0.005, 0],
              [ roadGeometry.rw/2, 0.005, 0],
            ] as [number,number,number][]}
            color="#f5e642" lineWidth={1.5} dashed dashSize={0.8} gapSize={0.5}
          />
        </group>
      )}

      {house && hw > 0 && hl > 0 && (
        <group position={[hx, 0.012, hz]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[hw, hl]} />
            <meshStandardMaterial color="#3b82f6" transparent opacity={0.18} roughness={0.9}/>
          </mesh>
          {([
            [[-hw/2,0.005,-hl/2],[hw/2,0.005,-hl/2]],
            [[hw/2,0.005,-hl/2],[hw/2,0.005,hl/2]],
            [[hw/2,0.005,hl/2],[-hw/2,0.005,hl/2]],
            [[-hw/2,0.005,hl/2],[-hw/2,0.005,-hl/2]],
          ] as [number,number,number][][]).map((pts,i)=>(
            <Line key={i} points={pts} color="#60a5fa" lineWidth={2}/>
          ))}
        </group>
      )}

      {site.slope > 1 && (
        <Line
          points={[[0,0.05,-l*0.35],[0,0.05,l*0.35]] as [number,number,number][]}
          color="#f59e0b" lineWidth={2}
        />
      )}
    </group>
  );
}

// ── Void grid ─────────────────────────────────────────────────────────────────

function VoidGrid({ dark }: { dark: boolean }) {
  return (
    <>
      <gridHelper args={[200, 40, dark ? '#2a2a2a' : '#bbbbbb', dark ? '#1a1a1a' : '#cccccc']} position={[0, 0.01, 0]} />
      <gridHelper args={[200, 160, dark ? '#161616' : '#dddddd', dark ? '#111111' : '#e8e8e8']} position={[0, 0.008, 0]} />
      <Line points={[[-100,0.02,0],[100,0.02,0]] as [number,number,number][]} color={dark?'#22c55e':'#16a34a'} lineWidth={1.5} transparent opacity={0.5}/>
      <Line points={[[0,0.02,-100],[0,0.02,100]] as [number,number,number][]} color={dark?'#3b82f6':'#2563eb'} lineWidth={1.5} transparent opacity={0.5}/>
    </>
  );
}

// ── Model mesh with grounding ─────────────────────────────────────────────────

interface ModelMeshInnerProps {
  geo?:   THREE.BufferGeometry;
  obj?:   THREE.Group;
  opacity: number;
  scale:   number;
  enableTransform: boolean;
  transformMode:   TransformMode;
  orbitRef: React.RefObject<any>;
}

function ModelMeshInner({ geo, obj, opacity, scale, enableTransform, transformMode, orbitRef }: ModelMeshInnerProps) {
  const wrapRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const grpRef  = useRef<THREE.Group>(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    wrapRef.current.position.y = 0;
    const box = new THREE.Box3().setFromObject(wrapRef.current);
    if (box.min.y < 0) {
      wrapRef.current.position.y = -box.min.y;
    }
  }, [geo, obj, scale]);

  const clonedObj = useMemo(() => {
    if (!obj) return null;
    const c = obj.clone();
    c.rotation.x = -Math.PI / 2;
    c.traverse(ch => {
      if ((ch as THREE.Mesh).isMesh) {
        (ch as THREE.Mesh).material = new THREE.MeshStandardMaterial({
          color: '#ddd8d0', roughness: 0.82, metalness: 0.04, transparent: true, opacity,
        });
      }
    });
    return c;
  }, [obj, opacity]);

  if (!geo && !obj) return null;

  return (
    <>
      <group ref={wrapRef} scale={[scale, scale, scale]}>
        {geo && (
          <mesh ref={meshRef} geometry={geo} castShadow receiveShadow rotation={[-Math.PI/2,0,0]}>
            <meshStandardMaterial color="#ddd8d0" roughness={0.82} metalness={0.04} transparent opacity={opacity} />
          </mesh>
        )}
        {clonedObj && (
          <group ref={grpRef}>
            <primitive object={clonedObj} />
          </group>
        )}
      </group>

      {enableTransform && wrapRef.current && (
        <TransformControls
          object={wrapRef.current}
          mode={transformMode}
          onMouseDown={() => { if (orbitRef.current) orbitRef.current.enabled = false; }}
          onMouseUp={()   => { if (orbitRef.current) orbitRef.current.enabled = true;  }}
        />
      )}
    </>
  );
}

function ModelLoader({ fileUrl, fileExt, opacity, scale, enableTransform, transformMode, orbitRef }: {
  fileUrl: string; fileExt: string; opacity: number; scale: number;
  enableTransform: boolean; transformMode: TransformMode; orbitRef: React.RefObject<any>;
}) {
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null);
  const [obj, setObj] = useState<THREE.Group | null>(null);

  useEffect(() => {
    setGeo(null); setObj(null);
    if (fileExt === 'stl') {
      import('three/examples/jsm/loaders/STLLoader.js').then(({ STLLoader }) => {
        new STLLoader().load(fileUrl, g => { g.computeVertexNormals(); g.center(); setGeo(g); });
      });
    } else {
      import('three/examples/jsm/loaders/OBJLoader.js').then(({ OBJLoader }) => {
        new OBJLoader().load(fileUrl, g => setObj(g));
      });
    }
  }, [fileUrl, fileExt]);

  if (!geo && !obj) return null;
  return (
    <ModelMeshInner
      geo={geo ?? undefined} obj={obj ?? undefined}
      opacity={opacity} scale={scale}
      enableTransform={enableTransform} transformMode={transformMode}
      orbitRef={orbitRef}
    />
  );
}

// ── Error boundary for 3D viewer ──────────────────────────────────────────────
class ThreeErrorBoundary extends React.Component<
  {children: React.ReactNode; fallback?: React.ReactNode},
  {hasError: boolean}
> {
  constructor(props: any) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}

// ── Printer nozzle animation ──────────────────────────────────────────────────

function PrinterAnimation({ toolpath, layerHeight, progress, pathColor = '#c8bfb0', nozzleDiameter = 0.025 }: {
  toolpath: Layer[]; layerHeight: number; progress: number; pathColor?: string; nozzleDiameter?: number;
}) {
  const allSegs = useMemo(() => {
    const out: { s:[number,number,number]; e:[number,number,number]; layer: number }[] = [];
    toolpath.forEach((layer, li) => {
      const y = (li + 0.5) * layerHeight;
      layer.forEach(seg => {
        if (seg.gap) return;
        const dx = seg.x1 - seg.x0;
        const dy = seg.y1 - seg.y0;
        // Filter segments shorter than 40% of nozzle diameter.
        // Segments where len << beadW render as open-ended discs (the tube is
        // shorter than it is wide), appearing lighter and visually larger than
        // the surrounding rod-shaped beads due to DoubleSide back-face exposure.
        const minLen = nozzleDiameter * 0.4;
        if (dx * dx + dy * dy < minLen * minLen) return;
        out.push({
          s: [seg.x0, y, -seg.y0],
          e: [seg.x1, y, -seg.y1],
          layer: li,
        });
      });
    });
    return out;
  }, [toolpath, layerHeight, nozzleDiameter]);

  if (allSegs.length === 0) return null;

  const rawIdx  = progress * allSegs.length;
  const segIdx  = Math.min(Math.floor(rawIdx), allSegs.length - 1);
  const segFrac = rawIdx - segIdx;
  const cur     = allSegs[segIdx];

  const nozzle: [number,number,number] = [
    cur.s[0] + (cur.e[0]-cur.s[0])*segFrac,
    cur.s[1] + (cur.e[1]-cur.s[1])*segFrac + layerHeight * 0.5,
    cur.s[2] + (cur.e[2]-cur.s[2])*segFrac,
  ];

  // beadW = nozzle contact width; beadH = 110% of layer height.
  // 10% extra height guarantees adjacent layers always overlap — zero gaps regardless of
  // profile shape. Both values are constant across all segments (only extrusion length varies).
  const beadW = (nozzleDiameter ?? layerHeight * 1.67) * 0.88;
  const beadH = layerHeight * 1.1;

  const fullGeo = useMemo(() => {
    const total = allSegs.length;
    if (total === 0) return null;

    // Cross-section profile: 6 points — symmetric rounded rectangle.
    //   p0 (-hw, -h/2)  base left
    //   p1 (-hw,  h/4)  shoulder left  (vertical wall stops here)
    //   p2 (-hw*0.85, h/2)  dome left  (slight inward taper for crown)
    //   p3 ( hw*0.85, h/2)  dome right
    //   p4 ( hw,  h/4)  shoulder right
    //   p5 ( hw, -h/2)  base right
    // Symmetric: span = h = beadH.  With beadH = layerHeight*1.1 the top sits
    // exactly 0.55*layerHeight above centre — guaranteed to overlap the adjacent
    // layer's base by 0.1*layerHeight no matter what the wall geometry looks like.

    const PROFILE = 6;
    const vertsPerSeg  = PROFILE * 2;
    const trisPerSeg   = (PROFILE - 1) * 2; // 5 quads × 2 tris each
    const idxPerSeg    = trisPerSeg * 3;

    const positions = new Float32Array(total * vertsPerSeg * 3);
    const normals   = new Float32Array(total * vertsPerSeg * 3);
    const indices   = new Uint32Array(total * idxPerSeg);

    const hw = beadW * 0.5;
    const h  = beadH;

    const px = [-hw, -hw,      -hw * 0.85, hw * 0.85,  hw,      hw ];
    const py = [-h * 0.5, h * 0.25, h * 0.5, h * 0.5, h * 0.25, -h * 0.5];

    for (let i = 0; i < total; i++) {
      const s  = allSegs[i];
      const dx = s.e[0] - s.s[0];
      const dz = s.e[2] - s.s[2];
      const len = Math.sqrt(dx*dx + dz*dz);
      if (len < 1e-9) continue; // safety only — allSegs pre-filter guarantees len >= nozzleDiameter*0.4

      const nx = -dz / len;  // normal across bead width
      const nz =  dx / len;

      const vb = i * vertsPerSeg;
      const y0 = s.s[1]; // layer center Y

      // Start end (vi=0..5) and finish end (vi=6..11)
      for (let p = 0; p < PROFILE; p++) {
        const across = px[p];
        const up     = py[p];

        // start end
        positions[(vb + p) * 3 + 0] = s.s[0] + nx * across;
        positions[(vb + p) * 3 + 1] = y0 + up;
        positions[(vb + p) * 3 + 2] = s.s[2] + nz * across;

        // finish end
        positions[(vb + PROFILE + p) * 3 + 0] = s.e[0] + nx * across;
        positions[(vb + PROFILE + p) * 3 + 1] = y0 + up;
        positions[(vb + PROFILE + p) * 3 + 2] = s.e[2] + nz * across;
      }

      // Build quads along the extrusion (connecting start ring to end ring)
      const ib = i * idxPerSeg;
      let ti = 0;
      for (let p = 0; p < PROFILE - 1; p++) {
        const a = vb + p;
        const b = vb + p + 1;
        const c = vb + PROFILE + p + 1;
        const d = vb + PROFILE + p;
        indices[ib + ti++] = a; indices[ib + ti++] = b; indices[ib + ti++] = c;
        indices[ib + ti++] = a; indices[ib + ti++] = c; indices[ib + ti++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    return geo;
  }, [allSegs, beadW, beadH]);

  useEffect(() => {
    if (!fullGeo) return;
    const idxPerSeg = (6 - 1) * 2 * 3; // 30 — (PROFILE-1) quads × 2 tris × 3 indices
    if (progress >= 1) {
      fullGeo.setDrawRange(0, Infinity);
    } else {
      // segIdx + 1: draw all indices up to and including the current segment.
      // Without +1, segment segIdx itself is excluded (off-by-one missing bead).
      fullGeo.setDrawRange(0, (segIdx + 1) * idxPerSeg);
    }
  }, [fullGeo, progress, segIdx, allSegs.length]);

  return (
    <group>
      {fullGeo && (
        <mesh geometry={fullGeo}>
          <meshStandardMaterial
            color={pathColor}
            roughness={0.92}
            metalness={0.0}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Nozzle head */}
      <group position={nozzle}>
        <mesh rotation={[-Math.PI/2,0,0]}>
          <ringGeometry args={[beadW*0.6, beadW*1.2, 24]}/>
          <meshBasicMaterial color={pathColor} transparent opacity={0.4}/>
        </mesh>
        <mesh>
          <sphereGeometry args={[beadW*0.5, 16, 16]}/>
          <meshBasicMaterial color="#ffffff"/>
        </mesh>
        <mesh position={[0, -beadH*0.5, 0]}>
          <sphereGeometry args={[beadW*0.3, 10, 10]}/>
          <meshBasicMaterial color={pathColor} transparent opacity={0.9}/>
        </mesh>
      </group>
    </group>
  );
}

// ── Camera controller ─────────────────────────────────────────────────────────

function CameraController({ snap, site }: { snap: string|null; site: SiteDimensions }) {
  const { camera } = useThree();
  const d = Math.max(site.width||12, site.length||10) * 1.5;
  useEffect(() => {
    if (!snap) return;
    const t: Record<string,[number,number,number]> = {
      top:         [0,d*2.2,0.001], front:[0,d*0.4,d*1.3],
      right:       [d*1.3,d*0.4,0], left:[-d*1.3,d*0.4,0],
      back:        [0,d*0.4,-d*1.3], perspective:[d*0.9,d*0.6,d*0.9],
    };
    if (t[snap]) { camera.position.set(...t[snap]); camera.lookAt(0,0,0); }
  }, [snap, d, camera]);
  return null;
}

// ── Scene ─────────────────────────────────────────────────────────────────────

function Scene({ fileUrl, fileExt, toolpath, layerHeight, animProgress, mode, site, modelScale,
  snap, enableTransform, transformMode, orbitRef, sitePlan, pathColor, nozzleDiameter = 0.025,
  showModel = true, showToolpath = true }: {
  fileUrl: string|null; fileExt: string; toolpath: Layer[];
  layerHeight: number; animProgress: number; mode: ViewMode;
  site: SiteDimensions; modelScale: number; snap: string|null;
  enableTransform: boolean; transformMode: TransformMode; orbitRef: React.RefObject<any>;
  sitePlan?: import('./SitePlanReader').SitePlanData | null;
  pathColor?: string;
  nozzleDiameter?: number;
  showModel?: boolean;
  showToolpath?: boolean;
}) {
  const isVoid = mode !== 'environment';
  const isDark = mode === 'void-dark';

  return (
    <>
      <ambientLight intensity={isVoid ? (isDark?0.4:0.8) : 0.7}/>
      <directionalLight position={[15,25,15]} intensity={isVoid?1.0:2.0} castShadow
        shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-camera-far={200} shadow-camera-left={-60} shadow-camera-right={60}
        shadow-camera-top={60} shadow-camera-bottom={-60}
      />
      <directionalLight position={[-10,15,-10]} intensity={0.5} color="#b8d4ff"/>

      {mode === 'environment' && (
        <>
          <SkySphere/>
          <fog attach="fog" args={['#c8e8f8',80,400]}/>
        </>
      )}
      {isVoid && <VoidGrid dark={isDark}/>}

      <SiteGround site={site} mode={mode} sitePlan={sitePlan}/>

      {fileUrl && showModel && (
        <ModelLoader
          fileUrl={fileUrl} fileExt={fileExt}
          opacity={toolpath.length > 0 && animProgress < 1 ? 0.3 : 1.0}
          scale={modelScale}
          enableTransform={enableTransform} transformMode={transformMode}
          orbitRef={orbitRef}
        />
      )}

      {toolpath.length > 0 && showToolpath && (
        <PrinterAnimation toolpath={toolpath} layerHeight={layerHeight} progress={animProgress} pathColor={pathColor} nozzleDiameter={nozzleDiameter}/>
      )}

      <CameraController snap={snap} site={site}/>
      <OrbitControls ref={orbitRef} enablePan enableZoom enableRotate
        maxPolarAngle={Math.PI/1.85} minDistance={1} maxDistance={300}/>

      <GizmoHelper alignment="bottom-left" margin={[72, 72]}>
        <GizmoViewport axisColors={['#ef4444','#22c55e','#3b82f6']} labelColor="white" hideNegativeAxes={false}/>
      </GizmoHelper>
    </>
  );
}

// ── Playback bar ──────────────────────────────────────────────────────────────

function PlaybackBar({
  progress, isPlaying,
  onReset, onToggle, onEnd, onScrub,
  mode, onModeChange, pathColor, onPathColorChange,
  showModel, onShowModel, showToolpath, onShowToolpath,
}: {
  progress: number; isPlaying: boolean;
  onReset: ()=>void; onToggle: ()=>void; onEnd: ()=>void; onScrub:(v:number)=>void;
  mode: ViewMode; onModeChange:(m:ViewMode)=>void;
  pathColor: string; onPathColorChange:(c:string)=>void;
  showModel: boolean; onShowModel:(v:boolean)=>void;
  showToolpath: boolean; onShowToolpath:(v:boolean)=>void;
}) {
  return (
    <div className="rounded-xl overflow-hidden" style={{background:'rgba(6,6,10,0.85)',backdropFilter:'blur(20px)',border:'1px solid rgba(255,255,255,0.07)'}}>
      {/* Progress track */}
      <div className="h-px bg-white/8">
        <div className="h-full transition-all duration-75" style={{width:`${progress}%`,background:pathColor}}/>
      </div>

      <div className="flex items-center gap-2 px-3 py-2">
        {/* Scrubber + % */}
        <input type="range" min={0} max={100} value={progress}
          onChange={e=>onScrub(Number(e.target.value)/100)}
          className="w-24 appearance-none h-0.5 rounded-full bg-white/10 cursor-pointer flex-shrink-0"
        />
        <span className="text-[10px] font-mono text-white/35 w-7 tabular-nums">{progress}%</span>

        <div className="w-px h-3 bg-white/10 mx-0.5"/>

        {/* Transport */}
        <button onClick={onReset} className="w-6 h-6 flex items-center justify-center text-white/30 hover:text-white transition-colors text-sm">⟲</button>
        <button onClick={onToggle}
          className={`flex items-center gap-1 px-3 h-6 rounded-lg text-[11px] font-semibold transition-all ${isPlaying?'bg-white/10 text-white':'bg-white text-black'}`}>
          {isPlaying ? (
            <><svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>Pause</>
          ) : progress >= 1 ? (
            <><svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>Replay</>
          ) : (
            <><svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Play</>
          )}
        </button>
        <button onClick={onEnd} className="w-6 h-6 flex items-center justify-center text-white/30 hover:text-white transition-colors">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
        </button>

        <div className="w-px h-3 bg-white/10 mx-0.5"/>

        {/* View mode */}
        <div className="flex items-center gap-px">
          {([{id:'environment' as ViewMode,l:'Env'},{id:'void-dark' as ViewMode,l:'Dark'},{id:'void-light' as ViewMode,l:'Light'}]).map(o=>(
            <button key={o.id} onClick={()=>onModeChange(o.id)}
              className={`px-2 py-1 text-[9px] font-medium rounded-md transition-all ${mode===o.id?'text-white bg-white/12':'text-white/25 hover:text-white/60'}`}>
              {o.l}
            </button>
          ))}
        </div>

        <div className="w-px h-3 bg-white/10 mx-0.5"/>

        {/* Layer toggles */}
        <button onClick={()=>onShowModel(!showModel)}
          className={`px-2 py-1 text-[9px] font-medium rounded-md transition-all ${showModel?'text-white bg-white/12':'text-white/25'}`}>
          Model
        </button>
        <button onClick={()=>onShowToolpath(!showToolpath)}
          className={`px-2 py-1 text-[9px] font-medium rounded-md transition-all ${showToolpath?'text-white bg-white/12':'text-white/25'}`}>
          Path
        </button>

        <div className="w-px h-3 bg-white/10 mx-0.5"/>

        {/* Color picker */}
        <label className="relative cursor-pointer flex items-center gap-1.5 group">
          <span className="text-[9px] text-white/25 group-hover:text-white/50 transition-colors">Colour</span>
          <div className="w-4 h-4 rounded-full border border-white/20 group-hover:border-white/40 transition-colors" style={{background:pathColor}}/>
          <input type="color" value={pathColor} onChange={e=>onPathColorChange(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"/>
        </label>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LayerVisualization({
  file, toolpath, numLayers, layerHeight, nozzleDiameter, site, fullscreen,
  externalMode, onModeChange, modelScale: extScale, sitePlan, modelDimensions,
}: LayerVisualizationProps) {
  const [internalMode,    setInternalMode]    = useState<ViewMode>('environment');
  const [animProgress,    setAnimProgress]    = useState(0);
  const [isPlaying,       setIsPlaying]       = useState(false);
  const [fileUrl,         setFileUrl]         = useState<string|null>(null);
  const [snap,            setSnap]            = useState<string|null>(null);
  const [internalScale,   setInternalScale]   = useState(1.0);
  const [enableTransform, setEnableTransform] = useState(false);
  const [transformMode,   setTransformMode]   = useState<TransformMode>('translate');
  const [pathColor,       setPathColor]       = useState('#c8bfb0');
  const [showModel,       setShowModel]       = useState(true);
  const [showToolpath,    setShowToolpath]    = useState(true);
  const orbitRef = useRef<any>(null);
  const rafRef   = useRef<number|null>(null);
  const lastTRef = useRef<number|null>(null);

  const mode       = externalMode ?? internalMode;
  const setMode    = (m: ViewMode) => { setInternalMode(m); onModeChange?.(m); };
  const modelScale = extScale ?? internalScale;
  const fileExt    = file?.name.split('.').pop()?.toLowerCase() ?? 'stl';
  const resolvedSite = site ?? { width:12, length:10, slope:0 };
  const totalSegs    = useMemo(()=>toolpath.reduce((a,l)=>a+l.length,0),[toolpath]);
  const animDuration = useMemo(()=>Math.min(Math.max(totalSegs*0.05,5),120),[totalSegs]);

  useEffect(()=>{
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEnableTransform(false);
      if (!e.ctrlKey && !e.metaKey) {
        if (e.key==='t'||e.key==='T') setEnableTransform(v=>!v);
        if (e.key==='g'||e.key==='G') setTransformMode('translate');
        if (e.key==='r'||e.key==='R') setTransformMode('rotate');
        if (e.key==='s'||e.key==='S') setTransformMode('scale');
      }
      if (e.key===' ' && toolpath.length>0) { e.preventDefault(); setIsPlaying(p=>!p); }
    };
    window.addEventListener('keydown', handler);
    return ()=>window.removeEventListener('keydown', handler);
  },[fullscreen, toolpath.length]);

  useEffect(()=>{
    if (!file) return;
    const url = URL.createObjectURL(file);
    setFileUrl(url); setAnimProgress(0); setIsPlaying(false);
    return ()=>URL.revokeObjectURL(url);
  },[file]);

  useEffect(()=>{
    if (toolpath.length>0){
      setAnimProgress(0);
      const t = setTimeout(()=>setIsPlaying(true),500);
      return ()=>clearTimeout(t);
    }
  },[toolpath.length]);

  useEffect(()=>{
    if (isPlaying){
      const tick = (ts:number)=>{
        if (lastTRef.current===null) lastTRef.current=ts;
        const dt=(ts-lastTRef.current)/1000;
        lastTRef.current=ts;
        setAnimProgress(p=>{
          const next=p+dt/animDuration;
          if(next>=1){setIsPlaying(false);lastTRef.current=null;return 1;}
          return next;
        });
        rafRef.current=requestAnimationFrame(tick);
      };
      rafRef.current=requestAnimationFrame(tick);
    } else {
      lastTRef.current=null;
      if(rafRef.current)cancelAnimationFrame(rafRef.current);
    }
    return ()=>{if(rafRef.current)cancelAnimationFrame(rafRef.current);};
  },[isPlaying,animDuration]);

  const progress = Math.round(animProgress*100);
  const bgMap: Record<ViewMode,string> = {
    'environment': '#7ec8e3',
    'void-dark':   '#060606',
    'void-light':  '#d8d8d8',
  };
  const bg = bgMap[mode];

  // ── Compact (setup tab) ───────────────────────────────────────────────────

  if (!fullscreen) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-sm font-semibold text-black">3D Preview</h3>
            <p className="text-[11px] text-black/40 mt-0.5">
              {file ? file.name : 'Upload a model'} · {resolvedSite.width}m × {resolvedSite.length}m
              {resolvedSite.slope > 0 ? ` · ${resolvedSite.slope}°` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1 bg-gray-50 border border-gray-100 rounded-xl p-1">
            {([
              {id:'environment' as ViewMode, l:'Env'},
              {id:'void-dark'   as ViewMode, l:'Dark'},
              {id:'void-light'  as ViewMode, l:'Light'},
            ]).map(m=>(
              <button key={m.id} onClick={()=>setMode(m.id)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  mode===m.id?'bg-black text-white':'text-black/40 hover:text-black'
                }`}>{m.l}</button>
            ))}
          </div>
        </div>
        <div className="relative" style={{height:340,background:bg}}>
          <Canvas shadows gl={{antialias:true}}>
            <Scene fileUrl={fileUrl} fileExt={fileExt} toolpath={[]} layerHeight={0.04}
              animProgress={0} mode={mode} site={resolvedSite} modelScale={modelScale}
              snap={null} enableTransform={false} transformMode="translate" orbitRef={orbitRef} sitePlan={sitePlan} pathColor={pathColor}/>
          </Canvas>
          <div className="absolute bottom-3 right-3 px-2 py-1 bg-black/40 backdrop-blur-md rounded-lg">
            <span className="text-white/40 text-[10px]">Drag · scroll</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Full-screen results ───────────────────────────────────────────────────

  const panelW = 318;

  return (
    <div className="absolute inset-0">
      <Canvas shadows
        gl={{antialias:true,toneMapping:THREE.ACESFilmicToneMapping,toneMappingExposure:1.1}}
        style={{background:bg}}>
        <Scene fileUrl={fileUrl} fileExt={fileExt} toolpath={toolpath} layerHeight={layerHeight||0.04}
          animProgress={animProgress} mode={mode} site={resolvedSite} modelScale={modelScale}
          snap={snap} enableTransform={enableTransform} transformMode={transformMode}
          orbitRef={orbitRef} sitePlan={sitePlan} pathColor={pathColor}
          nozzleDiameter={nozzleDiameter ?? 0.025}
          showModel={showModel} showToolpath={showToolpath}/>
      </Canvas>

      {/* Top-left controls */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-1.5">
        <div className="flex items-center gap-0.5 p-0.5 rounded-xl border border-white/10"
          style={{background:'rgba(0,0,0,0.5)',backdropFilter:'blur(12px)'}}>
          {([
            {id:'environment' as ViewMode,label:'Environment'},
            {id:'void-dark'   as ViewMode,label:'Void Dark'},
            {id:'void-light'  as ViewMode,label:'Void Light'},
          ]).map(opt=>(
            <button key={opt.id} onClick={()=>setMode(opt.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                mode===opt.id?'bg-white text-black shadow-sm':'text-white/50 hover:text-white'
              }`}>{opt.label}</button>
          ))}
        </div>

        <div className="px-3 py-1.5 rounded-xl border border-white/8 space-y-0.5"
          style={{background:'rgba(0,0,0,0.4)',backdropFilter:'blur(10px)'}}>
          <span className="text-white/40 text-[10px] font-mono block">
            {resolvedSite.width}m × {resolvedSite.length}m
            {resolvedSite.slope>0?` · ${resolvedSite.slope}°`:''}
          </span>
          {modelDimensions && (
            <span className="text-white/60 text-[10px] font-mono block">
              L {(modelDimensions.x*1000).toFixed(0)}mm ·{' '}
              W {(modelDimensions.y*1000).toFixed(0)}mm ·{' '}
              H {(modelDimensions.z*1000).toFixed(0)}mm
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 p-0.5 rounded-xl border border-white/8"
          style={{background:'rgba(0,0,0,0.5)',backdropFilter:'blur(12px)'}}>
          <button onClick={()=>setShowModel(v=>!v)}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-lg transition-all ${
              showModel?'bg-white/15 text-white':'text-white/30 hover:text-white/60'
            }`}>Model</button>
          <button onClick={()=>setShowToolpath(v=>!v)}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-lg transition-all ${
              showToolpath?'bg-white/15 text-white':'text-white/30 hover:text-white/60'
            }`}>Toolpath</button>
        </div>
      </div>

      {/* Transform controls */}
      <div className="absolute top-24 left-4 z-10">
        <div className="rounded-xl border border-white/8 overflow-hidden"
          style={{background:'rgba(0,0,0,0.5)',backdropFilter:'blur(12px)',minWidth:120}}>
          <button onClick={()=>setEnableTransform(v=>!v)}
            className={`w-full px-3 py-2 text-[11px] font-medium transition-all flex items-center gap-2 ${
              enableTransform?'text-white bg-white/10':'text-white/40 hover:text-white'
            }`}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"/>
            </svg>
            {enableTransform ? 'Transform On' : 'Transform'}
          </button>
          <AnimatePresence>
            {enableTransform && (
              <motion.div initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}}
                className="border-t border-white/8">
                {([
                  {m:'translate' as TransformMode, label:'Move', key:'G'},
                  {m:'rotate'    as TransformMode, label:'Rotate', key:'R'},
                  {m:'scale'     as TransformMode, label:'Scale', key:'S'},
                ]).map(opt=>(
                  <button key={opt.m} onClick={()=>setTransformMode(opt.m)}
                    className={`w-full px-3 py-1.5 text-[10px] flex items-center justify-between transition-colors ${
                      transformMode===opt.m?'text-white bg-white/8':'text-white/30 hover:text-white/60'
                    }`}>
                    <span>{opt.label}</span>
                    <span className="text-[9px] font-mono text-white/20">[{opt.key}]</span>
                  </button>
                ))}
                <div className="px-3 py-1.5 border-t border-white/6">
                  <p className="text-[9px] text-white/15 font-mono">Esc to exit · T toggle</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      

      {/* Playback bar */}
      {toolpath.length > 0 && (
        <div className="absolute bottom-3 left-4 right-4 z-10 flex justify-center">
          <div className="w-full max-w-3xl">
            <PlaybackBar
              progress={progress} isPlaying={isPlaying}
              onReset={()=>{setAnimProgress(0);setIsPlaying(false);}}
              onToggle={()=>setIsPlaying(p=>!p)}
              onEnd={()=>{setIsPlaying(false);setAnimProgress(1);}}
              onScrub={v=>{setIsPlaying(false);setAnimProgress(v);}}
              mode={mode} onModeChange={setMode}
              pathColor={pathColor} onPathColorChange={setPathColor}
              showModel={showModel} onShowModel={setShowModel}
              showToolpath={showToolpath} onShowToolpath={setShowToolpath}
            />
          </div>
        </div>
      )}

      {!toolpath.length && (
        <div className="absolute bottom-4 right-4 z-10 px-2 py-1 bg-black/40 backdrop-blur-md rounded-lg"
          style={{right:panelW+16}}>
          <span className="text-white/25 text-[10px]">Drag · scroll · right-click pan</span>
        </div>
      )}
    </div>
  );
}
