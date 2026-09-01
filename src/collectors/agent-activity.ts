import type {
  AgentActivity,
  AgentActivityRow,
  AgentDisplayStatus,
  SessionSource,
} from '../types.js';
import {
  findRolloutByThreadId,
  type SessionFile,
} from './session-finder.js';
import {
  readCompleteJsonl,
  type JsonlTailBatch,
} from '../utils/jsonl-tail.js';

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

  if (
    value === 'interacted' ||
    value === 'interrupted' ||
    value === 'completed'
  ) {
    return false;
  }

  throw new Error(
    'Invalid agent spawn activity: kind must be "started", "interacted", "interrupted", or "completed".'
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

export type RolloutResolver = (threadId: string) => SessionFile | null;
export type TrackingErrorLogger = (message: string) => void;

export interface AgentActivityCollectorOptions {
  inactivityTimeoutMs: number;
  resolveRollout?: RolloutResolver;
  logError?: TrackingErrorLogger;
}

interface RootTracker {
  session: SessionFile;
  offset: number;
  physicalTurnIds: Set<string>;
  canonicalValidated: boolean;
  forkedFromId: string | null;
  trackingError: string | null;
}

interface TrackedAgentNode extends AgentState {
  rolloutPath: string | null;
  offset: number;
  physicalTurnIds: Set<string>;
  canonicalValidated: boolean;
  localBoundaryFound: boolean;
}

interface RootForkBoundary {
  localBoundaryIndex: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error &&
    'code' in error &&
    error.code === 'ENOENT';
}

function requireCanonicalSessionMeta(
  records: readonly unknown[],
  expectedId: string,
  context: string
): JsonRecord {
  const entry = asRecord(records[0]);
  const payload = entry?.type === 'session_meta' ? asRecord(entry.payload) : null;
  if (!payload) {
    throw new Error(`${context} first complete record must be canonical SessionMeta.`);
  }

  if (payload.id !== expectedId) {
    throw new Error(
      `${context} canonical SessionMeta id mismatch: expected ${expectedId}, received ${String(payload.id)}.`
    );
  }

  return payload;
}

function optionalNonEmptyString(
  value: unknown,
  fieldName: string
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string when present.`);
  }

  return value;
}

function physicalLifecycleTurnId(record: unknown): string | null {
  const entry = asRecord(record);
  if (entry?.type !== 'event_msg') {
    return null;
  }

  const payload = asRecord(entry.payload);
  if (
    payload?.type !== 'task_started' &&
    payload?.type !== 'task_complete' &&
    payload?.type !== 'turn_aborted'
  ) {
    return null;
  }

  return typeof payload.turn_id === 'string' && payload.turn_id.trim().length > 0
    ? payload.turn_id
    : null;
}

function taskStartedTurnId(record: unknown): string | null {
  const entry = asRecord(record);
  if (entry?.type !== 'event_msg') {
    return null;
  }

  const payload = asRecord(entry.payload);
  if (payload?.type !== 'task_started') {
    return null;
  }

  return typeof payload.turn_id === 'string' && payload.turn_id.trim().length > 0
    ? payload.turn_id
    : null;
}

function collectPhysicalTurnIds(
  records: readonly unknown[],
  initial: ReadonlySet<string> = new Set<string>()
): Set<string> {
  const turnIds = new Set(initial);
  for (const record of records) {
    const turnId = physicalLifecycleTurnId(record);
    if (turnId !== null) {
      turnIds.add(turnId);
    }
  }
  return turnIds;
}

function findLocalBoundaryIndex(
  records: readonly unknown[],
  inheritedTurnIds: ReadonlySet<string>
): number {
  return records.findIndex((record) => {
    const turnId = taskStartedTurnId(record);
    return turnId !== null && !inheritedTurnIds.has(turnId);
  });
}

function validateChildCanonicalMeta(
  records: readonly unknown[],
  resolvedSessionId: string,
  node: TrackedAgentNode
): void {
  const context = `Agent ${node.threadId}`;
  if (resolvedSessionId !== node.threadId) {
    throw new Error(
      `${context} resolved rollout session mismatch: expected ${node.threadId}, received ${resolvedSessionId}.`
    );
  }

  const payload = requireCanonicalSessionMeta(records, node.threadId, context);
  const source = asRecord(payload.source);
  const subagent = asRecord(source?.subagent);
  const threadSpawn = asRecord(subagent?.thread_spawn);
  if (!threadSpawn) {
    throw new Error(
      `${context} canonical SessionMeta source must be subagent.thread_spawn.`
    );
  }

  if (threadSpawn.parent_thread_id !== node.parentThreadId) {
    throw new Error(
      `${context} canonical parent mismatch: expected ${node.parentThreadId}, received ${String(threadSpawn.parent_thread_id)}.`
    );
  }
  if (threadSpawn.agent_path !== node.agentPath) {
    throw new Error(
      `${context} canonical agent path mismatch: expected ${node.agentPath}, received ${String(threadSpawn.agent_path)}.`
    );
  }

  if (
    payload.parent_thread_id !== undefined &&
    payload.parent_thread_id !== node.parentThreadId
  ) {
    throw new Error(
      `${context} duplicate parent_thread_id mismatch: expected ${node.parentThreadId}, received ${String(payload.parent_thread_id)}.`
    );
  }
  if (payload.agent_path !== undefined && payload.agent_path !== node.agentPath) {
    throw new Error(
      `${context} duplicate agent_path mismatch: expected ${node.agentPath}, received ${String(payload.agent_path)}.`
    );
  }
}

function cloneNode(node: TrackedAgentNode): TrackedAgentNode {
  return {
    ...node,
    physicalTurnIds: new Set(node.physicalTurnIds),
  };
}

function defaultTrackingErrorLogger(message: string): void {
  console.error(message);
}

export class AgentActivityCollector {
  private readonly inactivityTimeoutMs: number;
  private readonly resolveRollout: RolloutResolver;
  private readonly logError: TrackingErrorLogger;
  private root: RootTracker | null = null;
  private readonly nodes = new Map<string, TrackedAgentNode>();

  constructor(options: AgentActivityCollectorOptions) {
    this.inactivityTimeoutMs = options.inactivityTimeoutMs;
    this.resolveRollout = options.resolveRollout ?? findRolloutByThreadId;
    this.logError = options.logError ?? defaultTrackingErrorLogger;
  }

  setRootSession(session: SessionFile | null): void {
    if (
      session !== null &&
      this.root !== null &&
      this.root.session.sessionId === session.sessionId &&
      this.root.session.path === session.path
    ) {
      this.root.session = session;
      return;
    }

    this.nodes.clear();
    this.root = session
      ? {
          session,
          offset: 0,
          physicalTurnIds: new Set<string>(),
          canonicalValidated: false,
          forkedFromId: null,
          trackingError: null,
        }
      : null;
  }

  async collect(nowMs: number = Date.now()): Promise<AgentActivity> {
    if (this.root === null) {
      return deriveAgentActivity({
        rootThreadId: '',
        nodes: [],
        nowMs,
        inactivityTimeoutMs: this.inactivityTimeoutMs,
      });
    }

    const rootReady = await this.collectRoot();
    if (!rootReady) {
      return deriveAgentActivity({
        rootThreadId: this.root.session.sessionId,
        nodes: [],
        nowMs,
        inactivityTimeoutMs: this.inactivityTimeoutMs,
        rootTrackingError: true,
      });
    }

    const queue = [...this.nodes.keys()];
    const queued = new Set(queue);
    for (let index = 0; index < queue.length; index++) {
      await this.collectNode(queue[index]);
      for (const threadId of this.nodes.keys()) {
        if (!queued.has(threadId)) {
          queued.add(threadId);
          queue.push(threadId);
        }
      }
    }

    return deriveAgentActivity({
      rootThreadId: this.root.session.sessionId,
      nodes: [...this.nodes.values()],
      nowMs,
      inactivityTimeoutMs: this.inactivityTimeoutMs,
    });
  }

  private async collectRoot(): Promise<boolean> {
    const root = this.root;
    if (root === null) {
      return false;
    }

    const batch = await readCompleteJsonl<unknown>(
      root.session.path,
      root.offset
    );
    if (batch.truncated && root.offset > 0) {
      throw new Error(
        `Root rollout ${root.session.path} was truncated below committed offset ${root.offset}.`
      );
    }

    const candidate: RootTracker = {
      ...root,
      physicalTurnIds: collectPhysicalTurnIds(
        batch.records,
        root.physicalTurnIds
      ),
    };
    let eligibleStartIndex = 0;

    if (!root.canonicalValidated) {
      const payload = requireCanonicalSessionMeta(
        batch.records,
        root.session.sessionId,
        `Root ${root.session.sessionId}`
      );
      candidate.canonicalValidated = true;
      candidate.forkedFromId = optionalNonEmptyString(
        payload.forked_from_id,
        `Root ${root.session.sessionId} forked_from_id`
      );

      if (candidate.forkedFromId !== null) {
        try {
          const boundary = await this.resolveRootForkBoundary(
            candidate.forkedFromId,
            batch.records
          );
          eligibleStartIndex = boundary.localBoundaryIndex;
        } catch (error) {
          this.setRootTrackingError(
            `Root fork source ${candidate.forkedFromId}: ${errorMessage(error)}`
          );
          return false;
        }
      }
    }

    const seeds: AgentSpawnSeed[] = [];
    for (const record of batch.records.slice(eligibleStartIndex)) {
      const seed = normalizeAgentSpawnSeed(record);
      if (seed !== null) {
        seeds.push(seed);
      }
    }

    const stagedNodes = this.stageSeeds(seeds, candidate.session.sessionId);
    candidate.offset = batch.nextOffset;
    candidate.trackingError = null;
    this.root = candidate;
    this.applyStagedNodes(stagedNodes);
    this.clearRootTrackingError(root.trackingError, candidate.forkedFromId);
    return true;
  }

  private async resolveRootForkBoundary(
    sourceThreadId: string,
    rootRecords: readonly unknown[]
  ): Promise<RootForkBoundary> {
    const source = this.resolveRollout(sourceThreadId);
    if (source === null) {
      throw new Error('exact active/archive rollout is unavailable.');
    }
    if (source.sessionId !== sourceThreadId) {
      throw new Error(
        `resolved rollout session mismatch: expected ${sourceThreadId}, received ${source.sessionId}.`
      );
    }

    const sourceBatch = await readCompleteJsonl<unknown>(source.path, 0);
    requireCanonicalSessionMeta(
      sourceBatch.records,
      sourceThreadId,
      `Root fork source ${sourceThreadId}`
    );
    const sourceTurnIds = collectPhysicalTurnIds(sourceBatch.records);
    const localBoundaryIndex = findLocalBoundaryIndex(rootRecords, sourceTurnIds);
    if (localBoundaryIndex < 0) {
      throw new Error('root-local task_started boundary is not yet available.');
    }

    return {
      localBoundaryIndex,
    };
  }

  private async collectNode(threadId: string): Promise<void> {
    const current = this.nodes.get(threadId);
    const root = this.root;
    if (!current || root === null) {
      return;
    }

    const parent =
      current.parentThreadId === root.session.sessionId
        ? root
        : this.nodes.get(current.parentThreadId);
    if (!parent) {
      this.setNodeTrackingError(
        current,
        `expected parent ${current.parentThreadId} is not tracked.`
      );
      return;
    }
    if (!current.localBoundaryFound && parent.trackingError !== null) {
      return;
    }

    try {
      let rolloutPath = current.rolloutPath;
      let resolvedSessionId: string | null = null;
      let readOffset = current.offset;
      let relocated = false;
      if (rolloutPath === null) {
        const resolved = this.resolveRollout(current.threadId);
        if (resolved === null) {
          throw new Error('exact active/archive rollout is unavailable.');
        }
        rolloutPath = resolved.path;
        resolvedSessionId = resolved.sessionId;
      }

      let batch: JsonlTailBatch<unknown>;
      try {
        batch = await readCompleteJsonl<unknown>(rolloutPath, readOffset);
      } catch (error) {
        if (current.rolloutPath === null || !isMissingFileError(error)) {
          throw error;
        }

        const resolved = this.resolveRollout(current.threadId);
        if (resolved === null) {
          throw new Error('exact active/archive rollout is unavailable.');
        }
        if (resolved.sessionId !== current.threadId) {
          throw new Error(
            `Agent ${current.threadId} resolved rollout session mismatch: expected ${current.threadId}, received ${resolved.sessionId}.`
          );
        }

        rolloutPath = resolved.path;
        resolvedSessionId = resolved.sessionId;
        const canonicalBatch = await readCompleteJsonl<unknown>(rolloutPath, 0);
        validateChildCanonicalMeta(
          canonicalBatch.records,
          resolvedSessionId,
          current
        );
        batch = await readCompleteJsonl<unknown>(rolloutPath, readOffset);
        relocated = true;
      }
      if (batch.truncated && readOffset > 0) {
        throw new Error(
          `rollout was truncated below committed offset ${readOffset}.`
        );
      }

      let candidate = cloneNode(current);
      if (relocated) {
        candidate.canonicalValidated = true;
        candidate.rolloutPath = rolloutPath;
      } else if (!candidate.canonicalValidated) {
        if (resolvedSessionId === null) {
          throw new Error(
            'unvalidated agent rollout must be resolved before canonical validation.'
          );
        }
        validateChildCanonicalMeta(batch.records, resolvedSessionId, candidate);
        candidate.canonicalValidated = true;
        candidate.rolloutPath = rolloutPath;
      }
      candidate.physicalTurnIds = collectPhysicalTurnIds(
        batch.records,
        candidate.physicalTurnIds
      );

      let eligibleStartIndex = 0;
      if (!candidate.localBoundaryFound) {
        eligibleStartIndex = findLocalBoundaryIndex(
          batch.records,
          parent.physicalTurnIds
        );
        if (eligibleStartIndex < 0) {
          candidate.offset = batch.nextOffset;
          candidate.trackingError = null;
          this.commitNodeSuccess(current, candidate);
          return;
        }
        candidate.localBoundaryFound = true;
      }

      const seeds: AgentSpawnSeed[] = [];
      for (const record of batch.records.slice(eligibleStartIndex)) {
        const reduced = reduceAgentLifecycleRecord(candidate, record);
        candidate = { ...candidate, ...reduced };
        const seed = normalizeAgentSpawnSeed(record);
        if (seed !== null) {
          seeds.push(seed);
        }
      }

      const stagedNodes = this.stageSeeds(seeds, candidate.threadId);
      candidate.offset = batch.nextOffset;
      candidate.trackingError = null;
      this.commitNodeSuccess(current, candidate, stagedNodes);
    } catch (error) {
      this.setNodeTrackingError(current, errorMessage(error));
    }
  }

  private stageSeeds(
    seeds: readonly AgentSpawnSeed[],
    parentThreadId: string
  ): TrackedAgentNode[] {
    const stagedNodes: TrackedAgentNode[] = [];
    const stagedThreadIds = new Set<string>();
    for (const seed of seeds) {
      if (
        this.nodes.has(seed.childThreadId) ||
        stagedThreadIds.has(seed.childThreadId)
      ) {
        continue;
      }

      stagedNodes.push({
        ...createAgentState(seed, parentThreadId),
        rolloutPath: null,
        offset: 0,
        physicalTurnIds: new Set<string>(),
        canonicalValidated: false,
        localBoundaryFound: false,
      });
      stagedThreadIds.add(seed.childThreadId);
    }
    return stagedNodes;
  }

  private applyStagedNodes(stagedNodes: readonly TrackedAgentNode[]): void {
    for (const node of stagedNodes) {
      this.nodes.set(node.threadId, node);
    }
  }

  private setNodeTrackingError(
    node: TrackedAgentNode,
    concreteCause: string
  ): void {
    if (node.trackingError === concreteCause) {
      return;
    }

    this.nodes.set(node.threadId, {
      ...node,
      trackingError: concreteCause,
    });
    this.logError(
      `Agent ${node.threadId} tracking error: ${concreteCause}`
    );
  }

  private commitNodeSuccess(
    previous: TrackedAgentNode,
    candidate: TrackedAgentNode,
    stagedNodes: readonly TrackedAgentNode[] = []
  ): void {
    this.nodes.set(candidate.threadId, candidate);
    this.applyStagedNodes(stagedNodes);
    if (previous.trackingError !== null) {
      this.logError(`Agent ${candidate.threadId} tracking recovered.`);
    }
  }

  private setRootTrackingError(concreteCause: string): void {
    const root = this.root;
    if (root === null || root.trackingError === concreteCause) {
      return;
    }

    this.root = {
      ...root,
      trackingError: concreteCause,
    };
    this.logError(`Agent root tracking error: ${concreteCause}`);
  }

  private clearRootTrackingError(
    previousError: string | null,
    sourceThreadId: string | null
  ): void {
    if (previousError !== null) {
      this.logError(
        sourceThreadId === null
          ? 'Agent root tracking recovered.'
          : `Root fork source ${sourceThreadId} tracking recovered.`
      );
    }
  }
}
