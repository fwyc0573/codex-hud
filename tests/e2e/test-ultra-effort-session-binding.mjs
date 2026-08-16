import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const HUD_ENTRY = path.join(REPO_ROOT, 'dist', 'index.js');
const ANSI_ESCAPE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const THREAD_ID = '019f9db5-0000-7000-8000-000000000000';
const MAIN_PANE = '%70';

function localDateParts(now = new Date()) {
  return {
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1).padStart(2, '0'),
    day: String(now.getDate()).padStart(2, '0'),
    hour: String(now.getHours()).padStart(2, '0'),
    minute: String(now.getMinutes()).padStart(2, '0'),
    second: String(now.getSeconds()).padStart(2, '0'),
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function latestEffort(stdout) {
  const matches = [...stdout.matchAll(/\[gpt-5\.6-sol (max|ultra)\]/g)];
  return matches.at(-1)?.[1] ?? null;
}

async function waitForEffort(state, expected, timeoutMs = 5_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (latestEffort(state.stdout) === expected) {
      return Date.now() - startedAt;
    }
    if (state.child.exitCode !== null || state.child.signalCode !== null) {
      throw new Error(
        `HUD exited before ${expected}: code=${state.child.exitCode}, signal=${state.child.signalCode}, stderr=${JSON.stringify(state.stderr)}`
      );
    }
    await wait(25);
  }
  throw new Error(
    `HUD did not render ${expected} within ${timeoutMs} ms; latest=${latestEffort(state.stdout)}, stderr=${JSON.stringify(state.stderr)}`
  );
}

function stopHud(state) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      state.child.kill('SIGKILL');
      reject(new Error('HUD did not stop after SIGTERM.'));
    }, 2_000);
    state.child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
    state.child.kill('SIGTERM');
  });
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-ultra-binding-'));
const codexHome = path.join(root, 'codex-home');
const workspace = path.join(root, 'workspace');
const snapshotsDir = path.join(codexHome, 'shell_snapshots');
const now = new Date();
const parts = localDateParts(now);
const sessionDir = path.join(codexHome, 'sessions', parts.year, parts.month, parts.day);
const rolloutPath = path.join(
  sessionDir,
  `rollout-${parts.year}-${parts.month}-${parts.day}T${parts.hour}-${parts.minute}-${parts.second}-${THREAD_ID}.jsonl`
);

let state;
try {
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(snapshotsDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, 'config.toml'),
    'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "max"\n',
    'utf8'
  );
  const timestamp = now.toISOString();
  fs.writeFileSync(
    rolloutPath,
    [
      {
        timestamp,
        type: 'session_meta',
        payload: {
          id: THREAD_ID,
          timestamp,
          cwd: workspace,
          originator: 'codex-tui',
          cli_version: '0.144.4',
          source: 'cli',
          model_provider: 'openai',
        },
      },
      {
        timestamp,
        type: 'turn_context',
        payload: {
          model: 'gpt-5.6-sol',
          effort: 'ultra',
          collaboration_mode: {
            mode: 'default',
            settings: {
              model: 'gpt-5.6-sol',
              reasoning_effort: 'ultra',
            },
          },
        },
      },
    ].map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8'
  );

  const child = spawn(process.execPath, [HUD_ENTRY], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      CODEX_HUD_CWD: workspace,
      CODEX_HUD_MAIN_PANE: MAIN_PANE,
      CODEX_HUD_SESSION_START: String(now.getTime()),
      CODEX_HUD_CLEAR_SCROLLBACK: '0',
      COLUMNS: '120',
      LINES: '5',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  state = {
    child,
    get stdout() {
      return stdout.replace(ANSI_ESCAPE, '');
    },
    get stderr() {
      return stderr.replace(ANSI_ESCAPE, '');
    },
  };

  const initialConfigMs = await waitForEffort(state, 'max', 3_000);
  assert.ok(
    initialConfigMs <= 2_500,
    `HUD did not render its initial config promptly: ${initialConfigMs} ms`
  );

  const snapshotCreatedAt = Date.now();
  fs.writeFileSync(
    path.join(snapshotsDir, `${THREAD_ID}.1786812904323780615.sh`),
    `export TMUX_PANE='${MAIN_PANE}'\n`,
    'utf8'
  );
  const snapshotBindMs = await waitForEffort(state, 'ultra', 7_000);
  assert.ok(
    snapshotBindMs <= 6_500,
    `HUD did not bind promptly after exact snapshot visibility: ${snapshotBindMs} ms`
  );
  assert.ok(
    Date.now() - snapshotCreatedAt < 7_000,
    'exact snapshot binding must not wait for a 20-second startup window'
  );
  await wait(1_200);

  assert.equal(
    state.child.exitCode,
    null,
    'HUD must remain alive after exact snapshot binding'
  );
  assert.equal(
    latestEffort(state.stdout),
    'ultra',
    'HUD must retain the exact snapshot-bound runtime ultra effort'
  );
  assert.equal(state.stderr, '', `HUD stderr must remain empty: ${state.stderr}`);

  const closeResult = await stopHud(state);
  assert.equal(closeResult.code, 0, 'HUD must shut down cleanly after SIGTERM');
  assert.equal(closeResult.signal, null, 'HUD handles SIGTERM through its clean shutdown path');
  console.log(
    `test-ultra-effort-session-binding: PASS (initial_config_ms=${initialConfigMs}, exact_snapshot_bind_ms=${snapshotBindMs}, fixed_wait_ms=0, retained_effort=${latestEffort(state.stdout)})`
  );
} finally {
  if (state && state.child.exitCode === null && state.child.signalCode === null) {
    state.child.kill('SIGKILL');
  }
  fs.rmSync(root, { recursive: true, force: true });
}
