'use client';
import Link from 'next/link';
import Image from 'next/image';

const links = [
  { label: 'Slicer',       href: '/slicer' },
  { label: 'Monitor',      href: '/monitor' },
  { label: 'Early Access', href: '/early-access' },
  { label: 'Contact',      href: '/contact' },
];

export default function MktNav() {
  return (
    <>
      <style>{`
        .mkt-nav-link { font-size:13px; font-weight:500; color:rgba(0,0,0,0.45); text-decoration:none; transition:color 0.2s; }
        .mkt-nav-link:hover { color:#080808; }
        .mkt-nav-cta { background:#080808; color:#fff; border-radius:100px; padding:10px 24px; font-size:13px; font-weight:600; text-decoration:none; white-space:nowrap; transition:opacity 0.2s; font-family:'Space Grotesk',sans-serif; }
        .mkt-nav-cta:hover { opacity:0.75; }
        @media (max-width:768px) { .mkt-nav-links { display:none !important; } nav.mkt-nav { padding:0 20px !important; height:60px !important; } nav.mkt-nav img { height:36px !important; } }
      `}</style>
      <nav className="mkt-nav" style={{ position:'fixed', top:0, left:0, right:0, zIndex:200, background:'#fff', borderBottom:'1px solid rgba(0,0,0,0.08)', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 40px', height:'72px', fontFamily:"'Space Grotesk',sans-serif" }}>
        <Link href="/">
          <Image src="/Autobuildblack.png" alt="AutoBuild AI" width={200} height={60} style={{ height:'48px', width:'auto', display:'block' }} />
        </Link>
        <ul className="mkt-nav-links" style={{ display:'flex', listStyle:'none', gap:'32px', alignItems:'center' }}>
          {links.map(l => (
            <li key={l.label}><Link href={l.href} className="mkt-nav-link">{l.label}</Link></li>
          ))}
        </ul>
        <Link href="/early-access" className="mkt-nav-cta">Join Waitlist</Link>
      </nav>
    </>
  );
}
