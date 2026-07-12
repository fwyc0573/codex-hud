import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  appendRolloutRecords,
  canonicalSessionMeta,
  cleanupAgentTestRoot,
  legacyAgentStart,
  makeAgentTestRoot,
  paginatedAgentStart,
  taskComplete,
  taskStarted,
  turnAborted,
  writeRolloutFile,
} from '../helpers/agent-rollout-fixture.mjs';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const HUD_ENTRY = path.join(REPO_ROOT, 'dist', 'index.js');
const CURSOR_HOME = '\x1b[H';
const CLEAR_LINE = '\x1b[2K';
const ANSI_ESCAPE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const TRANSITION_TIMEOUT_MS = 5_000;
const INACTIVITY_TIMEOUT_MS = 3_000;
const FRAME_LINES = 12;

const ROOT_THREAD_ID = '11111111-1111-7111-8111-111111111111';
const CHILD_THREAD_ID = '22222222-2222-7222-8222-222222222222';
const GRANDCHILD_THREAD_ID = '33333333-3333-7333-8333-333333333333';
const RECOVERY_THREAD_ID = '44444444-4444-7444-8444-444444444444';
const OVERVIEW_ROOT_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const OVERVIEW_CHILD_ID = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function localDateFixture(now = new Date()) {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  return {
    relativeDir: path.join(year, month, day),
    timestampLabel: `${year}-${month}-${day}T${hour}-${minute}-${second}`,
  };
}

function timestamp(ms = Date.now()) {
  return new Date(ms).toISOString();
}

function subagentSource(parentThreadId, agentPath, depth) {
  return {
    subagent: {
      thread_spawn: {
        parent_thread_id: parentThreadId,
        depth,
        agent_path: agentPath,
      },
    },
  };
}

function assistantActivity(ms = Date.now()) {
  return {
    timestamp: timestamp(ms),
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'fixture activity' }],
    },
  };
}

function toolActivity(ms = Date.now()) {
  return {
    timestamp: timestamp(ms),
    type: 'response_item',
    payload: {
      type: 'function_call',
      id: 'fc_overview_child',
      call_id: 'call_overview_child',
      name: 'read',
      arguments: JSON.stringify({ file_path: '/tmp/fixture' }),
    },
  };
}

function createHudEnvironment(testRoot, name, mainPane) {
  const environmentRoot = path.join(testRoot, name);
  const codexHome = path.join(environmentRoot, 'codex-home');
  const workspace = path.join(environmentRoot, 'workspace');
  fs.mkdirSync(path.join(codexHome, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(codexHome, 'shell_snapshots'), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, 'config.toml'),
    'model = "gpt-5.4"\nmodel_reasoning_effort = "high"\n',
    'utf8'
  );

  return {
    codexHome,
    workspace,
    writePaneSnapshot(threadId) {
      fs.writeFileSync(
        path.join(codexHome, 'shell_snapshots', `${threadId}.1.sh`),
        `export TMUX_PANE='${mainPane}'\n`,
        'utf8'
      );
    },
  };
}

function buildProcessEnv(environment, overrides = {}) {
  const env = {
    ...process.env,
    CODEX_HOME: environment.codexHome,
    CODEX_HUD_MAIN_PANE: '%agent-test',
    CODEX_HUD_CWD: environment.workspace,
    CODEX_HUD_CLEAR_SCROLLBACK: '0',
    COLUMNS: '100',
    LINES: String(FRAME_LINES),
    ...overrides,
  };
  delete env.CODEX_SESSIONS_PATH;
  return env;
}

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}

function parseFrames(stdout) {
  return stdout
    .split(CURSOR_HOME)
    .slice(1)
    .map((raw) => {
      const plain = raw.replace(ANSI_ESCAPE, '').replaceAll('\r', '');
      return {
        raw,
        plain,
        lines: plain.split('\n').map((line) => line.trimEnd()),
        complete: countOccurrences(raw, CLEAR_LINE) >= FRAME_LINES,
      };
    });
}

function processClose(child) {
  return new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

function assertOutputDrained(processState, label) {
  assert.equal(processState.child.stdout.readableEnded, true, `${label} stdout must be drained`);
  assert.equal(processState.child.stderr.readableEnded, true, `${label} stderr must be drained`);
}

function startHud(environment, overrides = {}) {
  const child = spawn(process.execPath, [HUD_ENTRY], {
    cwd: REPO_ROOT,
    env: buildProcessEnv(environment, overrides),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = processClose(child);
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
    closed,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    frames() {
      return parseFrames(stdout);
    },
  };
}

async function stopHud(processState) {
  if (processState.child.exitCode !== null || processState.child.signalCode !== null) {
    return processState.closed;
  }

  processState.child.kill('SIGTERM');
  const result = await Promise.race([
    processState.closed,
    delay(2_000).then(() => null),
  ]);
  if (result !== null) {
    return result;
  }

  processState.child.kill('SIGKILL');
  return processState.closed;
}

async function waitForFrame(processState, label, afterCount, predicate) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= TRANSITION_TIMEOUT_MS) {
    if (processState.child.exitCode !== null || processState.child.signalCode !== null) {
      const result = await processState.closed;
      throw new Error(
        `${label}: HUD exited before the expected frame ` +
          `(code=${result.code}, signal=${result.signal}, ` +
          `stderr=${JSON.stringify(processState.stderr)})`
      );
    }

    const frames = processState.frames();
    for (let index = afterCount; index < frames.length; index++) {
      const frame = frames[index];
      if (frame.complete && predicate(frame)) {
        assert.ok(index >= afterCount, `${label}: accepted a frame before the mutation baseline`);
        assert.ok(
          countOccurrences(frame.raw, CLEAR_LINE) >= FRAME_LINES,
          `${label}: accepted an incomplete frame`
        );
        const latencyMs = Date.now() - startedAt;
        assert.ok(
          latencyMs <= TRANSITION_TIMEOUT_MS,
          `${label}: transition took ${latencyMs} ms`
        );
        return { frame, latencyMs, frameCount: frames.length };
      }
    }
    await delay(25);
  }

  const frames = processState.frames();
  const tail = frames.at(-1)?.plain ?? processState.stdout;
  throw new Error(
    `${label}: timed out after ${TRANSITION_TIMEOUT_MS} ms waiting for frame; ` +
      `frames=${frames.length}; tail=${JSON.stringify(tail)}; stderr=${JSON.stringify(processState.stderr)}`
  );
}

function rowFor(frame, label) {
  return frame.lines.find((line) => line.includes(` ${label} `)) ?? null;
}

function elapsedSeconds(row, label) {
  const match = new RegExp(
    `^[◐◓◑◒] ${label} (\\d+)s(?: ↳\\d+)?$`
  ).exec(row);
  assert.ok(match, `Expected a seconds-based ${label} row, received ${JSON.stringify(row)}`);
  return Number(match[1]);
}

async function waitForClose(processState, timeoutMs) {
  const result = await Promise.race([
    processState.closed,
    delay(timeoutMs).then(() => null),
  ]);
  if (result === null) {
    throw new Error(`HUD process did not close within ${timeoutMs} ms`);
  }
  return result;
}

function writeSession(codexHome, sessionId, records) {
  const now = new Date();
  const dateFixture = localDateFixture(now);
  return writeRolloutFile(codexHome, {
    sessionId,
    records,
    relativeDir: dateFixture.relativeDir,
    timestampLabel: dateFixture.timestampLabel,
  });
}

async function runSingleModeFlow(testRoot, processStates, metrics) {
  const environment = createHudEnvironment(testRoot, 'single', '%agent-test');
  environment.writePaneSnapshot(ROOT_THREAD_ID);

  const seedStartedAtMs = Date.now() - 10_000;
  const rootTurnId = 'root-turn';
  const childTurnId = 'child-turn';
  const grandchildTurnId = 'grandchild-turn';
  const childAgentPath = '/root/child_e2e';
  const grandchildAgentPath = '/root/child_e2e/grandchild_e2e';
  const rootPath = writeSession(environment.codexHome, ROOT_THREAD_ID, [
    canonicalSessionMeta({
      id: ROOT_THREAD_ID,
      timestamp: timestamp(seedStartedAtMs - 1_000),
      outerTimestamp: timestamp(seedStartedAtMs - 1_000),
      cwd: environment.workspace,
      source: 'cli',
    }),
    taskStarted({
      turnId: rootTurnId,
      startedAt: Math.floor((seedStartedAtMs - 500) / 1_000),
      timestamp: timestamp(seedStartedAtMs - 500),
    }),
    legacyAgentStart({
      eventId: 'call_child_seed',
      occurredAtMs: seedStartedAtMs,
      childThreadId: CHILD_THREAD_ID,
      agentPath: childAgentPath,
      timestamp: timestamp(seedStartedAtMs),
    }),
  ]);

  const childPath = writeSession(environment.codexHome, CHILD_THREAD_ID, [
    canonicalSessionMeta({
      id: CHILD_THREAD_ID,
      timestamp: timestamp(seedStartedAtMs),
      outerTimestamp: timestamp(seedStartedAtMs),
      cwd: environment.workspace,
      source: subagentSource(ROOT_THREAD_ID, childAgentPath, 1),
      parentThreadId: ROOT_THREAD_ID,
      agentPath: childAgentPath,
    }),
  ]);

  const processState = startHud(environment, {
    CODEX_HUD_MODE: 'single',
    CODEX_HUD_AGENT_INACTIVITY_TIMEOUT_MS: String(INACTIVITY_TIMEOUT_MS),
  });
  processStates.add(processState);

  let cursor = 0;
  let transition = await waitForFrame(
    processState,
    'typed seed -> starting',
    cursor,
    (frame) => {
      const row = rowFor(frame, 'child_e2e');
      return row !== null && /^[◐◓◑◒] child_e2e \d+s$/.test(row);
    }
  );
  metrics.transitions.push(['typed seed -> starting', transition.latencyMs]);
  cursor = transition.frameCount;
  const startingElapsed = elapsedSeconds(rowFor(transition.frame, 'child_e2e'), 'child_e2e');
  assert.ok(startingElapsed >= 9, `Starting elapsed must preserve the typed seed time, got ${startingElapsed}s`);
  assert.ok(
    startingElapsed * 1_000 > INACTIVITY_TIMEOUT_MS,
    `Starting must remain visible beyond the ${INACTIVITY_TIMEOUT_MS} ms running-only timeout`
  );
  metrics.startingBeyondTimeoutMs = startingElapsed * 1_000;

  const childStartedAtMs = Date.now();
  appendRolloutRecords(childPath, [
    taskStarted({
      turnId: childTurnId,
      startedAt: Math.floor(childStartedAtMs / 1_000),
      timestamp: timestamp(childStartedAtMs),
    }),
  ]);
  transition = await waitForFrame(
    processState,
    'child-local task_started -> running reset',
    cursor,
    (frame) => {
      const row = rowFor(frame, 'child_e2e');
      if (!row || !/^[◐◓◑◒] child_e2e \d+s$/.test(row)) {
        return false;
      }
      return elapsedSeconds(row, 'child_e2e') <= 2;
    }
  );
  metrics.transitions.push(['child-local task_started -> running reset', transition.latencyMs]);
  cursor = transition.frameCount;
  metrics.timerResetSeconds = elapsedSeconds(rowFor(transition.frame, 'child_e2e'), 'child_e2e');

  const grandchildStartedAtMs = Date.now();
  const grandchildPath = writeSession(environment.codexHome, GRANDCHILD_THREAD_ID, [
    canonicalSessionMeta({
      id: GRANDCHILD_THREAD_ID,
      timestamp: timestamp(grandchildStartedAtMs),
      outerTimestamp: timestamp(grandchildStartedAtMs),
      cwd: environment.workspace,
      source: subagentSource(CHILD_THREAD_ID, grandchildAgentPath, 2),
      parentThreadId: CHILD_THREAD_ID,
      agentPath: grandchildAgentPath,
    }),
    taskStarted({
      turnId: grandchildTurnId,
      startedAt: Math.floor(grandchildStartedAtMs / 1_000),
      timestamp: timestamp(grandchildStartedAtMs),
    }),
  ]);
  appendRolloutRecords(childPath, [
    paginatedAgentStart({
      eventId: 'call_grandchild_seed',
      occurredAtMs: grandchildStartedAtMs,
      childThreadId: GRANDCHILD_THREAD_ID,
      agentPath: grandchildAgentPath,
      parentThreadId: CHILD_THREAD_ID,
      turnId: childTurnId,
      timestamp: timestamp(grandchildStartedAtMs),
    }),
  ]);
  transition = await waitForFrame(
    processState,
    'nested Paginated seed -> descendant aggregate',
    cursor,
    (frame) => /^[◐◓◑◒] child_e2e \d+s ↳1$/.test(rowFor(frame, 'child_e2e') ?? '')
  );
  metrics.transitions.push(['nested Paginated seed -> descendant aggregate', transition.latencyMs]);
  cursor = transition.frameCount;
  metrics.nestedDescendants = 1;

  appendRolloutRecords(childPath, [
    taskComplete({
      turnId: childTurnId,
      completedAt: Math.floor(Date.now() / 1_000),
      timestamp: timestamp(),
    }),
  ]);
  transition = await waitForFrame(
    processState,
    'direct complete -> descendant keeps aggregate',
    cursor,
    (frame) => /^[◐◓◑◒] child_e2e \d+s ↳1$/.test(rowFor(frame, 'child_e2e') ?? '')
  );
  metrics.transitions.push(['direct complete -> descendant keeps aggregate', transition.latencyMs]);
  cursor = transition.frameCount;

  appendRolloutRecords(grandchildPath, [
    taskComplete({
      turnId: grandchildTurnId,
      completedAt: Math.floor(Date.now() / 1_000),
      timestamp: timestamp(),
    }),
  ]);
  transition = await waitForFrame(
    processState,
    'grandchild complete -> aggregate removal',
    cursor,
    (frame) => rowFor(frame, 'child_e2e') === null
  );
  metrics.transitions.push(['grandchild complete -> aggregate removal', transition.latencyMs]);
  cursor = transition.frameCount;

  const followupTurnId = 'child-followup-turn';
  const followupStartedAtMs = Date.now();
  appendRolloutRecords(childPath, [
    taskStarted({
      turnId: followupTurnId,
      startedAt: Math.floor(followupStartedAtMs / 1_000),
      timestamp: timestamp(followupStartedAtMs),
    }),
  ]);
  transition = await waitForFrame(
    processState,
    'follow-up task_started -> visible reset',
    cursor,
    (frame) => {
      const row = rowFor(frame, 'child_e2e');
      return Boolean(row) && elapsedSeconds(row, 'child_e2e') <= 2;
    }
  );
  metrics.transitions.push(['follow-up task_started -> visible reset', transition.latencyMs]);
  cursor = transition.frameCount;
  metrics.followupResetSeconds = elapsedSeconds(rowFor(transition.frame, 'child_e2e'), 'child_e2e');

  transition = await waitForFrame(
    processState,
    'running inactivity -> presentation hidden',
    cursor,
    (frame) => rowFor(frame, 'child_e2e') === null
  );
  metrics.inactivityElapsedMs = Date.now() - followupStartedAtMs;
  assert.ok(
    metrics.inactivityElapsedMs >= INACTIVITY_TIMEOUT_MS,
    `Inactivity hide occurred before ${INACTIVITY_TIMEOUT_MS} ms: ${metrics.inactivityElapsedMs} ms`
  );
  assert.ok(
    metrics.inactivityElapsedMs <= TRANSITION_TIMEOUT_MS,
    `Inactivity hide exceeded ${TRANSITION_TIMEOUT_MS} ms: ${metrics.inactivityElapsedMs} ms`
  );
  metrics.transitions.push([
    'running inactivity -> presentation hidden',
    metrics.inactivityElapsedMs,
  ]);
  cursor = transition.frameCount;

  const activityAtMs = Date.now();
  appendRolloutRecords(childPath, [assistantActivity(activityAtMs)]);
  transition = await waitForFrame(
    processState,
    'non-lifecycle activity -> visible without timer reset',
    cursor,
    (frame) => rowFor(frame, 'child_e2e') !== null
  );
  metrics.transitions.push(['non-lifecycle activity -> visible without timer reset', transition.latencyMs]);
  cursor = transition.frameCount;
  metrics.recoveredElapsedSeconds = elapsedSeconds(
    rowFor(transition.frame, 'child_e2e'),
    'child_e2e'
  );
  assert.ok(
    metrics.recoveredElapsedSeconds >= 3,
    `Activity recovery reset the turn timer to ${metrics.recoveredElapsedSeconds}s`
  );

  const recoveryAgentPath = '/root/recovery_child';
  const recoverySeedAtMs = Date.now();
  appendRolloutRecords(rootPath, [
    legacyAgentStart({
      eventId: 'call_recovery_seed',
      occurredAtMs: recoverySeedAtMs,
      childThreadId: RECOVERY_THREAD_ID,
      agentPath: recoveryAgentPath,
      timestamp: timestamp(recoverySeedAtMs),
    }),
  ]);
  appendRolloutRecords(childPath, [assistantActivity(recoverySeedAtMs)]);
  transition = await waitForFrame(
    processState,
    'missing exact rollout -> tracking error',
    cursor,
    (frame) => rowFor(frame, 'recovery_child') === '✗ recovery_child tracking error'
  );
  metrics.transitions.push(['missing exact rollout -> tracking error', transition.latencyMs]);
  cursor = transition.frameCount;
  assert.match(
    processState.stderr,
    /exact active\/archive rollout is unavailable\./,
    'Tracking error details must be logged by the HUD process'
  );

  const trackingErrorAgeBeforeBaseline = Date.now() - recoverySeedAtMs;
  if (trackingErrorAgeBeforeBaseline < INACTIVITY_TIMEOUT_MS - 500) {
    await delay(INACTIVITY_TIMEOUT_MS - 500 - trackingErrorAgeBeforeBaseline);
  }
  cursor = processState.frames().length;
  transition = await waitForFrame(
    processState,
    'tracking error survives running-only timeout',
    cursor,
    (frame) =>
      rowFor(frame, 'recovery_child') === '✗ recovery_child tracking error' &&
      rowFor(frame, 'child_e2e') === null
  );
  metrics.trackingErrorVisibleAfterMs = Date.now() - recoverySeedAtMs;
  assert.ok(
    metrics.trackingErrorVisibleAfterMs >= INACTIVITY_TIMEOUT_MS,
    `Tracking error disappeared before ${INACTIVITY_TIMEOUT_MS} ms`
  );
  metrics.transitions.push([
    'tracking error survives running-only timeout',
    metrics.trackingErrorVisibleAfterMs,
  ]);
  cursor = transition.frameCount;

  const recoveryTurnId = 'recovery-turn';
  const recoveryPath = writeSession(environment.codexHome, RECOVERY_THREAD_ID, [
    canonicalSessionMeta({
      id: RECOVERY_THREAD_ID,
      timestamp: timestamp(recoverySeedAtMs),
      outerTimestamp: timestamp(recoverySeedAtMs),
      cwd: environment.workspace,
      source: subagentSource(ROOT_THREAD_ID, recoveryAgentPath, 1),
      parentThreadId: ROOT_THREAD_ID,
      agentPath: recoveryAgentPath,
    }),
    taskStarted({
      turnId: recoveryTurnId,
      startedAt: Math.floor(Date.now() / 1_000),
      timestamp: timestamp(),
    }),
  ]);
  transition = await waitForFrame(
    processState,
    'exact canonical rollout -> tracking recovery',
    cursor,
    (frame) => /^[◐◓◑◒] recovery_child \d+s$/.test(rowFor(frame, 'recovery_child') ?? '')
  );
  metrics.transitions.push(['exact canonical rollout -> tracking recovery', transition.latencyMs]);
  cursor = transition.frameCount;

  assert.ok(fs.existsSync(recoveryPath), `Expected exact recovery rollout at ${recoveryPath}`);
  appendRolloutRecords(recoveryPath, [
    turnAborted({
      turnId: recoveryTurnId,
      completedAt: Math.floor(Date.now() / 1_000),
      timestamp: timestamp(),
    }),
  ]);
  transition = await waitForFrame(
    processState,
    'turn_aborted -> immediate removal',
    cursor,
    (frame) => rowFor(frame, 'recovery_child') === null
  );
  metrics.transitions.push(['turn_aborted -> immediate removal', transition.latencyMs]);

  await stopHud(processState);
  assertOutputDrained(processState, 'Valid single-mode flow');
  assert.doesNotMatch(
    processState.stderr,
    /(?:Render error:|Fatal error:)/,
    'Valid single-mode flow must not emit render or fatal errors'
  );
  processStates.delete(processState);
}

async function runOverviewFlow(testRoot, processStates, metrics) {
  const environment = createHudEnvironment(testRoot, 'overview', '%agent-test');
  environment.writePaneSnapshot(OVERVIEW_ROOT_ID);
  const nowMs = Date.now();

  const rootPath = writeSession(environment.codexHome, OVERVIEW_ROOT_ID, [
    canonicalSessionMeta({
      id: OVERVIEW_ROOT_ID,
      timestamp: timestamp(nowMs),
      outerTimestamp: timestamp(nowMs),
      cwd: environment.workspace,
      source: 'cli',
    }),
    assistantActivity(nowMs),
  ]);
  const childPath = writeSession(environment.codexHome, OVERVIEW_CHILD_ID, [
    canonicalSessionMeta({
      id: OVERVIEW_CHILD_ID,
      timestamp: timestamp(nowMs),
      outerTimestamp: timestamp(nowMs),
      cwd: environment.workspace,
      source: subagentSource(OVERVIEW_ROOT_ID, '/root/overview_child', 1),
      parentThreadId: OVERVIEW_ROOT_ID,
      agentPath: '/root/overview_child',
    }),
    toolActivity(nowMs),
  ]);

  const rolloutModuleUrl = pathToFileURL(
    path.join(REPO_ROOT, 'dist', 'collectors', 'rollout.js')
  ).href;
  const { parseRolloutFile } = await import(rolloutModuleUrl);
  const [{ result: parsedRoot }, { result: parsedChild }] = await Promise.all([
    parseRolloutFile(rootPath, 0, 3),
    parseRolloutFile(childPath, 0, 3),
  ]);
  const activityGateNow = Date.now();
  const rootActivityAgeMs =
    activityGateNow - parsedRoot.lastAssistantMessageTime.getTime();
  const childActivityAgeMs =
    activityGateNow - parsedChild.lastToolActivityTime.getTime();
  const rootMtimeAgeMs = activityGateNow - fs.statSync(rootPath).mtimeMs;
  const childMtimeAgeMs = activityGateNow - fs.statSync(childPath).mtimeMs;
  for (const [label, ageMs] of [
    ['root assistant activity', rootActivityAgeMs],
    ['child tool activity', childActivityAgeMs],
    ['root mtime', rootMtimeAgeMs],
    ['child mtime', childMtimeAgeMs],
  ]) {
    assert.ok(ageMs >= 0 && ageMs <= 60_000, `${label} age ${ageMs} ms misses the overview gate`);
  }

  const processState = startHud(environment, {
    CODEX_HUD_MODE: 'overview',
    CODEX_HUD_AGENT_INACTIVITY_TIMEOUT_MS: String(INACTIVITY_TIMEOUT_MS),
  });
  processStates.add(processState);

  const transition = await waitForFrame(
    processState,
    'overview excludes structured subagent session',
    0,
    (frame) => frame.plain.includes(OVERVIEW_ROOT_ID.slice(0, 8))
  );
  const rootOutputs = countOccurrences(transition.frame.plain, OVERVIEW_ROOT_ID.slice(0, 8));
  const childOutputs = countOccurrences(transition.frame.plain, OVERVIEW_CHILD_ID.slice(0, 8));
  assert.equal(rootOutputs, 1, 'Overview must render the active root exactly once');
  assert.equal(childOutputs, 0, 'Overview must exclude the structured subagent rollout');
  metrics.transitions.push(['overview root-only filtering', transition.latencyMs]);
  metrics.overview = {
    activeInputs: 2,
    activityGateInputs: 2,
    rootOutputs,
    childOutputs,
    rootActivityAgeMs,
    childActivityAgeMs,
    rootMtimeAgeMs,
    childMtimeAgeMs,
  };

  await stopHud(processState);
  assertOutputDrained(processState, 'Valid overview flow');
  assert.doesNotMatch(
    processState.stderr,
    /(?:Render error:|Fatal error:)/,
    'Valid overview flow must not emit render or fatal errors'
  );
  processStates.delete(processState);
}

async function runInvalidTimeoutFlow(testRoot, processStates, metrics) {
  metrics.invalidTimeout = [];
  for (const [name, value] of [
    ['non-numeric', 'abc'],
    ['zero', '0'],
    ['negative', '-1'],
  ]) {
    const environment = createHudEnvironment(
      testRoot,
      `invalid-timeout-${name}`,
      '%agent-test'
    );
    const processState = startHud(environment, {
      CODEX_HUD_MODE: 'single',
      CODEX_HUD_AGENT_INACTIVITY_TIMEOUT_MS: value,
    });
    processStates.add(processState);
    const startedAt = Date.now();
    const result = await waitForClose(processState, TRANSITION_TIMEOUT_MS);
    const latencyMs = Date.now() - startedAt;

    assertOutputDrained(processState, `Invalid ${name} timeout flow`);
    assert.notEqual(result.code, 0, `${name} timeout must exit non-zero`);
    assert.match(
      processState.stderr,
      /Fatal error: Error: CODEX_HUD_AGENT_INACTIVITY_TIMEOUT_MS must be a positive integer in milliseconds\./
    );
    assert.equal(
      processState.stdout.includes('Codex HUD starting...'),
      false,
      `${name} timeout must fail before the startup banner`
    );
    assert.equal(
      processState.frames().filter((frame) => frame.complete).length,
      0,
      `${name} timeout must fail before a complete frame`
    );
    metrics.transitions.push([`invalid ${name} timeout -> fatal exit`, latencyMs]);
    metrics.invalidTimeout.push({
      name,
      value,
      exitCode: result.code,
      errorMatched: 1,
      latencyMs,
    });
    processStates.delete(processState);
  }
}

async function main() {
  assert.ok(fs.existsSync(HUD_ENTRY), `Build output is missing: ${HUD_ENTRY}`);
  const moduleUrl = pathToFileURL(
    path.join(REPO_ROOT, 'dist', 'collectors', 'agent-activity.js')
  ).href;
  const { parseAgentInactivityTimeoutMs } = await import(moduleUrl);
  const defaultTimeoutMs = parseAgentInactivityTimeoutMs(undefined);
  assert.equal(defaultTimeoutMs, 900_000);

  const testRoot = makeAgentTestRoot();
  const processStates = new Set();
  const metrics = {
    defaultTimeoutMs,
    transitions: [],
  };
  let failure = null;
  let stoppedProcesses = 0;

  try {
    await runSingleModeFlow(testRoot, processStates, metrics);
    await runOverviewFlow(testRoot, processStates, metrics);
    await runInvalidTimeoutFlow(testRoot, processStates, metrics);
  } catch (error) {
    failure = error;
  } finally {
    for (const processState of processStates) {
      await stopHud(processState);
      stoppedProcesses++;
    }
    cleanupAgentTestRoot(testRoot);
    assert.equal(fs.existsSync(testRoot), false, 'Test-owned temp root must be removed');
    console.log(
      `CLEANUP child_processes_alive=0 forced_test_child_stops=${stoppedProcesses} temp_roots_remaining=0`
    );
  }

  if (failure) {
    throw failure;
  }

  for (const [name, latencyMs] of metrics.transitions) {
    console.log(`TRANSITION ${name}: actual=${latencyMs}ms threshold<=${TRANSITION_TIMEOUT_MS}ms`);
  }
  console.log(
    `METRIC default_timeout_ms expected=900000 actual=${metrics.defaultTimeoutMs}`
  );
  console.log(
    `METRIC timer_reset_seconds expected<=2 actual=${metrics.timerResetSeconds} ` +
      `followup_expected<=2 followup_actual=${metrics.followupResetSeconds}`
  );
  console.log(
    `METRIC nested_descendants expected=1 actual=${metrics.nestedDescendants} ` +
      `activity_recovery_elapsed_expected>=3 actual=${metrics.recoveredElapsedSeconds}`
  );
  console.log(
    `METRIC running_only_timeout_ms expected=${INACTIVITY_TIMEOUT_MS} ` +
      `starting_visible_after=${metrics.startingBeyondTimeoutMs} ` +
      `tracking_error_visible_after=${metrics.trackingErrorVisibleAfterMs}`
  );
  console.log(
    `METRIC overview_active_inputs expected=2 actual=${metrics.overview.activeInputs} ` +
      `activity_gate_inputs expected=2 actual=${metrics.overview.activityGateInputs} ` +
      `root_outputs expected=1 actual=${metrics.overview.rootOutputs} ` +
      `child_outputs expected=0 actual=${metrics.overview.childOutputs}`
  );
  console.log(
    `METRIC invalid_timeout_cases expected=3 actual=${metrics.invalidTimeout.length} ` +
      `nonzero_exits expected=3 actual=${metrics.invalidTimeout.filter((item) => item.exitCode !== 0).length} ` +
      `error_matches expected=3 actual=${metrics.invalidTimeout.reduce((sum, item) => sum + item.errorMatched, 0)}`
  );
  console.log('PASS test-agent-status-hud (1/1)');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
