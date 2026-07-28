import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileWatcher } from '../../dist/collectors/file-watcher.js';
import { RolloutParser } from '../../dist/collectors/rollout.js';
import { getApprovalPolicyDisplay } from '../../dist/collectors/codex-config.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-permission-refresh-'));
const rolloutPath = path.join(root, 'rollout-permission-refresh.jsonl');
const sessionId = '019f9db5-0000-7000-8000-000000000000';

function writeLine(payload) {
  fs.appendFileSync(rolloutPath, `${JSON.stringify(payload)}\n`, 'utf8');
}

function waitFor(predicate, timeoutMs = 2000, describe = () => '') {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) {
        resolve(Date.now() - started);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error(`condition was not met within ${timeoutMs} ms ${describe()}`));
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  });
}

try {
  fs.writeFileSync(rolloutPath, '', 'utf8');
  writeLine({
    timestamp: '2026-07-27T14:00:00.000Z',
    type: 'session_meta',
    payload: {
      id: sessionId,
      timestamp: '2026-07-27T14:00:00.000Z',
      cwd: root,
      originator: 'codex-tui',
      cli_version: '0.144.4',
      source: 'cli',
    },
  });
  writeLine({
    timestamp: '2026-07-27T14:00:01.000Z',
    type: 'turn_context',
    payload: {
      approval_policy: 'on-request',
      sandbox_policy: { type: 'workspace-write' },
    },
  });

  const parser = new RolloutParser(5);
  parser.setRolloutPath(rolloutPath);
  const initial = await parser.parse();
  assert.equal(initial?.session?.approvalPolicy, 'on-request');
  assert.equal(initial?.session?.sandboxMode, 'workspace-write');

  let latest = initial;
  let callbackCount = 0;
  const watcher = new FileWatcher([rolloutPath], { usePolling: true });
  watcher.onChange(async () => {
    callbackCount += 1;
    latest = await parser.parse();
  });
  watcher.start();

  // The production HUD starts its watcher before Codex writes the first
  // runtime update. Allow chokidar to finish its asynchronous setup here so
  // this fixture models that lifecycle instead of racing initialization.
  await new Promise((resolve) => setTimeout(resolve, 1200));

  writeLine({
    timestamp: '2026-07-27T14:00:02.000Z',
    type: 'turn_context',
    payload: {
      approval_policy: 'never',
      sandbox_policy: { type: 'danger-full-access' },
    },
  });

  const observedMs = await waitFor(
    () => latest?.session?.approvalPolicy === 'never'
      && latest?.session?.sandboxMode === 'danger-full-access',
    5000,
    () => `(callbacks=${callbackCount}, approval=${latest?.session?.approvalPolicy ?? '<none>'}, sandbox=${latest?.session?.sandboxMode ?? '<none>'})`
  );
  await watcher.stop();

  assert.equal(
    getApprovalPolicyDisplay(
      { approval_policy: 'on-request', sandbox_mode: 'workspace-write' },
      {
        approvalPolicy: latest.session.approvalPolicy,
        sandboxMode: latest.session.sandboxMode,
      }
    ),
    'full access'
  );
  assert.ok(observedMs <= 5000, `runtime permission refresh took ${observedMs} ms`);
  assert.ok(callbackCount > 0, 'rollout watcher must invoke its callback');
  console.log(`test-runtime-permission-refresh: PASS (observed_ms=${observedMs}, callbacks=${callbackCount})`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
