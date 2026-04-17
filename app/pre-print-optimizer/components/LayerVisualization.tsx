'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Line, TransformControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'framer-motion';

interface Segment { x0: number; y0: number; x1: number; y1: number; gap?: boolean; }
type Layer         = Segment[];
type ViewMode      = 'environment' | 'dark' | 'light';
type TimeOfDay     = 'morning' | 'noon' | 'sunset';
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

// ── Time-of-day configs ───────────────────────────────────────────────────────

const TOD_CONFIG: Record<TimeOfDay, {
  skyTop: string; skyMid: string; skyHorizon: string;
  fog: string; fogNear: number; fogFar: number;
  ambientIntensity: number; ambientColor: string;
  sunColor: string; sunIntensity: number; sunPosition: [number,number,number];
  sunSphereColor: string; sunHaloColor: string;
  groundColor: string; groundFar: string;
}> = {
  morning: {
    skyTop:'#2e6fa8', skyMid:'#e8a44a', skyHorizon:'#f5d08a',
    fog:'#f0d4a0', fogNear:70, fogFar:320,
    ambientIntensity:0.55, ambientColor:'#ffe8c0',
    sunColor:'#ffcc55', sunIntensity:1.6, sunPosition:[18,7,28],
    sunSphereColor:'#ffe066', sunHaloColor:'#ffcc4488',
    groundColor:'#4a7a3a', groundFar:'#3d6b2e',
  },
  noon: {
    skyTop:'#1565b8', skyMid:'#3a8fd4', skyHorizon:'#87ceeb',
    fog:'#c8e8f8', fogNear:90, fogFar:420,
    ambientIntensity:0.75, ambientColor:'#ffffff',
    sunColor:'#fff8f0', sunIntensity:2.4, sunPosition:[8,55,12],
    sunSphereColor:'#fffde8', sunHaloColor:'#ffff9944',
    groundColor:'#4a7a3a', groundFar:'#3d6b2e',
  },
  sunset: {
    skyTop:'#1a2466', skyMid:'#c44a20', skyHorizon:'#f07830',
    fog:'#b04818', fogNear:35, fogFar:180,
    ambientIntensity:0.38, ambientColor:'#ffaa55',
    sunColor:'#ff7722', sunIntensity:1.1, sunPosition:[45,4,18],
    sunSphereColor:'#ff9944', sunHaloColor:'#ff550066',
    groundColor:'#3a5c28', groundFar:'#2e4820',
  },
};

// ── Sky sphere with 3-stop gradient ──────────────────────────────────────────

function SkySphere({ tod }: { tod: TimeOfDay }) {
  const cfg = TOD_CONFIG[tod];

  const geo = useMemo(() => {
    const g = new THREE.SphereGeometry(480, 32, 24);
    const pos    = g.attributes.position;
    const colors: number[] = [];
    const topC  = new THREE.Color(cfg.skyTop);
    const midC  = new THREE.Color(cfg.skyMid);
    const horC  = new THREE.Color(cfg.skyHorizon);
    for (let i = 0; i < pos.count; i++) {
      const y   = pos.getY(i);
      const t   = (y + 480) / 480; // 0 = bottom, 1 = top
      let c: THREE.Color;
      if (t > 0.35) {
        c = midC.clone().lerp(topC, (t - 0.35) / 0.65);
      } else {
        c = horC.clone().lerp(midC, t / 0.35);
      }
      colors.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    return g;
  }, [tod]);

  return (
    <mesh>
      <primitive object={geo} attach="geometry" />
      <meshBasicMaterial vertexColors side={THREE.BackSide} />
    </mesh>
  );
}

// ── Sun with halo ─────────────────────────────────────────────────────────────

function Sun({ tod }: { tod: TimeOfDay }) {
  const cfg = TOD_CONFIG[tod];
  const [px, py, pz] = cfg.sunPosition;
  const dist = 210;
  const len  = Math.sqrt(px*px + py*py + pz*pz);
  const sx   = (px/len)*dist, sy = (py/len)*dist, sz = (pz/len)*dist;
  const radius = tod === 'sunset' ? 11 : tod === 'morning' ? 9 : 7;

  return (
    <group position={[sx, sy, sz]}>
      {/* Halo glow — large soft sphere */}
      <mesh>
        <sphereGeometry args={[radius * 2.8, 16, 16]} />
        <meshBasicMaterial color={cfg.sunHaloColor} transparent opacity={0.18} depthWrite={false}/>
      </mesh>
      {/* Inner glow */}
      <mesh>
        <sphereGeometry args={[radius * 1.5, 16, 16]} />
        <meshBasicMaterial color={cfg.sunHaloColor} transparent opacity={0.35} depthWrite={false}/>
      </mesh>
      {/* Sun disc */}
      <mesh>
        <sphereGeometry args={[radius, 24, 16]} />
        <meshBasicMaterial color={cfg.sunSphereColor}/>
      </mesh>
    </group>
  );
}

// ── Cirrus clouds (wispy streaks like the reference photo) ───────────────────

function CirrusCloud({ position, rotation, length, width, opacity }: {
  position: [number,number,number];
  rotation: number;
  length: number;
  width: number;
  opacity: number;
}) {
  const geo = useMemo(() => {
    // Build a wispy streak from many tiny overlapping ellipsoids along a curved path
    const g = new THREE.BufferGeometry();
    const verts: number[] = [];
    const norms: number[] = [];
    const uvs:   number[] = [];
    const tris:  number[] = [];

    const segments = 18;
    const slices   = 6;

    for (let s = 0; s <= segments; s++) {
      const t     = s / segments;
      // Gentle curve — sine gives a natural wisp shape
      const x     = (t - 0.5) * length;
      const y     = Math.sin(t * Math.PI) * width * 0.18;
      const z     = 0;
      // Width tapers at both ends (wider in middle)
      const w     = width * Math.sin(t * Math.PI) * 0.5;

      for (let sl = 0; sl <= slices; sl++) {
        const angle = (sl / slices) * Math.PI * 2;
        const nx    = 0;
        const ny    = Math.cos(angle);
        const nz    = Math.sin(angle);
        verts.push(x, y + ny * w * 0.25, z + nz * w);
        norms.push(nx, ny, nz);
        uvs.push(t, sl / slices);
      }
    }

    for (let s = 0; s < segments; s++) {
      for (let sl = 0; sl < slices; sl++) {
        const a = s * (slices + 1) + sl;
        const b = a + 1;
        const c = a + (slices + 1);
        const d = c + 1;
        tris.push(a, b, c, b, d, c);
      }
    }

    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    g.setAttribute('normal',   new THREE.BufferAttribute(new Float32Array(norms), 3));
    g.setAttribute('uv',       new THREE.BufferAttribute(new Float32Array(uvs),   2));
    g.setIndex(tris);
    g.computeVertexNormals();
    return g;
  }, [length, width]);

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh geometry={geo}>
        <meshBasicMaterial color="#ffffff" transparent opacity={opacity} depthWrite={false}/>
      </mesh>
      {/* Secondary wisp — offset and rotated slightly for layered look */}
      <mesh geometry={geo} rotation={[0.08, 0.05, 0]} position={[length*0.05, width*0.1, 0]}>
        <meshBasicMaterial color="#f0f4ff" transparent opacity={opacity * 0.45} depthWrite={false}/>
      </mesh>
    </group>
  );
}

function Clouds({ tod }: { tod: TimeOfDay }) {
  // Reduced opacity at sunset for warm haze feel
  const baseOpacity = tod === 'sunset' ? 0.28 : tod === 'morning' ? 0.38 : 0.45;

  const cirrus = useMemo(() => [
    // pos [x,y,z], yaw rotation, length, width, opacity multiplier
    { pos: [-40, 55, -120] as [number,number,number], rot: 0.3,  len: 55, w: 6,  o: 1.0  },
    { pos: [ 30, 60, -140] as [number,number,number], rot:-0.15, len: 70, w: 7,  o: 0.85 },
    { pos: [ 80, 50, -100] as [number,number,number], rot: 0.5,  len: 40, w: 5,  o: 0.7  },
    { pos: [-80, 58, -90]  as [number,number,number], rot:-0.4,  len: 48, w: 5,  o: 0.6  },
    { pos: [  5, 65, -160] as [number,number,number], rot: 0.1,  len: 80, w: 8,  o: 0.5  },
    { pos: [-20, 52, -75]  as [number,number,number], rot: 0.7,  len: 35, w: 4,  o: 0.4  },
    { pos: [ 60, 62, -130] as [number,number,number], rot:-0.25, len: 50, w: 6,  o: 0.55 },
  ], []);

  return (
    <>
      {cirrus.map((c, i) => (
        <CirrusCloud key={i}
          position={c.pos} rotation={c.rot}
          length={c.len} width={c.w}
          opacity={baseOpacity * c.o}
        />
      ))}
    </>
  );
}

// ── Ground ────────────────────────────────────────────────────────────────────

import type { SitePlanData } from './SitePlanReader';

function SiteGround({ site, mode, sitePlan, tod }: {
  site: SiteDimensions; mode: ViewMode; sitePlan?: SitePlanData | null; tod: TimeOfDay;
}) {
  const w = Math.max(site.width  || 12, 2);
  const l = Math.max(site.length || 10, 2);
  const slopeRad = (site.slope * Math.PI) / 180;
  const isEnv  = mode === 'environment';
  const isDark = mode === 'dark';
  const cfg    = TOD_CONFIG[tod];

  const groundColor  = isEnv ? cfg.groundColor  : (isDark ? '#141414' : '#e8e8e8');
  const groundFar    = isEnv ? cfg.groundFar     : (isDark ? '#080808' : '#d8d8d8');
  const borderColor  = isDark ? '#22c55e'        : isEnv ? '#5a9a4a' : '#555';

  const house = sitePlan?.house;
  const hx = house ? (house.offset_x - 0.5) * w : 0;
  const hz = house ? (house.offset_z - 0.5) * l : 0;
  const hw  = house?.width  ?? 0;
  const hl  = house?.length ?? 0;

  return (
    <group rotation={[slopeRad, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[w, l]} />
        <meshStandardMaterial color={groundColor} roughness={0.9}/>
      </mesh>

      {([
        [[-w/2,0.015,-l/2],[w/2,0.015,-l/2]],
        [[w/2,0.015,-l/2],[w/2,0.015,l/2]],
        [[w/2,0.015,l/2],[-w/2,0.015,l/2]],
        [[-w/2,0.015,l/2],[-w/2,0.015,-l/2]],
      ] as [number,number,number][][]).map((pts,i)=>(
        <Line key={i} points={pts} color={borderColor} lineWidth={1.5}/>
      ))}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]} receiveShadow>
        <planeGeometry args={[w * 10, l * 10]} />
        <meshStandardMaterial color={groundFar} roughness={0.95}/>
      </mesh>

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
        <Line points={[[0,0.05,-l*0.35],[0,0.05,l*0.35]] as [number,number,number][]} color="#f59e0b" lineWidth={2}/>
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

// ── Error boundary ────────────────────────────────────────────────────────────
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

// ── Printer animation ─────────────────────────────────────────────────────────
// Uses InstancedMesh + BoxGeometry: one solid box per bead, zero open ends,
// zero gaps between layers. count controls animation instead of drawRange.

function PrinterAnimation({ toolpath, layerHeight, progress, pathColor = '#c8bfb0', nozzleDiameter = 0.025 }: {
  toolpath: Layer[]; layerHeight: number; progress: number; pathColor?: string; nozzleDiameter?: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const allSegs = useMemo(() => {
    const out: { s: [number,number,number]; e: [number,number,number] }[] = [];
    const minLen = nozzleDiameter * 0.5;
    const minLen2 = minLen * minLen;
    toolpath.forEach((layer, li) => {
      const y = (li + 0.5) * layerHeight;
      layer.forEach(seg => {
        if (seg.gap) return;
        const dx = seg.x1 - seg.x0, dy = seg.y1 - seg.y0;
        if (dx * dx + dy * dy < minLen2) return;
        out.push({ s: [seg.x0, y, -seg.y0], e: [seg.x1, y, -seg.y1] });
      });
    });
    return out;
  }, [toolpath, layerHeight, nozzleDiameter]);

  const beadW = nozzleDiameter * 0.88;
  // 1.3× layer height: 30% overlap keeps it gap-free while leaving the top edge of
  // each box protruding 0.15×lh above the next layer's base — the ridge that gives
  // 3DCP its characteristic horizontal texture (visible in real concrete prints).
  const beadH = layerHeight * 1.3;

  // Set instance transforms whenever segments change
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || allSegs.length === 0) return;
    const dummy = new THREE.Object3D();
    allSegs.forEach((seg, i) => {
      const dx = seg.e[0] - seg.s[0], dz = seg.e[2] - seg.s[2];
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 1e-9) return;
      dummy.position.set((seg.s[0] + seg.e[0]) / 2, seg.s[1], (seg.s[2] + seg.e[2]) / 2);
      dummy.rotation.set(0, Math.atan2(dx, dz), 0);
      dummy.scale.set(beadW, beadH, len);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [allSegs, beadW, beadH]);

  // Drive animation by setting visible instance count
  useEffect(() => {
    if (!meshRef.current) return;
    const n = allSegs.length;
    meshRef.current.count = progress >= 1
      ? n
      : Math.min(Math.floor(progress * n) + 1, n);
  }, [progress, allSegs.length]);

  const rawIdx = progress * allSegs.length;
  const segIdx = Math.min(Math.floor(rawIdx), allSegs.length - 1);
  const cur    = allSegs[segIdx];
  const frac   = rawIdx - segIdx;

  if (allSegs.length === 0) return null;

  const nozzlePos: [number,number,number] = cur ? [
    cur.s[0] + (cur.e[0] - cur.s[0]) * frac,
    cur.s[1] + layerHeight * 0.5,
    cur.s[2] + (cur.e[2] - cur.s[2]) * frac,
  ] : [0, 0, 0];

  return (
    <group>
      {/* key forces remount when segment count changes (new optimise result) */}
      <instancedMesh key={allSegs.length} ref={meshRef} args={[undefined, undefined, Math.max(allSegs.length, 1)]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={pathColor} roughness={0.96} metalness={0.0} />
      </instancedMesh>

      {cur && (
        <mesh position={nozzlePos}>
          <sphereGeometry args={[beadW * 0.5, 12, 12]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      )}
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
      top:[0,d*2.2,0.001], front:[0,d*0.4,d*1.3],
      right:[d*1.3,d*0.4,0], left:[-d*1.3,d*0.4,0],
      back:[0,d*0.4,-d*1.3], perspective:[d*0.9,d*0.6,d*0.9],
    };
    if (t[snap]) { camera.position.set(...t[snap]); camera.lookAt(0,0,0); }
  }, [snap, d, camera]);
  return null;
}

// ── Scene ─────────────────────────────────────────────────────────────────────

function Scene({ fileUrl, fileExt, toolpath, layerHeight, animProgress, mode, site, modelScale,
  snap, enableTransform, transformMode, orbitRef, sitePlan, pathColor, nozzleDiameter = 0.025,
  tod = 'noon', showModel = true, showToolpath = true }: {
  fileUrl: string|null; fileExt: string; toolpath: Layer[];
  layerHeight: number; animProgress: number; mode: ViewMode;
  site: SiteDimensions; modelScale: number; snap: string|null;
  enableTransform: boolean; transformMode: TransformMode; orbitRef: React.RefObject<any>;
  sitePlan?: import('./SitePlanReader').SitePlanData | null;
  pathColor?: string; nozzleDiameter?: number; tod?: TimeOfDay;
  showModel?: boolean; showToolpath?: boolean;
}) {
  const isEnv = mode === 'environment';
  const isDark = mode === 'dark';
  const cfg = TOD_CONFIG[tod];

  return (
    <>
      {isEnv ? (
        <>
          <ambientLight intensity={cfg.ambientIntensity} color={cfg.ambientColor}/>
          <directionalLight position={cfg.sunPosition} intensity={cfg.sunIntensity} color={cfg.sunColor} castShadow
            shadow-mapSize-width={2048} shadow-mapSize-height={2048}
            shadow-camera-far={200} shadow-camera-left={-60} shadow-camera-right={60}
            shadow-camera-top={60} shadow-camera-bottom={-60}/>
          <directionalLight
            position={[-cfg.sunPosition[0]*0.4, 4, -cfg.sunPosition[2]*0.4]}
            intensity={cfg.sunIntensity * 0.12} color={cfg.ambientColor}/>
          <SkySphere tod={tod}/>
          <Sun tod={tod}/>
          <Clouds tod={tod}/>
          <fog attach="fog" args={[cfg.fog, cfg.fogNear, cfg.fogFar]}/>
        </>
      ) : (
        <>
          <ambientLight intensity={isDark ? 0.4 : 0.8}/>
          <directionalLight position={[15,25,15]} intensity={isDark ? 1.0 : 1.8} castShadow
            shadow-mapSize-width={2048} shadow-mapSize-height={2048}
            shadow-camera-far={200} shadow-camera-left={-60} shadow-camera-right={60}
            shadow-camera-top={60} shadow-camera-bottom={-60}/>
          <directionalLight position={[-10,15,-10]} intensity={0.4} color="#b8d4ff"/>
          <VoidGrid dark={isDark}/>
        </>
      )}

      <SiteGround site={site} mode={mode} sitePlan={sitePlan} tod={tod}/>

      {fileUrl && showModel && (
        <ModelLoader fileUrl={fileUrl} fileExt={fileExt}
          opacity={toolpath.length > 0 && animProgress < 1 ? 0.3 : 1.0}
          scale={modelScale} enableTransform={enableTransform}
          transformMode={transformMode} orbitRef={orbitRef}/>
      )}

      {toolpath.length > 0 && showToolpath && (
        <PrinterAnimation toolpath={toolpath} layerHeight={layerHeight} progress={animProgress}
          pathColor={pathColor} nozzleDiameter={nozzleDiameter}/>
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
  progress, isPlaying, onReset, onToggle, onEnd, onScrub,
  mode, onModeChange, tod, onTodChange,
  pathColor, onPathColorChange, showModel, onShowModel, showToolpath, onShowToolpath,
}: {
  progress: number; isPlaying: boolean;
  onReset: ()=>void; onToggle: ()=>void; onEnd: ()=>void; onScrub:(v:number)=>void;
  mode: ViewMode; onModeChange:(m:ViewMode)=>void;
  tod: TimeOfDay; onTodChange:(t:TimeOfDay)=>void;
  pathColor: string; onPathColorChange:(c:string)=>void;
  showModel: boolean; onShowModel:(v:boolean)=>void;
  showToolpath: boolean; onShowToolpath:(v:boolean)=>void;
}) {
  return (
    <div className="rounded-xl overflow-hidden" style={{background:'rgba(6,6,10,0.85)',backdropFilter:'blur(20px)',border:'1px solid rgba(255,255,255,0.07)'}}>
      <div className="h-px bg-white/8">
        <div className="h-full transition-all duration-75" style={{width:`${progress}%`,background:pathColor}}/>
      </div>
      <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
        <input type="range" min={0} max={100} value={progress}
          onChange={e=>onScrub(Number(e.target.value)/100)}
          className="w-24 appearance-none h-0.5 rounded-full bg-white/10 cursor-pointer flex-shrink-0"/>
        <span className="text-[10px] font-mono text-white/35 w-7 tabular-nums">{progress}%</span>
        <div className="w-px h-3 bg-white/10 mx-0.5"/>
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
          {([
            {id:'environment' as ViewMode, l:'Env'},
            {id:'dark'        as ViewMode, l:'Dark'},
            {id:'light'       as ViewMode, l:'Light'},
          ]).map(o=>(
            <button key={o.id} onClick={()=>onModeChange(o.id)}
              className={`px-2 py-1 text-[9px] font-medium rounded-md transition-all ${mode===o.id?'text-white bg-white/12':'text-white/25 hover:text-white/60'}`}>
              {o.l}
            </button>
          ))}
        </div>
        {/* Time of day — only in environment mode */}
        {mode === 'environment' && (
          <>
            <div className="w-px h-3 bg-white/10 mx-0.5"/>
            <div className="flex items-center gap-px">
              {([
                {id:'morning' as TimeOfDay, l:'🌅', title:'Morning'},
                {id:'noon'    as TimeOfDay, l:'☀️', title:'Noon'},
                {id:'sunset'  as TimeOfDay, l:'🌇', title:'Sunset'},
              ]).map(o=>(
                <button key={o.id} onClick={()=>onTodChange(o.id)} title={o.title}
                  className={`px-1.5 py-1 text-[11px] rounded-md transition-all ${tod===o.id?'bg-white/15':'text-white/40 hover:text-white/70'}`}>
                  {o.l}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="w-px h-3 bg-white/10 mx-0.5"/>
        <button onClick={()=>onShowModel(!showModel)}
          className={`px-2 py-1 text-[9px] font-medium rounded-md transition-all ${showModel?'text-white bg-white/12':'text-white/25'}`}>
          Model
        </button>
        <button onClick={()=>onShowToolpath(!showToolpath)}
          className={`px-2 py-1 text-[9px] font-medium rounded-md transition-all ${showToolpath?'text-white bg-white/12':'text-white/25'}`}>
          Path
        </button>
        <div className="w-px h-3 bg-white/10 mx-0.5"/>
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
  const [tod,             setTod]             = useState<TimeOfDay>('noon');
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
    'dark':        '#060606',
    'light':       '#d8d8d8',
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
              {id:'dark'        as ViewMode, l:'Dark'},
              {id:'light'       as ViewMode, l:'Light'},
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
              snap={null} enableTransform={false} transformMode="translate"
              orbitRef={orbitRef} sitePlan={sitePlan} pathColor={pathColor} tod={tod}/>
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
          nozzleDiameter={nozzleDiameter ?? 0.025} tod={tod}
          showModel={showModel} showToolpath={showToolpath}/>
      </Canvas>

      {/* Top-left controls */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-1.5">
        <div className="flex items-center gap-0.5 p-0.5 rounded-xl border border-white/10"
          style={{background:'rgba(0,0,0,0.5)',backdropFilter:'blur(12px)'}}>
          {([
            {id:'environment' as ViewMode, label:'Environment'},
            {id:'dark'        as ViewMode, label:'Dark'},
            {id:'light'       as ViewMode, label:'Light'},
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
              tod={tod} onTodChange={setTod}
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