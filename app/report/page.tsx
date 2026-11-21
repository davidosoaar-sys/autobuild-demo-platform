'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import WorkspaceThemeToggle from '@/components/WorkspaceThemeToggle';
import { buildPostPrintExport, summarizeLayers } from '@/lib/post-print-evidence.mjs';
import { actionClass, panelClass, projectRoute, ReviewList, usePostPrint } from '@/lib/post-print-workspace';

function fmt(iso: string) {
  return new Date(iso).toLocaleString([], {
    year:'numeric', month:'short', day:'numeric',
    hour:'2-digit', minute:'2-digit',
  });
}

function fmtTime(iso: string) {
  return Number.isFinite(Date.parse(iso)) ? fmt(iso) : iso || 'Unknown';
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
  const { project: activeProject, evidence, loading, pending, error } = usePostPrint();

  // Show ToS on first visit
  const [tosAccepted, setTosAccepted] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    try { setTosAccepted(localStorage.getItem('autobuild_tos_accepted') === 'true'); } catch { setTosAccepted(false); }
  }, []);

  const acceptTos = () => {
    localStorage.setItem('autobuild_tos_accepted', 'true');
    setTosAccepted(true);
  };
  const r = activeProject?.report as any ?? {};

  const record = activeProject ? buildPostPrintExport(activeProject, evidence, new Date().toISOString()) : null;
  const coverage = summarizeLayers(evidence, record?.run.alerts ?? []);
  const problemLayers = coverage.layers.filter(layer => layer.status === 'finding' || layer.status === 'alert');
  const findings = evidence?.reviews.filter(review => review.defectType !== 'none') ?? [];
  const checkedFlags = findings.filter(review => review.disposition !== 'missed' && review.suggestion?.verdict === 'defect' && review.suggestion.defectType !== 'none');
  const missed = findings.filter(review => review.disposition === 'missed');
  function downloadEvidence() {
    if (!record || loading || pending || error) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `autobuild-evidence-${record.exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (tosAccepted === false) {
    return (
      <div className="print-workspace min-h-screen flex items-center justify-center p-4">
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
            <p><strong className="text-black">Data.</strong> Saved post-print reviews contain thumbnails stored in this browser. Optional AI analysis sends the photo to the analysis service.</p>
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

  if (tosAccepted === null || loading || pending || !activeProject) return <main className="mx-auto max-w-3xl p-6">
    <h1 className="text-xl font-semibold">Print Report</h1>
    {tosAccepted === null || loading || pending ? <p role="status">Loading print record…</p> : <p>Choose a project from <Link href="/projects" className="underline">Projects</Link> first.</p>}
  </main>;

  return (
    <div className="print-workspace min-h-screen pb-28" id="report-root">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          #report-root { padding: 0; background: white; min-height: 0; }
          #report-body { max-width: none; padding: 0; }
          #report-root h2, #report-root h3 { break-after: avoid; }
          #report-root img { max-height: 34mm; }
          @page { margin: 13mm; }
          .print-break { page-break-before: always; }
        }
      `}</style>

      {/* Header */}
      <header className="print-chrome border-b border-gray-100 sticky top-0 z-10 no-print">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-1 flex flex-wrap items-center justify-between gap-3">
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
          <div className="flex items-center gap-2 no-print"><WorkspaceThemeToggle />
            <button onClick={() => router.push('/tos')}
              className="px-3 py-2 text-xs text-black/40 hover:text-black transition-colors">
              Terms
            </button>
            <button onClick={() => window.print()} disabled={Boolean(error)}
              className="min-h-11 whitespace-nowrap px-3 sm:px-4 py-2 bg-black text-white text-xs sm:text-sm font-medium rounded-xl hover:bg-black/90 disabled:opacity-50 transition-colors">
              Print / Save PDF
            </button>
          </div>
        </div>
      </header>

      <div id="report-body" className="max-w-3xl mx-auto break-words px-4 sm:px-6 py-6 sm:py-8 space-y-4">

        {/* Print-only header */}
        <div className="hidden print:flex items-center justify-between mb-6">
          <div>
            <p className="text-2xl font-bold text-black">AutoBuild AI</p>
            <p className="text-xs text-black/60 mt-0.5">3DCP Production Record</p>
          </div>
          <p className="text-xs text-black/30">{r.generatedAt ? fmt(r.generatedAt) : ''}</p>
        </div>

        {/* Job hero */}
        <div className="bg-black rounded-2xl px-5 py-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1">Project</p>
              <p className="text-xl font-bold text-white">{activeProject?.name ?? '—'}</p>
              <p className="mt-1 text-xs text-white/70">Print started: {record?.run.startedAt ? fmt(record.run.startedAt) : 'Not recorded'}</p>
              <p className="mt-1 text-xs text-white/70">Print ended: {record?.run.finishedAt ? fmt(record.run.finishedAt) : 'Not recorded'}</p>
            </div>
          </div>
          <div className="h-px bg-white/10 mb-4"/>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label:'Reported Duration', value: r.duration ?? '—' },
              { label:'Planned Layers',   value: record?.run.plannedLayers ?? '—' },
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

        <section className={`${panelClass} space-y-4`} aria-labelledby="evidence-heading">
          <h2 id="evidence-heading" className="text-lg font-semibold">Evidence and coverage</h2>
          <div className="space-y-2 text-sm">
            <h3 className="font-semibold">Live video inputs</h3>
            {record?.run.videoInputs.length ? <ul>{record.run.videoInputs.map((entry, index) => <li key={`${entry.startedAt}:${index}`} className="break-words">{entry.cameraLabel} started at <time dateTime={entry.startedAt}>{new Date(entry.startedAt).toLocaleString()}</time></li>)}</ul> : <p>No video input starts recorded.</p>}
            <h3 className="font-semibold">Live video observations</h3>
            {record?.run.videoObservations.length ? <ul className="space-y-2">{record.run.videoObservations.map((entry, index) => <li key={`${entry.observedAt}:${index}`} className="break-words">
              <time dateTime={entry.observedAt}>{new Date(entry.observedAt).toLocaleString()}</time> · {entry.cameraLabel} · {entry.defectType === 'none' ? entry.verdict : entry.defectType}
              {entry.description && <p>{entry.description}</p>}
            </li>)}</ul> : <p>No video observations saved for this run.</p>}
          </div>
          {evidence?.feedback && <div className="space-y-1 text-sm">
            <h3 className="font-semibold">Operator feedback</h3>
            <p>Print rating: {evidence.feedback.rating}/5. Tools helped: {evidence.feedback.helpful ? 'Yes' : 'No'}.</p>
            {evidence.feedback.notes && <p className="whitespace-pre-wrap break-words">{evidence.feedback.notes}</p>}
          </div>}
          {!error && <p className="text-sm text-gray-900">Recorded for this run: {record?.run.alerts.length ?? 0} monitor alerts, {checkedFlags.length} reviewed AI flags with an operator finding, and {missed.length} operator-marked misses. These are counts of saved records, not a detection rate.</p>}
          <p className="text-sm text-gray-700">This is a process record, not structural acceptance. Missing evidence does not establish that the print was defect-free.</p>
          <ul className="space-y-1 text-sm text-gray-700">
            <li>Live monitor: {record?.run.alerts.length ? `${record.run.alerts.length} recorded alert(s)` : 'No alerts recorded; coverage unverified'}.</li>
            <li>CCU readings and calibrated bead measurements: not available in this report.</li>
            <li>Planned toolpath: {evidence?.toolpath ? <span className="break-words">{evidence.toolpath.filename} · {evidence.toolpath.layers.length} deposition {evidence.toolpath.layers.length === 1 ? 'layer' : 'layers'} · {evidence.toolpath.lengthMm.toLocaleString()} mm of planned deposition</span> : 'not attached in this browser'}.</li>
            {evidence?.toolpath && <li>{coverage.layers.filter(layer => layer.status === 'no-data').length} planned layers have no matched alerts or photo reviews. {coverage.unplacedAlerts.length} alerts and {coverage.unplacedReviews.length} reviews were not matched to the plan.</li>}
          </ul>
          {error ? <p role="alert" className="text-sm text-red-800">{error} Export is disabled to avoid an incomplete file.</p> : <>
            {evidence?.toolpath && <div className="space-y-2">
              <h3 className="font-semibold">Layers to revisit</h3>
              {problemLayers.length ? <ul className="space-y-2 text-sm">{problemLayers.map(({ plan, alerts, reviews }) => <li key={plan.layerNumber} className="break-inside-avoid border-l-2 border-gray-300 pl-3">
                <Link className="font-semibold underline" href={`${projectRoute('/post-processing', activeProject.id)}&run=${encodeURIComponent(evidence.startedAt)}&layer=${plan.layerNumber}#layer-review`}>Inspect layer {plan.layerNumber}</Link>
                <p>Planned Z: {plan.zMm.toLocaleString()} mm · {plan.lengthMm.toLocaleString()} mm of deposition · {alerts.length} alerts · {reviews.length} photo reviews</p>
              </li>)}</ul> : <p className="text-sm text-gray-600">No alerts or operator findings were matched to planned layers.</p>}
              <p className="text-sm text-gray-700">For the next review, start with matched findings and verify any unmatched records against site notes. Collect missing telemetry before drawing conclusions about the mix or bead dimensions.</p>
            </div>}
            <h3 className="font-semibold">Operator photo reviews</h3>
            <ReviewList reviews={evidence?.reviews ?? []} />
          </>}
          <div className="no-print flex flex-wrap gap-2">
            <Link className={actionClass} href={`${projectRoute('/post-processing', activeProject.id)}#layer-review`}>Review evidence</Link>
            <button type="button" className={actionClass} onClick={downloadEvidence} disabled={Boolean(error)}>Export evidence JSON</button>
          </div>
          <p className="no-print text-xs text-gray-600">Evidence JSON can contain photos and notes. Share it only with authorized recipients.</p>
        </section>

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
      <div className="print-chrome fixed bottom-0 left-0 right-0 border-t border-gray-100 z-10 no-print">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-black">
              Post-print process record
            </p>
            <p className="text-xs text-gray-600 mt-0.5">Not a structural assessment</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => router.push('/projects')}
              className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl text-black hover:bg-gray-50 transition-colors">
              Projects
            </button>
            <button onClick={() => window.print()} disabled={Boolean(error)}
              className="min-h-11 px-3 py-2 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/90 disabled:opacity-50 transition-colors">
              Print / Save PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}