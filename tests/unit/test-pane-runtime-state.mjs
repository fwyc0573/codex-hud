import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  PaneRuntimeStateCollector,
  parsePaneRuntimeStateFromCapture,
} from '../../dist/collectors/pane-runtime-state.js';

const directParse = parsePaneRuntimeStateFromCapture(`
  • Permissions updated to Full Access

  /plan         switch to Plan mode
`);

assert.equal(directParse.approvalPolicy, 'never', 'Full Access should map to approval never');
assert.equal(
  directParse.sandboxMode,
  'danger-full-access',
  'Full Access should map to danger-full-access'
);
assert.equal(
  directParse.collaborationMode,
  'default',
  'switch-to-Plan hint should mean the current mode is default'
);

const footerParse = parsePaneRuntimeStateFromCapture(`
  gpt-5.4 high · ~\\Documents\\GitHub\\codex-hud    Plan mode (shift+tab to cycle
`);

assert.equal(footerParse.collaborationMode, 'plan', 'Plan mode footer should map to plan mode');

const latestStateParse = parsePaneRuntimeStateFromCapture(`
  • Permissions updated to Full Access
  • Permissions updated to Workspace Write
  /plan         switch to Plan mode
  /plan         switch to Default mode
`);

assert.equal(
  latestStateParse.approvalPolicy,
  'on-request',
  'parser should use the latest permission update in the capture tail'
);
assert.equal(
  latestStateParse.sandboxMode,
  'workspace-write',
  'parser should use the latest sandbox update in the capture tail'
);
assert.equal(
  latestStateParse.collaborationMode,
  'plan',
  'parser should use the latest mode hint in the capture tail'
);

let captureIndex = 0;
const captures = [
  `
    • Permissions updated to Full Access
    /plan         switch to Plan mode
  `,
  `
    /plan         switch to Default mode
  `,
];

const collector = new PaneRuntimeStateCollector('%0', () => captures[captureIndex++] ?? null);

const firstState = collector.collect();
assert.equal(firstState?.approvalPolicy, 'never', 'first capture should populate approval policy');
assert.equal(firstState?.sandboxMode, 'danger-full-access', 'first capture should populate sandbox mode');
assert.equal(firstState?.collaborationMode, 'default', 'first capture should detect default mode');

const secondState = collector.collect();
assert.equal(
  secondState?.approvalPolicy,
  'never',
  'collector should retain last known approval when later frames omit the message'
);
assert.equal(
  secondState?.sandboxMode,
  'danger-full-access',
  'collector should retain last known sandbox when later frames omit the message'
);
assert.equal(secondState?.collaborationMode, 'plan', 'second capture should flip to plan mode');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-pane-runtime-'));
const captureFile = path.join(tempDir, 'pane.log');
fs.writeFileSync(
  captureFile,
  `
    • Permissions updated to Full Access
    gpt-5.4 high · ~\\Documents\\GitHub\\codex-hud    Plan mode (shift+tab to cycle
  `,
  'utf8'
);

const fileCollector = new PaneRuntimeStateCollector(
  '%0',
  () => {
    throw new Error('file-backed collector should not use tmux capture fallback');
  },
  captureFile
);

const fileState = fileCollector.collect();
assert.equal(fileState?.approvalPolicy, 'never', 'file-backed collector should read approval');
assert.equal(fileState?.sandboxMode, 'danger-full-access', 'file-backed collector should read sandbox');
assert.equal(fileState?.collaborationMode, 'plan', 'file-backed collector should read plan mode');

console.log('test-pane-runtime-state: PASS');
