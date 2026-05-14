'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

interface AlertEntry { time: string; msg: string; level: 'info' | 'warn' | 'error'; }

interface SessionReport {
  generatedAt: string;
  duration:    string;
  beadScans:   number;
  totalAlerts: number;
  alerts:      AlertEntry[];
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-black rounded-2xl p-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 mb-1">{label}</p>
      <p className="text-3xl font-bold text-white leading-none">{value}</p>
      {sub && <p className="text-[10px] text-white/30 mt-1">{sub}</p>}
    </div>
  );
}

export default function MonitorReport() {
  const router = useRouter();
  const [report, setReport] = useState<SessionReport | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem('standalone_monitor_report');
    if (!raw) { setMissing(true); return; }
    try { setReport(JSON.parse(raw)); } catch { setMissing(true); }
  }, []);

  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  const levelDot = (level: AlertEntry['level']) =>
    level === 'error' ? 'bg-red-500' : level === 'warn' ? 'bg-amber-400' : 'bg-gray-300';

  const levelRow = (level: AlertEntry['level']) =>
    level === 'error' ? 'bg-red-50 text-red-700' : level === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-black/50';

  return (
    <div className="min-h-screen bg-gray-50 pb-12 print:bg-white">
      <header className="border-b border-gray-100 bg-white sticky top-0 z-10 print:static">
        <div className="max-w-4xl mx-auto px-6 py-1 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/')} className="-my-4 sm:-my-6 print:pointer-events-none">
              <Image src="/Autobuildblack.png" alt="AutoBuild AI" width={400} height={400} className="h-24 sm:h-36 w-auto" />
            </button>
            <span className="w-px h-5 bg-gray-200" />
            <span className="text-sm font-medium text-black/40">Session Report</span>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <button onClick={() => window.print()}
              className="px-4 py-1.5 border border-gray-200 text-xs font-semibold rounded-xl hover:bg-gray-50 transition-colors">
              Export PDF
            </button>
            <button onClick={() => router.push('/tools/monitor')}
              className="px-4 py-1.5 bg-black text-white text-xs font-semibold rounded-xl hover:bg-black/80 transition-colors">
              New Session
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 pt-8 space-y-6">

        {missing && (
          <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center shadow-sm">
            <p className="text-sm font-semibold text-black/40 mb-2">No session report found</p>
            <p className="text-xs text-black/25 mb-6">End a monitoring session to generate a report.</p>
            <button onClick={() => router.push('/tools/monitor')}
              className="px-6 py-2.5 bg-black text-white text-sm font-semibold rounded-xl hover:bg-black/80 transition-colors">
              Start Session
            </button>
          </div>
        )}

        {report && (
          <>
            {/* Meta */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex items-center justify-between flex-wrap gap-3">
              <div>
                <h1 className="text-base font-bold text-black">Live Monitor Session</h1>
                <p className="text-xs text-black/35 mt-0.5">{fmtDate(report.generatedAt)}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-medium text-black/50">Session complete</span>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <StatCard label="Duration"     value={report.duration} />
              <StatCard label="Bead Scans"   value={report.beadScans}   sub="AI-analysed frames" />
              <StatCard label="Total Alerts" value={report.totalAlerts} sub="warn + error events" />
            </div>

            {/* Alert log */}
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-black/40">Event Log</h2>
                <span className="text-[10px] font-mono text-black/25">{report.alerts.length} event{report.alerts.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="divide-y divide-gray-50 max-h-[420px] overflow-y-auto print:max-h-none">
                {report.alerts.length === 0 && (
                  <p className="text-xs text-black/25 text-center py-8">No events recorded</p>
                )}
                {report.alerts.map((a, i) => (
                  <div key={i} className={`flex items-start gap-3 px-5 py-2.5 ${levelRow(a.level)}`}>
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${levelDot(a.level)}`} />
                    <span className="font-mono text-[10px] opacity-50 flex-shrink-0 pt-0.5">{a.time}</span>
                    <span className="text-[11px] flex-1">{a.msg}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 print:hidden">
              <button onClick={() => window.print()}
                className="flex-1 py-3 text-sm font-semibold border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
                Export PDF
              </button>
              <button onClick={() => router.push('/tools/monitor')}
                className="flex-1 py-3 text-sm font-semibold bg-black text-white rounded-xl hover:bg-black/80 transition-colors">
                Start New Session
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
