'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import MktNav from '@/app/components/MktNav';
import MktFooter from '@/app/components/MktFooter';

const mono = `'JetBrains Mono', monospace`;
const fade = { hidden:{ opacity:0, y:28 }, visible:{ opacity:1, y:0, transition:{ duration:0.65, ease:[0.22,1,0.36,1] as const } } };
const dl = (d:number) => ({ hidden:{ opacity:0, y:28 }, visible:{ opacity:1, y:0, transition:{ duration:0.65, delay:d, ease:[0.22,1,0.36,1] as const } } });

export default function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  return (
    <div className="mkt" style={{ fontFamily:"'Space Grotesk',sans-serif" }}>
      <MktNav />

      {/* Hero */}
      <section style={{ position:'relative', minHeight:'60vh', display:'flex', flexDirection:'column', alignItems:'flex-start', justifyContent:'flex-end', padding:'160px 80px 80px', overflow:'hidden', borderBottom:'1px solid rgba(0,0,0,0.08)' }}>
        <div style={{ position:'absolute', inset:0, backgroundImage:'radial-gradient(circle,rgba(0,0,0,0.06) 1px,transparent 1px)', backgroundSize:'28px 28px', pointerEvents:'none' }} />
        <motion.div initial="hidden" animate="visible" variants={fade} style={{ fontFamily:mono, fontSize:'10px', fontWeight:500, letterSpacing:'0.18em', textTransform:'uppercase', opacity:0.3, marginBottom:'20px', position:'relative' }}>Contact</motion.div>
        <motion.h1 initial="hidden" animate="visible" variants={dl(0.08)} style={{ fontSize:'clamp(56px,9vw,120px)', fontWeight:700, letterSpacing:'-0.045em', lineHeight:0.95, marginBottom:'24px', position:'relative' }}>
          Get in touch.
        </motion.h1>
        <motion.p initial="hidden" animate="visible" variants={dl(0.16)} style={{ fontSize:'17px', fontWeight:300, color:'rgba(0,0,0,0.42)', maxWidth:'480px', lineHeight:1.7, position:'relative' }}>
          Questions about early access, integration, or anything else — we read every message and respond personally.
        </motion.p>
      </section>

      {/* Form + info */}
      <div style={{ padding:'100px 80px' }}>
        <div style={{ maxWidth:'1100px', margin:'0 auto', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'100px', alignItems:'start' }} className="mkt-contact-grid">

          {/* Form */}
          <motion.div initial="hidden" whileInView="visible" viewport={{ once:true }} variants={fade}>
            {sent ? (
              <div>
                <div style={{ width:'28px', height:'1px', background:'#080808', marginBottom:'20px' }} />
                <div style={{ fontSize:'20px', fontWeight:600, marginBottom:'8px' }}>Message sent.</div>
                <p style={{ fontSize:'14px', color:'rgba(0,0,0,0.42)' }}>We&apos;ll get back to you within 24 hours.</p>
              </div>
            ) : (
              <form style={{ display:'flex', flexDirection:'column', gap:'12px' }} onSubmit={e => { e.preventDefault(); setSent(true); }}>
                <input type="text" placeholder="Full name" required value={name} onChange={e => setName(e.target.value)}
                  style={{ background:'transparent', border:'1px solid rgba(0,0,0,0.12)', borderRadius:'6px', padding:'16px 18px', fontFamily:"'Space Grotesk',sans-serif", fontSize:'14px', color:'#080808', outline:'none', width:'100%' }} />
                <input type="email" placeholder="Email address" required value={email} onChange={e => setEmail(e.target.value)}
                  style={{ background:'transparent', border:'1px solid rgba(0,0,0,0.12)', borderRadius:'6px', padding:'16px 18px', fontFamily:"'Space Grotesk',sans-serif", fontSize:'14px', color:'#080808', outline:'none', width:'100%' }} />
                <textarea placeholder="Your message" required value={message} onChange={e => setMessage(e.target.value)} rows={6}
                  style={{ background:'transparent', border:'1px solid rgba(0,0,0,0.12)', borderRadius:'6px', padding:'16px 18px', fontFamily:"'Space Grotesk',sans-serif", fontSize:'14px', color:'#080808', outline:'none', width:'100%', resize:'vertical' }} />
                <button type="submit" style={{ background:'#080808', color:'#fff', border:'none', borderRadius:'6px', padding:'16px 28px', fontFamily:"'Space Grotesk',sans-serif", fontSize:'14px', fontWeight:600, cursor:'pointer', alignSelf:'flex-start', transition:'opacity 0.2s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity='0.72'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity='1'; }}>
                  Send Message
                </button>
              </form>
            )}
          </motion.div>

          {/* Info */}
          <motion.div initial="hidden" whileInView="visible" viewport={{ once:true }} variants={dl(0.12)} style={{ paddingTop:'8px' }}>
            <div style={{ marginBottom:'52px' }}>
              <div style={{ fontFamily:mono, fontSize:'9px', letterSpacing:'0.18em', color:'rgba(0,0,0,0.2)', marginBottom:'14px' }}>Email</div>
              <div style={{ fontSize:'20px', fontWeight:600, letterSpacing:'-0.01em' }}>
                <a href="mailto:hello@autobuild3dcp.com" style={{ color:'#080808', textDecoration:'none', transition:'opacity 0.2s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity='0.55'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity='1'; }}>
                  hello@autobuild3dcp.com
                </a>
              </div>
              <p style={{ fontSize:'14px', fontWeight:300, color:'rgba(0,0,0,0.42)', marginTop:'6px' }}>We respond within 24 hours.</p>
            </div>
            <div style={{ marginBottom:'52px' }}>
              <div style={{ fontFamily:mono, fontSize:'9px', letterSpacing:'0.18em', color:'rgba(0,0,0,0.2)', marginBottom:'14px' }}>Early Access</div>
              <p style={{ fontSize:'14px', fontWeight:300, color:'rgba(0,0,0,0.42)', lineHeight:1.6, marginBottom:'16px' }}>Want to try the platform before it launches? Join the waitlist and we&apos;ll reach out with access details.</p>
              <Link href="/early-access" style={{ display:'inline-flex', alignItems:'center', gap:'8px', fontSize:'14px', fontWeight:600, color:'#080808', textDecoration:'none', borderBottom:'1px solid rgba(0,0,0,0.18)', paddingBottom:'2px', transition:'border-color 0.2s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor='#080808'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor='rgba(0,0,0,0.18)'; }}>
                Join Waitlist →
              </Link>
            </div>
            <div>
              <div style={{ fontFamily:mono, fontSize:'9px', letterSpacing:'0.18em', color:'rgba(0,0,0,0.2)', marginBottom:'14px' }}>Based in</div>
              <div style={{ fontSize:'20px', fontWeight:600 }}>Australia</div>
              <p style={{ fontSize:'14px', fontWeight:300, color:'rgba(0,0,0,0.42)', marginTop:'6px' }}>Building tools for 3D concrete printing teams worldwide.</p>
            </div>
          </motion.div>
        </div>
      </div>

      <MktFooter />

      <style>{`
        @media (max-width:900px) {
          .mkt-contact-grid { grid-template-columns:1fr !important; gap:60px !important; }
        }
        @media (max-width:768px) {
          section, div[style*="padding:100px 80px"] { padding-left:24px !important; padding-right:24px !important; }
        }
      `}</style>
    </div>
  );
}
