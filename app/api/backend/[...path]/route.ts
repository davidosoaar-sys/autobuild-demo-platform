import { NextRequest, NextResponse } from 'next/server';

// Server-side proxy to the FastAPI backend. The backend's shared secret
// (BACKEND_API_SECRET) is attached here and never reaches the browser —
// the client only ever calls same-origin /api/backend/*.

const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || 'http://localhost:8000';
const API_SECRET = process.env.BACKEND_API_SECRET;

async function proxy(req: NextRequest, path: string[]) {
  const target = `${BACKEND_ORIGIN}/${path.join('/')}${req.nextUrl.search}`;

  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('connection');
  headers.delete('content-length');
  if (API_SECRET) headers.set('x-api-key', API_SECRET);

  const init: RequestInit = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer();
  }

  let res: Response;
  try {
    res = await fetch(target, init);
  } catch {
    return NextResponse.json({ detail: 'Backend unreachable' }, { status: 502 });
  }

  const body = await res.arrayBuffer();
  const resHeaders = new Headers(res.headers);
  resHeaders.delete('content-encoding');
  resHeaders.delete('content-length');

  return new NextResponse(body, { status: res.status, headers: resHeaders });
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
