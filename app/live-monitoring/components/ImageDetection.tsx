'use client';

import { useState } from 'react';
import { Upload, X } from 'lucide-react';

const TOTAL_LAYERS = 22;
const NORMAL_LAYERS = 6;
const DEFECTED_LAYERS = 16;

const LOADING_STATUSES = [
  'Counting visible layers...',
  'Detecting crack propagation...',
  'Classifying defect types...',
  'Finalizing report...',
];

const metrics = [
  { label: 'Total Layers', value: String(TOTAL_LAYERS) },
  { label: 'Error Type', value: 'Cracked Layers' },
  { label: 'Normal Layers', value: String(NORMAL_LAYERS) },
  { label: 'Defected Layers', value: String(DEFECTED_LAYERS) },
];

export default function ImageDetection() {
  const [image, setImage] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'results'>('idle');
  const [statusIdx, setStatusIdx] = useState(0);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImage(event.target?.result as string);
        setPhase('idle');
      };
      reader.readAsDataURL(file);
    }
  };

  const clearImage = () => {
    setImage(null);
    setPhase('idle');
    setStatusIdx(0);
  };

  const runDetection = () => {
    setPhase('loading');
    setStatusIdx(0);
    let idx = 0;
    const ticker = setInterval(() => {
      idx++;
      if (idx < LOADING_STATUSES.length) setStatusIdx(idx);
    }, 900);
    setTimeout(() => {
      clearInterval(ticker);
      setPhase('results');
    }, 3800);
  };

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Left Column */}
      <div className="space-y-4">
        <div className="border-2 border-dashed border-gray-300 rounded-lg overflow-hidden">
          {image ? (
            <div className="relative bg-gray-100 h-[400px] flex items-center justify-center">
              <img src={image} alt="Uploaded" className="max-w-full max-h-full object-contain" />
              <button
                onClick={clearImage}
                className="absolute top-2 right-2 p-2 bg-black text-white rounded-full hover:bg-gray-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="p-12 h-[400px] flex items-center justify-center">
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
                id="image-upload"
              />
              <label htmlFor="image-upload" className="flex flex-col items-center cursor-pointer">
                <Upload className="w-12 h-12 text-gray-400 mb-4" />
                <span className="text-sm text-gray-600">Click to upload 3DCP image</span>
              </label>
            </div>
          )}
        </div>

        {image && (
          <button
            onClick={runDetection}
            disabled={phase === 'loading'}
            className="w-full py-3 bg-black text-white rounded-lg hover:bg-gray-800 disabled:bg-gray-600 transition-colors text-sm font-medium"
          >
            {phase === 'loading' ? LOADING_STATUSES[statusIdx] : 'Run Detection'}
          </button>
        )}
      </div>

      {/* Right Column */}
      <div className="flex flex-col">
        {(phase === 'idle' || phase === 'loading') && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-gray-400">
              {phase === 'loading' ? (
                <>
                  <div className="inline-block w-5 h-5 border-2 border-gray-300 border-t-black rounded-full animate-spin mb-3" />
                  <p className="text-sm">{LOADING_STATUSES[statusIdx]}</p>
                </>
              ) : (
                <>
                  <p className="text-sm">Upload an image and run detection</p>
                  <p className="text-xs mt-1">Results will appear here</p>
                </>
              )}
            </div>
          </div>
        )}

        {phase === 'results' && (
          <div className="bg-black rounded-2xl p-6 flex flex-col gap-6">
            {/* Header */}
            <div>
              <p className="text-xs text-white/30 uppercase tracking-[0.15em] mb-1">Output</p>
              <h3 className="text-white text-xl font-semibold tracking-tight">Image Analysis</h3>
            </div>

            {/* Metrics list */}
            <div className="flex flex-col">
              {metrics.map(({ label, value }, i) => (
                <div
                  key={label}
                  className={`flex items-center justify-between py-3 ${
                    i < metrics.length - 1 ? 'border-b border-white/10' : ''
                  }`}
                >
                  <span className="text-sm text-white">{label}</span>
                  <span className="text-sm text-white font-medium">{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}