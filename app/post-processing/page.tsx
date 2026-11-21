'use client';

import OperatorFeedback from './OperatorFeedback';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import AppNav from '@/components/AppNav';
import { addPhotoReview, attachToolpath, DEFECT_TYPES, MAX_IMAGE_LENGTH, MAX_REVIEWS, MAX_TOOLPATH_BYTES, normalizeSuggestion, type Evidence, type Review, type Suggestion } from '@/lib/post-print-evidence.mjs';
import { actionClass, defectLabel, fieldClass, panelClass, primaryClass, projectRoute, ReviewList, usePostPrint } from '@/lib/post-print-workspace';
import { buildPostPrintExport, summarizeLayers, type RecordedAlert } from '@/lib/post-print-evidence.mjs';
import LayerReview from './LayerReview';

type Save = (transform: (e: Evidence) => Evidence) => void;
const LegacyDefectDetection = dynamic(() => import('@/app/live-monitoring/LiveMonitoring').then(module => module.DefectDetectionPanel), { ssr: false, loading: () => <p role="status">Loading legacy analysis…</p> });
const message = (e: unknown) => e instanceof DOMException && e.name === 'QuotaExceededError' ? 'Browser storage is full. Your draft was not saved.' : e instanceof Error ? e.message : 'Could not save evidence.';

async function thumbnail(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Choose a JPEG, PNG or WebP photo up to 10 MiB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    const ratio = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not prepare a photo in this browser.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.84, 0.68, 0.48, 0.28]) {
      const candidate = canvas.toDataURL('image/jpeg', quality);
      if (candidate.length <= MAX_IMAGE_LENGTH) return candidate;
    }
    throw new Error('Could not prepare a small enough thumbnail. Try another photo.');
  } finally { URL.revokeObjectURL(url); }
}

function PhotoReview({ evidence, save, activeLayer }: { evidence: Evidence; save: Save; activeLayer: number | null }) {
  const [image, setImage] = useState('');
  const [layer, setLayer] = useState('');
  const [note, setNote] = useState('');
  const [defect, setDefect] = useState('');
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [disposition, setDisposition] = useState<Review['disposition']>('missed');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const confirmed = disposition === 'confirmed';
  const reset = () => { setSuggestion(null); setDisposition('missed'); setDefect(''); setNote(''); setLayer(activeLayer === null ? '' : String(activeLayer)); };

  async function selectPhoto(file: File) {
    setBusy(true); setError(''); setNotice('');
    try { setImage(await thumbnail(file)); reset(); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }

  async function analyze() {
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await fetch('/api/analyze-beads', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: image.split(',')[1], mimeType: 'image/jpeg' }), signal: AbortSignal.timeout(45_000) });
      if (!res.ok || res.redirected) throw new Error();
      const result = normalizeSuggestion(await res.json());
      setSuggestion(result); setDisposition(result.verdict === 'unclear' ? 'corrected' : 'confirmed'); setDefect(result.defectType);
    } catch { setError('AI analysis is unavailable. You can still mark a missed defect.'); }
    finally { setBusy(false); }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError(''); setNotice('');
    try {
      save(current => addPhotoReview(current, { id: crypto.randomUUID(), image, recordedAt: new Date().toISOString(), layer: layer === '' ? null : Number(layer), note, defectType: defect, suggestion, disposition }));
      reset(); setImage(''); setNotice('Photo review saved in this browser.');
    } catch (e) { setError(message(e)); }
  }

  return <section className={`${panelClass} space-y-4`} aria-labelledby="photo-review">
    <h2 id="photo-review" className="text-lg font-semibold">Review a layer photo</h2>
    <p className="text-sm text-gray-600">Mark a missed defect without AI, or ask AI for an observation and confirm or correct its label.</p>
    {evidence.reviews.length >= MAX_REVIEWS ? <p role="status">This run has reached the limit of {MAX_REVIEWS} saved photos.</p> : <>
      <label className="block space-y-1 text-sm font-medium">Layer photo
        <input className={fieldClass} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void selectPhoto(file); }} />
      </label>
      {image && <div className="grid items-start gap-5 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="Selected layer photo" className="max-h-[34rem] w-full rounded-xl bg-gray-100 object-contain" />
        <form className="space-y-4" onSubmit={submit}>
          <button type="button" className={actionClass} onClick={analyze} disabled={busy}>{busy ? 'Working…' : 'Ask AI to review photo'}</button>
          <p className="text-sm text-gray-600">Asking AI sends the thumbnail to the existing analysis service. Saving a review does not.</p>
          {suggestion && <div className="rounded-xl bg-gray-100 p-3 text-sm"><p className="font-semibold">AI observation: {suggestion.verdict === 'unclear' ? 'Unclear' : defectLabel(suggestion.defectType)}</p>{suggestion.description && <p>{suggestion.description}</p>}</div>}
          <label className="block space-y-1 text-sm font-medium">Review action
            <select aria-label="Review action" className={fieldClass} value={disposition} disabled={busy} onChange={e => {
              const choice = e.target.value as Review['disposition']; setDisposition(choice);
              if (choice === 'confirmed') setDefect(suggestion?.defectType ?? '');
              if (choice === 'missed' && defect === 'none') setDefect('');
            }}>
              <option value="missed">Mark a missed defect</option>
              {suggestion && <option value="corrected">Correct AI label</option>}
              {suggestion && suggestion.verdict !== 'unclear' && <option value="confirmed">Confirm AI label</option>}
            </select>
          </label>
          <label className="block space-y-1 text-sm font-medium">Defect type
            <select aria-label="Defect type" className={`${fieldClass} capitalize`} required value={defect} onChange={e => setDefect(e.target.value)} disabled={busy || confirmed}>
              <option value="" disabled>Choose a defect type</option>
              {DEFECT_TYPES.filter(type => disposition !== 'missed' || type !== 'none').map(type => <option key={type} value={type}>{defectLabel(type)}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-sm font-medium">Layer number (optional)<input className={fieldClass} type="number" min={0} step={1} value={layer} disabled={busy} onChange={e => setLayer(e.target.value)} /></label>
          <label className="block space-y-1 text-sm font-medium">Operator note {confirmed ? '(optional)' : '(required)'}<textarea className={fieldClass} rows={3} required={!confirmed} maxLength={1000} disabled={busy} value={note} onChange={e => setNote(e.target.value)} /></label>
          <button type="submit" className={primaryClass} disabled={busy}>Save photo review</button>
        </form>
      </div>}
    </>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="text-sm text-gray-700">{notice}</p>}
  </section>;
}

function PlannedToolpath({ evidence, save, alerts, onSelect }: { evidence: Evidence; save: Save; alerts: RecordedAlert[]; onSelect: (layer: number | null) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [requested] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    const raw = query.get('layer');
    return query.get('run') === evidence.startedAt && raw && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toolpath = evidence.toolpath;
  const { layers, unplacedAlerts, unplacedReviews } = useMemo(() => summarizeLayers(evidence, alerts), [evidence, alerts]);
  async function attach(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || busy) return;
    setError(''); setBusy(true);
    try {
      if (file.size > MAX_TOOLPATH_BYTES) throw new Error('Choose a full AutoBuild export no larger than 8 MiB.');
      const text = await file.text();
      save(current => attachToolpath(current, { text, filename: file.name, recordedAt: new Date().toISOString() }));
      onSelect(null);
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  return <section id="layer-review" className={`${panelClass} scroll-mt-24 space-y-4`} aria-labelledby="planned-toolpath">
    <h2 id="planned-toolpath" className="text-lg font-semibold">3D layer review</h2>
    <p className="text-sm text-gray-600">Choose the full AutoBuild G-code export for this run, not a preview. These values describe the plan, not the printed bead.</p>
    <form className="flex flex-wrap items-end gap-3" onSubmit={attach}>
      <label className="min-w-0 flex-1 space-y-1 text-sm font-medium">Full G-code file<input className={fieldClass} type="file" accept=".gcode,.txt" disabled={busy} onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
      <button type="submit" disabled={!file || busy} className={actionClass}>{busy ? 'Reading file…' : toolpath ? 'Replace planned toolpath' : 'Attach planned toolpath'}</button>
    </form>
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {toolpath ? <LayerReview key={toolpath.recordedAt} toolpath={toolpath} layers={layers} initialLayer={requested} onSelect={onSelect} /> : <p className="text-sm text-gray-600">No planned toolpath attached.</p>}
    {toolpath && Boolean(unplacedAlerts.length || unplacedReviews.length) && <p className="text-sm text-gray-700">Not matched to the plan: {unplacedAlerts.length} alerts and {unplacedReviews.length} photo reviews. They remain in the report.</p>}
  </section>;
}

export default function PostProcessingPage() {
  const router = useRouter();
  const { project, evidence, key, pending, error, loading, save, updateProject } = usePostPrint();
  const [selection, setSelection] = useState<{ key: string | null; layer: number | null } | null>(null);
  const alerts = useMemo(() => project ? buildPostPrintExport(project, null, new Date().toISOString()).run.alerts : [], [project]);
  const [finishing, setFinishing] = useState(false);
  const [completionError, setCompletionError] = useState('');
  const [legacyMessage, setLegacyMessage] = useState('');
  const [legacyOpen, setLegacyOpen] = useState(false);
  async function finish() {
    if (!project || finishing) return;
    setFinishing(true); setCompletionError('');
    try { await updateProject(project.id, { status: 'complete' }); router.push(projectRoute('/report', project.id)); }
    catch { setCompletionError('Could not update the project status. You can still view the report.'); }
    finally { setFinishing(false); }
  }
  return <div className="print-workspace min-h-screen">
    <AppNav currentStep="post-processing" />
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">Post-print evidence</h1>
          {project && <p className="mt-1 break-words text-sm text-gray-600">{project.name}{evidence && <> · Started <time dateTime={evidence.startedAt}>{new Date(evidence.startedAt).toLocaleString()}</time></>}</p>}
        </div>
        {project && <Link className={actionClass} href={projectRoute('/report', project.id)}>View report</Link>}
      </header>
      {loading || pending ? <p role="status">Loading print evidence…</p> : !project ? <p>Choose a project from <Link href="/projects" className="underline">Projects</Link> first.</p> : <>
        <p className="text-sm text-gray-700">Evidence added here stays in this browser. Export the report to keep a copy. Saving a review does not retrain the AI.</p>
        {error ? <p role="alert">{error}</p> : evidence ? <>
          <PlannedToolpath key={`${key}:toolpath`} evidence={evidence} save={save} alerts={alerts} onSelect={layer => setSelection({ key, layer })} />
          <PhotoReview key={`${key}:photo`} evidence={evidence} save={save} activeLayer={selection?.key === key ? selection?.layer ?? null : null} />
          <OperatorFeedback key={`${key}:feedback`} evidence={evidence} save={save} />
          <section className={`${panelClass} space-y-4`}><h2 className="text-lg font-semibold">Saved operator reviews</h2><ReviewList reviews={evidence.reviews} /></section>

        </> : <p className={panelClass}>This project has no recorded print start. You can view its legacy report, but new evidence needs a run to attach to.</p>}
        <details className={panelClass} onToggle={e => { if (e.currentTarget.open) setLegacyOpen(true); }}>
          <summary className="min-h-11 cursor-pointer font-medium">Legacy image analysis and training feedback</summary>
          <p className="mb-4 text-sm text-gray-600">This separate tool is not part of the run’s local evidence record.</p>
          {legacyOpen && <LegacyDefectDetection onAlert={setLegacyMessage} />}
          {legacyMessage && <p role="status" className="mt-3 text-sm">{legacyMessage}</p>}
        </details>
        {project.status === 'post-processing' && <div className="space-y-2"><button type="button" className={actionClass} onClick={finish} disabled={finishing}>{finishing ? 'Updating project…' : 'Mark project complete and view report'}</button>
          {completionError && <p role="alert" className="text-sm text-red-800">{completionError}</p>}</div>}
      </>}
    </main>
  </div>;
}
