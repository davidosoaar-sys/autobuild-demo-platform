export const MATERIAL_STALE_MS = 5000;
const display = (value, unit) => Number.isFinite(value) ? `${value}${unit}` : '—';

export function materialReadings(reading, now) {
  if (!Number.isSafeInteger(reading?.observedAt) || reading.observedAt < 0 || reading.observedAt > now) {
    return {consistency: '—', temperature: '—', stale: false};
  }
  const c = reading.consistencyPercent;
  const consistency = display(c >= 0 && c <= 100 ? c : null, '%');
  const temperature = display(reading.temperatureC, ' °C');
  return {consistency, temperature, stale: (consistency !== '—' || temperature !== '—') && now - reading.observedAt >= MATERIAL_STALE_MS};
}
