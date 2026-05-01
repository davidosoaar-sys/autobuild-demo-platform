import Link from 'next/link';
import Image from 'next/image';

const monoFont = `'JetBrains Mono', monospace`;
const links = [
  { label: 'Slicer',   href: '/slicer' },
  { label: 'Monitor',  href: '/monitor' },
  { label: 'Terms',    href: '/tos' },
  { label: 'Privacy',  href: '/privacy' },
  { label: 'Contact',  href: '/contact' },
];

export default function MktFooter() {
  return (
    <footer style={{ background:'#080808', borderTop:'1px solid rgba(255,255,255,0.07)', padding:'36px 48px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'16px', fontFamily:"'Space Grotesk',sans-serif" }}>
      <Image src="/Autobuildwhite.png" alt="AutoBuild AI" width={120} height={30} style={{ height:'28px', width:'auto', display:'block' }} />
      <ul style={{ display:'flex', gap:'28px', listStyle:'none', flexWrap:'wrap' }}>
        {links.map(l => (
          <li key={l.label}>
            <Link href={l.href} style={{ color:'rgba(255,255,255,0.3)', textDecoration:'none', fontSize:'12px', letterSpacing:'0.03em', transition:'color 0.2s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)'; }}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
      <span style={{ fontFamily:monoFont, fontSize:'12px', color:'rgba(255,255,255,0.2)' }}>© 2026 AutoBuild AI</span>
    </footer>
  );
}
