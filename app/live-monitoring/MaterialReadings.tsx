'use client';

import { useEffect, useState } from 'react';
import { MATERIAL_STALE_MS, materialReadings, type MaterialReading } from '@/lib/material-readings.mjs';

export default function MaterialReadings({ reading = null }: { reading?: MaterialReading | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!reading) return;
    const current = Date.now();
    setNow(current);
    if (!Number.isSafeInteger(reading.observedAt) || reading.observedAt > current) return;
    const remaining = reading.observedAt + MATERIAL_STALE_MS - current;
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), remaining + 1);
    return () => window.clearTimeout(timer);
  }, [reading]);
  const { consistency, temperature, stale } = materialReadings(reading, now);
  const waiting = consistency === '—' && temperature === '—';
  return (
    <div className="space-y-2 border-y border-white/15 py-3">
      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div><dt className="text-white/60">Material consistency</dt><dd className="mt-1 font-mono text-white">{consistency}</dd></div>
        <div><dt className="text-white/60">Material temperature</dt><dd className="mt-1 font-mono text-white">{temperature}</dd></div>
      </dl>
      {(waiting || stale) && <p className="text-xs text-white/60">{stale ? 'Last known readings' : 'Waiting for material readings'}</p>}
    </div>
  );
}
