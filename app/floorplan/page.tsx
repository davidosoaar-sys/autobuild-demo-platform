'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface PreviewData {
  image_base64:   string;
  page_width_pt:  number;
  page_height_pt: number;
  zoom:           number;
  image_width_px: number;
  image_height_px: number;
}

export default function FloorPlanPage() {
  const router = useRouter();

  const [pdfFile,    setPdfFile]    = useState<File | null>(null);
  const [preview,    setPreview]    = useState<PreviewData | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [statusMsg,  setStatusMsg]  = useState('No PDF uploaded');

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPdfFile(file);
    setPreview(null);

    if (!file) {
      setStatusMsg('No PDF uploaded');
      return;
    }

    setStatusMsg(`Selected: ${file.name}`);
    setLoading(true);
    setStatusMsg('Rendering preview…');

    try {
      const fd = new FormData();
      fd.append('file', file);
      const res  = await fetch(`${API}/floorplan/preview`, { method: 'POST', body: fd });
      const data = await res.json();

      if (data.error) {
        setStatusMsg(`Error: ${data.error}`);
        return;
      }

      setPreview(data as PreviewData);
      setStatusMsg(`${file.name} — page 1 of ${data.page_count ?? '?'} · ${data.image_width_px}×${data.image_height_px}px`);
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message || 'Could not reach backend'}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Header */}
      <header className="border-b border-gray-100 bg-white sticky top-0 z-10 overflow-visible">
        <div className="max-w-[1400px] mx-auto px-6 py-1 flex items-center justify-between">
          <button onClick={() => router.push('/')} className="-my-4 sm:-my-6">
            <Image src="/Autobuildblack.png" alt="AutoBuild AI" width={400} height={400} className="h-24 sm:h-36 w-auto" />
          </button>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-black/40">Floor Plan</span>
            <button
              disabled
              className="px-5 py-2 bg-black text-white text-sm font-semibold rounded-xl
                disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Extract Walls
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center px-4 py-10">
        <div className="w-full max-w-2xl space-y-6">

          {/* Heading */}
          <div>
            <h1 className="text-2xl font-bold text-black tracking-tight">
              Floor Plan to Print Path
            </h1>
            <p className="text-sm text-black/40 mt-1.5">
              Upload a PDF floor plan to extract wall geometry and generate a concrete print path.
            </p>
          </div>

          {/* File input */}
          <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm space-y-3">
            <label className="block text-xs font-semibold text-black/50 uppercase tracking-wider mb-2">
              Upload Floor Plan PDF
            </label>
            <input
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              className="block w-full text-sm text-black/60
                file:mr-4 file:py-2 file:px-4
                file:rounded-xl file:border-0
                file:text-sm file:font-semibold
                file:bg-black file:text-white
                hover:file:bg-black/80
                file:cursor-pointer cursor-pointer
                transition-all"
            />
            <p className="text-xs text-black/30 mt-1">{statusMsg}</p>
          </div>

          {/* Preview box */}
          <div className="bg-white border-2 border-dashed border-gray-200 rounded-2xl overflow-hidden flex items-center justify-center"
            style={{ minHeight: '400px' }}>
            {loading && (
              <div className="flex flex-col items-center gap-3 py-16">
                <div className="w-6 h-6 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                <p className="text-sm text-black/30">Rendering preview…</p>
              </div>
            )}
            {!loading && preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:image/png;base64,${preview.image_base64}`}
                alt="PDF preview"
                className="w-full h-auto rounded-2xl"
              />
            )}
            {!loading && !preview && (
              <p className="text-sm text-black/30 select-none">PDF preview will appear here</p>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}
