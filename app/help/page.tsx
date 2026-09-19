'use client';

import { useRouter } from 'next/navigation';

interface Section {
  id: string;
  title: string;
  kicker: string;
}

const SECTIONS: Section[] = [
  { id: 'overview',        title: 'Overview',              kicker: 'Start here' },
  { id: 'workflow',        title: 'The Guided Workflow',    kicker: 'Projects' },
  { id: 'printer-setup',   title: 'Printer Setup',          kicker: 'Step 1' },
  { id: 'pre-print',       title: 'Pre-Print Optimizer',    kicker: 'Step 2' },
  { id: 'floorplan',       title: 'Floor Plan Tool',        kicker: 'PDF → 3D model' },
  { id: 'live-monitoring', title: 'Live Monitoring',        kicker: 'Step 3' },
  { id: 'post-processing', title: 'Post Processing',        kicker: 'Step 4' },
  { id: 'report',          title: 'Report',                 kicker: 'Step 5' },
  { id: 'standalone',      title: 'Standalone Tools',       kicker: 'Outside a project' },
  { id: 'reference',       title: 'Settings & Definitions', kicker: 'Reference' },
];

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-gray-100 rounded-2xl p-5 ${className}`}>
      {children}
    </div>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-widest text-black/30 mb-2">{children}</p>;
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[9px] font-bold text-black/40 bg-black/5 px-1.5 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap">
      {children}
    </span>
  );
}

function ThresholdRow({ name, effect, whenLow, whenHigh }: { name: string; effect: string; whenLow: string; whenHigh: string }) {
  return (
    <div className="border-t border-gray-100 py-3 first:border-t-0 first:pt-0">
      <p className="text-sm font-bold text-black mb-1">{name}</p>
      <p className="text-[13px] text-black/55 leading-relaxed mb-2">{effect}</p>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="bg-gray-50 rounded-lg px-2.5 py-1.5"><span className="text-black/35">Lower it — </span><span className="text-black/70">{whenLow}</span></div>
        <div className="bg-gray-50 rounded-lg px-2.5 py-1.5"><span className="text-black/35">Raise it — </span><span className="text-black/70">{whenHigh}</span></div>
      </div>
    </div>
  );
}

function ToolCard({ name, route, desc }: { name: string; route: string; desc: string }) {
  const router = useRouter();
  return (
    <button onClick={() => router.push(route)} className="text-left bg-white border border-gray-100 rounded-2xl p-4 hover:border-black transition-colors w-full">
      <p className="text-sm font-bold text-black mb-1">{name}</p>
      <p className="text-[12px] text-black/50 leading-relaxed">{desc}</p>
      <p className="text-[10px] text-black/30 font-mono mt-2">{route}</p>
    </button>
  );
}

export default function HelpPage() {
  const router = useRouter();

  function jumpTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="bg-white border-b border-gray-100 px-4 sm:px-6 py-4 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center gap-3 sm:gap-4">
          <button onClick={() => router.back()} className="text-black/40 hover:text-black transition-colors flex-shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-black">How AutoBuild AI Works</h1>
            <p className="text-xs text-black/40 hidden sm:block">A guide to every step, tool, and setting in the app</p>
          </div>
          <button onClick={() => router.push('/definitions')}
            className="text-xs font-semibold text-black/50 hover:text-black border border-gray-200 hover:border-black rounded-xl px-3 py-1.5 transition-colors flex-shrink-0">
            Material &amp; printer specs →
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-8">
        {/* ── Sidebar nav ── */}
        <nav className="hidden lg:block sticky top-24 self-start space-y-0.5">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => jumpTo(s.id)}
              className="w-full text-left px-3 py-2 rounded-xl text-[13px] text-black/50 hover:text-black hover:bg-white transition-colors">
              {s.title}
            </button>
          ))}
        </nav>

        {/* ── Content ── */}
        <div className="space-y-10 min-w-0">

          {/* Overview */}
          <section id="overview">
            <Kicker>{SECTIONS[0].kicker}</Kicker>
            <h2 className="text-xl font-bold text-black mb-3">{SECTIONS[0].title}</h2>
            <Card className="space-y-3">
              <p className="text-sm text-black/70 leading-relaxed">
                AutoBuild AI turns a building design — a 3D model or a 2D architectural floor plan — into an
                adaptive, RL-optimised toolpath for 3D concrete printing (3DCP), then helps you monitor the
                print in real time and generates a final report when it&apos;s done.
              </p>
              <p className="text-sm text-black/70 leading-relaxed">
                There are two ways to use it. The <strong>guided workflow</strong> (Projects) walks you through
                five steps in order — Printer Setup, Pre-Print, Live Monitor, Post Processing, Report — and
                remembers everything about one specific print job as you go. The <strong>standalone tools</strong>
                {' '}(Slicer, Monitor, Image Analysis, My Slices, and the Floor Plan tool) do the same underlying
                work but outside a project, for one-off use.
              </p>
            </Card>
          </section>

          {/* Workflow */}
          <section id="workflow">
            <Kicker>{SECTIONS[1].kicker}</Kicker>
            <h2 className="text-xl font-bold text-black mb-3">{SECTIONS[1].title}</h2>
            <Card className="space-y-4">
              <p className="text-sm text-black/70 leading-relaxed">
                Everything starts on the <strong>Projects</strong> page — create one (name, description, address,
                structure type) and it becomes your <em>active project</em>. Every other page reads and writes to
                that one active project, which is how your printer config, weather, toolpath, and print log all
                travel between steps without you re-entering anything.
              </p>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
                {['Printer Setup', 'Pre-Print', 'Live Monitor', 'Post Processing', 'Report'].map((s, i, arr) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <span className="bg-black text-white px-2.5 py-1 rounded-full">{i + 1}. {s}</span>
                    {i < arr.length - 1 && <span className="text-black/20">→</span>}
                  </span>
                ))}
              </div>
              <p className="text-[12px] text-black/45 leading-relaxed">
                A project&apos;s status (which step it&apos;s currently on) is saved automatically, so reopening
                it from the Projects list sends you straight back to wherever you left off. Steps ahead of your
                current one stay locked in the top nav until you reach them.
              </p>
            </Card>
          </section>

          {/* Printer Setup */}
          <section id="printer-setup">
            <Kicker>{SECTIONS[2].kicker}</Kicker>
            <h2 className="text-xl font-bold text-black mb-3">{SECTIONS[2].title}</h2>
            <Card className="space-y-3">
              <p className="text-sm text-black/70 leading-relaxed">
                Captures the physical hardware profile everything downstream depends on. Two ways in:
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl p-3.5">
                  <p className="text-sm font-bold text-black mb-1">Wireless Pi Connection</p>
                  <p className="text-[12px] text-black/55 leading-relaxed">A Raspberry Pi on the printer broadcasts its specs over Wi-Fi — scan, and it auto-fills the config for you.</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3.5">
                  <p className="text-sm font-bold text-black mb-1">Manual Config</p>
                  <p className="text-[12px] text-black/55 leading-relaxed">Fill in Nozzle, Delivery (pump/hose), and Machine Kinematics yourself. Every field has an info button explaining what it does and whether the RL agent uses it directly.</p>
                </div>
              </div>
              <p className="text-[12px] text-black/45 leading-relaxed">
                Full field-by-field explanations live on the <button onClick={() => router.push('/definitions')} className="underline underline-offset-2 hover:text-black">Definitions</button> page. Saving here routes you into Pre-Print.
              </p>
            </Card>
          </section>

          {/* Pre-Print Optimizer */}
          <section id="pre-print">
            <Kicker>{SECTIONS[3].kicker}</Kicker>
            <h2 className="text-xl font-bold text-black mb-3">{SECTIONS[3].title}</h2>
            <Card className="space-y-3">
              <p className="text-sm text-black/70 leading-relaxed">
                This is the RL slicer. Upload a 3D model (STL/OBJ) or use the Floor Plan tool to build one from
                a PDF, set your weather and cement mix, and the trained PPO agent decides the print order and
                speed for every layer — minimising nozzle travel while respecting your cement&apos;s open time
                and the live weather at each stage of the print.
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl p-3.5">
                  <p className="text-[12px] font-bold text-black/70 mb-1">Site Plan Reader</p>
                  <p className="text-[12px] text-black/55 leading-relaxed">Upload a site plan image and Claude estimates the plot dimensions, road position, and building placement automatically.</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3.5">
                  <p className="text-[12px] font-bold text-black/70 mb-1">Why factors panel</p>
                  <p className="text-[12px] text-black/55 leading-relaxed">The results page explains every speed/route decision in plain English — temperature, humidity, wind, slope, cement risk, and printer compatibility.</p>
                </div>
              </div>
              <p className="text-[12px] text-black/45 leading-relaxed">Output: an optimised toolpath, G-code, and an estimated print time — carried forward into Live Monitoring.</p>
            </Card>
          </section>

          {/* Floor Plan Tool — the big one */}
          <section id="floorplan">
            <Kicker>{SECTIONS[4].kicker}</Kicker>
            <h2 className="text-xl font-bold text-black mb-3">{SECTIONS[4].title}</h2>
            <Card className="space-y-5">
              <p className="text-sm text-black/70 leading-relaxed">
                Turns a 2D architectural PDF into a printable 3D wall model, floor by floor, with real door and
                window openings at the correct height. Reachable from the home page (Slicer → Floor Plan) or
                directly at <code className="font-mono text-[12px] bg-gray-50 px-1.5 py-0.5 rounded">/floorplan</code>.
              </p>

              <div>
                <p className="text-sm font-bold text-black mb-2">1. Upload &amp; sheet check</p>
                <p className="text-[13px] text-black/55 leading-relaxed">
                  Upload a PDF and it&apos;s automatically classified as a <strong>floor plan</strong> (extractable),
                  a <strong>site plan</strong> (placement context only — not extractable), a{' '}
                  <strong>section/elevation</strong>, or unknown. Only upload one architectural floor plan at a time.
                </p>
              </div>

              <div>
                <p className="text-sm font-bold text-black mb-2">2. Select your walls</p>
                <p className="text-[13px] text-black/55 leading-relaxed mb-2">Four ways to build the wall selection, usable together:</p>
                <div className="space-y-2">
                  {[
                    { name: 'Line mode', desc: 'Click a line to select it. Click an already-selected line again to remove it — great for cleaning up after a bulk auto-detect.' },
                    { name: 'Color mode', desc: 'Click any element to select every object drawn in that exact color.' },
                    { name: 'Pattern mode', desc: 'Click a hatch/fill area to select everything matching that angle + spacing signature, with adjustable tolerance.' },
                    { name: 'Wall Outline Extraction', desc: 'One-click auto-detect using the tuning thresholds below — the fastest starting point on a clean plan.' },
                  ].map(m => (
                    <div key={m.name} className="bg-gray-50 rounded-xl px-3.5 py-2.5">
                      <p className="text-[13px] font-semibold text-black">{m.name}</p>
                      <p className="text-[12px] text-black/55 leading-relaxed">{m.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-bold text-black mb-2">Tuning thresholds (Wall Outline Extraction)</p>
                <p className="text-[13px] text-black/55 leading-relaxed mb-1">
                  These decide what the auto-detector treats as a real wall line versus noise in the PDF&apos;s vector data.
                </p>
                <ThresholdRow
                  name="Min line length (pt)"
                  effect="Any single line shorter than this is discarded outright — filters out dimension ticks, text underlines, and furniture-symbol edges. Default 20pt."
                  whenLow="real short wall segments are getting missed."
                  whenHigh="dimension lines or other noise are being picked up as walls."
                />
                <ThresholdRow
                  name="Hatch min segments"
                  effect="A drawing group needs at least this many individual lines before it's even considered for hatch-pattern detection. Default 6."
                  whenLow="real walls made of several parallel short segments are wrongly being classified as hatch and excluded."
                  whenHigh="hatch patterns with fewer lines are slipping through as walls."
                />
                <ThresholdRow
                  name="Hatch avg max (pt)"
                  effect="Combined with the above: if a group's segments average shorter than this, the whole group is treated as hatch (insulation, fill, tiling) and skipped. Default 25pt."
                  whenLow="hatch/fill lines are still getting included as walls."
                  whenHigh="real walls are being wrongly classified as hatch and excluded."
                />
              </div>

              <div>
                <p className="text-sm font-bold text-black mb-2">Cut a gap in a wall</p>
                <p className="text-[13px] text-black/55 leading-relaxed">
                  Some plans draw a wall as one continuous line straight through what&apos;s actually an opening
                  (the window/door symbol just sits on top, no real break in the vector data) — so click-to-remove
                  can only drop the whole line. This tool clicks two points along an already-selected wall line and
                  splits it there, discarding the span between — giving you a real break exactly where one belongs.
                </p>
              </div>

              <div>
                <p className="text-sm font-bold text-black mb-2">Doors &amp; Windows</p>
                <p className="text-[13px] text-black/55 leading-relaxed mb-2">
                  Once walls are selected, <strong>Detect doors &amp; windows</strong> finds candidate gaps and
                  guesses a type from nearby symbols (an arc suggests a door swing; short crossing lines suggest a
                  window). Click a candidate marker on the plan to confirm its type and set the sill/head height,
                  or discard it. Set default heights once (window sill/head, door height) at the top of the panel —
                  they apply to every new detection, and &quot;Apply to all windows&quot; retro-fits them onto
                  ones already placed.
                </p>
                <p className="text-[13px] text-black/55 leading-relaxed">
                  If detection misses something (or the plan has no real gap to find), use <strong>Place
                  window/door manually</strong> — click two points on the plan yourself, using the current default
                  heights. Confirmed openings render as a highlighted, colour-coded band in the 3D view (orange =
                  door, cyan = window), solid wall above and below.
                </p>
              </div>

              <div>
                <p className="text-sm font-bold text-black mb-2">Multi-floor buildings</p>
                <p className="text-[13px] text-black/55 leading-relaxed">
                  Set a floor name, base elevation, wall height, and X/Y offset, then <strong>Add current floor to
                  building</strong> — it&apos;s added to the shared 3D stack and the tool resets for you to upload
                  the next floor&apos;s plan. Adjust the X/Y offset when two floors&apos; drawing origins
                  don&apos;t line up.
                </p>
              </div>

              <div>
                <p className="text-sm font-bold text-black mb-2">Slice</p>
                <p className="text-[13px] text-black/55 leading-relaxed">
                  Set printer/nozzle parameters and weather (by city or manually), then run the slicer — it prints
                  every layer solid except where a door/window opening&apos;s height band says otherwise, and
                  returns G-code, toolpath, an estimated print time, and per-layer stats.
                </p>
              </div>
            </Card>
          </section>

          {/* Live Monitoring */}
          <section id="live-monitoring">
            <Kicker>{SECTIONS[5].kicker}</Kicker>
            <h2 className="text-xl font-bold text-black mb-3">{SECTIONS[5].title}</h2>
            <Card className="space-y-3">
              <p className="text-sm text-black/70 leading-relaxed">
                Tracks an in-progress print: multiple named camera views, a plumb indicator (how far off-vertical
                the printer head currently is), a live weather widget, printer speed/extrusion controls, and an
                event log of everything that happens.
              </p>
              <div>
                <p className="text-sm font-bold text-black mb-1">AI bead quality analysis <Badge>Claude</Badge></p>
                <p className="text-[13px] text-black/55 leading-relaxed">
                  Every 15 seconds (while enabled) or on-demand from an uploaded photo, Claude looks at the bead
                  layers and reports a verdict (straight / deviated / defect / unclear), defect type, severity,
                  and confidence. High-severity results raise an alert automatically. Photos are converted
                  server-side if needed — <strong>HEIC photos from iPhone are supported</strong>: the app detects
                  the format from the file&apos;s actual bytes and converts to JPEG before sending it on, so you
                  can upload straight from your phone without exporting first.
                </p>
              </div>
            </Card>
          </section>

          {/* Post Processing */}
          <section id="post-processing">
            <Kicker>{SECTIONS[6].kicker}</Kicker>
            <h2 className="text-xl font-bold text-black mb-3">{SECTIONS[6].title}</h2>
            <Card>
              <p className="text-sm text-black/70 leading-relaxed">
                A short review step after the print finishes — the same defect-detection panel from Live
                Monitoring, so you can run a final AI scan over photos of the completed print before generating
                the report.
              </p>
            </Card>
          </section>

          {/* Report */}
          <section id="report">
            <Kicker>{SECTIONS[7].kicker}</Kicker>
            <h2 className="text-xl font-bold text-black mb-3">{SECTIONS[7].title}</h2>
            <Card>
              <p className="text-sm text-black/70 leading-relaxed mb-3">
                The final, exportable summary of the whole job — a quality score, build duration and layer count,
                material and print parameters, site conditions during the print, a G-code reference, the full
                event log with alerts, and a record of any manual control changes made mid-print.
              </p>
              <p className="text-[12px] text-black/45">Export PDF via your browser&apos;s print dialog. This is the last step — nothing feeds forward from here.</p>
            </Card>
          </section>

          {/* Standalone tools */}
          <section id="standalone">
            <Kicker>{SECTIONS[8].kicker}</Kicker>
            <h2 className="text-xl font-bold text-black mb-3">{SECTIONS[8].title}</h2>
            <p className="text-sm text-black/60 leading-relaxed mb-3">
              Same underlying engines as the guided workflow, but not tied to a project — good for quick, one-off use.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <ToolCard name="Slicer" route="/tools/slicer" desc="The RL slicer on its own — upload a model, set parameters, run it. Results can be saved to My Slices." />
              <ToolCard name="Floor Plan" route="/floorplan" desc="The full PDF-to-3D tool described above, usable outside a project." />
              <ToolCard name="Live Monitor" route="/tools/monitor" desc="Camera views and bead analysis for an ad-hoc monitoring session, no project required." />
              <ToolCard name="Image Analysis" route="/tools/image-analysis" desc="Just the AI defect scan — upload a photo, get a verdict. The simplest entry point." />
              <ToolCard name="My Slices" route="/tools/slices" desc="Browse and revisit everything you've saved from the Slicer or Pre-Print Optimizer." />
            </div>
          </section>

          {/* Reference */}
          <section id="reference">
            <Kicker>{SECTIONS[9].kicker}</Kicker>
            <h2 className="text-xl font-bold text-black mb-3">{SECTIONS[9].title}</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <ToolCard name="Settings" route="/settings" desc="Your display name and the AI training-data opt-in — both stored locally, nothing leaves your device unless you opt in." />
              <ToolCard name="Definitions" route="/definitions" desc="A glossary of every material spec (per Sikacrete variant) and every printer setup field, with plain-English explanations." />
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
