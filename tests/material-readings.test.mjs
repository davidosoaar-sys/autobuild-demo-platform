import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../app/live-monitoring/LiveMonitoring.tsx', import.meta.url), 'utf8');
test('the existing monitor shows read-only material readings within the extrusion controls, not a separate CCU panel', () => {
  const controls = page.slice(page.indexOf('>Printer Control<'), page.indexOf('{/* Alerts panel */}'));
  assert.match(controls, /Extrusion Rate[\s\S]*<MaterialReadings/);
  assert.doesNotMatch(page, /<CcuPanel\b/);
});
test('absent readings are blank, real zero is visible, and expired readings are labeled', async () => {
  const { materialReadings } = await import('../lib/material-readings.mjs');
  assert.deepEqual(materialReadings(null, 1000), { consistency: '—', temperature: '—', stale: false });
  assert.deepEqual(materialReadings({observedAt: 1000, consistencyPercent: 0, temperatureC: 0}, 1000), {consistency: '0%', temperature: '0 °C', stale: false});
  assert.equal(materialReadings({observedAt: 1000, temperatureC: 24}, 6000).stale, true);
  assert.equal(materialReadings({observedAt: 1000, consistencyPercent: 200}, 1000).consistency, '—');
});
