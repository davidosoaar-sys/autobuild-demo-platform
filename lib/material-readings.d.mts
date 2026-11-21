export interface MaterialReading {
  observedAt: number;
  consistencyPercent?: number | null;
  temperatureC?: number | null;
}
export const MATERIAL_STALE_MS: number;
export function materialReadings(reading: MaterialReading | null, now: number): {consistency: string; temperature: string; stale: boolean};
