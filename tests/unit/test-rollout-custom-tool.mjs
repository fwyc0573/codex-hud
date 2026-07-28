import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { RolloutParser } from '../../dist/collectors/rollout.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-custom-tool-'));
const rolloutPath = path.join(root, 'rollout-custom-tool.jsonl');

function append(entry) {
  fs.appendFileSync(rolloutPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

try {
  fs.writeFileSync(rolloutPath, '', 'utf8');
  append({
    timestamp: '2026-07-28T14:00:00.000Z',
    type: 'session_meta',
    payload: {
      id: '019f9db5-0000-7000-8000-000000000000',
      timestamp: '2026-07-28T14:00:00.000Z',
      cwd: root,
      originator: 'codex-tui',
      cli_version: '0.144.4',
      source: 'cli',
    },
  });
  append({
    timestamp: '2026-07-28T14:00:01.000Z',
    type: 'response_item',
    payload: {
      type: 'custom_tool_call',
      id: 'ctc-1',
      call_id: 'call-custom-1',
      name: 'exec',
      input: 'echo running',
      status: 'completed',
    },
  });

  const parser = new RolloutParser(5);
  parser.setRolloutPath(rolloutPath);
  const running = await parser.parse();
  assert.equal(running?.toolActivity.totalCalls, 1, 'custom tool call counts once');
  assert.deepEqual(
    running?.toolActivity.recentCalls.map((call) => [call.id, call.name, call.status]),
    [['call-custom-1', 'exec', 'running']],
    'custom tool call is visible as running until its output arrives'
  );

  append({
    timestamp: '2026-07-28T14:00:02.000Z',
    type: 'response_item',
    payload: {
      type: 'custom_tool_call_output',
      id: 'ctco-1',
      call_id: 'call-custom-1',
      output: [{ type: 'input_text', text: 'done' }],
    },
  });

  const completed = await parser.parse();
  assert.equal(completed?.toolActivity.totalCalls, 1, 'custom output does not duplicate the call');
  assert.equal(completed?.toolActivity.recentCalls[0]?.status, 'completed');
  assert.equal(parser.getCached()?.toolActivity.callsByType.exec, 1);

  console.log('test-rollout-custom-tool: PASS');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
