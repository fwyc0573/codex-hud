import type { SessionSource } from '../types.js';

export interface AgentSpawnSeed {
  eventId: string;
  occurredAtMs: number;
  childThreadId: string;
  agentPath: string;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null ? (value as JsonRecord) : null;
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
