import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileWatcher } from '../../dist/collectors/file-watcher.js';
import { RolloutParser } from '../../dist/collectors/rollout.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-runtime-custom-'));
const rolloutPath = path.join(root, 'rollout-custom-refresh.jsonl');

function append(entry) {
  fs.appendFileSync(rolloutPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) {
        resolve(Date.now() - started);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error(`condition was not met within ${timeoutMs} ms`));
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  });
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

  const parser = new RolloutParser(5);
  parser.setRolloutPath(rolloutPath);
  let latest = await parser.parse();
  let callbackCount = 0;
  const watcher = new FileWatcher([rolloutPath], { usePolling: true });
  watcher.onChange(async () => {
    callbackCount += 1;
    latest = await parser.parse();
  });
  watcher.start();
  await new Promise((resolve) => setTimeout(resolve, 1200));

  append({
    timestamp: '2026-07-28T14:00:01.000Z',
    type: 'response_item',
    payload: {
      type: 'custom_tool_call',
      id: 'ctc-refresh-1',
      call_id: 'call-custom-refresh-1',
      name: 'exec',
      input: 'echo running',
      status: 'completed',
    },
  });
  const observedRunningMs = await waitFor(
    () => latest?.toolActivity.recentCalls.some(
      (call) => call.id === 'call-custom-refresh-1' && call.status === 'running'
    )
  );

  append({
    timestamp: '2026-07-28T14:00:02.000Z',
    type: 'response_item',
    payload: {
      type: 'custom_tool_call_output',
      id: 'ctco-refresh-1',
      call_id: 'call-custom-refresh-1',
      output: [{ type: 'input_text', text: 'done' }],
    },
  });
  const observedCompletedMs = await waitFor(
    () => latest?.toolActivity.recentCalls.some(
      (call) => call.id === 'call-custom-refresh-1' && call.status === 'completed'
    )
  );

  await watcher.stop();
  assert.equal(latest.toolActivity.totalCalls, 1);
  assert.equal(latest.toolActivity.callsByType.exec, 1);
  assert.ok(callbackCount >= 2, `expected call/output watcher callbacks, got ${callbackCount}`);
  console.log(
    `test-runtime-custom-tool-refresh: PASS (running_ms=${observedRunningMs}, completed_ms=${observedCompletedMs}, callbacks=${callbackCount})`
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
