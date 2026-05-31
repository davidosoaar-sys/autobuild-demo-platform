'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { useMemo } from 'react';

// Must match PT_TO_M in page.tsx — 1:50 real-world scale
const PT_TO_M = (0.0254 / 72) * 50;
const WALL_THICKNESS_M = 0.25;

type Seg = [[number, number], [number, number]];

function Walls({ segments, wallHeight }: { segments: Seg[]; wallHeight: number }) {
  const walls = useMemo(() => segments.flatMap((seg, i) => {
    const x0 = seg[0][0] * PT_TO_M, y0 = seg[0][1] * PT_TO_M;
    const x1 = seg[1][0] * PT_TO_M, y1 = seg[1][1] * PT_TO_M;
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return [];
    return [{
      i,
      x:   (x0 + x1) / 2,
      z:  -((y0 + y1) / 2),
      len,
      rot: -Math.atan2(dy, dx),
    }];
  }), [segments, wallHeight]);

  return (
    <>
      {walls.map(w => (
        <mesh key={w.i}
          position={[w.x, wallHeight / 2, w.z]}
          rotation={[0, w.rot, 0]}
          castShadow receiveShadow>
          <boxGeometry args={[w.len, wallHeight, WALL_THICKNESS_M]} />
          <meshStandardMaterial color="#d0c0a8" roughness={0.85} metalness={0.02} />
        </mesh>
      ))}
    </>
  );
}

interface WallViewerProps { segments: Seg[]; wallHeightMm: number; }

export default function WallViewer({ segments, wallHeightMm }: WallViewerProps) {
  const wallH = wallHeightMm / 1000;

  const { cx, cz, span } = useMemo(() => {
    if (!segments.length) return { cx: 0, cz: 0, span: 10 };
    const xs = segments.flatMap(s => [s[0][0] * PT_TO_M, s[1][0] * PT_TO_M]);
    const zs = segments.flatMap(s => [-(s[0][1] * PT_TO_M), -(s[1][1] * PT_TO_M)]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    return {
      cx:   (minX + maxX) / 2,
      cz:   (minZ + maxZ) / 2,
      span: Math.max(maxX - minX, maxZ - minZ, 10),
    };
  }, [segments]);

  const d   = span * 1.2;
  const cam: [number,number,number] = [cx + d * 0.6, wallH + d * 0.5, cz + d * 0.7];
  const tgt: [number,number,number] = [cx, wallH / 2, cz];

  return (
    <Canvas shadows camera={{ position: cam, fov: 50, near: 0.1, far: 5000 }}
      style={{ background: '#87ceeb', width: '100%', height: '100%' }}>
      <ambientLight intensity={0.55} color="#fff8ee" />
      <directionalLight
        position={[cx + span, wallH * 3 + 10, cz + span]}
        intensity={1.6} castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <Walls segments={segments} wallHeight={wallH} />
      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[span * 4, span * 4]} />
        <meshStandardMaterial color="#5c7a3a" roughness={1} />
      </mesh>
      <OrbitControls target={tgt} makeDefault />
      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport />
      </GizmoHelper>
    </Canvas>
  );
}
