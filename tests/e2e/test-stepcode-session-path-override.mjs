import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const testRoot = fs.mkdtempSync(
  path.join('/data/ycfeng/tmp', 'codex-hud-stepcode-session-override-')
);
const home = path.join(testRoot, 'home');
const managedHome = path.join(home, '.stepcode', 'codex');
const sessionsPath = path.join(home, '.codex', 'sessions');
const workspace = path.join(testRoot, 'workspace');
const sessionId = '019f9db5-1000-7000-8000-000000000000';
const rolloutDirectory = path.join(sessionsPath, '2026', '08', '22');
const rolloutPath = path.join(
  rolloutDirectory,
  `rollout-2026-08-22T20-00-00-${sessionId}.jsonl`
);

fs.mkdirSync(managedHome, { recursive: true });
fs.mkdirSync(rolloutDirectory, { recursive: true });
fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(
  rolloutPath,
  `${JSON.stringify({
    timestamp: '2026-08-22T20:00:00.000Z',
    type: 'session_meta',
    payload: {
      id: sessionId,
      timestamp: '2026-08-22T20:00:00.000Z',
      cwd: workspace,
      originator: 'codex-tui',
      cli_version: '0.144.4',
      source: 'cli',
      model_provider: 'stepcode-api',
    },
  })}\n`,
  'utf8'
);

process.env.CODEX_HOME = managedHome;
process.env.CODEX_SESSIONS_PATH = sessionsPath;

const { findRolloutByThreadId } = await import(
  '../../dist/collectors/session-finder.js'
);
const resolved = findRolloutByThreadId(sessionId);

assert.ok(
  resolved,
  'exact StepCode thread lookup must use CODEX_SESSIONS_PATH when it is set'
);
assert.equal(
  fs.realpathSync(resolved.path),
  fs.realpathSync(rolloutPath),
  'exact StepCode thread lookup must resolve the stable sessions path'
);

console.log(
  `test-stepcode-session-path-override: PASS ` +
    `(managed_home=${managedHome}, sessions_path=${sessionsPath})`
);
