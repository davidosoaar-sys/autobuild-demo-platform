'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';

const fadeUp = {
  hidden:  { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] as const } },
};
const delay = (d: number) => ({
  hidden:  { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.65, delay: d, ease: [0.22, 1, 0.36, 1] as const } },
});

const monoFont = "'JetBrains Mono', monospace";

export default function Home() {
  const router = useRouter();
  const [menuOpen,       setMenuOpen]       = useState(false);
  const [showOnboard,    setShowOnboard]    = useState(false);
  const [nameInput,      setNameInput]      = useState('');
  const [tosChecked,     setTosChecked]     = useState(false);
  const [privChecked,    setPrivChecked]    = useState(false);
  const [dataChecked,    setDataChecked]    = useState(false);
  const [email,          setEmail]          = useState('');
  const [waitlistJoined, setWaitlistJoined] = useState(false);
  const [ready,          setReady]          = useState(false);

  useEffect(() => {
    const name = localStorage.getItem('autobuild_user_name');
    const tos  = localStorage.getItem('autobuild_tos_accepted');
    const priv = localStorage.getItem('autobuild_privacy_accepted');
    if (!name || !tos || !priv) setShowOnboard(true);
    setReady(true);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const handleOnboard = () => {
    if (!nameInput.trim() || !tosChecked || !privChecked) return;
    localStorage.setItem('autobuild_user_name',              nameInput.trim());
    localStorage.setItem('autobuild_tos_accepted',           'true');
    localStorage.setItem('autobuild_privacy_accepted',       'true');
    localStorage.setItem('autobuild_data_training_opted_in', dataChecked ? 'true' : 'false');
    setShowOnboard(false);
  };

  if (!ready) return null;

  const NAV_LINKS = [
    { label: 'Home',         href: '/' },
    { label: 'Slicer',       href: '/slicer' },
    { label: 'Monitor',      href: '/monitor' },
    { label: 'Early Access', href: '#early-access' },
    { label: 'Contact',      href: '/contact' },
  ];

  const BULLETS_SLICER  = ['Live weather and material open time awareness', 'RL-optimized travel paths — not just shortest distance', 'Pot life warnings before you ever hit export'];
  const BULLETS_MONITOR = ['Frame-by-frame bead deviation measurement', 'Instant alerts for critical deviations', 'Fully automated, timestamped event log'];

  return (
    <div className="mkt">

      {/* ── Onboarding modal ─────────────────────────────────────── */}
      <AnimatePresence>
        {showOnboard && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
            <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
              style={{ background: '#fff', borderRadius: '20px', maxWidth: '400px', width: '100%', overflow: 'hidden', boxShadow: '0 32px 80px rgba(0,0,0,0.35)' }}>
              <div style={{ background: '#080808', padding: '24px 24px 20px' }}>
                <Image src="/Autobuildwhite.png" alt="AutoBuild AI" width={160} height={40} style={{ height: '32px', width: 'auto', marginBottom: '16px' }} />
                <p style={{ color: '#fff', fontWeight: 700, fontSize: '18px', lineHeight: 1.3 }}>Welcome to AutoBuild AI</p>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', marginTop: '4px' }}>3DCP monitoring and path optimisation platform</p>
              </div>
              <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'rgba(0,0,0,0.45)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Your name</label>
                  <input autoFocus value={nameInput} onChange={e => setNameInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleOnboard()} placeholder="e.g. John Doe"
                    style={{ width: '100%', border: '1px solid rgba(0,0,0,0.12)', borderRadius: '12px', padding: '10px 14px', fontSize: '14px', outline: 'none' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {[
                    { key: 'tos',  state: tosChecked,  set: setTosChecked,  text: <>'I agree to the <button type="button" onClick={() => router.push('/tos')} style={{ textDecoration: 'underline', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'inherit', color: 'inherit' }}>Terms of Service</button> <span style={{ color: '#f87171' }}>*</span></> },
                    { key: 'priv', state: privChecked, set: setPrivChecked, text: <>'I agree to the <button type="button" onClick={() => router.push('/privacy')} style={{ textDecoration: 'underline', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'inherit', color: 'inherit' }}>Privacy Policy</button> <span style={{ color: '#f87171' }}>*</span></> },
                  ].map(item => (
                    <label key={item.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={item.state} onChange={e => item.set(e.target.checked)}
                        style={{ marginTop: '2px', width: '15px', height: '15px', flexShrink: 0, accentColor: '#080808' }} />
                      <span style={{ fontSize: '12px', color: 'rgba(0,0,0,0.6)', lineHeight: 1.6 }}>{item.text}</span>
                    </label>
                  ))}
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={dataChecked} onChange={e => setDataChecked(e.target.checked)}
                      style={{ marginTop: '2px', width: '15px', height: '15px', flexShrink: 0, accentColor: '#080808' }} />
                    <span style={{ fontSize: '12px', color: 'rgba(0,0,0,0.45)', lineHeight: 1.6 }}>
                      Allow AutoBuild AI to use my anonymised print data to improve its models.{' '}
                      <span style={{ color: 'rgba(0,0,0,0.25)' }}>(Optional)</span>
                    </span>
                  </label>
                </div>
                <button onClick={handleOnboard} disabled={!nameInput.trim() || !tosChecked || !privChecked}
                  style={{ width: '100%', padding: '12px', background: '#080808', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', opacity: (!nameInput.trim() || !tosChecked || !privChecked) ? 0.3 : 1, transition: 'opacity 0.2s' }}>
                  Enter AutoBuild AI
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Fullscreen nav overlay ────────────────────────────────── */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 199, background: '#080808', display: 'flex', flexDirection: 'column', padding: '100px 56px 56px', opacity: menuOpen ? 1 : 0, pointerEvents: menuOpen ? 'all' : 'none', transition: 'opacity 0.4s ease' }}>
        <div className="mkt-mono" style={{ fontFamily: monoFont, fontSize: '10px', letterSpacing: '0.18em', color: 'rgba(255,255,255,0.25)', marginBottom: '24px' }}>(NAVIGATION)</div>
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
          {NAV_LINKS.map(link => (
            <li key={link.label}>
              <a href={link.href} onClick={() => setMenuOpen(false)}
                style={{ fontSize: 'clamp(40px, 7vw, 80px)', fontWeight: 700, letterSpacing: '-0.03em', color: 'rgba(255,255,255,0.85)', textDecoration: 'none', lineHeight: 1.1, display: 'inline-block', transition: 'color 0.2s ease' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.85)'; }}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: '40px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <ul style={{ listStyle: 'none', display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            {['Terms', 'Privacy', 'Contact'].map(t => (
              <li key={t}><a href="#" className="mkt-mono" style={{ fontFamily: monoFont, fontSize: '11px', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>{t}</a></li>
            ))}
          </ul>
          <span className="mkt-mono" style={{ fontFamily: monoFont, fontSize: '11px', color: 'rgba(255,255,255,0.2)' }}>© 2026 AutoBuild AI</span>
        </div>
      </div>

      {/* ── Nav ──────────────────────────────────────────────────── */}
      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200, background: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 40px', height: '72px' }}>
        <button onClick={() => setMenuOpen(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 0, background: '#080808', border: 'none', borderRadius: '100px', padding: 0, cursor: 'pointer', overflow: 'hidden', transition: 'opacity 0.2s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.85'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}>
          <span style={{ padding: '7px 12px 7px 10px', display: 'flex', alignItems: 'center' }}>
            <Image src="/Autobuildwhite.png" alt="AutoBuild AI" width={120} height={30} style={{ height: '30px', width: 'auto', display: 'block' }} />
          </span>
          <span style={{ width: '1px', height: '28px', background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', color: '#fff', fontSize: '13px', fontWeight: 500 }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ display: 'block', width: '16px', height: '1.5px', background: '#fff', borderRadius: '2px', transform: menuOpen ? 'rotate(45deg) translate(4px, 4px)' : 'none', transition: 'transform 0.3s ease' }} />
              <span style={{ display: 'block', width: '16px', height: '1.5px', background: '#fff', borderRadius: '2px', transform: menuOpen ? 'rotate(-45deg) translate(4px, -4px)' : 'none', transition: 'transform 0.3s ease' }} />
            </span>
            {menuOpen ? 'Close' : 'Menu'}
          </span>
        </button>
        <a href="/early-access"
          style={{ background: '#080808', color: '#fff', borderRadius: '100px', padding: '10px 24px', fontSize: '13px', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap', transition: 'opacity 0.2s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.75'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}>
          Join Waitlist
        </a>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section style={{ position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '160px 48px 100px', overflow: 'hidden', background: '#ffffff' }}>
        {/* Animated orbs */}
        <div className="mkt-orb mkt-orb-1" style={{ position: 'absolute', width: '700px', height: '700px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(100,60,220,0.07) 0%, transparent 70%)', top: '-200px', left: '-150px', pointerEvents: 'none' }} />
        <div className="mkt-orb mkt-orb-2" style={{ position: 'absolute', width: '600px', height: '600px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,140,255,0.06) 0%, transparent 70%)', bottom: '-100px', right: '-100px', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle, rgba(0,0,0,0.05) 1px, transparent 1px)', backgroundSize: '28px 28px', pointerEvents: 'none' }} />

        <motion.div initial="hidden" animate="visible" variants={fadeUp}
          className="mkt-mono"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '100px', padding: '6px 16px 6px 12px', fontFamily: monoFont, fontSize: '10px', letterSpacing: '0.1em', color: 'rgba(0,0,0,0.45)', marginBottom: '48px', background: '#f7f7f5', position: 'relative' }}>
          <span className="mkt-pulse" style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
          Early Access Now Open
        </motion.div>

        <motion.h1 initial="hidden" animate="visible" variants={delay(0.08)}
          style={{ fontSize: 'clamp(52px, 8vw, 110px)', fontWeight: 700, lineHeight: 1.0, letterSpacing: '-0.04em', marginBottom: '28px', maxWidth: '900px', color: '#000', position: 'relative' }}>
          The Intelligence Layer<br />
          <span style={{ opacity: 0.18 }}>for 3D Concrete Printing</span>
        </motion.h1>

        <motion.p initial="hidden" animate="visible" variants={delay(0.16)}
          style={{ maxWidth: '420px', fontSize: '16px', fontWeight: 300, lineHeight: 1.75, color: 'rgba(0,0,0,0.42)', marginBottom: '48px', position: 'relative' }}>
          AI-powered path optimization and real-time quality control for the future of construction.
        </motion.p>

        <motion.div initial="hidden" animate="visible" variants={delay(0.24)}
          style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center', position: 'relative' }}>
          <a href="#early-access"
            style={{ background: '#080808', color: '#fff', borderRadius: '6px', padding: '14px 28px', fontSize: '14px', fontWeight: 600, textDecoration: 'none', display: 'inline-block', transition: 'opacity 0.2s' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.75'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}>
            Join the Waitlist
          </a>
          <a href="/slicer"
            style={{ background: 'transparent', color: '#080808', border: '1px solid rgba(0,0,0,0.18)', borderRadius: '6px', padding: '14px 28px', fontSize: '14px', fontWeight: 500, textDecoration: 'none', display: 'inline-block', transition: 'border-color 0.2s' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#080808'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,0,0,0.18)'; }}>
            See How It Works
          </a>
        </motion.div>
      </section>

      {/* ── Stats bar ────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', background: '#080808', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        {[['47%','Average Travel Saved'],['< 1s','Alert Response Time'],['300+','Layers Per Print'],['Claude Vision','AI Engine']].map(([val, label], i) => (
          <motion.div key={val} initial="hidden" whileInView="visible" viewport={{ once: true }} variants={delay(i * 0.07)}
            style={{ padding: '36px 24px', borderRight: i < 3 ? '1px solid rgba(255,255,255,0.06)' : 'none', textAlign: 'center' }}>
            <div className="mkt-mono" style={{ fontFamily: monoFont, fontSize: '26px', fontWeight: 700, letterSpacing: '-0.02em', color: 'rgba(255,255,255,0.92)', marginBottom: '6px' }}>{val}</div>
            <div className="mkt-mono" style={{ fontFamily: monoFont, fontSize: '9px', letterSpacing: '0.14em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>{label}</div>
          </motion.div>
        ))}
      </div>

      {/* ── Slicer section ───────────────────────────────────────── */}
      <section style={{ padding: '120px 48px', background: '#ffffff', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
        <div className="mkt-slicer-grid" style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '80px', alignItems: 'center' }}>
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp}>
            <div className="mkt-mono" style={{ fontFamily: monoFont, fontSize: '10px', fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase', opacity: 0.3, marginBottom: '20px' }}>RL Slicer</div>
            <h2 style={{ fontSize: 'clamp(32px, 4vw, 54px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, marginBottom: '20px', color: '#000' }}>A strategy.<br />Not just a path.</h2>
            <p style={{ fontSize: '15px', fontWeight: 300, lineHeight: 1.75, color: 'rgba(0,0,0,0.42)', marginBottom: '28px', maxWidth: '380px' }}>
              Our reinforcement-learning slicer considers your material, environment, and build conditions before generating a single line of G-code.
            </p>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '36px' }}>
              {BULLETS_SLICER.map(item => (
                <li key={item} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: 'rgba(0,0,0,0.45)' }}>
                  <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: 'rgba(0,0,0,0.3)', flexShrink: 0, display: 'inline-block' }} />{item}
                </li>
              ))}
            </ul>
            <a href="/slicer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'rgba(0,0,0,0.6)', textDecoration: 'none', borderBottom: '1px solid rgba(0,0,0,0.15)', paddingBottom: '2px', transition: 'color 0.2s, border-color 0.2s' }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = '#080808'; el.style.borderColor = '#080808'; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = 'rgba(0,0,0,0.6)'; el.style.borderColor = 'rgba(0,0,0,0.15)'; }}>
              Learn more →
            </a>
          </motion.div>
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={delay(0.12)} style={{ position: 'relative' }}>
            <div style={{ borderRadius: '14px', overflow: 'hidden', boxShadow: '0 48px 100px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.06)', transform: 'perspective(1200px) rotateY(-4deg) rotateX(2deg)', transition: 'transform 0.7s ease' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'perspective(1200px) rotateY(-1deg) rotateX(0)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'perspective(1200px) rotateY(-4deg) rotateX(2deg)'; }}>
              <Image src="/slicer-screenshot.png" alt="AutoBuild AI RL Slicer" width={800} height={500} style={{ display: 'block', width: '100%', height: 'auto' }} />
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Monitor section ──────────────────────────────────────── */}
      <section style={{ padding: '120px 48px', background: '#f7f7f5', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
        <div className="mkt-monitor-grid" style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '80px', alignItems: 'center' }}>
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp}
            className="mkt-mono" style={{ background: '#080808', borderRadius: '14px', padding: '28px', fontFamily: monoFont, boxShadow: '0 40px 80px rgba(0,0,0,0.12)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div style={{ fontSize: '9px', letterSpacing: '0.18em', color: 'rgba(255,255,255,0.2)' }}>Bead Analysis</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '9px', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)' }}>
                <span className="mkt-pulse" style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />LIVE
              </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '20px', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '9px', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.18)' }}>CAMERA FEED — LAYER 47</div>
              <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
                <svg width="72" height="72" viewBox="0 0 72 72" fill="none">
                  <circle cx="36" cy="36" r="26" stroke="rgba(255,255,255,0.1)" strokeWidth="1"/>
                  <line x1="36" y1="4" x2="36" y2="68" stroke="rgba(255,255,255,0.07)" strokeWidth="0.5"/>
                  <line x1="4" y1="36" x2="68" y2="36" stroke="rgba(255,255,255,0.07)" strokeWidth="0.5"/>
                  <circle cx="36" cy="36" r="2.5" fill="rgba(255,255,255,0.3)"/>
                </svg>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.75)' }}>STRAIGHT +0.8°</span>
                <span style={{ fontSize: '8px', letterSpacing: '0.1em', border: '1px solid rgba(255,255,255,0.1)', padding: '3px 8px', borderRadius: '3px', color: 'rgba(255,255,255,0.3)' }}>WITHIN TOLERANCE</span>
              </div>
            </div>
            {[{ label: 'Deviation Avg.', value: '+0.4°' }, { label: 'Alerts Fired', value: '0' }, { label: 'Frames Analysed', value: '8,421' }].map((stat, i) => (
              <div key={stat.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < 2 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)' }}>{stat.label}</span>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.75)' }}>{stat.value}</span>
              </div>
            ))}
          </motion.div>

          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={delay(0.12)}>
            <div className="mkt-mono" style={{ fontFamily: monoFont, fontSize: '10px', fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase', opacity: 0.3, marginBottom: '20px' }}>Live Monitor</div>
            <h2 style={{ fontSize: 'clamp(32px, 4vw, 54px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, marginBottom: '20px', color: '#080808' }}>
              The extra set of eyes that never blinks.
            </h2>
            <p style={{ fontSize: '15px', fontWeight: 300, lineHeight: 1.75, color: 'rgba(0,0,0,0.42)', marginBottom: '28px', maxWidth: '380px' }}>
              Claude Vision analyses every frame of your print in real time — measuring deviation, logging events, and alerting you the moment something goes wrong.
            </p>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '36px' }}>
              {BULLETS_MONITOR.map(item => (
                <li key={item} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: 'rgba(0,0,0,0.45)' }}>
                  <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: 'rgba(0,0,0,0.3)', flexShrink: 0, display: 'inline-block' }} />{item}
                </li>
              ))}
            </ul>
            <a href="/monitor"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'rgba(0,0,0,0.6)', textDecoration: 'none', borderBottom: '1px solid rgba(0,0,0,0.15)', paddingBottom: '2px', transition: 'color 0.2s, border-color 0.2s' }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = '#080808'; el.style.borderColor = '#080808'; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = 'rgba(0,0,0,0.6)'; el.style.borderColor = 'rgba(0,0,0,0.15)'; }}>
              Learn more →
            </a>
          </motion.div>
        </div>
      </section>

      {/* ── How it Works ─────────────────────────────────────────── */}
      <section style={{ padding: '120px 48px', background: '#ffffff', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <motion.h2 initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp}
            style={{ fontSize: 'clamp(32px, 5vw, 68px)', fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1.0, marginBottom: '80px', maxWidth: '680px', color: '#000' }}>
            From model to monitor<br />in minutes.
          </motion.h2>
          <div className="mkt-steps-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', background: 'rgba(0,0,0,0.08)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '14px', overflow: 'hidden' }}>
            {[
              { num: '01', icon: '↑', title: 'Upload',   desc: 'Drop in your STL or OBJ. Set your material, location, and start time.' },
              { num: '02', icon: '⚙', title: 'Optimize', desc: 'The RL slicer computes an environment-aware print strategy in seconds.' },
              { num: '03', icon: '◉', title: 'Monitor',  desc: 'Connect your camera. AI watches every layer and logs every deviation.' },
            ].map((step, i) => (
              <motion.div key={step.num} initial="hidden" whileInView="visible" viewport={{ once: true }} variants={delay(i * 0.1)}
                style={{ background: '#ffffff', padding: '52px 44px', position: 'relative', overflow: 'hidden', transition: 'background 0.2s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f7f7f5'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#ffffff'; }}>
                <div className="mkt-mono" style={{ position: 'absolute', right: '-8px', bottom: '-20px', fontSize: '130px', fontWeight: 700, color: 'rgba(0,0,0,0.03)', fontFamily: monoFont, pointerEvents: 'none', userSelect: 'none', lineHeight: 1 }}>{step.num}</div>
                <div style={{ width: '48px', height: '48px', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', marginBottom: '28px', color: 'rgba(0,0,0,0.4)' }}>{step.icon}</div>
                <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '10px', color: '#080808' }}>{step.title}</h3>
                <p style={{ fontSize: '14px', fontWeight: 300, lineHeight: 1.65, color: 'rgba(0,0,0,0.42)' }}>{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Early Access ─────────────────────────────────────────── */}
      <section id="early-access" style={{ background: '#080808', color: '#fff', padding: '120px 48px', textAlign: 'center', position: 'relative', overflow: 'hidden', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 60% at 50% 50%, rgba(80,40,200,0.18) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)', backgroundSize: '28px 28px', pointerEvents: 'none' }} />
        <motion.h2 initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp}
          style={{ fontSize: 'clamp(44px, 7vw, 96px)', fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1.0, marginBottom: '20px', position: 'relative' }}>
          Be part of what&apos;s next.
        </motion.h2>
        <motion.p initial="hidden" whileInView="visible" viewport={{ once: true }} variants={delay(0.08)}
          style={{ fontSize: '16px', fontWeight: 300, color: 'rgba(255,255,255,0.4)', maxWidth: '420px', margin: '0 auto 44px', lineHeight: 1.7, position: 'relative' }}>
          We&apos;re opening early access to a select group of 3DCP operators, researchers, and construction companies.
        </motion.p>
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={delay(0.16)} style={{ position: 'relative' }}>
          {waitlistJoined ? (
            <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '16px' }}>You&apos;re on the list. We&apos;ll be in touch!</p>
          ) : (
            <form onSubmit={e => { e.preventDefault(); if (email.trim()) setWaitlistJoined(true); }}
              style={{ display: 'flex', gap: '10px', maxWidth: '420px', margin: '0 auto 16px', flexWrap: 'wrap', justifyContent: 'center' }}>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" required
                style={{ flex: 1, minWidth: '200px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '14px 18px', fontSize: '14px', color: '#fff', outline: 'none', transition: 'border-color 0.2s' }}
                onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.3)'; }}
                onBlur={e =>  { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)'; }} />
              <button type="submit"
                style={{ background: '#fff', color: '#080808', border: 'none', borderRadius: '6px', padding: '14px 28px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', transition: 'opacity 0.2s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.85'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}>
                Join Waitlist
              </button>
            </form>
          )}
        </motion.div>
        <motion.p initial="hidden" whileInView="visible" viewport={{ once: true }} variants={delay(0.22)}
          className="mkt-mono" style={{ fontFamily: monoFont, fontSize: '11px', color: 'rgba(255,255,255,0.18)', position: 'relative' }}>
          By joining you agree to our <a href="/tos" style={{ color: 'rgba(255,255,255,0.3)' }}>Terms</a> and <a href="/privacy" style={{ color: 'rgba(255,255,255,0.3)' }}>Privacy Policy</a>.
        </motion.p>
      </section>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer style={{ background: '#080808', borderTop: '1px solid rgba(255,255,255,0.07)', padding: '36px 48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <Image src="/Autobuildwhite.png" alt="AutoBuild AI" width={120} height={30} style={{ height: '28px', width: 'auto', display: 'block' }} />
        <ul style={{ display: 'flex', gap: '28px', listStyle: 'none', flexWrap: 'wrap' }}>
          {[{ label: 'Slicer', href: '/slicer' }, { label: 'Monitor', href: '/monitor' }, { label: 'Terms', href: '/tos' }, { label: 'Privacy', href: '/privacy' }, { label: 'Contact', href: '/contact' }].map(link => (
            <li key={link.label}>
              <a href={link.href}
                style={{ color: 'rgba(255,255,255,0.3)', textDecoration: 'none', fontSize: '12px', letterSpacing: '0.03em', transition: 'color 0.2s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)'; }}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <span className="mkt-mono" style={{ fontFamily: monoFont, fontSize: '12px', color: 'rgba(255,255,255,0.2)' }}>© 2026 AutoBuild AI</span>
      </footer>

      <style>{`
        @keyframes orb-drift-1 {
          0%,100% { transform: translate(0,0) scale(1); }
          30%  { transform: translate(60px,-40px) scale(1.06); }
          60%  { transform: translate(-30px,50px) scale(0.94); }
        }
        @keyframes orb-drift-2 {
          0%,100% { transform: translate(0,0) scale(1); }
          40%  { transform: translate(-50px,30px) scale(1.04); }
          70%  { transform: translate(40px,-50px) scale(0.96); }
        }
        .mkt-orb-1 { animation: orb-drift-1 20s ease-in-out infinite; }
        .mkt-orb-2 { animation: orb-drift-2 26s ease-in-out infinite; }
        @media (max-width: 900px) {
          .mkt-slicer-grid  { grid-template-columns: 1fr !important; gap: 48px !important; }
          .mkt-monitor-grid { grid-template-columns: 1fr !important; gap: 48px !important; }
          .mkt-steps-grid   { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 768px) {
          .mkt > nav { padding: 0 20px !important; height: 60px !important; }
        }
      `}</style>
    </div>
  );
}
