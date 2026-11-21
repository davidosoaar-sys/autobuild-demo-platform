// Only the export dialect of backend/gcode.py: absolute millimetres, planar
// G1 moves, M106 S255/M107 pump state, and a terminating M84. This is planned
// centerline geometry, not printer telemetry, bead dimensions or proof of print.
const MAX_TEXT_LENGTH = 8 * 1024 * 1024;
const MAX_SEGMENTS = 100_000;
const WORD = /^([A-Z])([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/;
const LAYER_MARKER = /^Layer (\d+)(?:\/(\d+)| — empty, skip)$/;

function includePoint(bounds, point) {
  if (!bounds) return { min: { ...point }, max: { ...point } };
  for (const axis of ['x', 'y', 'z']) {
    bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
  }
  return bounds;
}

/**
 * Parse the full AutoBuild G-code text (not gcode_preview), without any I/O.
 * Returns deposition-bearing layers in file order. Comment layer numbers are
 * one-based source IDs; inferred ordinals cannot recover omitted empty layers.
 * E words are not interpreted: the generator emits cumulative values despite
 * declaring M83, and can omit E altogether while the pump is on.
 * Throws on unsupported syntax or incomplete input; never returns partial data.
 */
export function parseToolpath(text) {
  if (typeof text !== 'string') throw new TypeError('G-code must be an in-memory string');
  if (text.length > MAX_TEXT_LENGTH) throw new RangeError('G-code exceeds 8 Mi UTF-16 code units');

  const layers = [];
  let lengthMm = 0;
  let boundsMm = null;
  let segmentCount = 0;
  let lineNumber = 0;
  let preamble = 0;
  let finished = false;
  let pumpOn = false;
  let z = null;
  let awaitingLeadIn = false;
  let position = null;
  let layer = null;
  let layerNumberSource = null;
  let lastLayerNumber = 0;
  let declaredTotal = null;
  let pendingMarker = null;
  const fail = message => { throw new SyntaxError(`G-code line ${lineNumber}: ${message}`); };

  // Scan one line at a time; do not allocate a split array for the input.
  for (let start = 0; start < text.length;) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline;
    const line = text.slice(start, end);
    start = end + 1;
    lineNumber += 1;
    const semicolon = line.indexOf(';');
    const code = (semicolon === -1 ? line : line.slice(0, semicolon)).trim();
    const comment = semicolon === -1 ? '' : line.slice(semicolon + 1).trim();

    if (!code) {
      const marker = LAYER_MARKER.exec(comment);
      if (!marker) continue;
      if (finished || pumpOn || pendingMarker !== null || layerNumberSource === 'inferred-order') {
        fail('unexpected layer marker');
      }
      const number = Number(marker[1]);
      const total = marker[2] === undefined ? null : Number(marker[2]);
      if (!Number.isSafeInteger(number) || number !== lastLayerNumber + 1
        || (declaredTotal !== null && number > declaredTotal)
        || (total !== null && (!Number.isSafeInteger(total) || number > total
          || (declaredTotal !== null && total !== declaredTotal)))) {
        fail('invalid or inconsistent layer number');
      }
      layerNumberSource = 'comments';
      lastLayerNumber = number;
      layer = null;
      awaitingLeadIn = false;
      if (total !== null) {
        declaredTotal = total;
        pendingMarker = number;
      }
      continue;
    }

    if (finished) fail('command after M84');
    if (preamble < 2) {
      const expected = preamble === 0 ? 'G21' : 'G90';
      if (code !== expected) fail(`expected ${expected} in the AutoBuild preamble`);
      preamble += 1;
      continue;
    }

    const [command, ...words] = code.split(/\s+/);
    const args = Object.create(null);
    for (const word of words) {
      const match = WORD.exec(word);
      if (!match || match[1] in args || !Number.isFinite(Number(match[2]))) {
        fail(`invalid argument for ${command}`);
      }
      args[match[1]] = Number(match[2]);
    }
    const { X, Y, Z, F, E, S, P } = args;
    const has = (...keys) => words.length === keys.length && keys.every(key => key in args);

    switch (command) {
      case 'M83':
        if (!has()) fail('expected M83 without arguments');
        break;
      case 'G92':
        if (!has('E') || E !== 0) fail('only G92 E0 is supported');
        break;
      case 'M106':
        if (!has('S') || S !== 255) fail('only M106 S255 is supported');
        if (!layer || awaitingLeadIn || pendingMarker !== null) fail('pump enabled before layer start');
        pumpOn = true;
        break;
      case 'M107':
        if (!has()) fail('expected M107 without arguments');
        pumpOn = false;
        break;
      case 'G4':
        if (!has('P') || !Number.isSafeInteger(P) || P < 0 || pumpOn) fail('unsupported dwell');
        break;
      case 'M0':
        if (!has() || pumpOn) fail('unsupported pause');
        break;
      case 'M84':
        if (!has() || pumpOn || pendingMarker !== null) fail('unexpected M84');
        if (declaredTotal !== null && lastLayerNumber !== declaredTotal) fail('missing markers for declared layer count');
        finished = true;
        break;
      case 'G0':
        if (!has('Z') || pumpOn) fail('only pump-off G0 Z is supported');
        z = Z;
        awaitingLeadIn = true;
        layer = null;
        break;
      case 'G1': {
        if (has('F') && F > 0) break;
        if (!(has('X', 'Y', 'F') || has('X', 'Y', 'F', 'E')) || F <= 0 || z === null) {
          fail('expected planar G1 X Y F [E] after positioning Z');
        }
        const to = { x: X, y: Y, z };
        if (!pumpOn) {
          if (E !== undefined) fail('unexpected E word with pump off');
          if (awaitingLeadIn) {
            if (layerNumberSource === 'comments' && pendingMarker === null) fail('missing layer marker');
            layerNumberSource ??= 'inferred-order';
            if (pendingMarker === null) lastLayerNumber += 1;
            const layerNumber = lastLayerNumber;
            layer = { layerNumber, zMm: z, lengthMm: 0, boundsMm: null, segments: [] };
            pendingMarker = null;
            awaitingLeadIn = false;
          } else if (!layer || pendingMarker !== null) {
            fail('travel before layer start');
          }
        } else {
          const segmentLength = Math.hypot(to.x - position.x, to.y - position.y);
          if (!Number.isFinite(lengthMm + segmentLength)) fail('non-finite deposition length');
          if (segmentLength > 0) {
            if (++segmentCount > MAX_SEGMENTS) throw new RangeError('G-code exceeds 100,000 deposition segments');
            if (!layer.segments.length) layers.push(layer);
            layer.segments.push({ from: position, to, lengthMm: segmentLength, lineNumber });
            layer.lengthMm += segmentLength;
            lengthMm += segmentLength;
            layer.boundsMm = includePoint(includePoint(layer.boundsMm, position), to);
            boundsMm = includePoint(includePoint(boundsMm, position), to);
          }
        }
        position = to;
        break;
      }
      default:
        fail(`unsupported command ${command}`);
    }
  }

  if (!finished) fail('incomplete AutoBuild export: missing M84');
  return { source: 'planned-gcode', layerNumberSource: layerNumberSource ?? 'inferred-order', layers, lengthMm, boundsMm };
}
