'use client';

import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useProjects } from '@/lib/project-store';

function fmt(iso: string) {
  return new Date(iso).toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function StatCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: boolean;
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5">
      <div className="text-[10px] font-semibold text-black/30 uppercase tracking-widest mb-2">{label}</div>
      <div className={`text-2xl font-bold tracking-tight leading-none ${accent ? 'text-red-600' : 'text-black'}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-black/40 mt-1.5">{sub}</div>}
    </div>
  );
}

export default function ReportPage() {
  const router = useRouter();
  const { activeProject } = useProjects();

  const r = activeProject?.report ?? {
    generatedAt:    new Date().toISOString(),
    duration:       '—',
    totalLayers:    activeProject?.totalLayers ?? 0,
    layersPrinted:  0,
    errorsDetected: 0,
    errorRate:      '0%',
    alerts:         [],
    printerName:    activeProject?.printer.name  ?? '—',
    printerModel:   activeProject?.printer.type  ?? '—',
    structureType:  activeProject?.structureType ?? '—',
  };

  const score = r.totalLayers > 0
    ? Math.max(0, Math.round(((r.totalLayers - r.errorsDetected) / r.totalLayers) * 100))
    : 100;

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
        }
      `}</style>

      {/* Header */}
      <header className="border-b border-gray-100 bg-white sticky top-0 z-10 overflow-visible no-print">
        <div className="max-w-7xl mx-auto px-6 py-1 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button onClick={() => router.push('/projects')}
              className="text-sm text-black/40 hover:text-black transition-colors flex items-center space-x-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span>Projects</span>
            </button>
            <div className="h-6 w-px bg-gray-200" />
            <div className="-my-5">
              <Image src="/logo.png" alt="AutoBuild AI" width={400} height={400} className="h-36 w-auto" />
            </div>
            <h1 className="text-xl font-semibold text-black">Print Report</h1>
          </div>
          <button onClick={() => window.print()}
            className="px-4 py-2 bg-black text-white text-sm font-medium rounded-xl hover:bg-black/90 transition-colors">
            Export PDF
          </button>
        </div>
      </header>

      {/* Print-only header */}
      <div className="hidden print:block max-w-4xl mx-auto px-6 pt-8 pb-4 border-b border-gray-200 mb-6">
        <h1 className="text-2xl font-bold text-black">AutoBuild AI — Print Report</h1>
        <p className="text-sm text-black/50 mt-1">{activeProject?.name} · {fmt(r.generatedAt)}</p>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">

        {/* Job summary — black card */}
        <div className="bg-black rounded-2xl px-6 py-5 mb-6">
          <div className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-3">Job Summary</div>
          <div className="grid grid-cols-4 gap-6">
            {[
              { label: 'Project',   value: activeProject?.name ?? '—' },
              { label: 'Structure', value: r.structureType },
              { label: 'Printer',   value: r.printerName  || '—' },
              { label: 'Model',     value: r.printerModel || '—' },
            ].map((s, i) => (
              <div key={i}>
                <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">{s.label}</div>
                <div className="text-sm font-semibold text-white truncate">{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Stat cards — white */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <StatCard label="Total Layers"    value={String(r.totalLayers || '—')} sub="configured" />
          <StatCard label="Layers Printed"  value={String(r.layersPrinted)}      sub={`of ${r.totalLayers}`} />
          <StatCard label="Errors Detected" value={String(r.errorsDetected)}
            sub={r.errorsDetected === 0 ? 'No issues' : `${r.errorRate} error rate`}
            accent={r.errorsDetected > 0} />
          <StatCard label="Duration"        value={r.duration} sub="wall time" />
        </div>

        {/* Quality score — white card */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-semibold text-black/30 uppercase tracking-widest">Quality Score</div>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
              score >= 90 ? 'border-black/10 bg-black/5 text-black' :
              score >= 75 ? 'border-black/10 bg-black/5 text-black' :
                            'border-red-200 bg-red-50 text-red-600'
            }`}>
              {score >= 90 ? 'Excellent' : score >= 75 ? 'Acceptable' : 'Needs Review'}
            </span>
          </div>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-4xl font-bold text-black tracking-tight">{score}</span>
            <span className="text-lg text-black/20 font-medium">/ 100</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-black transition-all duration-1000"
              style={{ width: `${score}%` }}
            />
          </div>
          <p className="text-[11px] text-black/30 mt-2">
            {r.errorsDetected} error{r.errorsDetected !== 1 ? 's' : ''} across {r.totalLayers} layers
          </p>
        </div>

        {/* Alert log — white card */}
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="text-[10px] font-semibold text-black/30 uppercase tracking-widest">Alert Log</div>
            <span className="text-xs text-black/30">{r.alerts.length} event{r.alerts.length !== 1 ? 's' : ''}</span>
          </div>

          {r.alerts.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm font-medium text-black">No alerts recorded</p>
              <p className="text-xs text-black/30 mt-1">Print completed with no detected deviations</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              <div className="grid grid-cols-5 px-5 py-2 bg-gray-50">
                {['Time', 'Camera', 'Layer', 'Deviation', 'Type'].map(h => (
                  <div key={h} className="text-[10px] font-semibold text-black/30 uppercase tracking-wider">{h}</div>
                ))}
              </div>
              {r.alerts.map(a => (
                <div key={a.id} className="grid grid-cols-5 px-5 py-3 items-center">
                  <div className="text-xs text-black/50 font-mono">
                    {new Date(a.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </div>
                  <div className="text-xs font-medium text-black truncate">{a.cameraLabel}</div>
                  <div className="text-xs text-black/50">{a.layer}</div>
                  <div className="text-xs font-mono font-medium text-black">
                    {a.angle > 0 ? '+' : ''}{a.angle}°
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full w-fit border border-black/10 bg-black/5 text-black">
                    {a.type.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-10 no-print">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-black">
              {r.errorsDetected === 0 ? 'Print completed successfully' : `${r.errorsDetected} error${r.errorsDetected !== 1 ? 's' : ''} detected`}
            </p>
            <p className="text-xs text-black/40 mt-0.5">Quality score: {score}/100</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => router.push('/projects')}
              className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl text-black hover:bg-gray-50 transition-colors">
              Back to Projects
            </button>
            <button onClick={() => window.print()}
              className="px-6 py-2.5 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/90 transition-colors">
              Export PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}