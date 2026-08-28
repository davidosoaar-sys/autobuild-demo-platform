import { NextRequest, NextResponse } from 'next/server';

function unauthorized() {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="AutoBuild AI"' },
  });
}

export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;

  // If credentials aren't configured, don't lock people out by accident.
  if (!user || !pass) {
    return NextResponse.next();
  }

  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Basic ')) {
    const decoded = atob(auth.slice(6));
    const sep = decoded.indexOf(':');
    const reqUser = decoded.slice(0, sep);
    const reqPass = decoded.slice(sep + 1);
    if (reqUser === user && reqPass === pass) {
      return NextResponse.next();
    }
  }

  return unauthorized();
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
