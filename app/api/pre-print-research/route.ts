import { NextRequest, NextResponse } from 'next/server';
import { cleanName } from '@/lib/pre-print-profile.mjs';
import { extractFindings, researchRequest } from '@/lib/pre-print-research.mjs';
import { createProfileStore } from '@/lib/pre-print-store.mjs';
import { prePrintConfiguration, DEFAULT_RESEARCH_MODEL } from '@/lib/pre-print-config.mjs';
import { isPilotOperator } from '../../../middleware';

export const runtime = 'nodejs';
export const maxDuration = 60;
let lastRequest = 0;
let pending = false;
const reply = (value: unknown, status = 200) => NextResponse.json(value, {status, headers:{'Cache-Control':'no-store'}});

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const host = request.headers.get('host');
  if (!host || request.headers.get('origin') !== `${url.protocol}//${host}` || request.headers.get('sec-fetch-site') !== 'same-origin') return reply({error:'Not allowed.'},403);
  const local = process.env.NODE_ENV === 'development' && /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host);
  if (!local && (url.protocol !== 'https:' || !(await isPilotOperator(request.headers.get('authorization'), process.env.AUTOBUILD_V1_PILOT_SHA256 ?? '')))) return reply({error:'Not allowed.'},403);
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return reply({error:'Expected JSON.'},415);
  if (!request.body) return reply({error:'Enter a printer and mix.'},400);
  let printer = '', mix = '';
  let data: {printer?:unknown;mix?:unknown;action?:unknown;revision?:unknown;selected?:unknown};
  try {
    const reader = request.body.getReader();
    const decoder = new TextDecoder('utf-8', {fatal:true});
    let text = '', size = 0;
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) { void reader.cancel().catch(() => {}); return reply({error:'Research request is too large.'},413); }
      text += decoder.decode(value,{stream:true});
    }
    data = JSON.parse(text + decoder.decode());
    if (!data || typeof data !== 'object' || Array.isArray(data)) return reply({error:'Invalid research request.'},400);
    if (data.action === 'configuration') return reply({configuration:await prePrintConfiguration(process.env, local)});
    printer = cleanName(data.printer); mix = cleanName(data.mix);
  } catch { return reply({error:'Invalid research request.'},400); }
  if (!printer || !mix) return reply({error:'Enter a printer model and a mix (100 characters each).'},400);
  const action = data.action ?? 'research';
  if (action !== 'lookup' && action !== 'review' && action !== 'research') return reply({error:'Unknown profile action.'},400);
  const path = local ? process.env.AUTOBUILD_PROFILE_STORE_PATH : undefined;
  let store: ReturnType<typeof createProfileStore> | null = null;
  try {
    store = path ? createProfileStore(path) : null;
    if (action === 'review') {
      if (!store) return reply({error:'Shared profile storage is not configured.'},503);
      const profile = await store.review(printer,mix,data.revision,data.selected);
      return profile ? reply({profile}) : reply({error:'The saved profile or selection changed. Look it up again before reviewing.'},409);
    }
    const profile = store ? await store.lookup(printer,mix) : null;
    if (action === 'lookup' || profile) return reply({profile, shared:!!store});
  } catch { return reply({error:'The shared profile store is unavailable.'},503); }
  const key = process.env.AUTOBUILD_RESEARCH_OPENAI_KEY?.trim();
  const model = process.env.AUTOBUILD_RESEARCH_MODEL?.trim() || DEFAULT_RESEARCH_MODEL;
  if (!key) return reply({error:'Web research is not configured on this server.'},503);
  if (pending || Date.now() - lastRequest < 5000) return reply({error:'Research is busy. Wait a few seconds and retry.'},429);
  pending = true;
  lastRequest = Date.now();
  try {
    const search = async () => {
      const response = await fetch('https://api.openai.com/v1/responses', {
      method:'POST', redirect:'error', cache:'no-store', signal:AbortSignal.any([request.signal,AbortSignal.timeout(45000)]),
      headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify(researchRequest(printer,mix,model)),
    });
      if (!response.ok) throw new Error('Research request failed.');
      return extractFindings(await response.json());
    };
    if (store) return reply({profile:await store.lookupOrResearch(printer,mix,search),shared:true});
    const findings = await search();
    return reply({printer,mix,findings,foundAt:Date.now(),shared:false});
  } catch { return reply({error:'Research did not return usable evidence. Retry or use your existing settings.'},502); }
  finally { pending = false; }
}
