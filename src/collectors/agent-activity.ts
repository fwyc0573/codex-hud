import type {
  AgentActivity,
  AgentActivityRow,
  AgentDisplayStatus,
  SessionSource,
} from '../types.js';

export const AGENT_INACTIVITY_TIMEOUT_ENV =
  'CODEX_HUD_AGENT_INACTIVITY_TIMEOUT_MS';
export const DEFAULT_AGENT_INACTIVITY_TIMEOUT_MS = 900_000;

export interface AgentSpawnSeed {
  eventId: string;
  occurredAtMs: number;
  childThreadId: string;
  agentPath: string;
}

export type AgentLifecycle = 'starting' | 'running' | 'idle';

export interface AgentState {
  threadId: string;
  parentThreadId: string;
  agentPath: string;
  label: string;
  lifecycle: AgentLifecycle;
  activeTurnId: string | null;
  startedAtMs: number | null;
  lastCompleteLocalRecordAtMs: number | null;
  trackingError: string | null;
}

export interface DeriveAgentActivityOptions {
  rootThreadId: string;
  nodes: readonly AgentState[];
  nowMs: number;
  inactivityTimeoutMs: number;
  rootTrackingError?: boolean;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null ? (value as JsonRecord) : null;
}

export function parseAgentInactivityTimeoutMs(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_AGENT_INACTIVITY_TIMEOUT_MS;
  }

  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `${AGENT_INACTIVITY_TIMEOUT_ENV} must be a positive integer in milliseconds.`
    );
  }

  return value;
}

function requireIdentity(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `Invalid agent spawn activity: ${fieldName} must be a non-empty string.`
    );
  }

  return value;
}

function requireOccurredAtMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      'Invalid agent spawn activity: occurredAtMs must be a positive number.'
    );
  }

  return value;
}

function createAgentSpawnSeed(
  eventId: unknown,
  occurredAtMs: unknown,
  childThreadId: unknown,
  agentPath: unknown
): AgentSpawnSeed {
  return {
    eventId: requireIdentity(eventId, 'eventId'),
    occurredAtMs: requireOccurredAtMs(occurredAtMs),
    childThreadId: requireIdentity(childThreadId, 'childThreadId'),
    agentPath: requireIdentity(agentPath, 'agentPath'),
  };
}

function agentPathLeaf(agentPath: string): string {
  const label = agentPath.slice(agentPath.lastIndexOf('/') + 1);
  return requireIdentity(label, 'agentPath leaf');
}

export function createAgentState(
  seed: AgentSpawnSeed,
  parentThreadId: string
): AgentState {
  return {
    threadId: requireIdentity(seed.childThreadId, 'childThreadId'),
    parentThreadId: requireIdentity(parentThreadId, 'parentThreadId'),
    agentPath: requireIdentity(seed.agentPath, 'agentPath'),
    label: agentPathLeaf(seed.agentPath),
    lifecycle: 'starting',
    activeTurnId: null,
    startedAtMs: requireOccurredAtMs(seed.occurredAtMs),
    lastCompleteLocalRecordAtMs: null,
    trackingError: null,
  };
}

function requireRecordTimestampMs(record: JsonRecord): number {
  if (typeof record.timestamp !== 'string') {
    throw new Error(
      'Invalid agent lifecycle record: timestamp must be a valid RFC3339 date-time string.'
    );
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
      record.timestamp
    );
  if (!match) {
    throw new Error(
      'Invalid agent lifecycle record: timestamp must be a valid RFC3339 date-time string.'
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) {
    throw new Error(
      'Invalid agent lifecycle record: timestamp must be a valid RFC3339 date-time string.'
    );
  }

  const timestampMs = Date.parse(record.timestamp);
  if (!Number.isFinite(timestampMs)) {
    throw new Error(
      'Invalid agent lifecycle record: timestamp must be a valid RFC3339 date-time string.'
    );
  }

  return timestampMs;
}

function requireTurnId(value: unknown, eventType: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `Invalid agent lifecycle record: ${eventType}.turn_id must be a non-empty string.`
    );
  }

  return value;
}

function startedAtMs(payload: JsonRecord, recordTimestampMs: number): number {
  if (payload.started_at === null || payload.started_at === undefined) {
    return recordTimestampMs;
  }

  if (
    typeof payload.started_at !== 'number' ||
    !Number.isSafeInteger(payload.started_at) ||
    !Number.isSafeInteger(payload.started_at * 1000)
  ) {
    throw new Error(
      'Invalid agent lifecycle record: task_started.started_at must be integer Unix seconds or null.'
    );
  }

  return payload.started_at * 1000;
}

function clearActiveTurn(state: AgentState): AgentState {
  return {
    ...state,
    lifecycle: 'idle',
    activeTurnId: null,
    startedAtMs: null,
    lastCompleteLocalRecordAtMs: null,
  };
}

export function reduceAgentLifecycleRecord(
  state: AgentState,
  record: unknown
): AgentState {
  const entry = asRecord(record);
  if (!entry) {
    throw new Error('Invalid agent lifecycle record: expected a JSON object.');
  }

  const recordTimestampMs = requireRecordTimestampMs(entry);
  let next =
    state.lifecycle === 'running'
      ? { ...state, lastCompleteLocalRecordAtMs: recordTimestampMs }
      : { ...state };

  if (entry.type !== 'event_msg') {
    return next;
  }

  const payload = asRecord(entry.payload);
  if (!payload) {
    throw new Error(
      'Invalid agent lifecycle record: event_msg.payload must be a JSON object.'
    );
  }

  if (payload.type === 'task_started') {
    next = {
      ...next,
      lifecycle: 'running',
      activeTurnId: requireTurnId(payload.turn_id, 'task_started'),
      startedAtMs: startedAtMs(payload, recordTimestampMs),
      lastCompleteLocalRecordAtMs: recordTimestampMs,
    };
  } else if (payload.type === 'task_complete') {
    const turnId = requireTurnId(payload.turn_id, 'task_complete');
    if (turnId === state.activeTurnId) {
      next = clearActiveTurn(next);
    }
  } else if (payload.type === 'turn_aborted') {
    const turnId =
      payload.turn_id === null || payload.turn_id === undefined
        ? null
        : requireTurnId(payload.turn_id, 'turn_aborted');
    if (
      state.lifecycle === 'running' &&
      (turnId === null || turnId === state.activeTurnId)
    ) {
      next = clearActiveTurn(next);
    }
  }

  return next;
}

export function isRunningVisible(
  state: AgentState,
  nowMs: number,
  inactivityTimeoutMs: number
): boolean {
  return (
    state.lifecycle === 'running' &&
    state.lastCompleteLocalRecordAtMs !== null &&
    nowMs - state.lastCompleteLocalRecordAtMs < inactivityTimeoutMs
  );
}

type VisibleAgentState =
  | { status: 'tracking-error' }
  | { status: 'starting' | 'running'; startedAtMs: number };

function visibleAgentState(
  state: AgentState,
  nowMs: number,
  inactivityTimeoutMs: number
): VisibleAgentState | null {
  if (state.trackingError !== null) {
    return { status: 'tracking-error' };
  }

  if (state.lifecycle === 'starting') {
    if (state.startedAtMs === null) {
      throw new Error('Invalid starting agent state: startedAtMs is required.');
    }
    return { status: 'starting', startedAtMs: state.startedAtMs };
  }

  if (isRunningVisible(state, nowMs, inactivityTimeoutMs)) {
    if (state.startedAtMs === null) {
      throw new Error('Invalid running agent state: startedAtMs is required.');
    }
    return { status: 'running', startedAtMs: state.startedAtMs };
  }

  return null;
}

export function deriveAgentActivity({
  rootThreadId,
  nodes,
  nowMs,
  inactivityTimeoutMs,
  rootTrackingError = false,
}: DeriveAgentActivityOptions): AgentActivity {
  const updatedAt = new Date(nowMs);
  if (rootTrackingError) {
    return {
      rows: [],
      visibleAgentCount: 0,
      rootTrackingError: true,
      updatedAt,
    };
  }

  const childrenByParent = new Map<string, AgentState[]>();
  for (const node of nodes) {
    const siblings = childrenByParent.get(node.parentThreadId);
    if (siblings) {
      siblings.push(node);
    } else {
      childrenByParent.set(node.parentThreadId, [node]);
    }
  }

  const rows: AgentActivityRow[] = [];
  let visibleAgentCount = 0;

  for (const directChild of childrenByParent.get(rootThreadId) ?? []) {
    const subtree: AgentState[] = [];
    const visit = (node: AgentState): void => {
      subtree.push(node);
      for (const child of childrenByParent.get(node.threadId) ?? []) {
        visit(child);
      }
    };
    visit(directChild);

    let hasError = false;
    let hasRunning = false;
    let oldestStartedAtMs: number | null = null;
    let activeDescendantCount = 0;
    let subtreeVisibleCount = 0;

    for (let index = 0; index < subtree.length; index++) {
      const visible = visibleAgentState(
        subtree[index],
        nowMs,
        inactivityTimeoutMs
      );
      if (!visible) {
        continue;
      }

      subtreeVisibleCount++;
      if (visible.status === 'tracking-error') {
        hasError = true;
        continue;
      }

      if (index > 0) {
        activeDescendantCount++;
      }
      if (visible.status === 'running') {
        hasRunning = true;
      }
      oldestStartedAtMs =
        oldestStartedAtMs === null
          ? visible.startedAtMs
          : Math.min(oldestStartedAtMs, visible.startedAtMs);
    }

    if (subtreeVisibleCount === 0) {
      continue;
    }

    visibleAgentCount += subtreeVisibleCount;
    const status: AgentDisplayStatus = hasError
      ? 'tracking-error'
      : hasRunning
        ? 'running'
        : 'starting';
    const row: AgentActivityRow = {
      threadId: directChild.threadId,
      agentPath: directChild.agentPath,
      label: directChild.label,
      status,
      activeDescendantCount,
    };
    if (oldestStartedAtMs !== null) {
      row.elapsedStartedAt = new Date(oldestStartedAtMs);
    }
    rows.push(row);
  }

  return {
    rows,
    visibleAgentCount,
    rootTrackingError: false,
    updatedAt,
  };
}

function isStartedActivityKind(value: unknown): boolean {
  if (value === 'started') {
    return true;
  }

  if (value === 'interacted' || value === 'interrupted') {
    return false;
  }

  throw new Error(
    'Invalid agent spawn activity: kind must be "started", "interacted", or "interrupted".'
  );
}

export function normalizeAgentSpawnSeed(record: unknown): AgentSpawnSeed | null {
  const entry = asRecord(record);
  if (entry?.type !== 'event_msg') {
    return null;
  }

  const payload = asRecord(entry.payload);
  if (payload?.type === 'sub_agent_activity') {
    if (!isStartedActivityKind(payload.kind)) {
      return null;
    }

    return createAgentSpawnSeed(
      payload.event_id,
      payload.occurred_at_ms,
      payload.agent_thread_id,
      payload.agent_path
    );
  }

  if (payload?.type !== 'item_completed') {
    return null;
  }

  const item = asRecord(payload.item);
  if (item?.type !== 'SubAgentActivity') {
    return null;
  }

  if (!isStartedActivityKind(item.kind)) {
    return null;
  }

  return createAgentSpawnSeed(
    item.id,
    payload.completed_at_ms,
    item.agent_thread_id,
    item.agent_path
  );
}

export function isSubagentSessionSource(source: SessionSource | undefined): boolean {
  return typeof source === 'object' && source !== null && 'subagent' in source;
}
