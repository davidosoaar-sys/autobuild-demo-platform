import { access, lstat, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute } from 'node:path';
import { cleanName, profileKey, validateFindings } from './pre-print-profile.mjs';

// Single dev server only. The path is explicit, private and never taken from a request.
const writes = new Map();
export function createProfileStore(path) {
  if (!isAbsolute(path)) throw new Error('Configure an absolute profile store path.');
  async function read() {
    try {
      const data = JSON.parse(await readFile(path, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.profiles)) throw new Error('Invalid profile store.');
      return data;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return {version:1, profiles:[]};
    }
  }
  async function write(data) {
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(data), {flag:'wx', mode:0o600});
      await rename(temp, path);
    } finally { await rm(temp, {force:true}); }
  }
  function serial(operation) {
    const next = (writes.get(path) ?? Promise.resolve()).then(operation);
    const settled = next.catch(() => {}).finally(() => {
      if (writes.get(path) === settled) writes.delete(path);
    });
    writes.set(path, settled);
    return next;
  }
  function find(data, printer, mix) {
    return data.profiles.find(p => profileKey(p.printer,p.mix) === profileKey(printer,mix));
  }
  function profile(row) {
    if (!row) return null;
    const {printer,mix,revision,foundAt,availableFindings,reviewedAt} = row;
    const findings = reviewedAt ? availableFindings.filter(f => row.selected.includes(f.field)) : availableFindings;
    return {printer,mix,revision,foundAt,findings,availableFindings,reviewedAt};
  }
  return {
    async checkConfiguration() {
      await access(dirname(path), constants.W_OK | constants.X_OK);
      const file = await lstat(path).catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (!file) return;
      if (!file.isFile()) throw new Error('Profile store is not a regular file.');
      await read();
    },
    async lookup(printer, mix) { return profile(find(await read(),printer,mix)); },
    lookupOrResearch(printer, mix, research) {
      return serial(async () => {
        const data = await read();
        const existing = find(data,printer,mix);
        if (existing) return profile(existing);
        if (data.profiles.length >= 500) throw new Error('Profile store is full.');
        const findings = validateFindings(await research());
        if (!findings.length) return null;
        const row = {printer:cleanName(printer),mix:cleanName(mix),revision:randomUUID(),foundAt:Date.now(),availableFindings:findings,reviewedAt:0,selected:[]};
        if (!row.printer || !row.mix) throw new Error('Invalid profile name.');
        data.profiles.push(row);
        await write(data);
        return profile(row);
      });
    },
    review(printer, mix, revision, selected) {
      return serial(async () => {
        const data = await read();
        const row = find(data,printer,mix);
        if (!row || row.revision !== revision || !Array.isArray(selected) || !selected.length || selected.length > row.availableFindings.length || new Set(selected).size !== selected.length || selected.some(key => !row.availableFindings.some(f => f.field === key))) return null;
        row.selected = selected;
        row.reviewedAt = Date.now();
        row.revision = randomUUID();
        await write(data);
        return profile(row);
      });
    },
  };
}
