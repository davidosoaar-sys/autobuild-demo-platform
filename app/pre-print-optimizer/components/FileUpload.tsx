'use client';

import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

export interface SiteDimensions {
  width:  number;
  length: number;
  slope:  number;
}

export interface ModelDimensions {
  x: number;
  y: number;
  z: number;
}

interface FileUploadProps {
  file:           File | null;
  onFileChange:   (file: File | null) => void;
  onScaleChange?: (scale: number) => void;
  printScale?:    number;
}

const PRESET_SCALES = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

export default function FileUpload({
  file, onFileChange, onScaleChange, printScale = 1.0,
}: FileUploadProps) {
  const [customScale, setCustomScale] = React.useState('');
  const [useCustom,   setUseCustom]   = React.useState(false);

  const handlePresetScale = (s: number) => {
    setUseCustom(false);
    setCustomScale('');
    onScaleChange?.(s);
  };

  const handleCustomScale = (raw: string) => {
    setCustomScale(raw);
    const v = parseFloat(raw);
    if (v > 0 && v <= 10) onScaleChange?.(parseFloat(v.toFixed(3)));
  };

  const onDropModel = useCallback((f: File[]) => {
    if (f.length) onFileChange(f[0]);
  }, [onFileChange]);

  const { getRootProps: getModelProps, getInputProps: getModelInput, isDragActive: isDragModel } = useDropzone({
    onDrop: onDropModel,
    accept: {
      'model/stl':                ['.stl'],
      'model/obj':                ['.obj'],
      'application/octet-stream': ['.stl', '.obj', '.stp', '.step', '.dxf', '.ifc'],
      'application/step':         ['.stp', '.step'],
      'application/dxf':          ['.dxf'],
      'application/ifc':          ['.ifc'],
    },
    maxFiles: 1,
  });

  const fileExt = file ? file.name.split('.').pop()?.toUpperCase() : null;

  return (
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
            }`}>
            <input {...getModelInput()} />
            <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-black/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
              </svg>
            </div>
            <p className="text-sm font-medium text-black mb-1">
              {isDragModel ? 'Drop 3D model here' : 'Drop your 3D model or click to browse'}
            </p>
            <p className="text-xs text-black/30">.stl · .obj · .stp · .dxf · .ifc</p>
          </div>
        </div>
      ) : (
        <>
          {/* File info */}
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center flex-shrink-0">
                <span className="text-[9px] font-bold text-white uppercase">{fileExt}</span>
              </div>
              <div>
                <p className="text-xs font-medium text-black truncate max-w-[180px]">{file.name}</p>
                <p className="text-[10px] text-black/40">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            </div>
            <button
              onClick={() => onFileChange(null)}
              className="text-xs text-black/30 hover:text-black border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
              Replace
            </button>
          </div>

          {/* Print Scale */}
          <div className="px-5 pb-5 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-black">
                Print Scale
                <span className="ml-1.5 text-[10px] text-black/30 font-normal">— scales geometry and time</span>
              </label>
              <span className="text-xs font-bold text-black font-mono">{printScale.toFixed(2)}×</span>
            </div>

            <div className="flex items-center gap-1.5 mb-2">
              {PRESET_SCALES.map(s => (
                <button key={s} onClick={() => handlePresetScale(s)}
                  className={`flex-1 py-1.5 text-[11px] font-semibold rounded-lg border transition-colors ${
                    !useCustom && printScale === s
                      ? 'bg-black text-white border-black'
                      : 'text-black/50 border-gray-200 hover:border-black hover:text-black'
                  }`}>
                  {s}×
                </button>
              ))}
              <button onClick={() => setUseCustom(true)}
                className={`px-2 py-1.5 text-[11px] font-semibold rounded-lg border transition-colors ${
                  useCustom ? 'bg-black text-white border-black' : 'text-black/50 border-gray-200 hover:border-black hover:text-black'
                }`}>
                Custom
              </button>
            </div>

            {useCustom && (
              <div className="flex items-center gap-2 mb-2">
                <input type="number" min={0.1} max={10} step={0.05}
                  placeholder="e.g. 1.75" value={customScale}
                  onChange={e => handleCustomScale(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-black text-black placeholder:text-black/20"
                  autoFocus/>
                <span className="text-xs text-black/40">×</span>
              </div>
            )}

            <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
              {printScale === 1.0 ? (
                <p className="text-[10px] text-black/40">Original size — all dimensions as modelled</p>
              ) : (
                <p className="text-[10px] text-black/60 font-medium">
                  Scaled {printScale}× · Material volume scales by {(printScale ** 3).toFixed(2)}×
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}