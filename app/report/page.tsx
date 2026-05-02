'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useProjects } from '@/lib/project-store';

function fmt(iso: string) {
  return new Date(iso).toLocaleString([], {
    year:'numeric', month:'short', day:'numeric',
    hour:'2-digit', minute:'2-digit',
  });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

const labelCls = 'text-[10px] font-semibold text-black/30 uppercase tracking-widest';

function Row({ label, value, mono }: { label:string; value:string; mono?:boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-black/40">{label}</span>
      <span className={`text-xs font-semibold ${mono?'font-mono':''} text-black`}>{value || '—'}</span>
    </div>
  );
}

function Section({ title, children }: { title:string; children:React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50">
        <p className={labelCls}>{title}</p>
      </div>
      <div className="px-5 py-1">{children}</div>
    </div>
  );
}

export default function ReportPage() {
  const router = useRouter();
  const { activeProject } = useProjects();

  // Show ToS on first visit
  const [tosAccepted, setTosAccepted] = React.useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('autobuild_tos_accepted') === 'true';
  });

  const acceptTos = () => {
    localStorage.setItem('autobuild_tos_accepted', 'true');
    setTosAccepted(true);
  };
  const r = activeProject?.report as any ?? {};

  const score = r.totalLayers > 0
    ? Math.max(0, Math.round(((r.totalLayers - (r.errorsDetected ?? 0)) / r.totalLayers) * 100))
    : 100;
  const scoreLabel = score >= 90 ? 'Excellent' : score >= 75 ? 'Acceptable' : 'Needs Review';

  if (!tosAccepted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white border border-gray-100 rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
          <div className="bg-black px-6 py-5">
            <Image src="/Autobuildblack.png" alt="AutoBuild AI" width={200} height={200} className="h-16 w-auto mb-3"/>
            <p className="text-white font-bold text-lg">Before you continue</p>
            <p className="text-white/50 text-xs mt-1">Please review our terms before accessing your print report.</p>
          </div>
          <div className="px-6 py-5 space-y-3 text-xs text-black/50 leading-relaxed max-h-64 overflow-y-auto border-b border-gray-100">
            <p><strong className="text-black">AI Analysis Limitations.</strong> AutoBuild AI uses Claude Vision to assess concrete bead quality. These outputs are decision-support tools only and are not a substitute for qualified engineering judgement.</p>
            <p><strong className="text-black">No Warranty.</strong> Results are provided "as is." AutoBuild AI does not guarantee accuracy of defect detection, angle measurements, or path optimisation outputs.</p>
            <p><strong className="text-black">Your Responsibility.</strong> You are solely responsible for all decisions made during the printing process based on platform outputs.</p>
            <p><strong className="text-black">Data.</strong> Camera frames and images are processed via Anthropic's API and are not permanently stored by AutoBuild AI.</p>
            <p className="text-black/30">By clicking "Accept & Continue" you agree to the full <button onClick={() => router.push('/tos')} className="underline hover:text-black">Terms of Service</button>.</p>
          </div>
          <div className="px-6 py-4 flex gap-3">
            <button onClick={() => router.push('/projects')}
              className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl text-black/40 hover:text-black hover:border-black transition-colors">
              Cancel
            </button>
            <button onClick={acceptTos}
              className="flex-1 py-2.5 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/80 transition-colors">
              Accept & Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-28" id="report-root">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          #report-root { padding: 0; }
          .print-break { page-break-before: always; }
        }
      `}</style>

      {/* Header */}
      <header className="border-b border-gray-100 bg-white sticky top-0 z-10 no-print">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-1 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/projects')}
              className="text-sm text-black/40 hover:text-black transition-colors flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
              </svg>
              <span className="hidden sm:inline">Projects</span>
            </button>
            <div className="h-6 w-px bg-gray-200 hidden sm:block"/>
            <div className="-my-4 sm:-my-5">
              <Image src="/Autobuildblack.png" alt="AutoBuild AI" width={400} height={400} className="h-20 sm:h-28 w-auto"/>
            </div>
            <h1 className="text-base sm:text-lg font-semibold text-black">Print Report</h1>
          </div>
          <div className="flex items-center gap-2 no-print">
            <button onClick={() => router.push('/tos')}
              className="px-3 py-2 text-xs text-black/40 hover:text-black transition-colors">
              Terms
            </button>
            <button onClick={() => window.print()}
              className="px-3 sm:px-4 py-2 bg-black text-white text-xs sm:text-sm font-medium rounded-xl hover:bg-black/90 transition-colors">
              Export PDF
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-4">

        {/* Print-only header */}
        <div className="hidden print:flex items-center justify-between mb-6">
          <div>
            <p className="text-2xl font-bold text-black">AutoBuild AI</p>
            <p className="text-xs text-black/40 mt-0.5">3DCP Quality Report</p>
          </div>
          <p className="text-xs text-black/30">{r.generatedAt ? fmt(r.generatedAt) : ''}</p>
        </div>

        {/* Job hero */}
        <div className="bg-black rounded-2xl px-5 py-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1">Project</p>
              <p className="text-xl font-bold text-white">{activeProject?.name ?? '—'}</p>
              {r.printStartedAt && <p className="text-[11px] text-white/35 mt-1">{fmt(r.printStartedAt)}</p>}
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1">Quality</p>
              <p className="text-2xl font-bold text-white">{score}<span className="text-sm text-white/30 ml-0.5">/100</span></p>
              <p className="text-[11px] font-medium text-white/50">{scoreLabel}</p>
            </div>
          </div>
          <div className="h-px bg-white/10 mb-4"/>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label:'Build Duration', value: r.duration ?? '—' },
              { label:'Total Layers',   value: r.totalLayers ? String(r.totalLayers) : '—' },
              { label:'Printer',        value: r.printerName ?? activeProject?.printer?.name ?? '—' },
              { label:'Structure',      value: r.structureType ?? activeProject?.structureType ?? '—' },
            ].map((s,i) => (
              <div key={i}>
                <p className="text-[9px] text-white/25 uppercase tracking-wider mb-0.5">{s.label}</p>
                <p className="text-sm font-semibold text-white">{s.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Quality score */}
        <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <p className={labelCls}>Quality Score</p>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
              score >= 90 ? 'border-black/10 bg-black/5 text-black' :
              score >= 75 ? 'border-black/10 bg-black/5 text-black' :
                            'border-red-200 bg-red-50 text-red-600'
            }`}>{scoreLabel}</span>
          </div>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-4xl font-bold text-black tracking-tight">{score}</span>
            <span className="text-lg text-black/20">/ 100</span>
          </div>
          <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-black" style={{width:`${score}%`}}/>
          </div>
          <p className="text-[11px] text-black/30 mt-2">
            {r.errorsDetected ?? 0} error{(r.errorsDetected ?? 0) !== 1 ? 's' : ''} across {r.totalLayers ?? 0} layers
          </p>
        </div>

        {/* Material */}
        <Section title="Material">
          <Row label="Material"     value={r.materialName ?? '—'}/>
          <Row label="Batch Number" value={r.batchNumber  ?? '—'} mono/>
          <Row label="Env Risk"     value={r.envRisk != null ? `${r.envRisk}/100` : '—'}/>
        </Section>

        {/* Print parameters */}
        <Section title="Print Parameters">
          <Row label="Layer Height"    value={r.layerHeight    ? `${r.layerHeight} mm`        : '—'}/>
          <Row label="Nozzle"          value={r.nozzle         ? `${r.nozzle} mm`             : '—'}/>
          <Row label="Total Layers"    value={r.totalLayers    ? String(r.totalLayers)         : '—'}/>
          <Row label="Total Segments"  value={r.totalSegments  ? String(r.totalSegments)       : '—'}/>
          <Row label="Travel Saved"    value={r.travelSaved    != null ? `${r.travelSaved}%`   : '—'}/>
          <Row label="Computed In"     value={r.computedIn     ? `${r.computedIn}s`            : '—'} mono/>
          <Row label="Bead Scans"      value={r.beadScans      != null ? String(r.beadScans)   : '—'}/>
          <Row label="Total Alerts"    value={r.totalAlerts    != null ? String(r.totalAlerts) : '—'}/>
          <Row label="Print Speed"     value={r.printSpeed     != null ? `${r.printSpeed} mm/s`     : '—'}/>
          <Row label="Extrusion Rate"  value={r.extrusionRate  != null ? `${r.extrusionRate}%`       : '—'}/>
          <Row label="Pump Speed"      value={r.pumpSpeed      != null ? `${r.pumpSpeed} mm/s`       : '—'}/>
          <Row label="Extruder Speed"  value={r.extruderSpeed  != null ? `${r.extruderSpeed} mm/s`   : '—'}/>
        </Section>

        {/* Site conditions */}
        <Section title="Site Conditions">
          <Row label="Temperature" value={r.conditions?.temperature != null ? `${r.conditions.temperature}°C` : '—'}/>
          <Row label="Humidity"    value={r.conditions?.humidity    != null ? `${r.conditions.humidity}%`     : '—'}/>
          <Row label="Wind Speed"  value={r.conditions?.windSpeed   != null ? `${r.conditions.windSpeed} km/h` : '—'}/>
        </Section>

        {/* G-code reference */}
        <Section title="G-code Reference">
          <Row label="File"      value={r.gcodeRef    ?? '—'} mono/>
          <Row label="Lines"     value={r.gcodeLines  ? String(r.gcodeLines) : '—'} mono/>
          <Row label="Generated" value={r.printStartedAt ? fmt(r.printStartedAt) : '—'}/>
        </Section>

        {/* Event log */}
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
            <p className={labelCls}>Event Log</p>
            <span className="text-[10px] text-black/30">
              {(r.events?.length ?? 0) + (r.alerts?.length ?? 0)} events
            </span>
          </div>
          <div className="divide-y divide-gray-50">
            {(r.events ?? []).map((e: any, i: number) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3">
                <span className="text-[10px] font-mono text-black/35 w-20 flex-shrink-0">{fmtTime(e.time)}</span>
                <span className="w-1.5 h-1.5 rounded-full bg-black/20 flex-shrink-0"/>
                <span className="text-xs text-black/60 flex-1">{e.label}</span>
                <span className="text-[9px] font-semibold uppercase tracking-wider text-black/25">{e.type}</span>
              </div>
            ))}
            {(r.alerts ?? []).map((a: any) => (
              <div key={a.id ?? a.time} className="flex items-center gap-4 px-5 py-3">
                <span className="text-[10px] font-mono text-black/35 w-20 flex-shrink-0">
                  {fmtTime(a.time)}
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-black flex-shrink-0"/>
                <span className="text-xs text-black/60 flex-1">{a.message ?? `Layer ${a.layer}`}</span>
                <span className="text-[9px] font-semibold uppercase tracking-wider text-black/40">alert</span>
              </div>
            ))}
            {(!r.events?.length && !r.alerts?.length) && (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-black/30">No events recorded</p>
              </div>
            )}
          </div>
        </div>

        {/* Print Controls Log */}
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
            <p className={labelCls}>Print Controls Log</p>
            <span className="text-[10px] text-black/30">
              {(r.controlHistory?.length ?? 0)} change{(r.controlHistory?.length ?? 0) !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="divide-y divide-gray-50">
            {(!r.controlHistory?.length) ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-black/30">No manual control changes recorded</p>
              </div>
            ) : (r.controlHistory as { time: string; control: string; value: string }[]).map((c, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3">
                <span className="text-[10px] font-mono text-black/35 w-20 flex-shrink-0">{c.time}</span>
                <span className="w-1.5 h-1.5 rounded-full bg-black/20 flex-shrink-0"/>
                <span className="text-xs text-black/60 flex-1">{c.control}</span>
                <span className="text-[10px] font-mono font-semibold text-black/50">{c.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pt-2 pb-4">
          <p className="text-[10px] text-black/20">
            Generated by AutoBuild AI · {r.generatedAt ? fmt(r.generatedAt) : '—'}
          </p>
          <button onClick={() => router.push('/tos')}
            className="text-[10px] text-black/20 hover:text-black/40 underline mt-1 no-print">
            Terms of Service
          </button>
        </div>

      </div>

      {/* Bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-10 no-print">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-black">
              {(r.errorsDetected ?? 0) === 0 ? 'Print completed successfully' : `${r.errorsDetected} error${r.errorsDetected !== 1 ? 's' : ''} detected`}
            </p>
            <p className="text-xs text-black/35 mt-0.5">Quality score: {score}/100</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => router.push('/projects')}
              className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl text-black hover:bg-gray-50 transition-colors">
              Projects
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