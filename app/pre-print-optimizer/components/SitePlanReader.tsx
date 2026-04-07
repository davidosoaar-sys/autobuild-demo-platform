'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';

// What Claude extracts from the site plan
export interface SitePlanData {
  width:        number;    // metres
  length:       number;    // metres
  shape:        'rectangular' | 'l-shaped' | 'irregular';
  road: {
    present:    boolean;
    side:       'north' | 'south' | 'east' | 'west' | 'corner-ne' | 'corner-nw' | 'corner-se' | 'corner-sw' | 'unknown';
    width_m:    number;    // estimated road width
  };
  house: {
    offset_x:   number;   // 0–1 (fraction of site width from west edge)
    offset_z:   number;   // 0–1 (fraction of site length from south edge)
    width:      number;   // metres
    length:     number;   // metres
    rotation:   number;   // degrees (0 = aligned with site)
  };
  confidence:   'high' | 'medium' | 'low';
  notes:        string;
}

interface SitePlanReaderProps {
  onSitePlanParsed: (data: SitePlanData) => void;
}

const SYSTEM_PROMPT = `You are an expert architectural site plan analyser.
The user will provide an image of a site plan or site layout drawing.
Analyse it carefully and return ONLY a JSON object with no markdown, no explanation, no backticks.

Extract:
- Site dimensions in metres (estimate from scale bar, annotations, or visual proportion)
- Site shape: rectangular, l-shaped, or irregular
- Road: which side it is on (north/south/east/west or corner), approximate width in metres
- House or building footprint: its position as fractions (0–1) of the site, its dimensions in metres, and rotation in degrees
- Confidence: high if you can see clear dimensions, medium if estimating, low if very unclear
- Brief notes about what you observed

Return exactly this JSON shape:
{
  "width": <number>,
  "length": <number>,
  "shape": "rectangular" | "l-shaped" | "irregular",
  "road": {
    "present": <boolean>,
    "side": "north" | "south" | "east" | "west" | "corner-ne" | "corner-nw" | "corner-se" | "corner-sw" | "unknown",
    "width_m": <number>
  },
  "house": {
    "offset_x": <0-1>,
    "offset_z": <0-1>,
    "width": <number>,
    "length": <number>,
    "rotation": <number>
  },
  "confidence": "high" | "medium" | "low",
  "notes": "<string>"
}`;

async function readFileAsBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => {
      const result  = reader.result as string;
      const base64  = result.split(',')[1];
      const mediaType = file.type || 'image/jpeg';
      resolve({ base64, mediaType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function analyseSitePlan(file: File): Promise<SitePlanData> {
  const { base64, mediaType } = await readFileAsBase64(file);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:      'claude-opus-4-5',
      max_tokens: 1000,
      system:     SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: 'Analyse this site plan and return the JSON.',
          },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${response.status}`);
  }

  const data    = await response.json();
  const text    = data.content?.[0]?.text ?? '';
  // Strip any accidental markdown fences
  const clean   = text.replace(/```json|```/g, '').trim();
  const parsed  = JSON.parse(clean) as SitePlanData;
  return parsed;
}

// ── Confidence badge ──────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: SitePlanData['confidence'] }) {
  const cfg = {
    high:   { color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20', label: 'High confidence' },
    medium: { color: 'text-amber-400 bg-amber-400/10 border-amber-400/20',       label: 'Medium confidence' },
    low:    { color: 'text-red-400 bg-red-400/10 border-red-400/20',             label: 'Low confidence' },
  }[confidence];
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

// ── Road direction indicator ──────────────────────────────────────────────────

function RoadIndicator({ side }: { side: SitePlanData['road']['side'] }) {
  const arrows: Record<string, string> = {
    north: '↑', south: '↓', east: '→', west: '←',
    'corner-ne': '↗', 'corner-nw': '↖', 'corner-se': '↘', 'corner-sw': '↙',
    unknown: '?',
  };
  return (
    <span className="text-lg text-white/60">{arrows[side] ?? '?'}</span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SitePlanReader({ onSitePlanParsed }: SitePlanReaderProps) {
  const [file,    setFile]    = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [phase,   setPhase]   = useState<'idle' | 'reading' | 'done' | 'error'>('idle');
  const [result,  setResult]  = useState<SitePlanData | null>(null);
  const [error,   setError]   = useState('');

  const onDrop = useCallback((accepted: File[]) => {
    if (!accepted.length) return;
    const f = accepted[0];
    setFile(f);
    setPhase('idle');
    setResult(null);
    const url = URL.createObjectURL(f);
    setPreview(url);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.pdf'] },
    maxFiles: 1,
  });

  const handleRead = async () => {
    if (!file) return;
    setPhase('reading');
    setError('');
    try {
      const data = await analyseSitePlan(file);
      setResult(data);
      setPhase('done');
      onSitePlanParsed(data);
    } catch (e: any) {
      setError(e.message || 'Failed to read site plan');
      setPhase('error');
    }
  };

  const handleReset = () => {
    setFile(null); setPreview(null);
    setPhase('idle'); setResult(null); setError('');
  };

  return (
    <div className="space-y-3">

      {/* Upload area */}
      {!file && (
        <div {...getRootProps()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
            isDragActive
              ? 'border-black bg-gray-50'
              : 'border-gray-200 hover:border-black hover:bg-gray-50'
          }`}>
          <input {...getInputProps()} />
          <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-3">
            <svg className="w-5 h-5 text-black/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-black mb-1">
            {isDragActive ? 'Drop site plan here' : 'Upload site plan or layout'}
          </p>
          <p className="text-xs text-black/30">PNG, JPG, PDF — AI will read dimensions and layout</p>
        </div>
      )}

      {/* Preview + controls */}
      {file && preview && (
        <div className="space-y-3">
          {/* Image preview */}
          <div className="relative rounded-xl overflow-hidden border border-gray-100 bg-gray-50">
            <img src={preview} alt="Site plan" className="w-full h-40 object-contain" />
            <button onClick={handleReset}
              className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center hover:bg-black transition-colors">
              ×
            </button>
          </div>

          {/* Analyse button */}
          {phase === 'idle' && (
            <button onClick={handleRead}
              className="w-full py-2.5 bg-black text-white text-sm font-semibold rounded-xl hover:bg-black/90 transition-colors flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
              </svg>
              Read with AI
            </button>
          )}

          {/* Reading state */}
          {phase === 'reading' && (
            <div className="bg-black rounded-xl p-4 flex items-center gap-3">
              <svg className="animate-spin w-4 h-4 text-white/60 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              <div>
                <p className="text-white text-xs font-medium">Analysing site plan…</p>
                <p className="text-white/30 text-[10px] mt-0.5">Claude vision is reading dimensions and layout</p>
              </div>
            </div>
          )}

          {/* Error */}
          {phase === 'error' && (
            <div className="bg-red-50 border border-red-100 rounded-xl p-4">
              <p className="text-xs font-semibold text-red-800 mb-1">Couldn't read site plan</p>
              <p className="text-[11px] text-red-600">{error}</p>
              <button onClick={()=>setPhase('idle')}
                className="mt-2 text-[11px] font-medium text-black underline">
                Try again
              </button>
            </div>
          )}

          {/* Results */}
          {phase === 'done' && result && (
            <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}}
              className="bg-black rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">
                  Site Plan Read
                </p>
                <ConfidenceBadge confidence={result.confidence}/>
              </div>

              {/* Key data grid */}
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { label: 'Width',  value: `${result.width}m` },
                  { label: 'Length', value: `${result.length}m` },
                  { label: 'Shape',  value: result.shape },
                  { label: 'House',  value: `${result.house.width}m × ${result.house.length}m` },
                ].map((s,i)=>(
                  <div key={i} className="bg-white/5 rounded-lg px-3 py-2">
                    <p className="text-[9px] text-white/30 uppercase tracking-wide mb-0.5">{s.label}</p>
                    <p className="text-xs font-semibold text-white capitalize">{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Road */}
              {result.road.present && (
                <div className="flex items-center gap-3 bg-white/5 rounded-lg px-3 py-2">
                  <RoadIndicator side={result.road.side}/>
                  <div>
                    <p className="text-[9px] text-white/30 uppercase tracking-wide">Road</p>
                    <p className="text-xs font-semibold text-white capitalize">
                      {result.road.side} side · {result.road.width_m}m wide
                    </p>
                  </div>
                </div>
              )}

              {/* Notes */}
              {result.notes && (
                <p className="text-[10px] text-white/30 italic leading-relaxed">{result.notes}</p>
              )}

              {/* Applied badge */}
              <div className="flex items-center gap-1.5 text-emerald-400">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                </svg>
                <span className="text-[11px] font-medium">Applied to 3D environment</span>
              </div>

              <button onClick={handleReset}
                className="w-full py-1.5 text-[11px] text-white/30 hover:text-white border border-white/8 rounded-lg transition-colors">
                Upload different plan
              </button>
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}