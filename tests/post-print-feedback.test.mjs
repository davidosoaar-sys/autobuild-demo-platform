import test from 'node:test';
import assert from 'node:assert/strict';
import * as evidence from '../lib/post-print-evidence.mjs';
const now = '2026-11-21T14:00:00Z';
const project = { id: 'p', name: 'Print', report: { printStartedAt: now } };
const baseline = evidence.createEvidence(project.id, project.report);
const feedback = { rating: 4, helpful: false, notes: 'Needs more context', recordedAt: now };
test('report exports material and timestamped video observations, not raw video or invalid records', () => {
  const observation = { observedAt: now, cameraLabel: 'Overhead', verdict: 'straight', defectType: 'none', description: 'Even bead' };
  const run = { ...project, report: { ...project.report, materialName: 'Mix A', batchNumber: 'B12', videoInputs: [{ startedAt: now, cameraLabel: 'Overhead', video: 'private' }], videoObservations: [{ ...observation, video: 'private' }, { ...observation, observedAt: 'bad' }] } };
  const output = evidence.buildPostPrintExport(run, baseline, now);
  assert.deepEqual(output.run.videoObservations, [observation]);
  assert.deepEqual(output.run.videoInputs, [{ startedAt: now, cameraLabel: 'Overhead' }]);
  assert.deepEqual(output.run.material, { name: 'Mix A', batchNumber: 'B12' });
});
test('run feedback survives reload and is included in the report export', () => {
  const map = new Map();
  const storage = {getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v)};
  evidence.saveEvidence(storage, baseline, e => evidence.setRunFeedback(e, feedback));
  assert.deepEqual(evidence.buildPostPrintExport(project, evidence.loadEvidence(storage, baseline), now).evidence.feedback, feedback);
});
test('invalid feedback is rejected and older exports have no rating', () => {
  assert.throws(() => evidence.setRunFeedback(baseline, {...feedback, rating: 6}), /rating/i);
  assert.equal(evidence.buildPostPrintExport(project, baseline, now).evidence.feedback, null);
});
