'use client';

import Link from 'next/link';
import Image from 'next/image';
import { DefectDetectionPanel } from '@/app/live-monitoring/page';

export default function ImageAnalysisPage() {
  return (
    <div className="inspection-workspace">
      <header className="inspection-glass inspection-topbar">
        <div className="inspection-header-inner">
          <Link href="/" className="inspection-brand" aria-label="AutoBuild home">
            <Image src="/Autobuildblack.png" alt="AutoBuild" width={400} height={400} priority />
          </Link>
          <nav className="inspection-switch" aria-label="Inspection workspace">
            <Link href="/live-monitoring">Live Monitor</Link>
            <Link href="/tools/image-analysis" aria-current="page">Image Analysis</Link>
          </nav>
        </div>
      </header>
      <main className="inspection-content">
        <div className="inspection-heading">
          <div>
            <h1>Image Analysis</h1>
            <p>Review what AutoBuild sees in a printed layer, then confirm or correct the result.</p>
          </div>
        </div>
        <DefectDetectionPanel onAlert={() => {}} />
      </main>
    </div>
  );
}
