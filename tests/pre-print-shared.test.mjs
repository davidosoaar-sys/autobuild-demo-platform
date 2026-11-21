import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProfileStore } from '../lib/pre-print-store.mjs';
import { exportContent } from '../lib/pre-print-profile.mjs';

const speed = {field:'maxVelocity', value:32, source:'https://maker.example/speed'};
const openTime = {field:'openTimeMin', value:22, source:'https://maker.example/mix'};

test('exact matches reuse saved research across independent server store instances; approval uses canonical values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-preprint-'));
  try {
    const path = join(dir, 'catalog.json');
    const first = createProfileStore(path);
    let searches = 0;
    const research = async () => (++searches, [speed, openTime]);
    const draft = await first.lookupOrResearch('P1', 'Mix A', research);
    assert.equal(draft.reviewedAt, 0);
    assert.ok(draft.foundAt > 0);
    const second = createProfileStore(path);
    assert.deepEqual(await second.lookupOrResearch(' p1 ', 'MIX A', research), draft);
    assert.equal(await second.lookup('P1', 'Mix B'), null);
    assert.equal(await second.review('P1', 'Mix A', 'wrong-version', ['maxVelocity']), null);
    assert.equal(await second.review('P1', 'Mix A', draft.revision, ['nozzleDiameter']), null);
    const reviewed = await second.review('P1', 'Mix A', draft.revision, ['maxVelocity']);
    assert.deepEqual(reviewed.findings, [speed]);
    assert.deepEqual(reviewed.availableFindings, [speed, openTime]);
    assert.ok(reviewed.reviewedAt >= draft.foundAt);
    assert.deepEqual(await createProfileStore(path).lookupOrResearch('P1','Mix A',research), reviewed);
    assert.equal(searches, 1);
    assert.equal(await first.review('P1','Mix A',draft.revision,['openTimeMin']),null);
    assert.deepEqual((await first.review('P1','Mix A',reviewed.revision,['openTimeMin'])).findings,[openTime]);
  } finally { await rm(dir, {recursive:true,force:true}); }
});

test('export never downgrades to a clipped preview', () => {
  assert.equal(exportContent({gcode_preview:'G1 X10'}), null);
  assert.equal(exportContent({gcode_full:'  '}), null);
  assert.equal(exportContent({gcode_full:'G1 X10\nM30\n', gcode_preview:'G1 X10'}), 'G1 X10\nM30\n');
});
