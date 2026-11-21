'use client';

import { Component, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { BufferGeometry, Color, Float32BufferAttribute, LineBasicMaterial, LineSegments } from 'three';
import type { LayerReview, Toolpath } from '@/lib/post-print-evidence.mjs';

const colors = { finding: '#fb7185', alert: '#fbbf24', reviewed: '#6ee7b7', 'no-data': '#a3a3a3' };
const unavailable = <p className="grid h-full place-items-center p-6 text-center text-sm text-neutral-200">3D is unavailable. Use the layer selector to review evidence.</p>;
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? unavailable : this.props.children; }
}

function Path({ toolpath, layers, selected, upToLayer, onSelect }: Props) {
  const invalidate = useThree(state => state.invalidate);
  const { line, vertexLayer, ends } = useMemo(() => {
    const raw: number[] = [];
    const vertexLayer: number[] = [];
    const ends: number[] = [];
    toolpath.preview?.forEach((xy, i) => {
      for (let n = 0; n < xy.length; n += 2) {
        raw.push(xy[n], toolpath.layers[i].zMm, -xy[n + 1]);
        vertexLayer.push(i);
      }
      ends.push(vertexLayer.length);
    });
    // Normalize before converting to float32 to keep the camera and picking
    // stable even for files with a large coordinate origin.
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    raw.forEach((value, i) => { const axis = i % 3; min[axis] = Math.min(value, min[axis]); max[axis] = Math.max(value, max[axis]); });
    const center = min.map((value, i) => value / 2 + max[i] / 2);
    const scale = Math.max(...max.map((value, i) => value / 2 - min[i] / 2)) || 1;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(raw.map((value, i) => (value / scale - center[i % 3] / scale) * 4), 3));
    geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(raw.length), 3));
    return { line: new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, toneMapped: false })), vertexLayer, ends };
  }, [toolpath]);
  useLayoutEffect(() => {
    const palette = Object.fromEntries(Object.entries(colors).map(([id, color]) => [id, new Color(color)]));
    const highlight = new Color('#ffffff');
    const attribute = line.geometry.getAttribute('color');
    vertexLayer.forEach((layer, vertex) => {
      const c = layer === selected ? highlight : palette[layers[layer].status];
      attribute.setXYZ(vertex, c.r, c.g, c.b);
    });
    attribute.needsUpdate = true;
    line.geometry.setDrawRange(0, upToLayer ? ends[selected] : vertexLayer.length);
    invalidate();
  }, [line, vertexLayer, ends, layers, selected, upToLayer, invalidate]);
  useEffect(() => () => { line.geometry.dispose(); line.material.dispose(); }, [line]);
  return <primitive object={line} onClick={(event: import('@react-three/fiber').ThreeEvent<MouseEvent>) => {
    if (event.delta > 5 || event.index === undefined) return;
    event.stopPropagation();
    const index = vertexLayer[event.index];
    if (index !== undefined) onSelect(index);
  }} />;
}

type Props = { toolpath: Toolpath; layers: LayerReview[]; selected: number; upToLayer: boolean; onSelect: (index: number) => void };

export default function LayerScene(props: Props) {
  return <SceneBoundary><Canvas aria-label="Interactive 3D planned toolpath" fallback={unavailable} frameloop="demand" dpr={[1, 1.5]}
    camera={{ position: [12, 10, 16], fov: 43, near: 0.1, far: 100 }}
    onCreated={({ raycaster }) => { raycaster.params.Line = { threshold: 0.16 }; }}>
    <Path {...props} />
    <OrbitControls makeDefault enableDamping={false} enablePan={false} minDistance={5} maxDistance={48} />
  </Canvas></SceneBoundary>;
}
