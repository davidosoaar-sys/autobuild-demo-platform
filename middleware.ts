import { NextRequest, NextResponse } from 'next/server';

// Beta gate: only the slicer picker and the two slicer tools are reachable.
// Everything else in the app (home, projects, settings, live-monitoring,
// pre-print-optimizer, post-processing, report, printer-setup, help, etc.)
// redirects to the slicer picker instead of resolving.
const ALLOWED_PREFIXES = ['/slicer', '/tools/slicer', '/floorplan'];
const ALLOWED_EXACT = ['/favicon.ico', '/Autobuildblack.png'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/_next/')) return NextResponse.next();
  if (ALLOWED_EXACT.includes(pathname)) return NextResponse.next();
  if (ALLOWED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL('/slicer', req.url));
}

export const config = {
  matcher: '/((?!_next/static|_next/image).*)',
};
