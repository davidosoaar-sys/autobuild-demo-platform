'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ── Factor row ────────────────────────────────────────────────────────────────

export interface Factor { label: string; value: string; impact: string; ok: boolean; }

export function StatRow({ label, value, highlight, delay = 0, accent }: {
  label: string; value: string; highlight?: boolean; delay?: number; accent?: string;
}) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay, duration: 0.25 }}
      className="flex items-center justify-between py-2.5 border-b border-white/6 last:border-0">
      <span className="text-[11px] text-white/35 font-medium">{label}</span>
      <span className={`text-[12px] font-semibold font-mono ${accent ?? (highlight ? 'text-white' : 'text-white/75')}`}>{value}</span>
    </motion.div>
  );
}

export function FactorRow({ label, value, impact, ok, delay = 0 }: {
  label: string; value: string; impact: string; ok: boolean; delay?: number;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.25 }}
      className="py-3 border-b border-white/6 last:border-0">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div className={`w-1 h-1 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          <span className="text-[11px] font-medium text-white/70">{label}</span>
        </div>
        <span className={`text-[10px] font-mono font-semibold ${ok ? 'text-emerald-400' : 'text-amber-400'}`}>{value}</span>
      </div>
      <p className="text-[10px] text-white/30 leading-relaxed pl-3">{impact}</p>
    </motion.div>
  );
}

// ── Scan issue row ────────────────────────────────────────────────────────────

export const SEV_DOT: Record<string, string> = {
  error:   'bg-red-500',
  warning: 'bg-amber-400',
  info:    'bg-blue-400',
};
export const SEV_BADGE: Record<string, string> = {
  error:   'bg-red-500/10 text-red-400 border-red-500/20',
  warning: 'bg-amber-400/10 text-amber-300 border-amber-400/20',
  info:    'bg-blue-400/10 text-blue-300 border-blue-400/20',
};
export const SEV_WRAP: Record<string, string> = {
  error:   'border-red-500/15 bg-red-500/5',
  warning: 'border-amber-400/15 bg-amber-400/4',
  info:    'border-white/8 bg-white/3',
};

export function ScanIssueRow({ issue, delay = 0 }: { issue: any; delay?: number }) {
  const [open, setOpen] = useState(issue.severity === 'error');
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.25 }}
      className={`rounded-xl border overflow-hidden ${SEV_WRAP[issue.severity] ?? 'border-white/8 bg-white/3'}`}>
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-white/3 transition-colors">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${SEV_DOT[issue.severity] ?? 'bg-white/30'}`} />
        <span className="flex-1 text-[10px] font-semibold text-white/80 leading-tight">{issue.title}</span>
        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${SEV_BADGE[issue.severity] ?? ''}`}>{issue.severity}</span>
        <svg className={`w-3 h-3 text-white/20 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }} className="overflow-hidden">
            <div className="px-3 pb-3 space-y-1.5 border-t border-white/5 pt-2">
              <p className="text-[9px] text-white/40 leading-relaxed">{issue.detail}</p>
              <div className="rounded-lg px-2 py-1.5 border border-white/5 bg-white/3">
                <p className="text-[8px] text-white/25 uppercase tracking-wider mb-0.5">Fix</p>
                <p className="text-[9px] text-white/50 leading-relaxed">{issue.recommendation}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
