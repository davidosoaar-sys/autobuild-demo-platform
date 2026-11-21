export const fields = Object.freeze({
  nozzleDiameter: { label: 'Nozzle diameter', unit: 'mm', min: 5, max: 120 },
  maxVelocity: { label: 'Maximum printing speed', unit: 'mm/s', min: 1, max: 1000 },
  beadCompression: { label: 'Layer height to nozzle ratio', unit: '', min: 0.1, max: 1 },
  maxFlowRate: { label: 'Maximum pump flow', unit: 'L/min', min: 0.1, max: 500 },
  openTimeMin: { label: 'Material open time (reference only)', unit: 'min', min: 1, max: 1440 },
  initialSetTimeMin: { label: 'Initial setting time (reference only)', unit: 'min', min: 1, max: 1440 },
  waterLPerKg: { label: 'Recommended mixing water (reference only)', unit: 'L/kg dry mix', min: 0.001, max: 5 },
  strengthMpa: { label: 'Material compressive strength (reference only)', unit: 'MPa', min: 0.1, max: 250 },
});
export const storageKey = 'autobuild.pre-print.reviewed.v1';
export function cleanName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/ +/g, ' ') : '';
  return name.length > 0 && name.length <= 100 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name) ? name : '';
}
export const profileKey = (printer, mix) => JSON.stringify([cleanName(printer).toLowerCase(), cleanName(mix).toLowerCase()]);
export function safeSource(value) {
  if (typeof value !== 'string' || value.length > 1800) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(url.hostname) || /\.(local|internal|localhost|test|invalid)$/i.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}
export function validateFindings(values) {
  if (!Array.isArray(values)) return [];
  const findings = [];
  const seen = new Set();
  for (const item of values.slice(0, 24)) {
    if (!item || !Object.hasOwn(fields, item.field) || seen.has(item.field)) continue;
    const { min, max } = fields[item.field];
    const source = safeSource(item.source);
    if (!source || !Number.isFinite(item.value) || item.value < min || item.value > max) continue;
    findings.push({field:item.field, value:item.value, source});
    seen.add(item.field);
  }
  return findings;
}
function readStorage(raw) {
  if (!raw || raw.length > 200_000) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.slice(0, 12) : []; } catch { return []; }
}
export function savedProfile(raw, printer, mix) {
  const found = readStorage(raw).find(p => p && profileKey(p.printer,p.mix) === profileKey(printer,mix));
  if (!found || !Number.isSafeInteger(found.reviewedAt) || found.reviewedAt <= 0 || found.reviewedAt > Date.now()) return null;
  const findings = validateFindings(found.findings);
  if (!findings.length || !cleanName(found.printer) || !cleanName(found.mix)) return null;
  const foundAt = Number.isSafeInteger(found.foundAt) && found.foundAt > 0 && found.foundAt <= found.reviewedAt ? found.foundAt : undefined;
  return {printer:found.printer,mix:found.mix,findings,reviewedAt:found.reviewedAt,...(foundAt === undefined ? {} : {foundAt})};
}
export function storeProfile(raw, profile) {
  const existing = readStorage(raw).filter(p => p && profileKey(p.printer,p.mix) !== profileKey(profile.printer,profile.mix));
  return JSON.stringify([profile, ...existing].slice(0,12));
}
export function resolveProfileInputs(baseline, profile) {
  const out = {...baseline};
  if (!profile) return out;
  const mapping = {nozzleDiameter:'nozzleMm',maxVelocity:'maxSpd',beadCompression:'beadComp',maxFlowRate:'flowRate'};
  for (const {field,value} of validateFindings(profile.findings)) if (Object.hasOwn(mapping,field)) out[mapping[field]] = value;
  if (out.maxSpd < out.minSpd) throw new Error('The reviewed maximum speed is below the configured minimum speed. Reconcile these settings before optimizing.');
  // Match backend/sika733.py: L/min → mm³/s over the rectangular bead cross-section.
  const flowLimitedSpeed = Math.round((out.flowRate * 1_000_000 / 60) / (out.nozzleMm ** 2 * out.beadComp) * 10) / 10;
  if (!Number.isFinite(flowLimitedSpeed) || flowLimitedSpeed < out.minSpd) {
    throw new Error('The pump flow cannot support the configured minimum speed with this nozzle and layer height. Reconcile these settings before optimizing.');
  }
  out.printSpeed = Math.min(out.printSpeed,out.maxSpd);
  return out;
}

export function exportContent(result) {
  return typeof result?.gcode_full === 'string' && result.gcode_full.trim() ? result.gcode_full : null;
}
