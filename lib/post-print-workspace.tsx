'use client';

import { useEffect, useMemo, useState } from 'react';
import { useProjects } from './project-store';
import { createEvidence, evidenceKey, loadEvidence, saveEvidence, type Evidence, type Review } from './post-print-evidence.mjs';

export const actionClass = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-100 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';
export const primaryClass = `${actionClass} border-gray-900 bg-gray-900 text-white hover:bg-black`;
export const fieldClass = 'block min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900';
export const panelClass = 'print-glass rounded-2xl border border-gray-200 p-5 sm:p-6';
export const layerLabel = (layer: number | null) => layer === null ? 'Layer unknown' : `Layer ${layer}`;
export const defectLabel = (defect: string) => defect === 'none' ? 'No visible defect' : defect.replaceAll('-', ' ');
export const reviewLabel = { confirmed: 'Confirmed AI label', corrected: 'Corrected AI label', missed: 'Operator-marked missed defect' };
export const projectRoute = (route: string, id: string) => `${route}?project=${encodeURIComponent(id)}`;

export function usePostPrint() {
  const { activeProject, projects, loading, updateProject } = useProjects();
  const [queryId, setQueryId] = useState<string | null | undefined>(undefined);
  useEffect(() => { setQueryId(new URLSearchParams(window.location.search).get('project')); }, []);
  const project = queryId === undefined ? null : queryId === null ? activeProject : projects.find(p => p.id === queryId) ?? null;
  const projectId = project?.id;
  const startedAt = project?.report?.printStartedAt;
  const baseline = useMemo(() => {
    if (!projectId) return null;
    try { return createEvidence(projectId, { printStartedAt: startedAt }); } catch { return null; }
  }, [projectId, startedAt]);
  const key = baseline ? evidenceKey(baseline) : null;
  const [state, setState] = useState<{ key: string; evidence: Evidence | null; error: string } | null>(null);

  useEffect(() => {
    if (!baseline || !key) return;
    const read = () => {
      try { setState({ key, evidence: loadEvidence(window.localStorage, baseline), error: '' }); }
      catch { setState({ key, evidence: null, error: 'Saved evidence could not be read in this browser. It has not been overwritten.' }); }
    };
    read();
    const sync = (event: StorageEvent) => { if (event.key === key || event.key === null) read(); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [baseline, key]);

  const save = (transform: (current: Evidence) => Evidence) => {
    if (!baseline || !key) throw new Error('A recorded run is required.');
    const next = saveEvidence(window.localStorage, baseline, transform);
    setState({ key, evidence: next, error: '' });
  };
  return { project, loading: loading || queryId === undefined, key, pending: Boolean(key && state?.key !== key),
    evidence: state?.key === key ? state?.evidence ?? null : null, error: state?.key === key ? state?.error ?? '' : '', save, updateProject };
}

export function ReviewList({ reviews }: { reviews: Review[] }) {
  if (!reviews.length) return <p className="text-sm text-gray-600">No photo reviews saved for this run in this browser.</p>;
  return <ul className="space-y-4">{[...reviews].reverse().map(review => <li key={review.id} className="flex flex-col gap-3 break-inside-avoid rounded-xl border border-gray-200 p-3 sm:flex-row">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={review.image} alt={`Reviewed print evidence, ${layerLabel(review.layer).toLowerCase()}`} className="max-h-40 w-full rounded-lg bg-gray-100 object-contain sm:w-36" />
    <div className="min-w-0 space-y-1 break-words text-sm text-gray-700">
      <p className="font-semibold text-gray-900">{reviewLabel[review.disposition]} · {defectLabel(review.defectType)}</p>
      <p>{layerLabel(review.layer)} · Saved <time dateTime={review.recordedAt}>{new Date(review.recordedAt).toLocaleString()}</time></p>
      {review.note && <p className="whitespace-pre-wrap">{review.note}</p>}
      {review.suggestion && <p>AI observation: {defectLabel(review.suggestion.defectType)}{review.suggestion.description && ` · ${review.suggestion.description}`}</p>}
    </div>
  </li>)}</ul>;
}
