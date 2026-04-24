'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';

interface SavedSlice {
  id: string;
  created_at: string;
  file_name: string;
  print_date: string | null;
  start_hour: number | null;
  city: string | null;
  material: string | null;
  layers: number | null;
  print_time: string | null;
  print_time_s: number | null;
  temperature: number | null;
  humidity: number | null;
  wind_speed: number | null;
  nozzle_mm: number | null;
  travel_saved_pct: number | null;
  result_json: Record<string, any> | null;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtHour(h: number | null) {
  if (h == null) return '—';
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const disp = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh;
  return `${disp}:${String(mm).padStart(2, '0')} ${ampm}`;
}

export default function SlicesPage() {
  const router  = useRouter();
  const [slices,  setSlices]  = useState<SavedSlice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const { data, error: err } = await supabase
          .from('saved_slices')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);
        if (err) throw err;
        setSlices(data ?? []);
      } catch (e: any) {
        setError(e.message || 'Failed to load slices');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const downloadGCode = (slice: SavedSlice) => {
    const gcode = slice.result_json?.gcode_full;
    if (!gcode) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([gcode], { type: 'text/plain' }));
    a.download = `${slice.file_name?.replace(/\.[^.]+$/, '') ?? 'print'}.gcode`;
    a.click();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-100 bg-white sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-1 flex items-center gap-3">
          <button onClick={() => router.back()}
            className="text-sm text-black/40 hover:text-black transition-colors flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
            </svg>
            Back
          </button>
          <div className="h-6 w-px bg-gray-200"/>
          <div className="-my-4 sm:-my-5">
            <Image src="/Autobuildwhite.png" alt="AutoBuild AI" width={400} height={400} className="h-20 sm:h-28 w-auto"/>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-14">

        <div className="mb-8 flex items-end justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-black tracking-tight mb-1">My Slices</h1>
            <p className="text-xs text-black/35">Saved slice results from the Slicer and Pre-Print Optimizer</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => router.push('/tools/slicer')}
              className="px-4 py-2 bg-black text-white text-xs font-semibold rounded-xl hover:bg-black/90 transition-colors">
              New Slice
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin"/>
          </div>
        )}

        {!loading && error && (
          <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-4 text-sm text-red-600">
            {error}
          </div>
        )}

        {!loading && !error && slices.length === 0 && (
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-black/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
            </div>
            <p className="text-sm font-semibold text-black mb-1">No slices saved yet</p>
            <p className="text-xs text-black/40 mb-6">Run the Slicer or Pre-Print Optimizer to save your first result.</p>
            <button onClick={() => router.push('/tools/slicer')}
              className="px-5 py-2.5 bg-black text-white text-sm font-semibold rounded-xl hover:bg-black/90 transition-colors">
              Open Slicer
            </button>
          </div>
        )}

        {!loading && !error && slices.length > 0 && (
          <div className="space-y-3">
            {slices.map(slice => (
              <div key={slice.id}
                className="bg-white border border-gray-100 rounded-2xl px-5 py-4 flex items-start gap-4">

                {/* Icon */}
                <div className="w-10 h-10 bg-gray-50 border border-gray-100 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-5 h-5 text-black/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
                  </svg>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-black truncate">{slice.file_name ?? '—'}</p>
                      <p className="text-[11px] text-black/35 mt-0.5">
                        {fmtDate(slice.created_at)}
                        {slice.city ? ` · ${slice.city}` : ''}
                        {slice.print_date ? ` · ${slice.print_date}` : ''}
                        {slice.start_hour != null ? ` · ${fmtHour(slice.start_hour)}` : ''}
                      </p>
                    </div>
                    {slice.result_json?.gcode_full && (
                      <button onClick={() => downloadGCode(slice)}
                        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-black text-white text-[11px] font-semibold rounded-lg hover:bg-black/80 transition-colors">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                        </svg>
                        G-code
                      </button>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                    {slice.print_time && (
                      <span className="text-[11px] text-black/50">
                        <span className="text-black/30">Print time</span> {slice.print_time}
                      </span>
                    )}
                    {slice.layers != null && (
                      <span className="text-[11px] text-black/50">
                        <span className="text-black/30">Layers</span> {slice.layers.toLocaleString()}
                      </span>
                    )}
                    {slice.material && (
                      <span className="text-[11px] text-black/50">
                        <span className="text-black/30">Material</span> {slice.material}
                      </span>
                    )}
                    {slice.nozzle_mm != null && (
                      <span className="text-[11px] text-black/50">
                        <span className="text-black/30">Nozzle</span> {slice.nozzle_mm} mm
                      </span>
                    )}
                    {slice.travel_saved_pct != null && slice.travel_saved_pct > 0 && (
                      <span className="text-[11px] text-emerald-600 font-semibold">
                        {slice.travel_saved_pct}% travel saved
                      </span>
                    )}
                    {slice.temperature != null && (
                      <span className="text-[11px] text-black/50">
                        <span className="text-black/30">Temp</span> {slice.temperature}°C
                      </span>
                    )}
                  </div>
                </div>

              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
