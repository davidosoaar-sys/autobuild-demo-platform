'use client';

import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import SitePlanReader, { SitePlanData } from './SitePlanReader';

export interface SiteDimensions {
  width:  number;
  length: number;
  slope:  number;
}

interface FileUploadProps {
  file:                 File | null;
  onFileChange:         (file: File | null) => void;
  onSiteChange?:        (site: SiteDimensions) => void;
  onSitePlanParsed?:    (data: SitePlanData) => void;
}

export default function FileUpload({ file, onFileChange, onSiteChange, onSitePlanParsed }: FileUploadProps) {
  const [site, setSite] = React.useState<SiteDimensions>({ width: 0, length: 0, slope: 0 });

  const updateSite = (key: keyof SiteDimensions, raw: string) => {
    const val     = parseFloat(raw) || 0;
    const updated = { ...site, [key]: val };
    setSite(updated);
    onSiteChange?.(updated);
  };

  // When AI reads site plan, auto-populate dimensions
  const handleSitePlanParsed = (data: SitePlanData) => {
    const updated: SiteDimensions = {
      width:  data.width,
      length: data.length,
      slope:  site.slope,
    };
    setSite(updated);
    onSiteChange?.(updated);
    onSitePlanParsed?.(data);
  };

  const onDropModel = useCallback((f: File[]) => { if (f.length) onFileChange(f[0]); }, [onFileChange]);

  const { getRootProps: getModelProps, getInputProps: getModelInput, isDragActive: isDragModel } = useDropzone({
    onDrop: onDropModel,
    accept: { 'model/stl': ['.stl'], 'model/obj': ['.obj'], 'application/octet-stream': ['.stl', '.obj'] },
    maxFiles: 1,
  });

  return (
    <div className="space-y-4">

      {/* 3D Model */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 pt-5">
          <h2 className="text-[10px] font-semibold text-black/40 uppercase tracking-widest mb-4">
            3D Building Model
          </h2>
        </div>

        {!file ? (
          <div className="px-5 pb-5">
            <div {...getModelProps()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                isDragModel ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-black hover:bg-gray-50'
              }`}
            >
              <input {...getModelInput()} />
              <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-3">
                <svg className="w-5 h-5 text-black/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
                </svg>
              </div>
              <p className="text-sm font-medium text-black mb-1">
                {isDragModel ? 'Drop 3D model here' : 'Drop your 3D model or click to browse'}
              </p>
              <p className="text-xs text-black/30">.stl and .obj supported</p>
            </div>
          </div>
        ) : (
          <>
            {/* File info */}
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center flex-shrink-0">
                  <span className="text-[9px] font-bold text-white uppercase">
                    {file.name.split('.').pop()}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-medium text-black truncate max-w-[160px]">{file.name}</p>
                  <p className="text-[10px] text-black/40">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              </div>
              <button
                {...(getModelProps() as any)}
                onClick={() => onFileChange(null)}
                className="text-xs text-black/30 hover:text-black border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
              >
                Replace
              </button>
              <input {...getModelInput()} />
            </div>
          </>
        )}
      </div>

      {/* Site Details */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <h2 className="text-[10px] font-semibold text-black/40 uppercase tracking-widest mb-4">
          Site Details
        </h2>

        {/* Dimensions — Width + Length only, slope from env parameters */}
        <div className="mb-5">
          <label className="text-xs font-medium text-black mb-2 block">
            Site Dimensions
            <span className="text-black/30 font-normal ml-1.5">— updates the 3D environment</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <input
                type="number" placeholder="Width" min={0}
                value={site.width || ''}
                onChange={e => updateSite('width', e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-black transition-colors text-black placeholder:text-black/20"
              />
              <p className="text-[10px] text-black/30 mt-1">Width (m)</p>
            </div>
            <div>
              <input
                type="number" placeholder="Length" min={0}
                value={site.length || ''}
                onChange={e => updateSite('length', e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-black transition-colors text-black placeholder:text-black/20"
              />
              <p className="text-[10px] text-black/30 mt-1">Length (m)</p>
            </div>
          </div>
          {(site.width > 0 || site.length > 0) && (
            <p className="text-[10px] text-emerald-600 mt-2">
              Site set to {site.width}m × {site.length}m — 3D view will update
            </p>
          )}
        </div>

        {/* Site Plan — AI reader */}
        <div>
          <label className="text-xs font-medium text-black mb-2 block">
            Site Plan
            <span className="ml-1.5 text-[10px] text-black/30 font-normal">— AI reads dimensions and road position</span>
          </label>
          <SitePlanReader onSitePlanParsed={handleSitePlanParsed}/>
        </div>
      </div>
    </div>
  );
}