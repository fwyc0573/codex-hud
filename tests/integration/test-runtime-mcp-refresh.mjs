import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileWatcher } from '../../dist/collectors/file-watcher.js';
import { RolloutParser } from '../../dist/collectors/rollout.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-runtime-mcp-'));
const rolloutPath = path.join(root, 'rollout-mcp-refresh.jsonl');
const sessionId = '019f9db5-0000-7000-8000-000000000000';

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
      id: sessionId,
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
    type: 'event_msg',
    payload: {
      type: 'mcp_tool_call_begin',
      call_id: 'mcp-refresh-1',
      invocation: { server: 'serena', tool: 'get_symbols_overview', arguments: {} },
    },
  });
  const observedRunningMs = await waitFor(
    () => latest?.toolActivity.recentCalls.some(
      (call) => call.id === 'mcp-refresh-1' && call.status === 'running'
    )
  );

  append({
    timestamp: '2026-07-28T14:00:02.000Z',
    type: 'event_msg',
    payload: {
      type: 'mcp_tool_call_end',
      call_id: 'mcp-refresh-1',
      invocation: { server: 'serena', tool: 'get_symbols_overview', arguments: {} },
      duration: { secs: 1, nanos: 0 },
      result: { Ok: { content: [] } },
    },
  });
  const observedCompletedMs = await waitFor(
    () => latest?.toolActivity.recentCalls.some(
      (call) => call.id === 'mcp-refresh-1' && call.status === 'completed'
    )
  );

  await watcher.stop();
  assert.equal(latest.toolActivity.totalCalls, 1);
  assert.ok(callbackCount >= 2, `expected begin/end watcher callbacks, got ${callbackCount}`);
  console.log(
    `test-runtime-mcp-refresh: PASS (running_ms=${observedRunningMs}, completed_ms=${observedCompletedMs}, callbacks=${callbackCount})`
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
