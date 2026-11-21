import test from 'node:test';
import assert from 'node:assert/strict';
import { attachToolpath, addPhotoReview, buildPostPrintExport, createEvidence, evidenceKey, loadEvidence, normalizeSuggestion, saveEvidence } from '../lib/post-print-evidence.mjs';

const time = '2026-11-21T12:00:00.000Z';
const project = { id: 'p1', name: 'Trial wall', report: { printStartedAt: time, totalLayers: 2, gcodeRef: 'planned.gcode' } };
const fresh = () => createEvidence(project.id, project.report);
const full = `G21\nG90\n; Layer 1/2\nG0 Z12\nG1 X0 Y0 F60\nM106 S255\nG1 X3 Y4 F60\nM107\n; Layer 2/2\nG0 Z24\nG1 X0 Y0 F60\nM106 S255\nG1 X6 Y8 F60\nM107\nM84`;
const image = 'data:image/jpeg;base64,/9j/2Q==';
const review = { id: 'frame1', recordedAt: time, image, layer: 2, defectType: 'gap', note: 'Visible opening on north wall', disposition: 'missed' };

test('planned 3D centerlines survive reload without adding travel moves', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const interrupted = full.replace('G1 X3 Y4 F60\nM107', 'G1 X3 Y4 F60\nM107\nG1 X10 Y10 F60\nM106 S255\nG1 X11 Y10 F60\nM107');
  saveEvidence(storage, fresh(), e => attachToolpath(e, { text: interrupted, filename: 'job.gcode', recordedAt: time }));
  assert.deepEqual(loadEvidence(storage, fresh()).toolpath.preview, [[0, 0, 3, 4, 10, 10, 11, 10], [0, 0, 6, 8]]);
});

test('review separates alerts, findings and no coverage without matching inferred layers', async () => {
  const { summarizeLayers } = await import('../lib/post-print-evidence.mjs');
  const evidence = attachToolpath(addPhotoReview(fresh(), review), { text: full, filename: 'job.gcode', recordedAt: time });
  const alerts = [{ layer: 1, message: 'Possible collapse', recordedTime: null }, { layer: 9, message: 'Unmapped alert', recordedTime: null }];
  const result = summarizeLayers(evidence, alerts);
  assert.deepEqual(result.layers.map(l => l.status), ['alert', 'finding']);
  assert.equal(result.unplacedAlerts.length, 1);
  assert.deepEqual(summarizeLayers({ ...evidence, toolpath: { ...evidence.toolpath, layerNumberSource: 'inferred-order' } }, alerts).layers.map(l => l.status), ['no-data', 'no-data']);
  assert.equal(summarizeLayers(evidence, []).layers[0].status, 'no-data');
});

test('only full parsed G-code becomes layer evidence, explicitly planned', () => {
  assert.throws(() => attachToolpath(fresh(), { text: full.replace('M84', ''), filename: 'preview.gcode', recordedAt: time }), /missing M84/);
  const evidence = attachToolpath(fresh(), { text: full, filename: 'job.gcode', recordedAt: time });
  assert.equal(evidence.toolpath.source, 'planned-gcode');
  assert.deepEqual(evidence.toolpath.layers, [
    { layerNumber: 1, zMm: 12, lengthMm: 5, segmentCount: 1 },
    { layerNumber: 2, zMm: 24, lengthMm: 10, segmentCount: 1 },
  ]);
});

test('an operator can record an unflagged photo without calling AI', () => {
  const evidence = addPhotoReview(fresh(), review);
  assert.equal(evidence.reviews[0].disposition, 'missed');
  assert.equal(evidence.reviews[0].suggestion, null);
  assert.throws(() => addPhotoReview(evidence, { ...review, note: 'Different content, same ID' }), /already saved/);
  assert.throws(() => addPhotoReview(fresh(), { ...review, defectType: 'none' }), /defect type/);
});

test('AI suggestion is separate from the label and excludes inferred dimensions', () => {
  const suggestion = normalizeSuggestion({ verdict: 'defect', defect_type: 'collapse', description: 'Possible collapse', confidence: 'low', angle_deviation: 30 });
  const evidence = addPhotoReview(fresh(), { ...review, disposition: 'corrected', suggestion });
  assert.equal(evidence.reviews[0].suggestion.defectType, 'collapse');
  assert.equal(evidence.reviews[0].defectType, 'gap');
  assert.equal('angle_deviation' in evidence.reviews[0].suggestion, false);
  assert.throws(() => addPhotoReview(fresh(), { ...review, disposition: 'confirmed' }), /requires an AI observation/);
  assert.throws(() => addPhotoReview(fresh(), { ...review, image: 'https://example.invalid/remote.jpg' }), /JPEG/);
});

test('export scopes evidence to the selected project and run and does not invent coverage', () => {
  const evidence = addPhotoReview(fresh(), review);
  const exported = buildPostPrintExport(project, evidence, time);
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.run.startedAt, time);
  assert.equal(exported.run.finishedAt, null);
  assert.equal(exported.evidence.reviews[0].image, image);
  assert.equal(exported.evidence.toolpath, null);
  assert.throws(() => buildPostPrintExport({ ...project, report: { printStartedAt: '2026-11-21T13:00:00.000Z' } }, evidence, time), /different project or run/);
});

test('local persistence round-trips records and isolates other projects and runs', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  saveEvidence(storage, fresh(), e => addPhotoReview(e, review));
  saveEvidence(storage, fresh(), e => attachToolpath(e, { text: full, filename: 'job.gcode', recordedAt: time }));
  assert.equal(loadEvidence(storage, fresh()).reviews[0].note, review.note);
  assert.equal(loadEvidence(storage, fresh()).toolpath.layers.length, 2);
  assert.equal(loadEvidence(storage, createEvidence('p2', project.report)).reviews.length, 0);
  assert.equal(loadEvidence(storage, createEvidence(project.id, { printStartedAt: '2026-11-21T13:00:00Z' })).reviews.length, 0);
});

test('a failed write is not reported as saved and unreadable records are not overwritten', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } };
  assert.throws(() => saveEvidence(storage, fresh(), e => addPhotoReview(e, review)), /Quota exceeded/);
  assert.equal(loadEvidence(storage, fresh()).reviews.length, 0);
  const data = new Map([[evidenceKey(fresh()), '{']]);
  const corrupt = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  assert.throws(() => saveEvidence(corrupt, fresh(), e => addPhotoReview(e, review)), SyntaxError);
  assert.equal(data.get(evidenceKey(fresh())), '{');
});
