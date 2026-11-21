import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
test('the four print stages share the workspace theme and controls', () => {
  for (const file of ['pre-print-optimizer/page.tsx','live-monitoring/LiveMonitoring.tsx','post-processing/page.tsx','report/page.tsx']) assert.match(read(`app/${file}`), /print-workspace/);
  assert.match(read('components/AppNav.tsx'), /<WorkspaceThemeToggle/);
  assert.match(read('app/print-workspace.css'), /prefers-contrast/);
});
