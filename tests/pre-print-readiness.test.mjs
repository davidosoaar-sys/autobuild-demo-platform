import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractFindings, researchRequest } from '../lib/pre-print-research.mjs';
import { resolveProfileInputs, savedProfile } from '../lib/pre-print-profile.mjs';

const source = 'https://maker.example/technical-data.pdf';
const material = [{field:'initialSetTimeMin',value:45,source},{field:'waterLPerKg',value:0.16,source}];

test('initial setting time and water dosage require source evidence and stay reference-only', () => {
  const prompt = researchRequest('Fixture printer', 'Fixture mix', 'fixture-model').instructions;
  assert.match(prompt, /initialSetTimeMin.*initial setting time/);
  assert.match(prompt, /waterLPerKg.*L\/kg/);
  const response = {status:'completed',output:[
    {type:'web_search_call',status:'completed',action:{sources:[{url:source}]}},
    {type:'message',content:[{type:'output_text',text:JSON.stringify({findings:[
      ...material, {field:'strengthMpa',value:55,source:'https://unconsulted.example/spec'},
    ]})}]},
  ]};
  const findings = extractFindings(response);
  assert.deepEqual(findings, material);
  const inputs = {nozzleMm:25,beadComp:0.6,flowRate:8,minSpd:15,maxSpd:100,printSpeed:60};
  assert.deepEqual(resolveProfileInputs(inputs,{findings}),inputs);
});

test('browser fallback retains discovery time after review', () => {
  const profile = {printer:'P1',mix:'M1',findings:material,foundAt:1,reviewedAt:2};
  assert.deepEqual(savedProfile(JSON.stringify([profile]),'P1','M1'),profile);
});

test('configuration diagnostics are read-only and return statuses, never secrets, model names or paths', async () => {
  const { prePrintConfiguration } = await import('../lib/pre-print-config.mjs');
  const scratch = await mkdtemp(join(tmpdir(),'pre-print-readiness-'));
  try {
    const catalog = join(scratch,'private-catalog.json');
    assert.deepEqual(await prePrintConfiguration({}),{research:'not-configured',catalog:'browser-only'});
    assert.deepEqual(await prePrintConfiguration({AUTOBUILD_RESEARCH_OPENAI_KEY:'  '}),{research:'not-configured',catalog:'browser-only'});
    assert.deepEqual(await prePrintConfiguration({AUTOBUILD_RESEARCH_OPENAI_KEY:'test-value'}),{research:'configured-unverified',catalog:'browser-only'});
    assert.deepEqual(await prePrintConfiguration({AUTOBUILD_RESEARCH_MODEL:'fixture-model',AUTOBUILD_PROFILE_STORE_PATH:'/'}),{research:'missing-key',catalog:'unavailable'});
    const config = {AUTOBUILD_RESEARCH_OPENAI_KEY:'test-value',AUTOBUILD_RESEARCH_MODEL:'fixture-model',AUTOBUILD_PROFILE_STORE_PATH:catalog};
    assert.deepEqual(await prePrintConfiguration(config),{research:'configured-unverified',catalog:'local-server'});
    await writeFile(catalog,'invalid JSON',{flag:'wx'}); // diagnostics must not have created it
    assert.deepEqual(await prePrintConfiguration(config),{research:'configured-unverified',catalog:'unavailable'});
    await writeFile(catalog, JSON.stringify({version:1,profiles:[]}));
    assert.deepEqual(await prePrintConfiguration(config),{research:'configured-unverified',catalog:'local-server'});
    assert.equal((await prePrintConfiguration({...config,AUTOBUILD_PROFILE_STORE_PATH:'relative.json'})).catalog,'unavailable');
    assert.equal((await prePrintConfiguration({...config,AUTOBUILD_PROFILE_STORE_PATH:join(scratch,'missing','catalog.json')})).catalog,'unavailable');
  } finally { await rm(scratch,{force:true,recursive:true}); }
});
