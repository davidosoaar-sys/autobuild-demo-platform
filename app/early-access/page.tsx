'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import MktNav from '@/app/components/MktNav';
import MktFooter from '@/app/components/MktFooter';

const mono = `'JetBrains Mono', monospace`;
const fade = { hidden:{ opacity:0, y:28 }, visible:{ opacity:1, y:0, transition:{ duration:0.65, ease:[0.22,1,0.36,1] as const } } };
const dl = (d:number) => ({ hidden:{ opacity:0, y:28 }, visible:{ opacity:1, y:0, transition:{ duration:0.65, delay:d, ease:[0.22,1,0.36,1] as const } } });

export default function EarlyAccessPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="mkt" style={{ fontFamily:"'Space Grotesk',sans-serif" }}>
      <MktNav />

      {/* Hero */}
      <section style={{ position:'relative', minHeight:'60vh', display:'flex', flexDirection:'column', alignItems:'flex-start', justifyContent:'flex-end', padding:'160px 80px 80px', overflow:'hidden', borderBottom:'1px solid rgba(0,0,0,0.08)' }}>
        <div style={{ position:'absolute', inset:0, backgroundImage:'radial-gradient(circle,rgba(0,0,0,0.06) 1px,transparent 1px)', backgroundSize:'28px 28px', pointerEvents:'none' }} />
        <motion.div initial="hidden" animate="visible" variants={fade} style={{ fontFamily:mono, fontSize:'10px', fontWeight:500, letterSpacing:'0.18em', textTransform:'uppercase', opacity:0.3, marginBottom:'20px', position:'relative' }}>Early Access</motion.div>
        <motion.h1 initial="hidden" animate="visible" variants={dl(0.08)} style={{ fontSize:'clamp(56px,9vw,120px)', fontWeight:700, letterSpacing:'-0.045em', lineHeight:0.95, marginBottom:'24px', position:'relative' }}>
          Be part of<br />what&apos;s next.
        </motion.h1>
        <motion.p initial="hidden" animate="visible" variants={dl(0.16)} style={{ fontSize:'17px', fontWeight:300, color:'rgba(0,0,0,0.42)', maxWidth:'500px', lineHeight:1.7, position:'relative' }}>
          We&apos;re opening early access to a select group of 3DCP operators, researchers, and construction companies.
        </motion.p>
      </section>

      {/* What you get */}
      <section style={{ padding:'120px 80px', background:'#f7f7f5', borderTop:'1px solid rgba(0,0,0,0.08)' }}>
        <div style={{ maxWidth:'1100px', margin:'0 auto' }}>
          <motion.h2 initial="hidden" whileInView="visible" viewport={{ once:true }} variants={fade} style={{ fontSize:'clamp(28px,4vw,48px)', fontWeight:700, letterSpacing:'-0.03em', marginBottom:'64px' }}>What you get.</motion.h2>
          <div className="mkt-ea-cards" style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'1px', background:'rgba(0,0,0,0.08)', border:'1px solid rgba(0,0,0,0.08)', borderRadius:'14px', overflow:'hidden' }}>
            {[
              { tag:'Tool 01', title:'RL Slicer',       badge:'FULL ACCESS', desc:'Full access to the reinforcement learning slicer. Unlimited optimizations. Every feature, no restrictions.' },
              { tag:'Tool 02', title:'Live Monitor',     badge:'FULL ACCESS', desc:'Full access to real-time AI quality monitoring. Unlimited camera feeds. Complete event logging and print reports.' },
              { tag:'Session', title:'1 Hour Session',   badge:'INCLUDED',    desc:"A focused one-hour trial with our team. We'll walk through both tools on your own model — see exactly what it does." },
            ].map((card, i) => (
              <motion.div key={card.tag} initial="hidden" whileInView="visible" viewport={{ once:true }} variants={dl(i*0.1)}
                style={{ background:'#fff', padding:'52px 40px', display:'flex', flexDirection:'column', gap:'14px', transition:'background 0.2s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f7f7f5'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fff'; }}>
                <div style={{ fontFamily:mono, fontSize:'9px', letterSpacing:'0.18em', color:'rgba(0,0,0,0.2)' }}>{card.tag}</div>
                <div style={{ fontSize:'26px', fontWeight:700, letterSpacing:'-0.02em' }}>{card.title}</div>
                <p style={{ fontSize:'14px', fontWeight:300, lineHeight:1.7, color:'rgba(0,0,0,0.42)', flex:1 }}>{card.desc}</p>
                <span style={{ display:'inline-block', fontFamily:mono, fontSize:'9px', letterSpacing:'0.12em', border:'1px solid rgba(0,0,0,0.12)', borderRadius:'4px', padding:'5px 12px', color:'rgba(0,0,0,0.3)', alignSelf:'flex-start' }}>{card.badge}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Waitlist form */}
      <section style={{ padding:'120px 80px', borderTop:'1px solid rgba(0,0,0,0.08)' }}>
        <div style={{ maxWidth:'1100px', margin:'0 auto', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'100px', alignItems:'start' }} className="mkt-ea-form-grid">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once:true }} variants={fade}>
            <div style={{ fontFamily:mono, fontSize:'10px', fontWeight:500, letterSpacing:'0.18em', textTransform:'uppercase', opacity:0.3, marginBottom:'20px' }}>Join the waitlist</div>
            <h2 style={{ fontSize:'clamp(28px,3.5vw,44px)', fontWeight:700, letterSpacing:'-0.03em', lineHeight:1.08, marginBottom:'18px' }}>We&apos;ll email you personally<br />with your access details.</h2>
            <p style={{ fontSize:'15px', fontWeight:300, lineHeight:1.75, color:'rgba(0,0,0,0.42)' }}>This isn&apos;t a mass rollout. We&apos;re onboarding early users carefully so we can actually support them. Fill in the form and we&apos;ll be in touch.</p>
          </motion.div>
          <motion.div initial="hidden" whileInView="visible" viewport={{ once:true }} variants={dl(0.12)}>
            {submitted ? (
              <div>
                <div style={{ width:'28px', height:'1px', background:'#080808', marginBottom:'20px' }} />
                <div style={{ fontSize:'20px', fontWeight:600, marginBottom:'8px' }}>You&apos;re on the list.</div>
                <p style={{ fontSize:'14px', color:'rgba(0,0,0,0.42)' }}>We&apos;ll be in touch soon with your access details.</p>
              </div>
            ) : (
              <form style={{ display:'flex', flexDirection:'column', gap:'12px' }} onSubmit={e => { e.preventDefault(); setSubmitted(true); }}>
                <input type="text" placeholder="Full name" required value={name} onChange={e => setName(e.target.value)}
                  style={{ background:'transparent', border:'1px solid rgba(0,0,0,0.12)', borderRadius:'6px', padding:'16px 18px', fontFamily:"'Space Grotesk',sans-serif", fontSize:'14px', color:'#080808', outline:'none', width:'100%' }} />
                <input type="email" placeholder="Email address" required value={email} onChange={e => setEmail(e.target.value)}
                  style={{ background:'transparent', border:'1px solid rgba(0,0,0,0.12)', borderRadius:'6px', padding:'16px 18px', fontFamily:"'Space Grotesk',sans-serif", fontSize:'14px', color:'#080808', outline:'none', width:'100%' }} />
                <button type="submit" style={{ background:'#080808', color:'#fff', border:'none', borderRadius:'6px', padding:'16px 28px', fontFamily:"'Space Grotesk',sans-serif", fontSize:'14px', fontWeight:600, cursor:'pointer', transition:'opacity 0.2s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity='0.72'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity='1'; }}>
                  Join the Waitlist
                </button>
                <p style={{ fontSize:'11px', fontFamily:mono, color:'rgba(0,0,0,0.25)', lineHeight:1.6 }}>
                  By joining you agree to our <Link href="/tos" style={{ color:'rgba(0,0,0,0.4)' }}>Terms of Service</Link> and <Link href="/privacy" style={{ color:'rgba(0,0,0,0.4)' }}>Privacy Policy</Link>. We&apos;ll email you personally with your access details.
                </p>
              </form>
            )}
          </motion.div>
        </div>
      </section>

      {/* Who it's for */}
      <section style={{ padding:'120px 80px', background:'#f7f7f5', borderTop:'1px solid rgba(0,0,0,0.08)' }}>
        <div style={{ maxWidth:'1100px', margin:'0 auto' }}>
          <motion.h2 initial="hidden" whileInView="visible" viewport={{ once:true }} variants={fade} style={{ fontSize:'clamp(28px,4vw,48px)', fontWeight:700, letterSpacing:'-0.03em', marginBottom:'64px' }}>Who it&apos;s for.</motion.h2>
          <div className="mkt-ea-who" style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'60px' }}>
            {[
              { num:'Audience 01', title:'3DCP Operators',          desc:"You're running printers and want smarter tools. Whether managing one machine or a fleet, AutoBuild AI is built for your workflow." },
              { num:'Audience 02', title:'Researchers',             desc:"You're studying concrete printing and need clean, structured data. Every print produces a fully timestamped event log — a complete record to work with." },
              { num:'Audience 03', title:'Construction Companies',  desc:"You're exploring 3DCP for real projects and need to understand what intelligent tooling looks like in practice. This is where that starts." },
            ].map((w, i) => (
              <motion.div key={w.num} initial="hidden" whileInView="visible" viewport={{ once:true }} variants={dl(i*0.1)} key={w.num}>
                <div style={{ fontFamily:mono, fontSize:'9px', letterSpacing:'0.18em', color:'rgba(0,0,0,0.2)', marginBottom:'18px' }}>{w.num}</div>
                <h3 style={{ fontSize:'20px', fontWeight:600, marginBottom:'12px' }}>{w.title}</h3>
                <p style={{ fontSize:'14px', fontWeight:300, lineHeight:1.7, color:'rgba(0,0,0,0.42)' }}>{w.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <MktFooter />

      <style>{`
        @media (max-width:900px) {
          .mkt-ea-cards, .mkt-ea-who { grid-template-columns:1fr !important; }
          .mkt-ea-form-grid { grid-template-columns:1fr !important; gap:48px !important; }
        }
        @media (max-width:768px) {
          section { padding-left:24px !important; padding-right:24px !important; }
        }
      `}</style>
    </div>
  );
}
