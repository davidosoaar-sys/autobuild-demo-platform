import { parseToolpath } from './autobuild-v1/toolpath.mjs';

export const DEFECT_TYPES = ['none', 'gap', 'collapse', 'over-extrusion', 'under-extrusion', 'layer-shift', 'deformation', 'surface-crack', 'other'];
const VERDICTS = ['straight', 'deviated', 'defect', 'unclear'];
const CONFIDENCES = ['low', 'medium', 'high'];
export const MAX_REVIEWS = 16;
export const MAX_IMAGE_LENGTH = 96_000;
export const MAX_TOOLPATH_BYTES = 8 * 1024 * 1024;
const MAX_LAYERS = 5000;
const MAX_PREVIEW_SEGMENTS = 12_000;
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const layerValid = value => Number.isSafeInteger(value) && value >= 0;
const jpeg = value => typeof value === 'string' && value.length <= MAX_IMAGE_LENGTH && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);

export function createEvidence(projectId, report) {
  if (!text(projectId, 200) || !timestamp(report?.printStartedAt)) {
    throw new Error('A recorded print start is required to save evidence for a run.');
  }
  return { schemaVersion: 1, projectId, startedAt: report.printStartedAt, toolpath: null, reviews: [] };
}

export function evidenceKey(evidence) {
  return `autobuild:post-print:v1:${JSON.stringify([evidence.projectId, evidence.startedAt])}`;
}

export function attachToolpath(evidence, input) {
  const filename = text(input.filename, 180);
  if (!filename || !timestamp(input.recordedAt)) throw new Error('File name and timestamp are required.');
  const parsed = parseToolpath(input.text);
  if (!parsed.layers.length) throw new Error('The export contains no deposition moves.');
  if (parsed.layers.length > MAX_LAYERS) throw new Error(`The evidence summary supports up to ${MAX_LAYERS} deposition layers.`);
  const total = parsed.layers.reduce((n, layer) => n + layer.segments.length, 0);
  const available = MAX_PREVIEW_SEGMENTS - parsed.layers.length;
  return { ...evidence, toolpath: {
    source: parsed.source, filename, recordedAt: input.recordedAt, layerNumberSource: parsed.layerNumberSource,
    lengthMm: parsed.lengthMm, layers: parsed.layers.map(({ layerNumber, zMm, lengthMm, segments }) => ({ layerNumber, zMm, lengthMm, segmentCount: segments.length })),
    preview: parsed.layers.map(({ segments }) => {
      const count = total <= MAX_PREVIEW_SEGMENTS ? segments.length : 1 + Math.floor(available * (segments.length - 1) / (total - parsed.layers.length));
      return Array.from({ length: count }, (_, i) => {
        const { from, to } = segments[count === 1 ? 0 : Math.round(i * (segments.length - 1) / (count - 1))];
        return [from.x, from.y, to.x, to.y];
      }).flat();
    }),
  } };
}

function validPreview(toolpath) {
  const { preview, layers } = toolpath;
  if (preview === undefined) return true; // legacy summary-only record
  if (!Array.isArray(preview) || preview.length !== layers.length) return false;
  let count = 0;
  return preview.every((xy, i) => Array.isArray(xy) && xy.length >= 4 && xy.length % 4 === 0
    && xy.length / 4 <= layers[i].segmentCount && (count += xy.length / 4) <= MAX_PREVIEW_SEGMENTS
    && xy.every(Number.isFinite));
}

export function summarizeLayers(evidence, alerts) {
  const toolpath = evidence?.toolpath;
  const layers = (toolpath?.layers ?? []).map(plan => ({ plan, reviews: [], alerts: [], status: 'no-data' }));
  const byNumber = new Map(toolpath?.layerNumberSource === 'comments' ? layers.map(layer => [layer.plan.layerNumber, layer]) : []);
  const unplacedReviews = [];
  const unplacedAlerts = [];
  for (const review of evidence?.reviews ?? []) {
    const layer = byNumber.get(review.layer);
    (layer ? layer.reviews : unplacedReviews).push(review);
  }
  for (const alert of alerts) {
    const layer = byNumber.get(alert.layer);
    (layer ? layer.alerts : unplacedAlerts).push(alert);
  }
  for (const layer of layers) {
    layer.status = layer.reviews.some(r => r.defectType !== 'none') ? 'finding' : layer.alerts.length ? 'alert' : layer.reviews.length ? 'reviewed' : 'no-data';
  }
  return { layers, unplacedReviews, unplacedAlerts };
}

export function normalizeSuggestion(value) {
  if (!VERDICTS.includes(value?.verdict) || !DEFECT_TYPES.includes(value.defect_type) || value.defect_type === 'other') throw new Error('The analysis did not return a usable observation.');
  return { verdict: value.verdict, defectType: value.defect_type, description: text(value.description, 500), confidence: CONFIDENCES.includes(value.confidence) ? value.confidence : null };
}

export function addPhotoReview(evidence, input) {
  const id = text(input.id, 120);
  const note = text(input.note, 1000);
  const { recordedAt, image, layer, defectType, disposition } = input;
  if (!id || !timestamp(recordedAt)) throw new Error('Review ID and timestamp are required.');
  if (evidence.reviews.some(review => review.id === id)) throw new Error('This review was already saved.');
  if (evidence.reviews.length >= MAX_REVIEWS) throw new Error(`This run already has ${MAX_REVIEWS} saved photo reviews.`);
  if (!jpeg(image)) throw new Error('A bounded JPEG thumbnail is required.');
  if (layer !== null && !layerValid(layer)) throw new Error('Enter a nonnegative whole layer number or leave it blank.');
  if (!DEFECT_TYPES.includes(defectType)) throw new Error('Choose a defect type.');
  const suggestion = input.suggestion ? normalizeSuggestion({ ...input.suggestion, defect_type: input.suggestion.defectType }) : null;
  if (!['confirmed', 'corrected', 'missed'].includes(disposition)) throw new Error('Choose a review action.');
  if (disposition !== 'missed' && !suggestion) throw new Error('This action requires an AI observation.');
  if (disposition === 'confirmed' && (suggestion.verdict === 'unclear' || suggestion.defectType !== defectType)) throw new Error('An unclear or changed AI label cannot be confirmed.');
  if (disposition === 'missed' && defectType === 'none') throw new Error('Choose a defect type for the missed defect.');
  if (disposition !== 'confirmed' && !note) throw new Error('Describe what you observed.');
  return { ...evidence, reviews: [...evidence.reviews, { id, recordedAt, image, layer, defectType, disposition, note, suggestion }] };
}

// Shared storage contract for the two existing routes. Read before transforming
// so independent edits in another tab are not replaced by a stale UI snapshot.
export function setRunFeedback(evidence, input) {
  const { rating, helpful, recordedAt } = input;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('Choose a rating from 1 to 5.');
  if (typeof helpful !== 'boolean' || !timestamp(recordedAt)) throw new Error('Indicate whether the tools helped.');
  return { ...evidence, feedback: { rating, helpful, recordedAt, notes: text(input.notes, 1000) } };
}

export function loadEvidence(storage, baseline) {
  const raw = storage.getItem(evidenceKey(baseline));
  if (raw === null) return baseline;
  const saved = JSON.parse(raw);
  if (saved?.schemaVersion !== 1 || saved.projectId !== baseline.projectId || saved.startedAt !== baseline.startedAt
    || !Array.isArray(saved.reviews) || saved.reviews.length > MAX_REVIEWS || (saved.toolpath !== null && (
      saved.toolpath?.source !== 'planned-gcode' || !text(saved.toolpath.filename, 180) || !timestamp(saved.toolpath.recordedAt)
      || !['comments', 'inferred-order'].includes(saved.toolpath.layerNumberSource) || !Number.isFinite(saved.toolpath.lengthMm)
      || !Array.isArray(saved.toolpath.layers) || !saved.toolpath.layers.length || saved.toolpath.layers.length > MAX_LAYERS
      || saved.toolpath.layers.some(layer => !layerValid(layer?.layerNumber) || !Number.isFinite(layer.zMm)
        || !Number.isFinite(layer.lengthMm) || !layerValid(layer.segmentCount)) || !validPreview(saved.toolpath)))) {
    throw new Error('Saved evidence is unreadable or belongs to a different project or run.');
  }
  // Rebuild reviews through the same validator; never render arbitrary image URLs.
  const restored = saved.reviews.reduce(addPhotoReview, { ...baseline, toolpath: saved.toolpath });
  return saved.feedback == null ? restored : setRunFeedback(restored, saved.feedback);
}

export function saveEvidence(storage, baseline, transform) {
  const next = transform(loadEvidence(storage, baseline));
  storage.setItem(evidenceKey(baseline), JSON.stringify(next));
  return next;
}

export function buildPostPrintExport(project, evidence, exportedAt) {
  if (!timestamp(exportedAt)) throw new Error('An export timestamp is required.');
  const r = project.report ?? {};
  const startedAt = timestamp(r.printStartedAt) ? r.printStartedAt : null;
  if (evidence && (evidence.projectId !== project.id || evidence.startedAt !== startedAt)) throw new Error('Evidence belongs to a different project or run.');
  const alerts = Array.isArray(r.alerts) ? r.alerts.map(a => ({ recordedTime: text(a?.time, 80) || null, layer: layerValid(a?.layer) ? a.layer : null, message: text(a?.message, 1000) })).filter(a => a.message) : [];
  const events = Array.isArray(r.events) ? r.events.map(e => ({ recordedTime: text(e?.time, 80) || null, label: text(e?.label, 500), type: text(e?.type, 80) || null })).filter(e => e.label) : [];
  const videoObservations = (Array.isArray(r.videoObservations) ? r.videoObservations.slice(0, 100) : [])
    .filter(v => timestamp(v?.observedAt) && VERDICTS.includes(v.verdict) && DEFECT_TYPES.includes(v.defectType))
    .map(v => ({ observedAt: v.observedAt, cameraLabel: text(v.cameraLabel, 100), verdict: v.verdict, defectType: v.defectType, description: text(v.description, 500) }));
  return {
    schemaVersion: 1, exportedAt, project: { id: project.id, name: project.name },
    run: { startedAt, finishedAt: timestamp(r.printFinishedAt) ? r.printFinishedAt : null,
      reportRecordedAt: timestamp(r.generatedAt) ? r.generatedAt : null, plannedLayers: layerValid(r.totalLayers) ? r.totalLayers : null,
      gcodeReference: text(r.gcodeRef, 180) || null, alerts, events, videoObservations,
      videoInputs: (Array.isArray(r.videoInputs) ? r.videoInputs.slice(0, 100) : []).filter(v => timestamp(v?.startedAt)).map(v => ({ startedAt: v.startedAt, cameraLabel: text(v.cameraLabel, 100) })),
      material: { name: text(r.materialName, 120) || null, batchNumber: text(r.batchNumber, 120) || null } },
    evidence: { storage: 'browser-local', toolpath: evidence?.toolpath ?? null, reviews: evidence?.reviews ?? [],
      feedback: evidence?.feedback ?? null, ccuReadings: null, calibratedMeasurements: null },
  };
}
