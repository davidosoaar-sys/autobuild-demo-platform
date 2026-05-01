'use client';
import Link from 'next/link';
import { motion } from 'framer-motion';
import MktNav from '@/app/components/MktNav';
import MktFooter from '@/app/components/MktFooter';

const mono = `'JetBrains Mono', monospace`;
const fade = { hidden:{ opacity:0, y:28 }, visible:{ opacity:1, y:0, transition:{ duration:0.65, ease:[0.22,1,0.36,1] as const } } };
const dl = (d:number) => ({ hidden:{ opacity:0, y:28 }, visible:{ opacity:1, y:0, transition:{ duration:0.65, delay:d, ease:[0.22,1,0.36,1] as const } } });

const monitors = [
  { num:'01 — Detection', title:'Bead deviation',   desc:'Angle measurement on every bead, every layer. Deviations classified by severity and logged with frame-accurate timestamps.' },
  { num:'02 — Quality',   title:'Surface quality',  desc:'Consistency and uniformity checks across each pass. Irregular surfaces flagged before they compound into structural issues.' },
  { num:'03 — Structure', title:'Layer integrity',  desc:'Bonding and continuity analysis between layers. Gaps, voids, and adhesion anomalies detected and recorded in the event log.' },
];

const steps = [
  { idx:'01', title:'Connect your camera',         desc:'Any standard camera works. Point it at your print head and connect through the Monitor interface — no special hardware required.' },
  { idx:'02', title:'AI analyses every frame',     desc:'Claude Vision processes your video feed continuously, running deviation detection and surface analysis on each frame as it arrives.' },
  { idx:'03', title:'Alerts fire instantly',        desc:'Critical deviations trigger immediate alerts. You know about a problem the moment it happens — not when you review footage later.' },
  { idx:'04', title:'Everything logged automatically', desc:'Every event is timestamped and saved. When the print ends, a complete quality report is generated — no manual documentation needed.' },
];

const features = [
  ['Claude Vision real-time analysis',          'Frame-by-frame AI — no buffering, no delay'],
  ['Angle deviation measurement and logging',   'Precise bead angle recorded for every layer'],
  ['Instant alerts for high severity detections','Configurable thresholds — notified when it matters'],
  ['Fully automated timestamped event log',     'Every detection saved with exact time and layer'],
  ['Complete print report on completion',       'Summary of every event across the full print run'],
  ['Works with any standard camera',            'No proprietary hardware required'],
];

export default function MonitorPage() {
  return (
    <div className="mkt" style={{ fontFamily:"'Space Grotesk',sans-serif" }}>
      <MktNav />

      {/* Hero */}
      <section style={{ position:'relative', minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center', padding:'160px 48px 100px', overflow:'hidden', background:'#fff' }}>
        <div style={{ position:'absolute', inset:0, backgroundImage:'radial-gradient(circle,rgba(0,0,0,0.06) 1px,transparent 1px)', backgroundSize:'28px 28px', pointerEvents:'none' }} />
        <motion.div initial="hidden" animate="visible" variants={fade} style={{ fontFamily:mono, fontSize:'10px', fontWeight:500, letterSpacing:'0.18em', textTransform:'uppercase', opacity:0.3, marginBottom:'20px', position:'relative' }}>Live Monitor</motion.div>
        <motion.h1 initial="hidden" animate="visible" variants={dl(0.08)} style={{ fontSize:'clamp(40px,6.5vw,88px)', fontWeight:700, letterSpacing:'-0.04em', lineHeight:1.0, marginBottom:'24px', maxWidth:'820px', position:'relative' }}>
          The extra set of eyes<br />that never blinks.
        </motion.h1>
        <motion.p initial="hidden" animate="visible" variants={dl(0.16)} style={{ fontSize:'16px', fontWeight:300, color:'rgba(0,0,0,0.42)', maxWidth:'460px', lineHeight:1.75, marginBottom:'44px', position:'relative' }}>
          Claude Vision analyses every frame of your concrete print in real time. Bead deviation. Surface quality. Layer integrity. All logged automatically.
        </motion.p>
        <motion.div initial="hidden" animate="visible" variants={dl(0.24)} style={{ display:'flex', gap:'12px', flexWrap:'wrap', justifyContent:'center', position:'relative' }}>
          <Link href="/early-access" style={{ background:'#080808', color:'#fff', borderRadius:'6px', padding:'14px 28px', fontSize:'14px', fontWeight:600, textDecoration:'none' }}>Get Early Access</Link>
          <Link href="/live-monitoring" style={{ background:'transparent', color:'#080808', border:'1px solid rgba(0,0,0,0.18)', borderRadius:'6px', padding:'14px 28px', fontSize:'14px', fontWeight:500, textDecoration:'none' }}>Open Monitor</Link>
        </motion.div>
      </section>

      {/* What it monitors */}
      <section style={{ padding:'120px 48px', borderTop:'1px solid rgba(0,0,0,0.08)' }}>
        <div style={{ maxWidth:'1100px', margin:'0 auto' }}>
          <motion.h2 initial="hidden" whileInView="visible" viewport={{ once:true }} variants={fade} style={{ fontSize:'clamp(28px,4vw,52px)', fontWeight:700, letterSpacing:'-0.03em', marginBottom:'64px' }}>What it monitors.</motion.h2>
          <div className="mkt-mon-cols" style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'1px', background:'rgba(0,0,0,0.08)', border:'1px solid rgba(0,0,0,0.08)', borderRadius:'14px', overflow:'hidden' }}>
            {monitors.map((m, i) => (
              <motion.div key={m.num} initial="hidden" whileInView="visible" viewport={{ once:true }} variants={dl(i*0.1)}
                style={{ background:'#fff', padding:'48px 40px', transition:'background 0.2s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f7f7f5'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fff'; }}>
                <div style={{ fontFamily:mono, fontSize:'10px', letterSpacing:'0.16em', color:'rgba(0,0,0,0.2)', marginBottom:'28px' }}>{m.num}</div>
                <h3 style={{ fontSize:'19px', fontWeight:600, marginBottom:'12px' }}>{m.title}</h3>
                <p style={{ fontSize:'14px', fontWeight:300, lineHeight:1.7, color:'rgba(0,0,0,0.42)' }}>{m.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section style={{ padding:'120px 48px', background:'#f7f7f5', borderTop:'1px solid rgba(0,0,0,0.08)' }}>
        <div style={{ maxWidth:'1100px', margin:'0 auto' }}>
          <motion.h2 initial="hidden" whileInView="visible" viewport={{ once:true }} variants={fade} style={{ fontSize:'clamp(28px,4vw,52px)', fontWeight:700, letterSpacing:'-0.03em', marginBottom:'64px' }}>How it works.</motion.h2>
          <div style={{ maxWidth:'680px' }}>
            {steps.map((s, i) => (
              <motion.div key={s.idx} initial="hidden" whileInView="visible" viewport={{ once:true }} variants={dl(i*0.08)}
                style={{ display:'grid', gridTemplateColumns:'52px 1fr', gap:'28px', padding:'36px 0', borderBottom: i < steps.length - 1 ? '1px solid rgba(0,0,0,0.08)' : 'none', alignItems:'start' }}>
                <span style={{ fontFamily:mono, fontSize:'10px', color:'rgba(0,0,0,0.18)', paddingTop:'5px', letterSpacing:'0.1em' }}>{s.idx}</span>
                <div>
                  <div style={{ fontSize:'17px', fontWeight:600, marginBottom:'8px' }}>{s.title}</div>
                  <p style={{ fontSize:'14px', fontWeight:300, lineHeight:1.7, color:'rgba(0,0,0,0.42)' }}>{s.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* What's included */}
      <section style={{ padding:'120px 48px', borderTop:'1px solid rgba(0,0,0,0.08)' }}>
        <div style={{ maxWidth:'900px', margin:'0 auto' }}>
          <motion.h2 initial="hidden" whileInView="visible" viewport={{ once:true }} variants={fade} style={{ fontSize:'clamp(28px,4vw,52px)', fontWeight:700, letterSpacing:'-0.03em', marginBottom:'48px' }}>What&apos;s included.</motion.h2>
          <div style={{ borderTop:'1px solid rgba(0,0,0,0.08)' }}>
            {features.map(([name, desc], i) => (
              <motion.div key={name} initial="hidden" whileInView="visible" viewport={{ once:true }} variants={dl(i*0.04)}
                style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'26px 0', borderBottom:'1px solid rgba(0,0,0,0.08)', transition:'background 0.2s,padding 0.2s,margin 0.2s', cursor:'default' }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background='#f7f7f5'; el.style.margin='0 -24px'; el.style.padding='26px 24px'; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background=''; el.style.margin=''; el.style.padding='26px 0'; }}>
                <span style={{ fontSize:'16px', fontWeight:500 }}>{name}</span>
                <span style={{ fontSize:'11px', color:'rgba(0,0,0,0.35)', maxWidth:'360px', textAlign:'right', fontFamily:mono }}>{desc}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Consistency advantage */}
      <section style={{ padding:'120px 48px', background:'#f7f7f5', borderTop:'1px solid rgba(0,0,0,0.08)' }}>
        <div style={{ maxWidth:'1100px', margin:'0 auto', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'100px', alignItems:'center' }} className="mkt-mon-consistency">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once:true }} variants={fade}>
            <div style={{ fontFamily:mono, fontSize:'10px', fontWeight:500, letterSpacing:'0.18em', textTransform:'uppercase', opacity:0.3, marginBottom:'20px' }}>The consistency advantage</div>
            <h2 style={{ fontSize:'clamp(28px,4vw,50px)', fontWeight:700, letterSpacing:'-0.03em', lineHeight:1.08, marginBottom:'20px' }}>AI doesn&apos;t get tired.<br />It doesn&apos;t have blind spots.</h2>
            <p style={{ fontSize:'15px', fontWeight:300, lineHeight:1.75, color:'rgba(0,0,0,0.42)' }}>It monitors layer 1 with the same precision as layer 299. Human operators miss things — not from negligence, but from the physical limits of sustained attention. AutoBuild AI doesn&apos;t have those limits.</p>
          </motion.div>
          <motion.div initial="hidden" whileInView="visible" viewport={{ once:true }} variants={dl(0.12)}
            style={{ borderLeft:'1px solid rgba(0,0,0,0.12)', paddingLeft:'32px', fontSize:'19px', fontWeight:500, lineHeight:1.55, color:'rgba(0,0,0,0.7)', letterSpacing:'-0.01em' }}>
            &ldquo;Every deviation is measured, timestamped, and logged — turning a print into a fully auditable construction process.&rdquo;
          </motion.div>
        </div>
      </section>

      <MktFooter />

      <style>{`
        @media (max-width:900px) {
          .mkt-mon-cols { grid-template-columns:1fr !important; }
          .mkt-mon-consistency { grid-template-columns:1fr !important; gap:48px !important; }
        }
      `}</style>
    </div>
  );
}
