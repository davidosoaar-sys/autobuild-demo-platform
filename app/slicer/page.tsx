'use client';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import MktNav from '@/app/components/MktNav';
import MktFooter from '@/app/components/MktFooter';

const mono = `'JetBrains Mono', monospace`;
const fade = { hidden: { opacity:0, y:28 }, visible: { opacity:1, y:0, transition:{ duration:0.65, ease:[0.22,1,0.36,1] as const } } };
const dl = (d:number) => ({ hidden:{ opacity:0, y:28 }, visible:{ opacity:1, y:0, transition:{ duration:0.65, delay:d, ease:[0.22,1,0.36,1] as const } } });

const howSteps = [
  { num:'01 — UPLOAD',     title:'Your model',          desc:'Drop in any STL or OBJ. The slicer parses your geometry and prepares it for environment-aware path computation.' },
  { num:'02 — CONDITIONS', title:'Set your environment', desc:'Enter your city, material mix, and planned start time. Live weather, open time, and pot life margins computed automatically.' },
  { num:'03 — STRATEGY',   title:'Get your G-code',     desc:'Receive an optimized print strategy with travel savings, a full summary, and pot life warning if conditions are tight.' },
];

const features = [
  ['Live weather forecast integration',        'Temp, humidity and wind at time of computation'],
  ['Material open time awareness',             "Each mix's working window factored into path sequencing"],
  ['Reinforcement learning path optimization', 'Trained on real print data — not shortest-path heuristics'],
  ['Pot life warning before export',           'Hard stop if your conditions put you at risk'],
  ['G-code download — .gcode and .txt',        'Compatible with standard 3DCP printer controllers'],
  ['Print strategy summary',                   'Human-readable breakdown of every decision made'],
];

export default function SlicerPage() {
  return (
    <div className="mkt" style={{ fontFamily:"'Space Grotesk',sans-serif" }}>
      <MktNav />

      {/* Hero */}
      <section style={{ position:'relative', minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center', padding:'160px 48px 100px', overflow:'hidden', background:'#fff' }}>
        <div style={{ position:'absolute', inset:0, backgroundImage:'radial-gradient(circle,rgba(0,0,0,0.06) 1px,transparent 1px)', backgroundSize:'28px 28px', pointerEvents:'none' }} />
        <motion.div initial="hidden" animate="visible" variants={fade} style={{ fontFamily:mono, fontSize:'10px', fontWeight:500, letterSpacing:'0.18em', textTransform:'uppercase', opacity:0.3, marginBottom:'20px', position:'relative' }}>RL Slicer</motion.div>
        <motion.h1 initial="hidden" animate="visible" variants={dl(0.08)} style={{ fontSize:'clamp(44px,7vw,96px)', fontWeight:700, letterSpacing:'-0.04em', lineHeight:1.0, marginBottom:'24px', maxWidth:'860px', position:'relative' }}>
          Upload your model.<br />Get a smarter build.
        </motion.h1>
        <motion.p initial="hidden" animate="visible" variants={dl(0.16)} style={{ fontSize:'16px', fontWeight:300, color:'rgba(0,0,0,0.42)', maxWidth:'460px', lineHeight:1.75, marginBottom:'44px', position:'relative' }}>
          The only slicer that factors in your material, environment, and build conditions before computing a single path.
        </motion.p>
        <motion.div initial="hidden" animate="visible" variants={dl(0.24)} style={{ display:'flex', gap:'12px', flexWrap:'wrap', justifyContent:'center', position:'relative' }}>
          <Link href="/early-access" style={{ background:'#080808', color:'#fff', borderRadius:'6px', padding:'14px 28px', fontSize:'14px', fontWeight:600, textDecoration:'none' }}>Get Early Access</Link>
          <Link href="/tools/slicer" style={{ background:'transparent', color:'#080808', border:'1px solid rgba(0,0,0,0.18)', borderRadius:'6px', padding:'14px 28px', fontSize:'14px', fontWeight:500, textDecoration:'none' }}>Try the Slicer</Link>
        </motion.div>
        <motion.div initial="hidden" animate="visible" variants={dl(0.28)} style={{ marginTop:'72px', width:'100%', maxWidth:'960px', position:'relative' }}>
          <div style={{ borderRadius:'16px', overflow:'hidden', boxShadow:'0 60px 120px rgba(0,0,0,0.13),0 12px 32px rgba(0,0,0,0.07)', border:'1px solid rgba(0,0,0,0.06)', transform:'perspective(1400px) rotateX(3deg)', transition:'transform 0.8s ease' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'perspective(1400px) rotateX(0)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'perspective(1400px) rotateX(3deg)'; }}>
            <Image src="/slicer-screenshot.png" alt="AutoBuild AI RL Slicer interface" width={960} height={600} style={{ display:'block', width:'100%', height:'auto' }} />
          </div>
        </motion.div>
      </section>

      {/* How it works */}
      <section style={{ padding:'120px 48px', borderTop:'1px solid rgba(0,0,0,0.08)' }}>
        <div style={{ maxWidth:'1100px', margin:'0 auto' }}>
          <motion.h2 initial="hidden" whileInView="visible" viewport={{ once:true }} variants={fade} style={{ fontSize:'clamp(28px,4vw,52px)', fontWeight:700, letterSpacing:'-0.03em', marginBottom:'64px' }}>How it works.</motion.h2>
          <div className="mkt-slicer-how" style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'1px', background:'rgba(0,0,0,0.08)', border:'1px solid rgba(0,0,0,0.08)', borderRadius:'14px', overflow:'hidden' }}>
            {howSteps.map((s, i) => (
              <motion.div key={s.num} initial="hidden" whileInView="visible" viewport={{ once:true }} variants={dl(i*0.1)}
                style={{ background:'#fff', padding:'48px 40px', transition:'background 0.2s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f7f7f5'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fff'; }}>
                <div style={{ fontFamily:mono, fontSize:'10px', letterSpacing:'0.16em', color:'rgba(0,0,0,0.2)', marginBottom:'28px' }}>{s.num}</div>
                <h3 style={{ fontSize:'19px', fontWeight:600, marginBottom:'12px' }}>{s.title}</h3>
                <p style={{ fontSize:'14px', fontWeight:300, lineHeight:1.7, color:'rgba(0,0,0,0.42)' }}>{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Why it matters */}
      <section style={{ padding:'120px 48px', background:'#f7f7f5', borderTop:'1px solid rgba(0,0,0,0.08)' }}>
        <div style={{ maxWidth:'1100px', margin:'0 auto', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'80px', alignItems:'center' }} className="mkt-slicer-diff">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once:true }} variants={fade}>
            <div style={{ fontFamily:mono, fontSize:'10px', fontWeight:500, letterSpacing:'0.18em', textTransform:'uppercase', opacity:0.3, marginBottom:'20px' }}>Why it matters</div>
            <h2 style={{ fontSize:'clamp(28px,4vw,52px)', fontWeight:700, letterSpacing:'-0.03em', lineHeight:1.05, marginBottom:'20px' }}>Traditional slicers<br />don&apos;t know your site.</h2>
            <p style={{ fontSize:'15px', fontWeight:300, lineHeight:1.75, color:'rgba(0,0,0,0.45)', marginBottom:'18px' }}>Standard slicers compute paths purely from geometry. They don&apos;t know your material&apos;s open time. They don&apos;t know if it&apos;s 34°C and humid.</p>
            <p style={{ fontSize:'15px', fontWeight:300, lineHeight:1.75, color:'rgba(0,0,0,0.45)' }}>AutoBuild AI&apos;s RL slicer is trained on real print conditions — minimizing travel, avoiding pot life violations, and producing G-code ready for the real world.</p>
          </motion.div>
          <motion.div initial="hidden" whileInView="visible" viewport={{ once:true }} variants={dl(0.12)}
            style={{ background:'#080808', borderRadius:'14px', padding:'36px', fontFamily:mono, boxShadow:'0 40px 80px rgba(0,0,0,0.1)' }}>
            <div style={{ fontSize:'9px', letterSpacing:'0.18em', color:'rgba(255,255,255,0.2)', marginBottom:'28px' }}>Results Panel · Last Run</div>
            {[['Travel Saved','47%',true],['Est. Print Time','4h 32m',false],['Layers','284',false],['Material','CC-40 Mix',false],['Temp / Humidity','28°C / 62%',false],['Pot Life Margin','+22 min ✓',false],['Computed in','8.2s',false]].map(([label,value,big]) => (
              <div key={String(label)} style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', padding:'13px 0', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.28)' }}>{label}</span>
                <span style={{ fontSize: big ? '24px' : '15px', color: big ? '#fff' : 'rgba(255,255,255,0.8)' }}>{value}</span>
              </div>
            ))}
          </motion.div>
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

      <MktFooter />

      <style>{`
        @media (max-width:900px) {
          .mkt-slicer-how { grid-template-columns:1fr !important; }
          .mkt-slicer-diff { grid-template-columns:1fr !important; gap:48px !important; }
        }
      `}</style>
    </div>
  );
}
