'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { actionClass, fieldClass, ReviewList } from '@/lib/post-print-workspace';
import type { LayerReview as Layer, Toolpath } from '@/lib/post-print-evidence.mjs';

const Scene = dynamic(() => import('./LayerScene'), { ssr: false, loading: () => <p role="status" className="p-5 text-neutral-200">Loading 3D toolpath…</p> });
const labels = { finding: 'Operator finding', alert: 'Recorded alert', reviewed: 'Photo reviewed', 'no-data': 'No recorded evidence' };

export default function LayerReview({ toolpath, layers, initialLayer, onSelect }: { toolpath: Toolpath; layers: Layer[]; initialLayer: number | null; onSelect: (layer: number | null) => void }) {
  const [index, setIndex] = useState(() => Math.max(0, layers.findIndex(layer => layer.plan.layerNumber === initialLayer)));
  const [upTo, setUpTo] = useState(false);
  const [camera, setCamera] = useState(0);
  const current = layers[index] ?? layers[0];
  const inferred = toolpath.layerNumberSource !== 'comments';
  function select(i: number) {
    setIndex(i);
    onSelect(inferred ? null : layers[i].plan.layerNumber);
  }
  const ordered = [...layers.slice(index + 1), ...layers.slice(0, index)];
  const next = ordered.find(l => l.status === 'finding' || l.status === 'alert');
  const sampled = toolpath.preview?.some((xy, i) => xy.length / 4 < toolpath.layers[i].segmentCount);
  return <div className="space-y-4">
    <p className="break-words text-sm text-gray-600">{toolpath.filename} · {layers.length} deposition layers. {inferred ? 'Layer numbers are inferred deposition order. Photos and alerts are not matched to this plan.' : 'Photos and alerts are matched by recorded layer number, not by measured position.'}</p>
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0 space-y-3">
        {toolpath.preview ? <>
          <div className="relative h-[clamp(16rem,45vw,29rem)] overflow-hidden rounded-xl bg-black">
            <Scene key={camera} toolpath={toolpath} layers={layers} selected={index} upToLayer={upTo} onSelect={select} />
            <span className="pointer-events-none absolute left-3 top-3 rounded bg-neutral-900 px-2 py-1 text-xs text-white">Planned centerlines</span>
          </div>
          <p className="text-xs text-gray-700">Drag to rotate, scroll or pinch to zoom, and select a line to inspect its layer. {sampled && 'Large plan: the model shows sampled segments; layer totals are unchanged.'}</p>
          <div aria-label="Layer colors" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700">
            {([['bg-rose-400', labels.finding], ['bg-amber-400', labels.alert], ['bg-emerald-300', labels.reviewed], ['bg-neutral-400', labels['no-data']], ['bg-white', 'Selected']] as const).map(([color, name]) => <span key={name} className="inline-flex items-center gap-1.5"><i aria-hidden className={`h-3 w-3 rounded-full border border-neutral-600 ${color}`} />{name}</span>)}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={upTo} onChange={e => setUpTo(e.target.checked)} /> Show only through selected layer</label>
            <button className={actionClass} type="button" onClick={() => setCamera(n => n + 1)}>Reset view</button>
          </div>
        </> : <p className="rounded-xl bg-gray-100 p-4 text-sm">This attachment predates 3D review. Reattach the full G-code to add a model; your photo reviews stay saved.</p>}
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-40 flex-1 space-y-1 text-sm font-medium">{inferred ? 'Deposition order' : 'Planned layer'}
            <select aria-label="Select planned layer" className={fieldClass} value={index} onChange={e => select(Number(e.target.value))}>{layers.map((layer, i) => <option key={i} value={i}>{layer.plan.layerNumber}: {labels[layer.status]}</option>)}</select>
          </label>
          <button className={actionClass} type="button" disabled={!next} onClick={() => next && select(layers.indexOf(next))}>Next flagged layer</button>
        </div>
        {layers.length > 1 && <label className="block text-sm font-medium">Layer scrubber<input className="block min-h-11 w-full accent-neutral-900" type="range" min={0} max={layers.length - 1} aria-valuetext={`${inferred ? 'Deposition' : 'Layer'} ${current.plan.layerNumber}`} value={index} onChange={e => select(Number(e.target.value))} /></label>}
      </div>
      <div className="min-w-0 space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div aria-live="polite">
          <h3 className="font-semibold">{inferred ? 'Deposition' : 'Layer'} {current.plan.layerNumber}</h3>
          <p className="text-sm text-gray-700">{labels[current.status]}</p>
          <p className="mt-2 text-sm text-gray-700">Planned Z: {current.plan.zMm.toLocaleString()} mm · Planned deposition: {current.plan.lengthMm.toLocaleString()} mm · {current.plan.segmentCount} segments</p>
        </div>
        <p className="border-t border-gray-200 pt-3 text-sm text-gray-700">Measured bead dimensions, CCU readings and layer duration are unavailable.</p>
        <div className="space-y-1"><h4 className="text-sm font-semibold">Recorded alerts</h4>{current.alerts.length ? <ul className="space-y-2 text-sm">{current.alerts.map((alert, i) => <li className="break-words" key={i}>{alert.recordedTime && `${alert.recordedTime}: `}{alert.message}</li>)}</ul> : <p className="text-sm text-gray-600">No alerts linked to this layer.</p>}</div>
        <div className="space-y-2"><h4 className="text-sm font-semibold">Operator photo reviews</h4>{current.reviews.length ? <ReviewList reviews={current.reviews} /> : <p className="text-sm text-gray-600">No photo reviews linked to this layer.</p>}</div>
      </div>
    </div>
  </div>;
}
