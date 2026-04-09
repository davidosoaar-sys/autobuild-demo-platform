'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';

export interface ScanIssue {
  id:             string;
  severity:       'error' | 'warning' | 'info';
  title:          string;
  count:          number;
  detail:         string;
  recommendation: string;
}

export interface ScanResult {
  ok:          boolean;
  score:       number;
  verdict:     'ready' | 'caution' | 'blocked';
  verdict_msg: string;
  issues:      ScanIssue[];
  warnings:    { id: string; detail: string }[];
  info:        Record<string, any>;
  counts:      { errors: number; warnings: number; info: number; total: number };
}

interface ScanBannerProps {
  result:   ScanResult | null;
  scanning: boolean;
  onRescan: () => void;
}

const SEVERITY_CONFIG = {
  error:   { dot: 'bg-red-500',    badge: 'bg-red-500/10 text-red-400 border-red-500/20',    label: 'Error'   },
  warning: { dot: 'bg-amber-400',  badge: 'bg-amber-400/10 text-amber-300 border-amber-400/20', label: 'Warning' },
  info:    { dot: 'bg-blue-400',   badge: 'bg-blue-400/10 text-blue-300 border-blue-400/20',  label: 'Info'    },
};

const VERDICT_CONFIG = {
  ready:   { bar: 'bg-emerald-500', text: 'text-emerald-400', label: 'Printable',       bg: 'border-emerald-500/20 bg-emerald-500/5'  },
  caution: { bar: 'bg-amber-400',   text: 'text-amber-300',   label: 'Review required', bg: 'border-amber-400/20 bg-amber-400/5'      },
  blocked: { bar: 'bg-red-500',     text: 'text-red-400',     label: 'Not printable',   bg: 'border-red-500/20 bg-red-500/5'          },
};

function IssueRow({ issue, defaultOpen = false }: { issue: ScanIssue; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const cfg = SEVERITY_CONFIG[issue.severity];

  return (
    <div className={`rounded-xl border overflow-hidden transition-colors ${
      issue.severity === 'error'   ? 'border-red-500/15 bg-red-500/5'    :
      issue.severity === 'warning' ? 'border-amber-400/15 bg-amber-400/4' :
                                     'border-white/8 bg-white/3'
    }`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/3 transition-colors"
      >
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`}/>
        <span className="flex-1 text-[11px] font-semibold text-white/80">{issue.title}</span>
        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${cfg.badge}`}>
          {cfg.label}
        </span>
        <svg
          className={`w-3 h-3 text-white/25 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2 border-t border-white/5">
              <p className="text-[10px] text-white/45 leading-relaxed pt-2">{issue.detail}</p>
              <div className="rounded-lg px-2.5 py-2 border border-white/6 bg-white/3">
                <p className="text-[9px] text-white/30 uppercase tracking-wider mb-1">Recommendation</p>
                <p className="text-[10px] text-white/55 leading-relaxed">{issue.recommendation}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ScanBanner({ result, scanning, onRescan }: ScanBannerProps) {
  const [expanded, setExpanded] = useState(true);

  // Scanning state
  if (scanning) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-white/10 overflow-hidden"
        style={{ background: 'rgba(6,6,10,0.85)', backdropFilter: 'blur(16px)' }}
      >
        <div className="flex items-center gap-3 px-4 py-3.5">
          <motion.div
            className="w-2 h-2 rounded-full bg-white flex-shrink-0"
            animate={{ opacity: [1, 0.2, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
          <div className="flex-1">
            <p className="text-[11px] font-semibold text-white">Scanning geometry...</p>
            <p className="text-[10px] text-white/30 mt-0.5">
              Checking wall thickness, overhangs, topology, extrusion gaps
            </p>
          </div>
          {/* Animated scan bar */}
          <div className="w-24 h-0.5 bg-white/10 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-white/60 rounded-full"
              animate={{ x: ['-100%', '200%'] }}
              transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
              style={{ width: '50%' }}
            />
          </div>
        </div>
      </motion.div>
    );
  }

  if (!result) return null;

  const vc  = VERDICT_CONFIG[result.verdict];
  const pct = result.score;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border overflow-hidden ${vc.bg}`}
      style={{ backdropFilter: 'blur(16px)' }}
    >
      {/* Score bar at top */}
      <div className="h-0.5 bg-white/5">
        <div
          className={`h-full transition-all duration-700 ${vc.bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Header row */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/3 transition-colors text-left"
      >
        {/* Score circle */}
        <div className="relative flex-shrink-0 w-9 h-9">
          <svg className="w-9 h-9 -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3"/>
            <circle
              cx="18" cy="18" r="15" fill="none"
              stroke={result.verdict === 'ready' ? '#10b981' : result.verdict === 'caution' ? '#fbbf24' : '#ef4444'}
              strokeWidth="3"
              strokeDasharray={`${(pct / 100) * 94.2} 94.2`}
              strokeLinecap="round"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white">
            {pct}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-bold ${vc.text}`}>{vc.label}</span>
            {result.counts.errors > 0 && (
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/20">
                {result.counts.errors} error{result.counts.errors !== 1 ? 's' : ''}
              </span>
            )}
            {result.counts.warnings > 0 && (
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-400/12 text-amber-300 border border-amber-400/20">
                {result.counts.warnings} warning{result.counts.warnings !== 1 ? 's' : ''}
              </span>
            )}
            {result.counts.info > 0 && (
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-400/10 text-blue-300 border border-blue-400/20">
                {result.counts.info} note{result.counts.info !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="text-[10px] text-white/35 mt-0.5 truncate">{result.verdict_msg}</p>
        </div>

        {/* Rescan + chevron */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={e => { e.stopPropagation(); onRescan(); }}
            className="px-2 py-1 text-[9px] font-medium text-white/30 hover:text-white/60 border border-white/8 hover:border-white/20 rounded-lg transition-colors"
          >
            Rescan
          </button>
          <svg
            className={`w-3.5 h-3.5 text-white/25 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
          </svg>
        </div>
      </button>

      {/* Collapsible issue list */}
      <AnimatePresence initial={false}>
        {expanded && result.issues.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-1.5 border-t border-white/5 pt-2">
              {result.issues.map((issue, i) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  defaultOpen={issue.severity === 'error' && i === 0}
                />
              ))}

              {/* Info strip — dims, layer count */}
              {result.info.dimensions_m && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 px-1">
                  {[
                    ['Width',   `${(result.info.dimensions_m.width  * 1000).toFixed(0)} mm`],
                    ['Depth',   `${(result.info.dimensions_m.depth  * 1000).toFixed(0)} mm`],
                    ['Height',  `${(result.info.dimensions_m.height * 1000).toFixed(0)} mm`],
                    ['Layers',  String(result.info.layer_count)],
                    ...(result.info.min_wall_thickness_mm != null
                      ? [['Min wall', `${result.info.min_wall_thickness_mm} mm`]]
                      : []
                    ),
                    ...(result.info.gap_events != null
                      ? [['Gap events', String(result.info.gap_events)]]
                      : []
                    ),
                  ].map(([label, value]) => (
                    <span key={label} className="text-[9px] text-white/25 font-mono">
                      <span className="text-white/15">{label} </span>{value}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {expanded && result.issues.length === 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 border-t border-white/5 pt-2">
              <p className="text-[10px] text-white/30">No issues found — model passed all checks.</p>
              {result.info.dimensions_m && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                  {[
                    ['Width',   `${(result.info.dimensions_m.width  * 1000).toFixed(0)} mm`],
                    ['Depth',   `${(result.info.dimensions_m.depth  * 1000).toFixed(0)} mm`],
                    ['Height',  `${(result.info.dimensions_m.height * 1000).toFixed(0)} mm`],
                    ['Layers',  String(result.info.layer_count)],
                  ].map(([label, value]) => (
                    <span key={label} className="text-[9px] text-white/25 font-mono">
                      <span className="text-white/15">{label} </span>{value}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}