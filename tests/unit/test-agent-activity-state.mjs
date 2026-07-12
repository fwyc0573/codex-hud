import assert from 'node:assert/strict';

import {
  createAgentState,
  deriveAgentActivity,
  isRunningVisible,
  reduceAgentLifecycleRecord,
} from '../../dist/collectors/agent-activity.js';
import {
  taskComplete,
  taskStarted,
  turnAborted,
} from '../helpers/agent-rollout-fixture.mjs';

const failures = [];
let passed = 0;

function check(name, test) {
  try {
    test();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL: ${name}`);
    console.error(error);
  }
}

function seed({
  childThreadId,
  agentPath = `/root/${childThreadId}`,
  occurredAtMs = 1_000,
} = {}) {
  return {
    eventId: `call_${childThreadId}`,
    occurredAtMs,
    childThreadId,
    agentPath,
  };
}

function makeState({
  threadId,
  parentThreadId,
  agentPath = `/root/${threadId}`,
  seedAtMs = 1_000,
  lifecycle = 'starting',
  activeTurnId = null,
  startedAtMs = seedAtMs,
  lastCompleteLocalRecordAtMs = null,
  trackingError = null,
} = {}) {
  return {
    ...createAgentState(
      seed({ childThreadId: threadId, agentPath, occurredAtMs: seedAtMs }),
      parentThreadId
    ),
    lifecycle,
    activeTurnId,
    startedAtMs,
    lastCompleteLocalRecordAtMs,
    trackingError,
  };
}

check('typed seed creates a visible starting state with a leaf label', () => {
  const state = createAgentState(
    seed({
      childThreadId: 'direct',
      agentPath: '/root/direct',
      occurredAtMs: 12_345,
    }),
    'root'
  );

  assert.deepEqual(state, {
    threadId: 'direct',
    parentThreadId: 'root',
    agentPath: '/root/direct',
    label: 'direct',
    lifecycle: 'starting',
    activeTurnId: null,
    startedAtMs: 12_345,
    lastCompleteLocalRecordAtMs: null,
    trackingError: null,
  });

  const activity = deriveAgentActivity({
    rootThreadId: 'root',
    nodes: [state],
    nowMs: 10_000_000,
    inactivityTimeoutMs: 1,
  });
  assert.equal(activity.rows[0].status, 'starting');
  assert.equal(activity.rows[0].elapsedStartedAt.getTime(), 12_345);
});

check('local task_started enters running and resets the timer', () => {
  const starting = makeState({
    threadId: 'direct',
    parentThreadId: 'root',
    seedAtMs: 1_000,
  });
  const running = reduceAgentLifecycleRecord(
    starting,
    taskStarted({
      turnId: 'turn-1',
      startedAt: 2,
      timestamp: '1970-01-01T00:00:02.500Z',
    })
  );

  assert.equal(running.lifecycle, 'running');
  assert.equal(running.activeTurnId, 'turn-1');
  assert.equal(running.startedAtMs, 2_000);
  assert.equal(running.lastCompleteLocalRecordAtMs, 2_500);
  assert.equal(starting.lifecycle, 'starting', 'the reducer must not mutate input state');
});

check('null and absent started_at use the same record outer timestamp', () => {
  const starting = makeState({ threadId: 'direct', parentThreadId: 'root' });
  const outerTimestamp = '2026-07-12T01:02:03.456Z';
  const expectedMs = Date.parse(outerTimestamp);
  const nullStartedAt = reduceAgentLifecycleRecord(
    starting,
    taskStarted({ turnId: 'turn-null', startedAt: null, timestamp: outerTimestamp })
  );
  const missingStartedAtRecord = taskStarted({
    turnId: 'turn-missing',
    timestamp: outerTimestamp,
  });
  delete missingStartedAtRecord.payload.started_at;
  const missingStartedAt = reduceAgentLifecycleRecord(starting, missingStartedAtRecord);

  assert.equal(nullStartedAt.startedAtMs, expectedMs);
  assert.equal(nullStartedAt.lastCompleteLocalRecordAtMs, expectedMs);
  assert.equal(missingStartedAt.startedAtMs, expectedMs);
  assert.equal(missingStartedAt.lastCompleteLocalRecordAtMs, expectedMs);
  console.log(
    `METRIC null-started-at expected=${expectedMs} actual=${nullStartedAt.startedAtMs}`
  );
});

check('null started_at with an invalid outer timestamp fails explicitly', () => {
  const starting = makeState({ threadId: 'direct', parentThreadId: 'root' });
  assert.throws(
    () =>
      reduceAgentLifecycleRecord(
        starting,
        taskStarted({ turnId: 'turn-invalid', startedAt: null, timestamp: 'invalid' })
      ),
    /timestamp/i
  );
  assert.equal(starting.lifecycle, 'starting');
});

check('only a matching complete terminates the active turn', () => {
  const running = makeState({
    threadId: 'direct',
    parentThreadId: 'root',
    lifecycle: 'running',
    activeTurnId: 'turn-active',
    startedAtMs: 2_000,
    lastCompleteLocalRecordAtMs: 2_500,
  });
  const mismatched = reduceAgentLifecycleRecord(
    running,
    taskComplete({
      turnId: 'turn-other',
      timestamp: '1970-01-01T00:00:03.000Z',
    })
  );
  const completed = reduceAgentLifecycleRecord(
    mismatched,
    taskComplete({
      turnId: 'turn-active',
      timestamp: '1970-01-01T00:00:04.000Z',
    })
  );

  assert.equal(mismatched.lifecycle, 'running');
  assert.equal(mismatched.activeTurnId, 'turn-active');
  assert.equal(completed.lifecycle, 'idle');
  assert.equal(completed.activeTurnId, null);
  assert.equal(completed.startedAtMs, null);
  assert.equal(completed.lastCompleteLocalRecordAtMs, null);
  assert.equal(
    deriveAgentActivity({
      rootThreadId: 'root',
      nodes: [completed],
      nowMs: 4_000,
      inactivityTimeoutMs: 900_000,
    }).rows.length,
    0
  );
});

check('matching and null-ID aborts terminate while mismatched abort does not', () => {
  const running = makeState({
    threadId: 'direct',
    parentThreadId: 'root',
    lifecycle: 'running',
    activeTurnId: 'turn-active',
    startedAtMs: 2_000,
    lastCompleteLocalRecordAtMs: 2_500,
  });
  const mismatched = reduceAgentLifecycleRecord(
    running,
    turnAborted({
      turnId: 'turn-other',
      timestamp: '1970-01-01T00:00:03.000Z',
    })
  );
  const matching = reduceAgentLifecycleRecord(
    running,
    turnAborted({
      turnId: 'turn-active',
      timestamp: '1970-01-01T00:00:04.000Z',
    })
  );
  const withoutId = reduceAgentLifecycleRecord(
    running,
    turnAborted({
      turnId: null,
      timestamp: '1970-01-01T00:00:05.000Z',
    })
  );

  assert.equal(mismatched.lifecycle, 'running');
  assert.equal(matching.lifecycle, 'idle');
  assert.equal(matching.activeTurnId, null);
  assert.equal(matching.startedAtMs, null);
  assert.equal(matching.lastCompleteLocalRecordAtMs, null);
  assert.equal(withoutId.lifecycle, 'idle');
  assert.equal(withoutId.activeTurnId, null);
  assert.equal(withoutId.startedAtMs, null);
  assert.equal(withoutId.lastCompleteLocalRecordAtMs, null);
});

check('a follow-up task_started makes a terminal thread visible with a reset timer', () => {
  const idle = makeState({
    threadId: 'direct',
    parentThreadId: 'root',
    lifecycle: 'idle',
    activeTurnId: null,
    startedAtMs: null,
    lastCompleteLocalRecordAtMs: null,
  });
  const followUp = reduceAgentLifecycleRecord(
    idle,
    taskStarted({
      turnId: 'turn-follow-up',
      startedAt: 20,
      timestamp: '1970-01-01T00:00:20.250Z',
    })
  );

  assert.equal(followUp.lifecycle, 'running');
  assert.equal(followUp.activeTurnId, 'turn-follow-up');
  assert.equal(followUp.startedAtMs, 20_000);
  assert.equal(followUp.lastCompleteLocalRecordAtMs, 20_250);
});

check('running visibility is strict at the configured timeout boundary', () => {
  const running = makeState({
    threadId: 'direct',
    parentThreadId: 'root',
    lifecycle: 'running',
    activeTurnId: 'turn-active',
    startedAtMs: 1_000,
    lastCompleteLocalRecordAtMs: 0,
  });

  assert.equal(isRunningVisible(running, 899_999, 900_000), true);
  assert.equal(isRunningVisible(running, 900_000, 900_000), false);
  console.log('METRIC timeout visibleAt=899999 hiddenAt=900000 timeout=900000');
});

check('a new complete local record restores visibility without resetting start', () => {
  const hidden = makeState({
    threadId: 'direct',
    parentThreadId: 'root',
    lifecycle: 'running',
    activeTurnId: 'turn-active',
    startedAtMs: 1_000,
    lastCompleteLocalRecordAtMs: 0,
  });
  assert.equal(isRunningVisible(hidden, 900_000, 900_000), false);

  const refreshed = reduceAgentLifecycleRecord(hidden, {
    timestamp: '1970-01-01T00:15:00.000Z',
    type: 'event_msg',
    payload: { type: 'token_count' },
  });

  assert.equal(refreshed.startedAtMs, 1_000);
  assert.equal(refreshed.lastCompleteLocalRecordAtMs, 900_000);
  assert.equal(isRunningVisible(refreshed, 900_000, 900_000), true);
});

check('malformed recognized lifecycle fields fail without mutating state', () => {
  const starting = makeState({ threadId: 'direct', parentThreadId: 'root' });
  const malformed = [
    null,
    { type: 'event_msg', payload: { type: 'token_count' } },
    { timestamp: '1970-01-01T00:00:01.000Z', type: 'event_msg', payload: null },
    taskStarted({ turnId: '', timestamp: '1970-01-01T00:00:01.000Z' }),
    taskStarted({ startedAt: 1.5, timestamp: '1970-01-01T00:00:01.000Z' }),
    taskComplete({ turnId: '', timestamp: '1970-01-01T00:00:01.000Z' }),
  ];

  for (const record of malformed) {
    assert.throws(() => reduceAgentLifecycleRecord(starting, record), /Invalid/);
  }
  assert.equal(starting.lifecycle, 'starting');
  assert.equal(starting.startedAtMs, 1_000);
});

check('tracking error remains separate from lifecycle and ignores timeout', () => {
  const timedOutRunning = makeState({
    threadId: 'direct',
    parentThreadId: 'root',
    lifecycle: 'running',
    activeTurnId: 'turn-active',
    startedAtMs: 1_000,
    lastCompleteLocalRecordAtMs: 0,
    trackingError: 'rollout unavailable',
  });
  const activity = deriveAgentActivity({
    rootThreadId: 'root',
    nodes: [timedOutRunning],
    nowMs: 10_000_000,
    inactivityTimeoutMs: 1,
  });
  const recovered = deriveAgentActivity({
    rootThreadId: 'root',
    nodes: [{ ...timedOutRunning, trackingError: null }],
    nowMs: 10_000_000,
    inactivityTimeoutMs: 1,
  });

  assert.equal(activity.rows[0].status, 'tracking-error');
  assert.equal(activity.rows[0].activeDescendantCount, 0);
  assert.equal(activity.visibleAgentCount, 1);
  assert.equal(timedOutRunning.lifecycle, 'running');
  assert.equal(recovered.rows.length, 0);
  assert.equal(recovered.visibleAgentCount, 0);
});

check('terminal direct child aggregates all visible active generations', () => {
  const direct = makeState({
    threadId: 'direct',
    parentThreadId: 'root',
    lifecycle: 'idle',
    activeTurnId: null,
    startedAtMs: null,
    lastCompleteLocalRecordAtMs: null,
  });
  const child = makeState({
    threadId: 'child',
    parentThreadId: 'direct',
    lifecycle: 'starting',
    startedAtMs: 4_000,
  });
  const grandchild = makeState({
    threadId: 'grandchild',
    parentThreadId: 'child',
    lifecycle: 'running',
    activeTurnId: 'turn-grandchild',
    startedAtMs: 2_000,
    lastCompleteLocalRecordAtMs: 9_500,
  });
  const activity = deriveAgentActivity({
    rootThreadId: 'root',
    nodes: [direct, child, grandchild],
    nowMs: 10_000,
    inactivityTimeoutMs: 900_000,
  });

  assert.equal(activity.rows.length, 1);
  assert.equal(activity.rows[0].threadId, 'direct');
  assert.equal(activity.rows[0].status, 'running');
  assert.equal(activity.rows[0].activeDescendantCount, 2);
  assert.equal(activity.rows[0].elapsedStartedAt.getTime(), 2_000);
  assert.equal(activity.visibleAgentCount, 2);
  assert.equal(activity.updatedAt.getTime(), 10_000);
  console.log(
    `METRIC aggregate visibleNodes=${activity.visibleAgentCount} descendants=${activity.rows[0].activeDescendantCount} oldestStart=${activity.rows[0].elapsedStartedAt.getTime()}`
  );
});

check('descendant error bubbles with precedence and is excluded from active count', () => {
  const direct = makeState({
    threadId: 'direct',
    parentThreadId: 'root',
    lifecycle: 'idle',
    activeTurnId: null,
    startedAtMs: null,
    lastCompleteLocalRecordAtMs: null,
  });
  const child = makeState({
    threadId: 'child',
    parentThreadId: 'direct',
    lifecycle: 'starting',
    startedAtMs: 4_000,
  });
  const grandchildError = makeState({
    threadId: 'grandchild',
    parentThreadId: 'child',
    lifecycle: 'running',
    activeTurnId: 'turn-grandchild',
    startedAtMs: 2_000,
    lastCompleteLocalRecordAtMs: 9_500,
    trackingError: 'malformed rollout',
  });
  const activity = deriveAgentActivity({
    rootThreadId: 'root',
    nodes: [direct, child, grandchildError],
    nowMs: 10_000,
    inactivityTimeoutMs: 900_000,
  });

  assert.equal(activity.rows[0].status, 'tracking-error');
  assert.equal(activity.rows[0].activeDescendantCount, 1);
  assert.equal(activity.rows[0].elapsedStartedAt.getTime(), 4_000);
  assert.equal(activity.visibleAgentCount, 2);
});

check('an error-only subtree has no elapsed active timer', () => {
  const errorOnly = makeState({
    threadId: 'direct',
    parentThreadId: 'root',
    lifecycle: 'idle',
    activeTurnId: null,
    startedAtMs: null,
    lastCompleteLocalRecordAtMs: null,
    trackingError: 'rollout unavailable',
  });
  const activity = deriveAgentActivity({
    rootThreadId: 'root',
    nodes: [errorOnly],
    nowMs: 10_000,
    inactivityTimeoutMs: 900_000,
  });

  assert.equal(activity.rows[0].status, 'tracking-error');
  assert.equal(activity.rows[0].elapsedStartedAt, undefined);
  assert.equal(activity.rows[0].activeDescendantCount, 0);
  assert.equal(activity.visibleAgentCount, 1);
});

check('direct rows preserve successful seed order and omit inactive subtrees', () => {
  const first = makeState({
    threadId: 'first',
    parentThreadId: 'root',
    seedAtMs: 2_000,
  });
  const second = makeState({
    threadId: 'second',
    parentThreadId: 'root',
    seedAtMs: 1_000,
  });
  const inactive = makeState({
    threadId: 'inactive',
    parentThreadId: 'root',
    lifecycle: 'idle',
    activeTurnId: null,
    startedAtMs: null,
    lastCompleteLocalRecordAtMs: null,
  });
  const activity = deriveAgentActivity({
    rootThreadId: 'root',
    nodes: [first, second, inactive],
    nowMs: 3_000,
    inactivityTimeoutMs: 900_000,
  });

  assert.deepEqual(
    activity.rows.map((row) => row.threadId),
    ['first', 'second']
  );
  assert.deepEqual(
    activity.rows.map((row) => row.activeDescendantCount),
    [0, 0]
  );
  assert.equal(activity.visibleAgentCount, 2);
});

check('root tracking error suppresses untrusted rows and numeric count', () => {
  const direct = makeState({ threadId: 'direct', parentThreadId: 'root' });
  const activity = deriveAgentActivity({
    rootThreadId: 'root',
    nodes: [direct],
    nowMs: 5_000,
    inactivityTimeoutMs: 900_000,
    rootTrackingError: true,
  });

  assert.deepEqual(activity.rows, []);
  assert.equal(activity.visibleAgentCount, 0);
  assert.equal(activity.rootTrackingError, true);
  assert.equal(activity.updatedAt.getTime(), 5_000);
});

if (failures.length > 0) {
  console.error(
    `test-agent-activity-state: FAIL (${passed}/${passed + failures.length} passed)`
  );
  process.exitCode = 1;
} else {
  console.log(`test-agent-activity-state: PASS (${passed}/${passed} passed)`);
}
