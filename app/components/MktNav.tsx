'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';

const monoFont = "'JetBrains Mono', monospace";

const NAV_LINKS = [
  { label: 'Home',         href: '/' },
  { label: 'Slicer',       href: '/slicer' },
  { label: 'Monitor',      href: '/monitor' },
  { label: 'Early Access', href: '/early-access' },
  { label: 'Contact',      href: '/contact' },
];

export default function MktNav() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  return (
    <>
      {/* Fullscreen overlay */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 199, background: '#080808', display: 'flex', flexDirection: 'column', padding: '100px 56px 56px', opacity: menuOpen ? 1 : 0, pointerEvents: menuOpen ? 'all' : 'none', transition: 'opacity 0.4s ease' }}>
        <div style={{ fontFamily: monoFont, fontSize: '10px', letterSpacing: '0.18em', color: 'rgba(255,255,255,0.25)', marginBottom: '24px' }}>(NAVIGATION)</div>
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
          {NAV_LINKS.map(link => (
            <li key={link.label}>
              <Link href={link.href} onClick={() => setMenuOpen(false)}
                style={{ fontSize: 'clamp(40px, 7vw, 80px)', fontWeight: 700, letterSpacing: '-0.03em', color: 'rgba(255,255,255,0.85)', textDecoration: 'none', lineHeight: 1.1, display: 'inline-block', transition: 'color 0.2s ease' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.85)'; }}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: '40px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <ul style={{ listStyle: 'none', display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            {[['Terms', '/tos'], ['Privacy', '/privacy'], ['Contact', '/contact']].map(([t, href]) => (
              <li key={t}><Link href={href} onClick={() => setMenuOpen(false)} style={{ fontFamily: monoFont, fontSize: '11px', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>{t}</Link></li>
            ))}
          </ul>
          <span style={{ fontFamily: monoFont, fontSize: '11px', color: 'rgba(255,255,255,0.2)' }}>© 2026 AutoBuild AI</span>
        </div>
      </div>

      {/* Nav bar */}
      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200, background: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 40px', height: '72px', fontFamily: "'Space Grotesk', sans-serif" }}>
        <button onClick={() => setMenuOpen(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 0, background: '#f7f7f5', border: '1px solid rgba(0,0,0,0.10)', borderRadius: '100px', padding: 0, cursor: 'pointer', overflow: 'hidden', transition: 'opacity 0.2s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.85'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}>
          <span style={{ padding: '7px 12px 7px 10px', display: 'flex', alignItems: 'center' }}>
            <Image src="/Autobuildblack.png" alt="AutoBuild AI" width={120} height={30} style={{ height: '30px', width: 'auto', display: 'block' }} />
          </span>
          <span style={{ width: '1px', height: '28px', background: 'rgba(0,0,0,0.12)', flexShrink: 0 }} />
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', color: '#080808', fontSize: '13px', fontWeight: 500 }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ display: 'block', width: '16px', height: '1.5px', background: '#080808', borderRadius: '2px', transform: menuOpen ? 'rotate(45deg) translate(4px, 4px)' : 'none', transition: 'transform 0.3s ease' }} />
              <span style={{ display: 'block', width: '16px', height: '1.5px', background: '#080808', borderRadius: '2px', transform: menuOpen ? 'rotate(-45deg) translate(4px, -4px)' : 'none', transition: 'transform 0.3s ease' }} />
            </span>
            {menuOpen ? 'Close' : 'Menu'}
          </span>
        </button>
        <Link href="/early-access"
          style={{ background: '#080808', color: '#fff', borderRadius: '100px', padding: '10px 24px', fontSize: '13px', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap', transition: 'opacity 0.2s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.75'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}>
          Join Waitlist
        </Link>
      </nav>
    </>
  );
}
