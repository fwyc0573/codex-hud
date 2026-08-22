import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const HUD_ENTRY = path.join(REPO_ROOT, 'dist', 'index.js');
const TEST_TMP_ROOT = '/data/ycfeng/tmp';
const ANSI_ESCAPE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const MAIN_PANE = '%stepcode-main';
const SESSION_ID = '019f9db5-1000-7000-8000-000000000000';

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

function writeManagedRollout(sessionsRoot, workspace, now) {
  const parts = localDateParts(now);
  const sessionsDir = path.join(
    sessionsRoot,
    'sessions',
    parts.year,
    parts.month,
    parts.day
  );
  fs.mkdirSync(sessionsDir, { recursive: true });

  const timestamp = now.toISOString();
  const rolloutPath = path.join(
    sessionsDir,
    `rollout-${parts.year}-${parts.month}-${parts.day}T${parts.hour}-${parts.minute}-${parts.second}-${SESSION_ID}.jsonl`
  );
  const records = [
    {
      timestamp,
      type: 'session_meta',
      payload: {
        id: SESSION_ID,
        timestamp,
        cwd: workspace,
        originator: 'codex-tui',
        cli_version: '0.144.4',
        source: 'cli',
        model_provider: 'stepcode-api',
      },
    },
    {
      timestamp,
      type: 'turn_context',
      payload: {
        model: 'stepcode-runtime-model',
        reasoning_effort: 'ultra',
        approval_policy: 'never',
        sandbox_policy: { type: 'danger-full-access' },
      },
    },
  ];
  fs.writeFileSync(
    rolloutPath,
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8'
  );
}

function startHud(environment) {
  const child = spawn(process.execPath, [HUD_ENTRY], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOME: environment.home,
      CODEX_HOME: environment.managedHome,
      CODEX_SESSIONS_PATH: environment.sessionsPath,
      CODEX_HUD_CWD: environment.workspace,
      CODEX_HUD_MAIN_PANE: MAIN_PANE,
      CODEX_HUD_SESSION_START: String(Date.now()),
      CODEX_HUD_CLEAR_SCROLLBACK: '0',
      COLUMNS: '120',
      LINES: '8',
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

  return {
    child,
    get output() {
      return stdout.replace(ANSI_ESCAPE, '');
    },
    get stderr() {
      return stderr.replace(ANSI_ESCAPE, '');
    },
  };
}

async function stopHud(state) {
  const closed = new Promise((resolve) => {
    state.child.once('close', (code, signal) => resolve({ code, signal }));
  });
  state.child.kill('SIGTERM');
  const result = await Promise.race([
    closed,
    wait(2_000).then(() => null),
  ]);
  if (result !== null) {
    return result;
  }

  state.child.kill('SIGKILL');
  return closed;
}

async function waitForManagedSession(state, timeoutMs = 8_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const shortSessionId = `${SESSION_ID.slice(0, 8)}…${SESSION_ID.slice(-4)}`;
    if (
      state.output.includes(shortSessionId) &&
      state.output.includes('stepcode-runtime-model')
    ) {
      return Date.now() - startedAt;
    }
    if (state.child.exitCode !== null || state.child.signalCode !== null) {
      throw new Error(
        `HUD exited before managed StepCode binding: code=${state.child.exitCode}, ` +
          `signal=${state.child.signalCode}, stderr=${JSON.stringify(state.stderr)}`
      );
    }
    await wait(25);
  }

  throw new Error(
    `HUD did not bind the managed StepCode rollout within ${timeoutMs} ms; ` +
      `output=${JSON.stringify(state.output)}, stderr=${JSON.stringify(state.stderr)}`
  );
}

const root = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'codex-hud-stepcode-renderer-'));
const home = path.join(root, 'home');
const managedHome = path.join(home, '.stepcode', 'codex');
const nativeHome = path.join(home, '.codex');
const stableSessionsPath = path.join(nativeHome, 'sessions');
const workspace = path.join(root, 'workspace');
const now = new Date();

let state;
try {
  fs.mkdirSync(path.join(managedHome, 'sessions'), { recursive: true });
  fs.mkdirSync(stableSessionsPath, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(
    path.join(nativeHome, 'config.toml'),
    'model = "native-distractor-model"\nmodel_reasoning_effort = "low"\n',
    'utf8'
  );

  state = startHud({
    home,
    managedHome,
    sessionsPath: stableSessionsPath,
    workspace,
  });
  await wait(250);

  const managedSessionsPath = path.join(managedHome, 'sessions');
  fs.rmdirSync(managedSessionsPath);
  fs.symlinkSync(stableSessionsPath, managedSessionsPath, 'dir');
  assert.equal(
    fs.lstatSync(managedSessionsPath).isSymbolicLink(),
    true,
    'StepCode managed sessions path must be a symlink after startup reconciliation'
  );
  assert.equal(
    fs.realpathSync(managedSessionsPath),
    fs.realpathSync(stableSessionsPath),
    'StepCode managed sessions symlink must resolve to the stable native sessions path'
  );

  writeManagedRollout(nativeHome, workspace, now);
  fs.mkdirSync(path.join(managedHome, 'shell_snapshots'), { recursive: true });
  fs.writeFileSync(
    path.join(managedHome, 'shell_snapshots', `${SESSION_ID}.1.sh`),
    `export TMUX_PANE='${MAIN_PANE}'\n`,
    'utf8'
  );

  const bindMs = await waitForManagedSession(state);
  assert.match(
    state.output,
    new RegExp(`Session: ${SESSION_ID.slice(0, 8)}…${SESSION_ID.slice(-4)}`)
  );
  assert.match(state.output, /\[stepcode-runtime-model ultra\]/);
  assert.match(state.output, /Provider: stepcode-api/);
  assert.doesNotMatch(state.output, /native-distractor-model/);
  assert.doesNotMatch(state.output, /native-distractor/);
  assert.equal(state.stderr, '', `HUD stderr must remain empty: ${state.stderr}`);

  const closeResult = await stopHud(state);
  assert.equal(closeResult.code, 0, 'HUD must stop cleanly after SIGTERM');
  assert.equal(closeResult.signal, null, 'HUD must handle SIGTERM itself');
  console.log(
    `test-stepcode-renderer-managed-home: PASS ` +
      `(managed_home=1, sessions_symlink_reconciled=1, exact_snapshot_binding_ms=${bindMs}, native_home_ignored=1, shutdown_status=${closeResult.code})`
  );
} finally {
  if (state && state.child.exitCode === null && state.child.signalCode === null) {
    state.child.kill('SIGKILL');
  }
}
