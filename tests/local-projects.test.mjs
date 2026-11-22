import test from 'node:test';
import assert from 'node:assert/strict';
import { readProjects, changeProjects, PROJECTS_KEY } from '../lib/local-projects.mjs';
const store = () => { const m = new Map(); return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)}; };
const project = {id:'p1',name:'Wall',status:'setup',printer:{name:'',nozzle:'',maxSpeed:''}};
test('project is created, updated and removed on the same browser only', () => {
  const a=store(), b=store();
  changeProjects(a, 'create', project);
  assert.equal(readProjects(b).length,0);
  assert.equal(readProjects(a)[0].name,'Wall');
  changeProjects(a,'update','p1',{status:'pre-print',printer:{name:'Printer A'}});
  assert.equal(readProjects(a)[0].printer.name,'Printer A');
  changeProjects(a,'delete','p1');
  assert.deepEqual(readProjects(a),[]);
});
test('bad storage and failed writes surface errors instead of hiding data', () => {
  const a=store(); a.setItem(PROJECTS_KEY,'{damaged');
  assert.throws(()=>changeProjects(a,'create',project), /could not be read/i);
  assert.equal(a.getItem(PROJECTS_KEY),'{damaged');
  assert.throws(()=>changeProjects({...store(),setItem(){throw new Error('quota');}},'create',project),/could not be saved/i);
  assert.throws(()=>changeProjects(store(),'update','missing',{}),/not found/i);
});
