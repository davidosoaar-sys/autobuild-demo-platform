import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const exports = {};
const source = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
new Function('require', 'exports', outputText)(createRequire(import.meta.url), exports);
const { middleware } = exports;

test('the dashboard and its legal pages are public without opening workspace routes', async () => {
  const request = path => middleware(new NextRequest(`https://workspace.example${path}`));
  for (const path of ['/', '/tos', '/privacy', '/slicer', '/projects', '/printer-setup', '/settings', '/help', '/definitions']) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('location'), null);
  }
  for (const path of ['/projects/extra', '/tools/monitor', '/tools/image-analysis', '/tools/slices', '/api/backend/optimize']) {
    assert.equal((await request(path)).status, 307, path);
  }
});

test('configured private pilot challenges for scoped workspace pages, never for Pod or legacy API routes', async () => {
  const keys = ['NODE_ENV', 'AUTOBUILD_V1_PILOT_SHA256'];
  const prior = keys.map(key => process.env[key]);
  const fixture = 'fixture-only-operator-credential-0123456789';
  try {
    process.env.NODE_ENV = 'production';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fixture));
    process.env.AUTOBUILD_V1_PILOT_SHA256 = Buffer.from(digest).toString('hex');
    const request = (path, authorization, scheme = 'https') => middleware(new NextRequest(`${scheme}://workspace.example${path}`, {headers: authorization ? {authorization} : {}}));
    const good = `Basic ${btoa(`operator:${fixture}`)}`;
    for (const path of ['/live-monitoring','/pre-print-optimizer','/post-processing','/report']) {
      const denied = await request(path);
      assert.equal(denied.status, 401);
      assert.match(denied.headers.get('www-authenticate') ?? '', /^Basic /);
      assert.equal((await request(path,'Basic invalid')).status,401);
      const allowed = await request(path,good);
      assert.equal(allowed.status,200);
      assert.match(allowed.headers.get('cache-control') ?? '', /no-store/);
    }
    assert.equal((await request('/report',good,'http')).status,307);
    const research = '/api/pre-print-research';
    assert.equal((await request(research)).status,401);
    assert.equal((await request(research,good)).status,200);
    assert.equal((await request(research,good,'http')).status,307);
    for (const route of ['/api/analyze-beads','/api/backend/optimize','/api/field-record-sync','/v1-preview','/v1-video/','/report/extra']) assert.equal((await request(route,good)).status,307);
    assert.equal((await request('/slicer')).status,200);
    process.env.AUTOBUILD_V1_PILOT_SHA256 = 'invalid';
    assert.equal((await request('/report',good)).status,307);
  } finally {
    keys.forEach((key,i)=> { if (prior[i] === undefined) delete process.env[key]; else process.env[key] = prior[i]; });
  }
});

test('workspace routes remain closed without pilot configuration', async () => {
  const old = process.env.NODE_ENV;
  try {
    for (const mode of ['development', 'production']) {
      process.env.NODE_ENV = mode;
      const request = path => middleware(new NextRequest('http://127.0.0.1:3891' + path));
      const monitor = await request('/live-monitoring');
      assert.equal(monitor.status, mode === 'development' ? 200 : 307);
      assert.equal(monitor.headers.get('x-middleware-rewrite'), null);
      assert.equal((await request('/api/analyze-beads')).status, 307);
      assert.equal((await request('/v1-video/')).status, 307);
      assert.equal((await request('/pre-print-optimizer')).status, mode === 'development' ? 200 : 307);
      assert.equal((await request('/api/pre-print-research')).status, mode === 'development' ? 200 : 307);
    }
  } finally {
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
});
