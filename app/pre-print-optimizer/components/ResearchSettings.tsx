'use client';

import { useState, type FormEvent } from 'react';
import { cleanName, fields, profileKey, savedProfile, storageKey, storeProfile, validateFindings, type Field, type ResearchProfile, type SharedProfile } from '@/lib/pre-print-profile.mjs';

type Props = {printerName: string; mixName: string; applied: ResearchProfile | null; disabled: boolean; onApply: (profile: ResearchProfile | null) => void; onValidate: (profile: ResearchProfile) => void};
const input = 'mt-1 block min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900';
const button = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 px-4 text-sm text-gray-900 disabled:opacity-50';
const researchStatus = {
  'not-configured': 'Not configured. Set the server research key.',
  'missing-key': 'Server research key is missing.',
  'missing-model': 'Server research model is missing.',
  'configured-unverified': 'Key and model are configured. Provider access has not been tested.',
};
const catalogStatus = {
  'browser-only': 'No server catalog configured. Reviewed settings can be saved in this browser.',
  'local-server': 'Local server catalog configured. This check does not write a profile.',
  'unavailable': 'Local catalog unavailable. Check the server path, permissions, and catalog file.',
};
type Configuration = {research: keyof typeof researchStatus; catalog: keyof typeof catalogStatus};

async function profileRequest(data: object) {
  const response = await fetch('/api/pre-print-research',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(55000)});
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(typeof result?.error === 'string' ? result.error : 'Profile service is unavailable. Retry or use your configured settings.');
  return result as {profile?: SharedProfile | null; shared?: boolean; findings?: unknown; foundAt?: number; configuration?: Configuration};
}

export default function ResearchSettings({printerName,mixName,applied,disabled,onApply,onValidate}: Props) {
  const [printer,setPrinter] = useState(printerName);
  const [mix,setMix] = useState(mixName);
  const [candidate,setCandidate] = useState<(ResearchProfile & Partial<SharedProfile>) | null>(null);
  const [chosen,setChosen] = useState<Field[]>([]);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');
  const [config,setConfig] = useState<Configuration | 'checking' | 'unavailable' | null>(null);
  async function checkConfiguration() {
    if (config === 'checking') return;
    setConfig('checking');
    try {
      const { configuration } = await profileRequest({action:'configuration'});
      setConfig(configuration && Object.hasOwn(researchStatus, configuration.research) && Object.hasOwn(catalogStatus, configuration.catalog) ? configuration : 'unavailable');
    } catch { setConfig('unavailable'); }
  }
  function reset() { setCandidate(null); setChosen([]); setError(''); setMessage(''); }
  function showSaved(saved: ResearchProfile & Partial<SharedProfile>, scope: string) {
    const age = Date.now() - (saved.foundAt || saved.reviewedAt);
    setCandidate(saved);
    const prefix = saved.reviewedAt ? 'Reviewed profile' : 'Unverified findings';
    setMessage(`${prefix} loaded from ${scope}. No new web search.${age > 365 * 86400000 ? ' Sources are over a year old; check them again before applying.' : ''}`);
  }
  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled) return;
    reset();
    const p = cleanName(printer), m = cleanName(mix);
    if (!p || !m) { setError('Enter the exact printer model and mix.'); return; }
    let saved: ResearchProfile | null = null;
    try { saved = savedProfile(localStorage.getItem(storageKey),p,m); } catch { /* browser storage is optional */ }
    setBusy(true);
    try {
      const lookup = await profileRequest({action:'lookup',printer:p,mix:m});
      if (lookup.profile) { showSaved(lookup.profile,'the local server catalog'); return; }
      if (saved) { showSaved(saved,'this browser'); return; }
      const result = await profileRequest({action:'research',printer:p,mix:m});
      if (result.profile) {
        setCandidate(result.profile);
        setMessage('Open the sources and select only the values that match your machine and mix.');
        return;
      }
      const findings = validateFindings(result.findings);
      if (!findings.length) { setMessage('No supported settings were found with a source. Nothing changed.'); return; }
      setCandidate({printer:p,mix:m,findings,foundAt:result.foundAt,reviewedAt:0});
      setMessage('Open the sources and select only the values that match your machine and mix.');
    } catch (cause) {
      if (saved) showSaved(saved,'this browser');
      else setError(cause instanceof Error && cause.name === 'Error' ? cause.message : 'Research timed out or could not connect. Retry or use your configured settings.');
    }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!candidate || !chosen.length || busy || disabled || profileKey(candidate.printer,candidate.mix) !== profileKey(printer,mix)) return;
    setError('');
    setBusy(true);
    try {
      let profile: ResearchProfile = {printer:candidate.printer,mix:candidate.mix,findings:(candidate.availableFindings ?? candidate.findings).filter(x => chosen.includes(x.field)),foundAt:candidate.foundAt,reviewedAt:Date.now()};
      onValidate(profile);
      if (candidate.revision) {
        const outcome = await profileRequest({action:'review',printer:profile.printer,mix:profile.mix,revision:candidate.revision,selected:chosen});
        if (!outcome.profile) throw new Error('The shared review was not saved. Look up the profile and retry.');
        profile = outcome.profile;
        setCandidate(outcome.profile);
      }
      onApply(profile);
      try {
        localStorage.setItem(storageKey,storeProfile(localStorage.getItem(storageKey),{...profile,findings:profile.findings}));
        setMessage(candidate.revision ? 'Reviewed profile saved in the local server catalog and applied to the next optimization.' : 'Reviewed profile saved in this browser and applied to the next optimization.');
      } catch { setMessage(candidate.revision ? 'Reviewed profile saved in the local server catalog and applied.' : 'Profile applied, but browser storage was unavailable.'); }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not apply these settings.'); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="research-title" className="print-glass rounded-2xl border border-gray-200 p-4 sm:p-5">
    <h2 id="research-title" className="text-base font-semibold text-gray-900">Research printer and mix settings</h2>
    <p className="mt-1 text-sm text-gray-600">Look up the exact model and mix. Only selected printer settings change the next optimization; material facts are for reference.</p>
    <div className="mt-3">
      <button type="button" className={button} disabled={config === 'checking'} onClick={checkConfiguration}>Check research setup</button>
      <div role="status" className="mt-2 text-sm text-gray-700">
        {config === 'checking' && <p>Checking research setup…</p>}
        {config === 'unavailable' && <p>Setup check unavailable. Use existing settings or retry on the local development server.</p>}
        {config && typeof config === 'object' && <dl>
          <div><dt className="inline font-medium">Web research: </dt><dd className="inline">{researchStatus[config.research]}</dd></div>
          <div><dt className="inline font-medium">Profile storage: </dt><dd className="inline">{catalogStatus[config.catalog]}</dd></div>
        </dl>}
      </div>
    </div>
    <form onSubmit={lookup} className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-sm text-gray-700">Printer model<input className={input} required maxLength={100} disabled={busy || disabled} value={printer} onChange={e=>{setPrinter(e.target.value);reset();}} placeholder="Manufacturer and model" /></label>
      <label className="text-sm text-gray-700">Material mix<input className={input} required maxLength={100} disabled={busy || disabled} value={mix} onChange={e=>{setMix(e.target.value);reset();}} placeholder="Exact mix name" /></label>
      <div className="sm:col-span-2"><button className={button} disabled={busy || disabled}>{busy?'Working…':'Look up settings'}</button></div>
    </form>
    {message && <p role="status" className="mt-3 text-sm text-gray-700">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {candidate && <fieldset className="mt-4 border-t border-gray-200 pt-3" disabled={busy || disabled}>
      <legend className="pr-2 text-sm text-gray-900">Review findings</legend>
      <ul className="divide-y divide-gray-100">
        {(candidate.availableFindings ?? candidate.findings).map(({field,value,source}) => <li key={field} className="py-2">
          <label className="flex min-h-11 items-center gap-3 text-sm text-gray-900"><input type="checkbox" checked={chosen.includes(field)} onChange={e=>setChosen(old=>e.target.checked?[...old,field]:old.filter(x=>x!==field))}/><span>{fields[field].label}: <strong>{value} {fields[field].unit}</strong></span></label>
          <a href={source} target="_blank" rel="noopener noreferrer" className="ml-7 inline-flex min-h-11 items-center break-all text-sm text-gray-700 underline underline-offset-4">Source: {new URL(source).hostname}<span className="sr-only"> for {fields[field].label} (new tab)</span></a>
        </li>)}
      </ul>
      <button type="button" className={button} disabled={!chosen.length || busy || disabled} onClick={apply}>Save and apply selected settings</button>
    </fieldset>}
    {applied && <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-3 text-sm">
      <p role="status">Applied profile: {applied.printer} / {applied.mix}</p>
      <button type="button" className={button} disabled={disabled} onClick={()=>onApply(null)}>Clear applied profile</button>
    </div>}
  </section>;
}
