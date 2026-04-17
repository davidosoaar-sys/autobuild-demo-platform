'use client';

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

function Row({ label, value, mono, accent }: { label:string; value:string; mono?:boolean; accent?:string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-black/40">{label}</span>
      <span className={`text-xs font-semibold ${mono?'font-mono':''} ${accent??'text-black'}`}>{value}</span>
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
  const r = activeProject?.report as any ?? {};

  const score = r.totalLayers > 0
    ? Math.max(0, Math.round(((r.totalLayers - (r.errorsDetected??0)) / r.totalLayers) * 100))
    : 100;

  const scoreLabel = score >= 90 ? 'Excellent' : score >= 75 ? 'Acceptable' : 'Needs Review';
  const scoreColor = score >= 90 ? 'text-emerald-600' : score >= 75 ? 'text-amber-500' : 'text-red-500';

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <style>{`@media print { .no-print{display:none!important} body{background:white} }`}</style>

      {/* Header */}
      <header className="border-b border-gray-100 bg-white sticky top-0 z-10 no-print">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-1 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={()=>router.push('/projects')}
              className="text-sm text-black/40 hover:text-black transition-colors flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
              </svg>
              <span className="hidden sm:inline">Projects</span>
            </button>
            <div className="h-6 w-px bg-gray-200 hidden sm:block"/>
            <div className="-my-4 sm:-my-5">
              <Image src="/logo.png" alt="AutoBuild AI" width={400} height={400} className="h-20 sm:h-28 w-auto"/>
            </div>
            <h1 className="text-base sm:text-lg font-semibold text-black">Print Report</h1>
          </div>
          <button onClick={()=>window.print()}
            className="px-3 sm:px-4 py-2 bg-black text-white text-xs sm:text-sm font-medium rounded-xl hover:bg-black/90 transition-colors flex-shrink-0 no-print">
            Export PDF
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-4">

        {/* Job hero */}
        <div className="bg-black rounded-2xl px-5 py-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1">Project</p>
              <p className="text-xl font-bold text-white">{activeProject?.name ?? '—'}</p>
              {r.printStartedAt && (
                <p className="text-[11px] text-white/35 mt-1">{fmt(r.printStartedAt)}</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1">Quality</p>
              <p className={`text-2xl font-bold ${scoreColor}`}>{score}<span className="text-sm text-white/30 ml-0.5">/100</span></p>
              <p className={`text-[11px] font-medium ${scoreColor}`}>{scoreLabel}</p>
            </div>
          </div>
          <div className="h-px bg-white/10 mb-4"/>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label:'Build Duration', value: r.duration ?? '—' },
              { label:'Total Layers',   value: r.totalLayers ? String(r.totalLayers) : '—' },
              { label:'Printer',        value: r.printerName ?? '—' },
              { label:'Structure',      value: r.structureType ?? '—' },
            ].map((s,i)=>(
              <div key={i}>
                <p className="text-[9px] text-white/25 uppercase tracking-wider mb-0.5">{s.label}</p>
                <p className="text-sm font-semibold text-white">{s.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Quality bar */}
        <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <p className={labelCls}>Quality Score</p>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
              score>=90 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
              score>=75 ? 'border-amber-200 bg-amber-50 text-amber-700' :
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
            {r.errorsDetected ?? 0} error{(r.errorsDetected??0)!==1?'s':''} across {r.totalLayers ?? 0} layers
          </p>
        </div>

        {/* Material + batch */}
        <Section title="Material">
          <Row label="Material"     value={r.materialName ?? '—'}/>
          <Row label="Batch Number" value={r.batchNumber  ?? '—'} mono/>
          <Row label="Env Risk"
            value={r.envRisk != null ? `${r.envRisk}/100` : '—'}
            accent={r.envRisk < 20 ? 'text-emerald-600' : r.envRisk < 50 ? 'text-amber-500' : 'text-red-500'}/>
        </Section>

        {/* Print parameters */}
        <Section title="Print Parameters">
          <Row label="Layer Height"   value={r.layerHeight  ? `${r.layerHeight} mm`  : '—'}/>
          <Row label="Nozzle"         value={r.nozzle       ? `${r.nozzle} mm`       : '—'}/>
          <Row label="Total Layers"   value={r.totalLayers  ? String(r.totalLayers)  : '—'}/>
          <Row label="Total Segments" value={r.totalSegments ? String(r.totalSegments) : '—'}/>
          <Row label="Travel Saved"   value={r.travelSaved  != null ? `${r.travelSaved}%` : '—'} accent="text-emerald-600"/>
          <Row label="Computed In"    value={r.computedIn   ? `${r.computedIn}s`     : '—'} mono/>
        </Section>

        {/* Conditions */}
        <Section title="Site Conditions">
          <Row label="Temperature" value={r.conditions?.temperature != null ? `${r.conditions.temperature}°C` : '—'}/>
          <Row label="Humidity"    value={r.conditions?.humidity    != null ? `${r.conditions.humidity}%`    : '—'}/>
          <Row label="Wind Speed"  value={r.conditions?.windSpeed   != null ? `${r.conditions.windSpeed} km/h` : '—'}/>
        </Section>

        {/* G-code reference */}
        <Section title="G-code Reference">
          <Row label="File"        value={r.gcodeRef   ?? '—'} mono/>
          <Row label="Lines"       value={r.gcodeLines ? String(r.gcodeLines) : '—'} mono/>
          <Row label="Generated"   value={r.printStartedAt ? fmt(r.printStartedAt) : '—'}/>
        </Section>

        {/* Event timestamps */}
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
            <p className={labelCls}>Event Log</p>
            <span className="text-[10px] text-black/30">{(r.events?.length ?? 0) + (r.alerts?.length ?? 0)} events</span>
          </div>
          <div className="divide-y divide-gray-50">
            {/* System events */}
            {(r.events ?? []).map((e: any, i: number) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3">
                <span className="text-[10px] font-mono text-black/35 w-20 flex-shrink-0">{fmtTime(e.time)}</span>
                <span className="w-1.5 h-1.5 rounded-full bg-black/20 flex-shrink-0"/>
                <span className="text-xs text-black/60 flex-1">{e.label}</span>
                <span className="text-[9px] font-semibold uppercase tracking-wider text-black/25">{e.type}</span>
              </div>
            ))}
            {/* Alerts */}
            {(r.alerts ?? []).map((a: any) => (
              <div key={a.id} className="flex items-center gap-4 px-5 py-3">
                <span className="text-[10px] font-mono text-black/35 w-20 flex-shrink-0">
                  {new Date(a.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0"/>
                <span className="text-xs text-black/60 flex-1">{a.cameraLabel} · Layer {a.layer} · {a.angle > 0 ? '+' : ''}{a.angle}°</span>
                <span className="text-[9px] font-semibold uppercase tracking-wider text-red-500">{a.type}</span>
              </div>
            ))}
            {(!r.events?.length && !r.alerts?.length) && (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-black/30">No events recorded</p>
              </div>
            )}
          </div>
        </div>

        {/* Report footer */}
        <div className="text-center pt-2">
          <p className="text-[10px] text-black/20">
            Generated by AutoBuild AI · {r.generatedAt ? fmt(r.generatedAt) : '—'}
          </p>
        </div>

      </div>

      {/* Bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-10 no-print">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-black">
              {(r.errorsDetected??0) === 0 ? 'Print completed successfully' : `${r.errorsDetected} error${r.errorsDetected!==1?'s':''} detected`}
            </p>
            <p className="text-xs text-black/35 mt-0.5">Quality score: {score}/100</p>
          </div>
          <div className="flex gap-2">
            <button onClick={()=>router.push('/projects')}
              className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl text-black hover:bg-gray-50 transition-colors">
              Projects
            </button>
            <button onClick={()=>window.print()}
              className="px-6 py-2.5 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/90 transition-colors">
              Export PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}