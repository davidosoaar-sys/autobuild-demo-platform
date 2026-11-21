import test from 'node:test';
import assert from 'node:assert/strict';
import { profileKey, validateFindings, resolveProfileInputs, savedProfile } from '../lib/pre-print-profile.mjs';
import { extractFindings, researchRequest } from '../lib/pre-print-research.mjs';
const url = 'https://maker.example/spec.pdf';
const entries = [{field:'nozzleDiameter',value:30,source:url},{field:'maxVelocity',value:40,source:url},{field:'openTimeMin',value:20,source:url}];
const profile = {printer:'Test P1',mix:'Test M1',findings:entries,reviewedAt:1};
test('cache keys match normalized exact printer and mix, and only reuse reviewed profiles', () => {
  assert.equal(profileKey(' TEST  P1 ','test M1'),profileKey('Test P1','Test M1'));
  assert.deepEqual(savedProfile(JSON.stringify([profile]),'test p1','test m1'),profile);
  assert.equal(savedProfile(JSON.stringify([profile]),'test p2','test m1'),null);
  assert.equal(savedProfile(JSON.stringify([{...profile,reviewedAt:0}]),'test p1','test m1'),null);
});
test('only supported finite values with safe evidence links survive', () => {
  assert.deepEqual(validateFindings([...entries,{field:'maxFlowRate',value:4,source:'javascript:alert(1)'},{field:'beadCompression',value:80,source:url}]),entries);
});
test('approved profile changes actual optimizer inputs without using advisory mix facts as machine settings', () => {
  const baseline = {nozzleMm:25,beadComp:0.6,maxSpd:100,minSpd:15,flowRate:8,printSpeed:60};
  assert.deepEqual(resolveProfileInputs(baseline,null),baseline);
  assert.deepEqual(resolveProfileInputs(baseline,profile),{...baseline,nozzleMm:30,maxSpd:40,printSpeed:40});
  assert.throws(() => resolveProfileInputs(baseline,{...profile,findings:[{field:'maxVelocity',value:10,source:url}]}),/minimum/);
  assert.throws(() => resolveProfileInputs(baseline,{...profile,findings:[{field:'maxFlowRate',value:0.1,source:url}]}),/pump flow/);
});
test('provider search must run and only its reported sources can be used', () => {
  const message = {type:'message',content:[{type:'output_text',text:JSON.stringify({findings:[...entries,{field:'maxFlowRate',value:3,source:'https://invented.example/spec'}]})}]};
  assert.throws(() => extractFindings({status:'completed',output:[message]}),/search/i);
  assert.deepEqual(extractFindings({status:'completed',output:[{type:'web_search_call',status:'completed',action:{type:'search',sources:[{type:'url',url}]}},message]}),entries);
  assert.equal(researchRequest('Test P1','Test M1','test-model').tool_choice.type,'web_search');
});
