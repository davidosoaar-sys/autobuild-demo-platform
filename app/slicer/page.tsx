'use client';

import { useRouter } from 'next/navigation';
import Image from 'next/image';
import BetaGuard from '@/components/BetaGuard';

export default function SlicerHubPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <BetaGuard />
      <button onClick={() => router.push('/')} className="mb-10">
        <Image src="/Autobuildblack.png" alt="AutoBuild AI" width={400} height={400} className="h-16 w-auto" />
      </button>

      <div className="text-center mb-10 max-w-md">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Choose a slicer</h1>
        <p className="text-sm text-gray-500">How would you like to generate your print path?</p>
      </div>

      <div className="w-full max-w-sm space-y-3">
        <button
          onClick={() => router.push('/tools/slicer')}
          className="w-full flex items-start gap-4 bg-white border border-gray-100 hover:bg-black hover:text-white hover:border-black rounded-2xl p-5 text-left shadow-sm hover:shadow-md transition-all group">
          <div className="mt-0.5 flex-shrink-0">
            <svg className="w-5 h-5 text-gray-500 group-hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold">Traditional Slicer</p>
            <p className="text-xs text-gray-500 group-hover:text-white/60 mt-0.5 leading-relaxed">
              Upload a 3D model (STL, OBJ, STP, DXF, IFC) and slice it into print layers.
            </p>
          </div>
        </button>

        <button
          onClick={() => router.push('/floorplan')}
          className="w-full flex items-start gap-4 bg-white border border-gray-100 hover:bg-black hover:text-white hover:border-black rounded-2xl p-5 text-left shadow-sm hover:shadow-md transition-all group">
          <div className="mt-0.5 flex-shrink-0">
            <svg className="w-5 h-5 text-gray-500 group-hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-1.447-.894L15 9m0 8V9m0 0L9 7" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold">Floor Plan Slicer</p>
            <p className="text-xs text-gray-500 group-hover:text-white/60 mt-0.5 leading-relaxed">
              Upload a PDF floor plan and extract wall geometry as a print path.
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}
