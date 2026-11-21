import test from 'node:test';
import assert from 'node:assert/strict';
import { parseToolpath } from '../lib/autobuild-v1/toolpath.mjs';

// Synthetic fixture in the format emitted by backend/gcode.py, not a print log.
const generated = `; AutoBuild AI — Adaptive 3DCP G-code
G21 ; units: millimetres
G90 ; absolute positioning
M83 ; relative extrusion
G92 E0
G1 F1000
M107
; Layer 1/3
;   Z: 12.5 mm  |  Speed: 50.0 mm/s  |  Risk: 0.0/100
G0 Z12.500
G1 X-3.000 Y-4.000 F3000 ; TRAVEL MOVE
M106 S255
G1 X0.000 Y0.000 F3000 E123.4567 ; EXTRUDE
G1 X0.000 Y0.000 F3000 ; EXTRUDE
M107
G1 X60.000 Y40.000 F3000 ; TRAVEL MOVE
G1 X10.000 Y0.000 F3000 ; TRAVEL MOVE
M106 S255
G1 X10.000 Y4.000 F1200 E222.0000 ; EXTRUDE
M107
G4 P1000
; Layer 2 — empty, skip
M107
G0 Z100 ; raise nozzle clear
M0 ; unconditional stop
; Layer 3/3
G0 Z12.500
G1 X2.000 Y2.000 F3000 ; TRAVEL MOVE
M106 S255
G1 X2.000 Y5.000 F1200 ; EXTRUDE
M107
; Print complete
M107
G0 Z100
M84
; End of file`;

const withoutComments = text => text.replace(/;[^\n]*/g, '');
const point = (x, y, z = 12.5) => ({ x, y, z });

test('groups pump-on planar moves by the emitted logical layer, not Z or feed rate', () => {
  const result = parseToolpath(generated.replaceAll('\n', '\r\n'));
  assert.equal(result.source, 'planned-gcode');
  assert.equal(result.layerNumberSource, 'comments');
  assert.equal(result.lengthMm, 12);
  assert.deepEqual(result.boundsMm, { min: point(-3, -4), max: point(10, 5) });
  assert.deepEqual(result.layers.map(({ layerNumber, zMm, lengthMm, boundsMm }) => (
    { layerNumber, zMm, lengthMm, boundsMm }
  )), [
    { layerNumber: 1, zMm: 12.5, lengthMm: 9, boundsMm: { min: point(-3, -4), max: point(10, 4) } },
    { layerNumber: 3, zMm: 12.5, lengthMm: 3, boundsMm: { min: point(2, 2), max: point(2, 5) } },
  ]);
  assert.deepEqual(result.layers[0].segments, [
    { from: point(-3, -4), to: point(0, 0), lengthMm: 5, lineNumber: 13 },
    { from: point(10, 0), to: point(10, 4), lengthMm: 4, lineNumber: 19 },
  ]);
});

test('commentless pump-only exports infer start order, not missing source layer IDs', () => {
  const pumpOnly = withoutComments(generated).replace(/^M83.*$/m, '').replace(/ E\d+\.\d+/g, '');
  const result = parseToolpath(pumpOnly);
  assert.equal(result.layerNumberSource, 'inferred-order');
  assert.equal(result.lengthMm, 12);
  assert.deepEqual(result.layers.map(({ layerNumber, zMm }) => [layerNumber, zMm]), [[1, 12.5], [2, 12.5]]);
});

test('an unmarked layer with only rounded zero-length moves still advances the ordinal', () => {
  const input = withoutComments(generated)
    .replace('X0.000 Y0.000', 'X-3.000 Y-4.000')
    .replace('X0.000 Y0.000', 'X-3.000 Y-4.000')
    .replace('X10.000 Y4.000', 'X10.000 Y0.000');
  const result = parseToolpath(input);
  assert.deepEqual(result.layers.map(({ layerNumber, lengthMm }) => [layerNumber, lengthMm]), [[2, 3]]);
});

test('a complete export with no deposition has zero length and no bounds', () => {
  assert.deepEqual(parseToolpath('G21\nG90\nG92 E0\nG1 F1000\nM107\nG0 Z100\nM84'), {
    source: 'planned-gcode', layerNumberSource: 'inferred-order', layers: [], lengthMm: 0, boundsMm: null,
  });
});

test('rejects foreign modes, commands and malformed moves rather than returning partial evidence', () => {
  for (const bad of ['G91', 'G20', 'G2 X0 Y0 I1 J0', 'G92 X0', 'M82', 'T1',
    'M106 S128', 'G1 Xoops Y0 F3000', 'G1 X1 X2 Y0 F3000', 'G0 Z200']) {
    assert.throws(() => parseToolpath(generated.replace('G1 X0.000 Y0.000 F3000 E123.4567 ; EXTRUDE', bad)),
      { name: 'SyntaxError', message: /line 13/i }, bad);
  }
});

test('requires a full export and rejects ambiguous or inconsistent layer labeling', () => {
  assert.throws(() => parseToolpath(generated.split('\n').slice(0, 20).join('\n')), /missing M84/i);
  assert.throws(() => parseToolpath(generated.replace('; Layer 3/3', '')), /layer marker/i);
  assert.throws(() => parseToolpath(generated.replace('; Layer 3/3', '; Layer 1/3')), /layer number/i);
  assert.throws(() => parseToolpath(generated.replace('; Layer 2 — empty, skip', '')), /layer number/i);
  assert.throws(() => parseToolpath(generated.replaceAll('/3\n', '/4\n')), /declared layer count/i);
  assert.throws(() => parseToolpath('G21\nG90\nM106 S255\nG1 X1 Y2 F1000\nM107\nM84'), /layer start/i);
});

test('only accepts bounded in-memory text', () => {
  assert.throws(() => parseToolpath(new Uint8Array()), TypeError);
  assert.throws(() => parseToolpath(' '.repeat(8 * 1024 * 1024 + 1)), RangeError);
});
