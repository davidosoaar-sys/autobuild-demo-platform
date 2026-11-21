import { NextRequest, NextResponse } from 'next/server';

// Beta gate: only the slicer picker and the two slicer tools are reachable.
// Everything else in the app (home, projects, settings, live-monitoring,
// pre-print-optimizer, post-processing, report, printer-setup, help, etc.)
// redirects to the slicer picker instead of resolving.
const ALLOWED_PREFIXES = ['/slicer', '/tools/slicer', '/floorplan'];
const ALLOWED_EXACT = ['/favicon.ico', '/Autobuildblack.png', '/autobuild-wordmark.png'];
const RESEARCH = '/api/pre-print-research';
const PILOT_PAGES = new Set(['/pre-print-optimizer', '/live-monitoring', '/post-processing', '/report', RESEARCH]);
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

export async function isPilotOperator(authorization: string | null, expected: string) {
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  const encoded = authorization?.match(/^Basic ([A-Za-z0-9+/]+={0,2})$/i)?.[1];
  if (!encoded || encoded.length > 192) return false;
  try {
    const value = atob(encoded);
    const credential = value.match(/^operator:([\x21-\x7e]{32,96})$/)?.[1];
    if (!credential) return false;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential)));
    let difference = 0;
    for (let i = 0; i < digest.length; i++) difference |= digest[i] ^ parseInt(expected.slice(2 * i, 2 * i + 2), 16);
    return difference === 0;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/_next/')) return NextResponse.next();
  if (process.env.NODE_ENV === 'development' && ['127.0.0.1','localhost','[::1]'].includes(req.nextUrl.hostname) && ['/','/live-monitoring','/post-processing','/report','/printer-setup'].includes(pathname)) {
    return NextResponse.next();
  }
  if (process.env.NODE_ENV === 'development' && pathname === '/v1-preview') return NextResponse.next();
  if (process.env.NODE_ENV === 'development' && (pathname === '/pre-print-optimizer' || pathname === '/api/pre-print-research')) return NextResponse.next();
  const pilotDigest = process.env.AUTOBUILD_V1_PILOT_SHA256 ?? '';
  if (req.nextUrl.protocol === 'https:' && PILOT_PAGES.has(pathname) && /^[a-f0-9]{64}$/.test(pilotDigest)) {
    if (!(await isPilotOperator(req.headers.get('authorization'), pilotDigest))) {
      return new NextResponse('Private AutoBuild pilot', {
        status: 401,
        headers: { ...PRIVATE_HEADERS, 'WWW-Authenticate': 'Basic realm="AutoBuild pilot", charset="UTF-8"' },
      });
    }
    const headers = new Headers(req.headers);
    if (pathname !== RESEARCH) headers.delete('authorization');
    return NextResponse.next({ headers: PRIVATE_HEADERS, request: { headers } });
  }
  if (ALLOWED_EXACT.includes(pathname)) return NextResponse.next();
  if (ALLOWED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL('/slicer', req.url));
}

export const config = {
  matcher: '/((?!_next/static|_next/image).*)',
};
