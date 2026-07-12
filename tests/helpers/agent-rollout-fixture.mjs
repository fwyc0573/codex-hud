import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const AGENT_TEST_PREFIX = 'codex-hud-agent-test-';

const DEFAULT_TIMESTAMP = '2026-07-12T00:00:00.000Z';
const DEFAULT_SESSION_ID = '019d7295-3ef8-7292-a039-fdf7ecd4f53e';
const DEFAULT_PARENT_THREAD_ID = '019d7291-a135-7fe1-b46f-8f3eca4fa451';
const DEFAULT_CHILD_THREAD_ID = '019d7299-b246-7ad3-b14a-0e4a47e5a682';

export function makeAgentTestRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), AGENT_TEST_PREFIX));
}

export function cleanupAgentTestRoot(rootPath) {
  const realRoot = fs.realpathSync(rootPath);
  const realTmp = fs.realpathSync(os.tmpdir());
  const realParent = path.dirname(realRoot);
  const parentIsUnderTmp =
    realParent === realTmp || realParent.startsWith(`${realTmp}${path.sep}`);

  if (!parentIsUnderTmp) {
    throw new Error(`Refusing to clean a test root outside the OS temp directory: ${realRoot}`);
  }

  if (!path.basename(realRoot).startsWith(AGENT_TEST_PREFIX)) {
    throw new Error(`Refusing to clean a test root without the required prefix: ${realRoot}`);
  }

  fs.rmSync(realRoot, { recursive: true });
}

export function canonicalSessionMeta({
  id = DEFAULT_SESSION_ID,
  timestamp = DEFAULT_TIMESTAMP,
  outerTimestamp = timestamp,
  cwd = '/tmp/codex-hud-agent-project',
  originator = 'codex-tui',
  cliVersion = '0.144.1',
  source = 'cli',
  forkedFromId,
  parentThreadId,
  agentPath,
  modelProvider = 'openai',
} = {}) {
  return {
    timestamp: outerTimestamp,
    type: 'session_meta',
    payload: {
      id,
      timestamp,
      cwd,
      originator,
      cli_version: cliVersion,
      source,
      forked_from_id: forkedFromId,
      parent_thread_id: parentThreadId,
      agent_path: agentPath,
      model_provider: modelProvider,
    },
  };
}

export function legacyAgentStart({
  eventId = 'call_legacy_start',
  occurredAtMs = 1_720_742_400_100,
  childThreadId = DEFAULT_CHILD_THREAD_ID,
  agentPath = '/root/legacy_agent',
  kind = 'started',
  timestamp = DEFAULT_TIMESTAMP,
} = {}) {
  return {
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'sub_agent_activity',
      event_id: eventId,
      occurred_at_ms: occurredAtMs,
      agent_thread_id: childThreadId,
      agent_path: agentPath,
      kind,
    },
  };
}

export function paginatedAgentStart({
  eventId = 'call_paginated_start',
  occurredAtMs = 1_720_742_400_200,
  childThreadId = DEFAULT_CHILD_THREAD_ID,
  agentPath = '/root/paginated_agent',
  kind = 'started',
  itemType = 'SubAgentActivity',
  parentThreadId = DEFAULT_PARENT_THREAD_ID,
  turnId = '019d729c-c357-7bd4-824b-1f5b58f6b793',
  timestamp = DEFAULT_TIMESTAMP,
} = {}) {
  return {
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      thread_id: parentThreadId,
      turn_id: turnId,
      completed_at_ms: occurredAtMs,
      item: {
        type: itemType,
        id: eventId,
        kind,
        agent_thread_id: childThreadId,
        agent_path: agentPath,
      },
    },
  };
}

export function taskStarted({
  turnId = '019d729d-d468-7ce5-935c-206c69a7c8a4',
  startedAt = 1_720_742_400,
  timestamp = DEFAULT_TIMESTAMP,
} = {}) {
  return {
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'task_started',
      turn_id: turnId,
      started_at: startedAt,
      model_context_window: 128_000,
    },
  };
}

export function taskComplete({
  turnId = '019d729d-d468-7ce5-935c-206c69a7c8a4',
  completedAt = 1_720_742_401,
  timestamp = DEFAULT_TIMESTAMP,
} = {}) {
  return {
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'task_complete',
      turn_id: turnId,
      last_agent_message: null,
      completed_at: completedAt,
    },
  };
}

export function turnAborted({
  turnId = '019d729d-d468-7ce5-935c-206c69a7c8a4',
  completedAt = 1_720_742_401,
  reason = 'interrupted',
  timestamp = DEFAULT_TIMESTAMP,
} = {}) {
  return {
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'turn_aborted',
      turn_id: turnId,
      reason,
      completed_at: completedAt,
    },
  };
}

export function writeRolloutFile(
  rootPath,
  {
    sessionId = DEFAULT_SESSION_ID,
    records = [],
    storage = 'sessions',
    relativeDir = path.join('2026', '07', '12'),
    timestampLabel = '2026-07-12T00-00-00',
  } = {}
) {
  if (storage !== 'sessions' && storage !== 'archived_sessions') {
    throw new Error(`Unsupported rollout storage: ${storage}`);
  }

  const directory = path.join(rootPath, storage, relativeDir);
  fs.mkdirSync(directory, { recursive: true });

  const filePath = path.join(
    directory,
    `rollout-${timestampLabel}-${sessionId}.jsonl`
  );
  const contents = records.map((record) => JSON.stringify(record)).join('\n');
  fs.writeFileSync(filePath, contents.length > 0 ? `${contents}\n` : '', 'utf8');
  return filePath;
}
