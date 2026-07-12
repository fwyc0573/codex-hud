import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  appendRolloutRecords,
  appendRolloutText,
  canonicalSessionMeta,
  cleanupAgentTestRoot,
  legacyAgentStart,
  makeAgentTestRoot,
  overwriteRolloutRecords,
  paginatedAgentStart,
  rolloutSessionFile,
  taskComplete,
  taskStarted,
  turnAborted,
  writeRolloutFile,
} from '../helpers/agent-rollout-fixture.mjs';

const {
  AgentActivityCollector,
} = await import('../../dist/collectors/agent-activity.js');

assert.equal(
  typeof AgentActivityCollector,
  'function',
  'AgentActivityCollector must expose the recursive collection API'
);

const failures = [];
let passed = 0;

async function check(name, test) {
  try {
    await test();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL: ${name}`);
    console.error(error);
  }
}

function thread(index) {
  return `10000000-0000-7000-8000-${String(index).padStart(12, '0')}`;
}

function timestamp(ms) {
  return new Date(ms).toISOString();
}

function spawnedSource(parentThreadId, agentPath, depth = 1) {
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

function childMeta({ id, parentThreadId, agentPath, depth = 1, ...overrides }) {
  return canonicalSessionMeta({
    id,
    source: spawnedSource(parentThreadId, agentPath, depth),
    parentThreadId,
    agentPath,
    ...overrides,
  });
}

function activityRecord(timestampMs) {
  return {
    timestamp: timestamp(timestampMs),
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [],
    },
  };
}

function createResolver(files, calls) {
  return (threadId) => {
    calls.push(threadId);
    const file = files.get(threadId);
    return file ? rolloutSessionFile(file.path, file.sessionId ?? threadId) : null;
  };
}

function logCount(logs, fragment) {
  return logs.filter((message) => message.includes(fragment)).length;
}

const testRoot = makeAgentTestRoot();

try {
  await check('collects one authoritative recursive tree across root and child fork history', async () => {
    const SOURCE = thread(1);
    const ROOT = thread(2);
    const COPIED_LEGACY = thread(3);
    const COPIED_PAGINATED = thread(4);
    const COPIED_CHILD_LEGACY = thread(5);
    const COPIED_CHILD_PAGINATED = thread(6);
    const COPIED_GRANDCHILD = thread(7);
    const DIRECT_A = thread(10);
    const DIRECT_B = thread(11);
    const GRANDCHILD_A = thread(12);
    const PARTIAL_CHILD = thread(13);
    const TRANSACTION_CHILD = thread(14);
    const NEW_ROOT = thread(15);
    const NEW_CHILD = thread(16);

    const sourceTurn = 'source-turn';
    const rootTurn = 'root-turn';
    const directATurn = 'direct-a-turn';
    const directBTurn = 'direct-b-turn';
    const grandchildTurn = 'grandchild-turn';
    const partialTurn = 'partial-turn';
    const transactionTurn = 'transaction-turn';

    const copiedLegacy = legacyAgentStart({
      eventId: 'call_copied_legacy',
      childThreadId: COPIED_LEGACY,
      agentPath: '/root/copied_legacy',
      occurredAtMs: 1_000,
      timestamp: timestamp(1_000),
    });
    const copiedPaginated = paginatedAgentStart({
      eventId: 'call_copied_paginated',
      childThreadId: COPIED_PAGINATED,
      agentPath: '/root/copied_paginated',
      occurredAtMs: 1_100,
      parentThreadId: SOURCE,
      turnId: sourceTurn,
      timestamp: timestamp(1_100),
    });
    const sourcePath = writeRolloutFile(testRoot, {
      sessionId: SOURCE,
      storage: 'archived_sessions',
      relativeDir: '2017/01/02',
      timestampLabel: '2017-01-02T03-04-05',
      records: [
        canonicalSessionMeta({ id: SOURCE }),
        taskStarted({
          turnId: sourceTurn,
          startedAt: 1,
          timestamp: timestamp(1_000),
        }),
        copiedLegacy,
        copiedPaginated,
        taskComplete({ turnId: sourceTurn, timestamp: timestamp(1_500) }),
      ],
    });

    const directASeed = legacyAgentStart({
      eventId: 'call_direct_a',
      childThreadId: DIRECT_A,
      agentPath: '/root/direct_a',
      occurredAtMs: 3_100,
      timestamp: timestamp(3_100),
    });
    const directBSeed = paginatedAgentStart({
      eventId: 'call_direct_b',
      childThreadId: DIRECT_B,
      agentPath: '/root/direct_b',
      occurredAtMs: 3_200,
      parentThreadId: ROOT,
      turnId: rootTurn,
      timestamp: timestamp(3_200),
    });
    const rootPath = writeRolloutFile(testRoot, {
      sessionId: ROOT,
      relativeDir: '2026/07/12',
      timestampLabel: '2026-07-12T01-00-00',
      records: [
        canonicalSessionMeta({ id: ROOT, forkedFromId: SOURCE }),
        taskStarted({
          turnId: sourceTurn,
          startedAt: 1,
          timestamp: timestamp(1_000),
        }),
        copiedLegacy,
        copiedPaginated,
        taskComplete({ turnId: sourceTurn, timestamp: timestamp(1_500) }),
        taskStarted({
          turnId: rootTurn,
          startedAt: 3,
          timestamp: timestamp(3_000),
        }),
        directASeed,
        directBSeed,
      ],
    });

    const copiedChildLegacy = legacyAgentStart({
      eventId: 'call_copied_child_legacy',
      childThreadId: COPIED_CHILD_LEGACY,
      agentPath: '/root/copied_child_legacy',
      occurredAtMs: 3_300,
      timestamp: timestamp(3_300),
    });
    const copiedChildPaginated = paginatedAgentStart({
      eventId: 'call_copied_child_paginated',
      childThreadId: COPIED_CHILD_PAGINATED,
      agentPath: '/root/copied_child_paginated',
      occurredAtMs: 3_400,
      parentThreadId: ROOT,
      turnId: rootTurn,
      timestamp: timestamp(3_400),
    });
    const grandchildSeed = legacyAgentStart({
      eventId: 'call_grandchild_a',
      childThreadId: GRANDCHILD_A,
      agentPath: '/root/direct_a/grandchild_a',
      occurredAtMs: 5_100,
      timestamp: timestamp(5_100),
    });
    const directAPath = writeRolloutFile(testRoot, {
      sessionId: DIRECT_A,
      relativeDir: '2026/07/12',
      timestampLabel: '2026-07-12T01-01-00',
      records: [
        childMeta({
          id: DIRECT_A,
          parentThreadId: ROOT,
          agentPath: '/root/direct_a',
        }),
        taskStarted({
          turnId: sourceTurn,
          startedAt: 1,
          timestamp: timestamp(1_000),
        }),
        copiedChildLegacy,
        taskStarted({
          turnId: rootTurn,
          startedAt: 3,
          timestamp: timestamp(3_000),
        }),
        copiedChildPaginated,
        taskStarted({
          turnId: directATurn,
          startedAt: 5,
          timestamp: timestamp(5_000),
        }),
        grandchildSeed,
      ],
    });

    const copiedGrandchild = legacyAgentStart({
      eventId: 'call_copied_grandchild',
      childThreadId: COPIED_GRANDCHILD,
      agentPath: '/root/copied_grandchild',
      occurredAtMs: 5_200,
      timestamp: timestamp(5_200),
    });
    const grandchildPath = writeRolloutFile(testRoot, {
      sessionId: GRANDCHILD_A,
      storage: 'archived_sessions',
      relativeDir: '2018/02/03',
      timestampLabel: '2018-02-03T04-05-06',
      records: [
        childMeta({
          id: GRANDCHILD_A,
          parentThreadId: DIRECT_A,
          agentPath: '/root/direct_a/grandchild_a',
          depth: 2,
        }),
        taskStarted({
          turnId: sourceTurn,
          startedAt: 1,
          timestamp: timestamp(1_000),
        }),
        copiedGrandchild,
        taskStarted({
          turnId: rootTurn,
          startedAt: 3,
          timestamp: timestamp(3_000),
        }),
        taskStarted({
          turnId: directATurn,
          startedAt: 5,
          timestamp: timestamp(5_000),
        }),
        taskStarted({
          turnId: grandchildTurn,
          startedAt: 6,
          timestamp: timestamp(6_000),
        }),
      ],
    });

    const files = new Map([
      [SOURCE, { path: sourcePath }],
      [DIRECT_A, { path: directAPath }],
      [GRANDCHILD_A, { path: grandchildPath }],
    ]);
    const resolverCalls = [];
    const logs = [];
    const collector = new AgentActivityCollector({
      inactivityTimeoutMs: 2_000,
      resolveRollout: createResolver(files, resolverCalls),
      logError: (message) => logs.push(message),
    });
    const rootSession = rolloutSessionFile(rootPath, ROOT);
    collector.setRootSession(rootSession);

    const initial = await collector.collect(6_000);
    assert.equal(initial.rootTrackingError, false);
    assert.equal(initial.visibleAgentCount, 3);
    assert.deepEqual(
      initial.rows.map((row) => [row.threadId, row.status, row.activeDescendantCount]),
      [
        [DIRECT_A, 'running', 1],
        [DIRECT_B, 'tracking-error', 0],
      ]
    );
    assert.ok(resolverCalls.indexOf(DIRECT_A) < resolverCalls.indexOf(GRANDCHILD_A));
    assert.equal(resolverCalls.filter((id) => id === DIRECT_A).length, 1);
    assert.equal(resolverCalls.filter((id) => id === GRANDCHILD_A).length, 1);
    assert.equal(logCount(logs, DIRECT_B), 1);
    for (const copiedId of [
      COPIED_LEGACY,
      COPIED_PAGINATED,
      COPIED_CHILD_LEGACY,
      COPIED_CHILD_PAGINATED,
      COPIED_GRANDCHILD,
    ]) {
      assert.equal(resolverCalls.filter((id) => id === copiedId).length, 0);
      assert.equal(logCount(logs, copiedId), 0);
    }
    assert.match(sourcePath, /archived_sessions/);
    assert.match(directAPath, /sessions/);
    assert.match(grandchildPath, /archived_sessions/);

    const idleRepoll = await collector.collect(6_000);
    assert.equal(idleRepoll.visibleAgentCount, 3);
    assert.equal(logCount(logs, DIRECT_B), 1);
    assert.equal(resolverCalls.filter((id) => id === DIRECT_A).length, 1);
    assert.equal(resolverCalls.filter((id) => id === GRANDCHILD_A).length, 1);

    const directBPath = writeRolloutFile(testRoot, {
      sessionId: DIRECT_B,
      relativeDir: '2026/07/12',
      timestampLabel: '2026-07-12T01-02-00',
      records: [
        childMeta({
          id: DIRECT_B,
          parentThreadId: ROOT,
          agentPath: '/root/direct_b',
        }),
        taskStarted({
          turnId: rootTurn,
          startedAt: 3,
          timestamp: timestamp(3_000),
        }),
        taskStarted({
          turnId: directBTurn,
          startedAt: 6,
          timestamp: timestamp(6_000),
        }),
      ],
    });
    files.set(DIRECT_B, { path: directBPath });
    const recoveredMissing = await collector.collect(6_200);
    assert.equal(recoveredMissing.visibleAgentCount, 3);
    assert.equal(recoveredMissing.rows[1].status, 'running');
    assert.equal(logCount(logs, DIRECT_B), 2, 'one error and one recovery log');

    appendRolloutRecords(rootPath, [directASeed]);
    const duplicateRepoll = await collector.collect(6_300);
    assert.equal(duplicateRepoll.visibleAgentCount, 3);
    assert.equal(resolverCalls.filter((id) => id === DIRECT_A).length, 1);

    appendRolloutRecords(directAPath, [
      taskComplete({ turnId: directATurn, timestamp: timestamp(6_400) }),
    ]);
    const terminalAnchor = await collector.collect(6_400);
    const directARow = terminalAnchor.rows.find((row) => row.threadId === DIRECT_A);
    assert.ok(directARow);
    assert.equal(directARow.status, 'running');
    assert.equal(directARow.activeDescendantCount, 1);
    assert.equal(directARow.elapsedStartedAt.getTime(), 6_000);

    appendRolloutRecords(grandchildPath, [
      taskComplete({ turnId: grandchildTurn, timestamp: timestamp(6_500) }),
    ]);
    const terminalGrandchild = await collector.collect(6_500);
    assert.equal(
      terminalGrandchild.rows.some((row) => row.threadId === DIRECT_A),
      false
    );

    appendRolloutRecords(directBPath, [
      turnAborted({ turnId: directBTurn, timestamp: timestamp(6_600) }),
    ]);
    const aborted = await collector.collect(6_600);
    assert.equal(aborted.visibleAgentCount, 0);
    assert.equal(aborted.rows.length, 0);

    const partialSeed = legacyAgentStart({
      eventId: 'call_partial_child',
      childThreadId: PARTIAL_CHILD,
      agentPath: '/root/direct_a/partial_child',
      occurredAtMs: 7_000,
      timestamp: timestamp(7_000),
    });
    const partialPath = writeRolloutFile(testRoot, {
      sessionId: PARTIAL_CHILD,
      relativeDir: '2026/07/12',
      timestampLabel: '2026-07-12T01-03-00',
      records: [
        childMeta({
          id: PARTIAL_CHILD,
          parentThreadId: DIRECT_A,
          agentPath: '/root/direct_a/partial_child',
          depth: 2,
        }),
      ],
    });
    const partialLifecycle = JSON.stringify(
      taskStarted({
        turnId: partialTurn,
        startedAt: 8,
        timestamp: timestamp(8_000),
      })
    );
    appendRolloutText(partialPath, partialLifecycle);
    files.set(PARTIAL_CHILD, { path: partialPath });
    const serializedSeed = JSON.stringify(partialSeed);
    const seedSplit = Math.floor(serializedSeed.length / 2);
    appendRolloutText(directAPath, serializedSeed.slice(0, seedSplit));
    const partialSeedPoll = await collector.collect(7_000);
    assert.equal(partialSeedPoll.visibleAgentCount, 0);
    assert.equal(resolverCalls.filter((id) => id === PARTIAL_CHILD).length, 0);

    appendRolloutText(directAPath, `${serializedSeed.slice(seedSplit)}\n`);
    const completeSeedPoll = await collector.collect(7_100);
    assert.equal(completeSeedPoll.visibleAgentCount, 1);
    assert.equal(completeSeedPoll.rows[0].threadId, DIRECT_A);
    assert.equal(completeSeedPoll.rows[0].status, 'starting');
    assert.equal(completeSeedPoll.rows[0].activeDescendantCount, 1);
    assert.equal(resolverCalls.filter((id) => id === PARTIAL_CHILD).length, 1);

    appendRolloutText(partialPath, '\n');
    const completeLifecyclePoll = await collector.collect(8_100);
    assert.equal(completeLifecyclePoll.visibleAgentCount, 1);
    assert.equal(completeLifecyclePoll.rows[0].status, 'running');
    assert.equal(completeLifecyclePoll.rows[0].elapsedStartedAt.getTime(), 8_000);
    await collector.collect(8_100);
    assert.equal(resolverCalls.filter((id) => id === PARTIAL_CHILD).length, 1);

    const malformedPrefix = fs.readFileSync(partialPath, 'utf8');
    appendRolloutText(partialPath, `${JSON.stringify(activityRecord(8_200))}\n{"broken":\n`);
    const malformed = await collector.collect(8_200);
    assert.equal(malformed.rows[0].status, 'tracking-error');
    assert.equal(logCount(logs, PARTIAL_CHILD), 1);
    await collector.collect(8_200);
    assert.equal(logCount(logs, PARTIAL_CHILD), 1);

    overwriteRolloutRecords(partialPath, [
      ...malformedPrefix.trimEnd().split('\n').map((line) => JSON.parse(line)),
      activityRecord(8_200),
      activityRecord(8_250),
    ]);
    const malformedRecovered = await collector.collect(8_250);
    assert.equal(malformedRecovered.rows[0].status, 'running');
    assert.equal(malformedRecovered.rows[0].elapsedStartedAt.getTime(), 8_000);
    assert.equal(logCount(logs, PARTIAL_CHILD), 2);

    const transactionChildPath = writeRolloutFile(testRoot, {
      sessionId: TRANSACTION_CHILD,
      relativeDir: '2026/07/12',
      timestampLabel: '2026-07-12T01-04-00',
      records: [
        childMeta({
          id: TRANSACTION_CHILD,
          parentThreadId: PARTIAL_CHILD,
          agentPath: '/root/direct_a/partial_child/transaction_child',
          depth: 3,
        }),
        taskStarted({
          turnId: partialTurn,
          startedAt: 8,
          timestamp: timestamp(8_000),
        }),
        taskStarted({
          turnId: transactionTurn,
          startedAt: 9,
          timestamp: timestamp(9_000),
        }),
      ],
    });
    files.set(TRANSACTION_CHILD, { path: transactionChildPath });
    const transactionSeed = legacyAgentStart({
      eventId: 'call_transaction_child',
      childThreadId: TRANSACTION_CHILD,
      agentPath: '/root/direct_a/partial_child/transaction_child',
      occurredAtMs: 8_300,
      timestamp: timestamp(8_300),
    });
    const transactionPrefix = fs.readFileSync(partialPath, 'utf8');
    appendRolloutRecords(partialPath, [
      transactionSeed,
      legacyAgentStart({ kind: 'completed', timestamp: timestamp(8_400) }),
    ]);
    const processingError = await collector.collect(8_400);
    assert.equal(processingError.rows[0].status, 'tracking-error');
    assert.equal(resolverCalls.filter((id) => id === TRANSACTION_CHILD).length, 0);

    overwriteRolloutRecords(partialPath, [
      ...transactionPrefix.trimEnd().split('\n').map((line) => JSON.parse(line)),
      transactionSeed,
      activityRecord(8_400),
    ]);
    const processingRecovered = await collector.collect(9_100);
    assert.equal(resolverCalls.filter((id) => id === TRANSACTION_CHILD).length, 1);
    assert.equal(processingRecovered.visibleAgentCount, 2);
    assert.equal(processingRecovered.rows[0].activeDescendantCount, 2);
    assert.equal(logCount(logs, PARTIAL_CHILD), 4);

    appendRolloutRecords(transactionChildPath, [
      taskComplete({ turnId: transactionTurn, timestamp: timestamp(9_200) }),
    ]);
    appendRolloutRecords(partialPath, [
      taskComplete({ turnId: partialTurn, timestamp: timestamp(9_200) }),
    ]);
    assert.equal((await collector.collect(9_200)).visibleAgentCount, 0);

    appendRolloutRecords(directBPath, [
      taskStarted({
        turnId: 'direct-b-follow-up',
        startedAt: 20,
        timestamp: timestamp(20_000),
      }),
    ]);
    const followUp = await collector.collect(20_100);
    assert.equal(followUp.visibleAgentCount, 1);
    assert.equal(followUp.rows[0].threadId, DIRECT_B);
    assert.equal(followUp.rows[0].elapsedStartedAt.getTime(), 20_000);

    const timedOut = await collector.collect(22_000);
    assert.equal(timedOut.visibleAgentCount, 0);
    appendRolloutRecords(directBPath, [activityRecord(22_100)]);
    const activityRecovered = await collector.collect(22_100);
    assert.equal(activityRecovered.visibleAgentCount, 1);
    assert.equal(activityRecovered.rows[0].elapsedStartedAt.getTime(), 20_000);

    collector.setRootSession(rolloutSessionFile(rootPath, ROOT));
    const idempotent = await collector.collect(22_100);
    assert.equal(idempotent.visibleAgentCount, 1);
    assert.equal(idempotent.rows[0].threadId, DIRECT_B);

    const newRootPath = writeRolloutFile(testRoot, {
      sessionId: NEW_ROOT,
      relativeDir: '2026/07/12',
      timestampLabel: '2026-07-12T01-05-00',
      records: [
        canonicalSessionMeta({ id: NEW_ROOT }),
        taskStarted({
          turnId: 'new-root-turn',
          startedAt: 30,
          timestamp: timestamp(30_000),
        }),
        legacyAgentStart({
          eventId: 'call_new_child',
          childThreadId: NEW_CHILD,
          agentPath: '/root/new_child',
          occurredAtMs: 30_100,
          timestamp: timestamp(30_100),
        }),
      ],
    });
    const newChildPath = writeRolloutFile(testRoot, {
      sessionId: NEW_CHILD,
      relativeDir: '2026/07/12',
      timestampLabel: '2026-07-12T01-06-00',
      records: [
        childMeta({
          id: NEW_CHILD,
          parentThreadId: NEW_ROOT,
          agentPath: '/root/new_child',
        }),
        taskStarted({
          turnId: 'new-root-turn',
          startedAt: 30,
          timestamp: timestamp(30_000),
        }),
        taskStarted({
          turnId: 'new-child-turn',
          startedAt: 31,
          timestamp: timestamp(31_000),
        }),
      ],
    });
    files.set(NEW_CHILD, { path: newChildPath });
    collector.setRootSession(rolloutSessionFile(newRootPath, NEW_ROOT));
    const reset = await collector.collect(31_100);
    assert.equal(reset.visibleAgentCount, 1);
    assert.deepEqual(reset.rows.map((row) => row.threadId), [NEW_CHILD]);
    collector.setRootSession(null);
    const cleared = await collector.collect(31_100);
    assert.equal(cleared.visibleAgentCount, 0);
    assert.equal(cleared.rows.length, 0);

    const localIds = [
      DIRECT_A,
      DIRECT_B,
      GRANDCHILD_A,
      PARTIAL_CHILD,
      TRANSACTION_CHILD,
      NEW_CHILD,
    ];
    const copiedLegacyIds = [
      COPIED_LEGACY,
      COPIED_CHILD_LEGACY,
      COPIED_GRANDCHILD,
    ];
    const copiedPaginatedIds = [COPIED_PAGINATED, COPIED_CHILD_PAGINATED];
    const localRegistrations = localIds.filter((id) => resolverCalls.includes(id)).length;
    const copiedLegacyRegistrations = copiedLegacyIds.reduce(
      (count, id) => count + resolverCalls.filter((call) => call === id).length,
      0
    );
    const copiedPaginatedRegistrations = copiedPaginatedIds.reduce(
      (count, id) => count + resolverCalls.filter((call) => call === id).length,
      0
    );
    const falseCopiedErrors = [...copiedLegacyIds, ...copiedPaginatedIds].reduce(
      (count, id) => count + logCount(logs, id),
      0
    );
    const duplicateRegistrations =
      resolverCalls.filter((id) => id === DIRECT_A).length - 1;
    const missingErrors = logs.filter(
      (message) => message.includes(DIRECT_B) && message.includes('tracking error')
    ).length;
    const missingRecoveries = logs.filter(
      (message) => message.includes(DIRECT_B) && message.includes('recovered')
    ).length;
    const malformedErrors = logs.filter(
      (message) =>
        message.includes(PARTIAL_CHILD) && message.includes('tracking error')
    ).length;
    const malformedRecoveries = logs.filter(
      (message) => message.includes(PARTIAL_CHILD) && message.includes('recovered')
    ).length;
    const descendantIds = [GRANDCHILD_A, PARTIAL_CHILD, TRANSACTION_CHILD];
    const descendantsDiscovered = descendantIds.filter((id) =>
      resolverCalls.includes(id)
    ).length;
    const assertedPhysicalInheritedTurnIdCases = [
      sourceTurn,
      rootTurn,
      directATurn,
    ].length;
    const followUpReappearances = Number(
      followUp.visibleAgentCount === 1 && followUp.rows[0]?.threadId === DIRECT_B
    );
    const timeoutHides = Number(timedOut.visibleAgentCount === 0);
    const activityRecoveries = Number(
      activityRecovered.visibleAgentCount === 1 &&
        activityRecovered.rows[0]?.threadId === DIRECT_B
    );
    const rootResets = Number(
      reset.visibleAgentCount === 1 && reset.rows[0]?.threadId === NEW_CHILD
    );
    assert.equal(localRegistrations, 6);
    assert.equal(descendantsDiscovered, 3);
    assert.equal(copiedLegacyRegistrations, 0);
    assert.equal(copiedPaginatedRegistrations, 0);
    assert.equal(falseCopiedErrors, 0);
    assert.equal(duplicateRegistrations, 0);
    assert.equal(missingErrors, 1);
    assert.equal(missingRecoveries, 1);
    assert.equal(malformedErrors, 2);
    assert.equal(malformedRecoveries, 2);
    assert.equal(followUpReappearances, 1);
    assert.equal(timeoutHides, 1);
    assert.equal(activityRecoveries, 1);
    assert.equal(rootResets, 1);

    console.log(
      `METRIC recursive-tree localRegistrations=${localRegistrations} ` +
        `descendantsDiscovered=${descendantsDiscovered} ` +
        `assertedPhysicalInheritedTurnIdCases=${assertedPhysicalInheritedTurnIdCases} ` +
        `copiedLegacyRegistrations=${copiedLegacyRegistrations} ` +
        `copiedPaginatedRegistrations=${copiedPaginatedRegistrations} ` +
        `falseCopiedErrors=${falseCopiedErrors} ` +
        `duplicateRegistrations=${duplicateRegistrations} ` +
        `missingErrors=${missingErrors} missingRecoveries=${missingRecoveries} ` +
        `malformedErrors=${malformedErrors} malformedRecoveries=${malformedRecoveries} ` +
        `followUpReappearances=${followUpReappearances} timeoutHides=${timeoutHides} ` +
        `activityRecoveries=${activityRecoveries} rootResets=${rootResets}`
    );
  });

  await check('does not commit a root batch until every first-seen seed validates', async () => {
    const ROOT = thread(300);
    const VALID_CHILD = thread(301);
    const INVALID_CHILD = thread(302);
    const rootTurn = 'root-transaction-turn';
    const validTurn = 'root-transaction-valid-turn';
    const rootPath = writeRolloutFile(testRoot, {
      sessionId: ROOT,
      relativeDir: '2026/07/12',
      timestampLabel: '2026-07-12T04-00-00',
      records: [
        canonicalSessionMeta({ id: ROOT }),
        taskStarted({
          turnId: rootTurn,
          startedAt: 70,
          timestamp: timestamp(70_000),
        }),
        legacyAgentStart({
          eventId: 'call_root_transaction_valid',
          childThreadId: VALID_CHILD,
          agentPath: '/root/valid_child',
          occurredAtMs: 70_100,
          timestamp: timestamp(70_100),
        }),
        legacyAgentStart({
          eventId: 'call_root_transaction_invalid',
          childThreadId: INVALID_CHILD,
          agentPath: '/root/invalid_child/',
          occurredAtMs: 70_200,
          timestamp: timestamp(70_200),
        }),
      ],
    });
    const validChildPath = writeRolloutFile(testRoot, {
      sessionId: VALID_CHILD,
      relativeDir: '2026/07/12',
      timestampLabel: '2026-07-12T04-01-00',
      records: [
        childMeta({
          id: VALID_CHILD,
          parentThreadId: ROOT,
          agentPath: '/root/valid_child',
        }),
        taskStarted({
          turnId: rootTurn,
          startedAt: 70,
          timestamp: timestamp(70_000),
        }),
        taskStarted({
          turnId: validTurn,
          startedAt: 71,
          timestamp: timestamp(71_000),
        }),
      ],
    });
    const files = new Map([[VALID_CHILD, { path: validChildPath }]]);
    const calls = [];
    const collector = new AgentActivityCollector({
      inactivityTimeoutMs: 1_000,
      resolveRollout: createResolver(files, calls),
      logError: () => {},
    });
    collector.setRootSession(rolloutSessionFile(rootPath, ROOT));

    const captureCollect = async () => {
      try {
        return { activity: await collector.collect(71_100), error: null };
      } catch (error) {
        return { activity: null, error };
      }
    };
    const first = await captureCollect();
    const second = await captureCollect();
    const firstRejects = Number(first.error !== null);
    const secondRejects = Number(second.error !== null);
    const validResolverAttempts = calls.filter((id) => id === VALID_CHILD).length;
    const partialVisibleCount = second.activity?.visibleAgentCount ?? 0;
    const partialRowCount = second.activity?.rows.length ?? 0;

    console.log(
      `METRIC root-batch-transaction firstRejects=${firstRejects} ` +
        `secondRejects=${secondRejects} validResolverAttempts=${validResolverAttempts} ` +
        `partialVisibleCount=${partialVisibleCount} partialRowCount=${partialRowCount}`
    );
    assert.match(first.error?.message ?? '', /agentPath leaf/);
    assert.equal(
      firstRejects,
      1,
      `root first rejection: expected=1 actual=${firstRejects}`
    );
    assert.equal(
      secondRejects,
      1,
      `root unchanged replay rejection: expected=1 actual=${secondRejects}`
    );
    assert.equal(
      validResolverAttempts,
      0,
      `root valid child resolver attempts before repair: expected=0 actual=${validResolverAttempts}`
    );
    assert.equal(
      partialVisibleCount,
      0,
      `root partial visible count: expected=0 actual=${partialVisibleCount}`
    );
    assert.equal(
      partialRowCount,
      0,
      `root partial row count: expected=0 actual=${partialRowCount}`
    );
  });

  await check('does not publish nested seeds before the parent batch commits', async () => {
    const ROOT = thread(310);
    const PARENT = thread(311);
    const NESTED = thread(312);
    const INVALID_NESTED = thread(313);
    const rootTurn = 'node-transaction-root-turn';
    const parentTurn = 'node-transaction-parent-turn';
    const nestedTurn = 'node-transaction-nested-turn';
    const parentSeed = legacyAgentStart({
      eventId: 'call_node_transaction_parent',
      childThreadId: PARENT,
      agentPath: '/root/transaction_parent',
      occurredAtMs: 80_100,
      timestamp: timestamp(80_100),
    });
    const nestedSeed = legacyAgentStart({
      eventId: 'call_node_transaction_nested',
      childThreadId: NESTED,
      agentPath: '/root/transaction_parent/nested',
      occurredAtMs: 81_100,
      timestamp: timestamp(81_100),
    });
    const invalidNestedSeed = legacyAgentStart({
      eventId: 'call_node_transaction_invalid',
      childThreadId: INVALID_NESTED,
      agentPath: '/root/transaction_parent/invalid/',
      occurredAtMs: 81_200,
      timestamp: timestamp(81_200),
    });
    const duplicateNestedSeed = legacyAgentStart({
      eventId: 'call_node_transaction_duplicate',
      childThreadId: NESTED,
      agentPath: '/root/transaction_parent/ignored_duplicate/',
      occurredAtMs: 81_300,
      timestamp: timestamp(81_300),
    });
    const rootPath = writeRolloutFile(testRoot, {
      sessionId: ROOT,
      relativeDir: '2026/07/12',
      timestampLabel: '2026-07-12T04-10-00',
      records: [
        canonicalSessionMeta({ id: ROOT }),
        taskStarted({
          turnId: rootTurn,
          startedAt: 80,
          timestamp: timestamp(80_000),
        }),
        parentSeed,
      ],
    });
    const parentRecords = [
      childMeta({
        id: PARENT,
        parentThreadId: ROOT,
        agentPath: '/root/transaction_parent',
      }),
      taskStarted({
        turnId: rootTurn,
        startedAt: 80,
        timestamp: timestamp(80_000),
      }),
      taskStarted({
        turnId: parentTurn,
        startedAt: 81,
        timestamp: timestamp(81_000),
      }),
      nestedSeed,
    ];
    const parentPath = writeRolloutFile(testRoot, {
      sessionId: PARENT,
      relativeDir: '2026/07/12',
      timestampLabel: '2026-07-12T04-11-00',
      records: [...parentRecords, invalidNestedSeed],
    });
    const nestedPath = writeRolloutFile(testRoot, {
      sessionId: NESTED,
      relativeDir: '2026/07/12',
      timestampLabel: '2026-07-12T04-12-00',
      records: [
        childMeta({
          id: NESTED,
          parentThreadId: PARENT,
          agentPath: '/root/transaction_parent/nested',
          depth: 2,
        }),
        taskStarted({
          turnId: parentTurn,
          startedAt: 81,
          timestamp: timestamp(81_000),
        }),
        taskStarted({
          turnId: nestedTurn,
          startedAt: 82,
          timestamp: timestamp(82_000),
        }),
      ],
    });
    const files = new Map([
      [PARENT, { path: parentPath }],
      [NESTED, { path: nestedPath }],
    ]);
    const calls = [];
    const logs = [];
    const collector = new AgentActivityCollector({
      inactivityTimeoutMs: 2_000,
      resolveRollout: createResolver(files, calls),
      logError: (message) => logs.push(message),
    });
    collector.setRootSession(rolloutSessionFile(rootPath, ROOT));

    const rejected = await collector.collect(82_100);
    const nestedAttemptsBeforeRepair = calls.filter((id) => id === NESTED).length;
    const visibleCountBeforeRepair = rejected.visibleAgentCount;
    const activeDescendantsBeforeRepair = rejected.rows[0]?.activeDescendantCount;
    assert.equal(rejected.rows[0]?.status, 'tracking-error');
    assert.equal(
      visibleCountBeforeRepair,
      1,
      `node visible count before repair: expected=1 actual=${visibleCountBeforeRepair}`
    );
    assert.equal(
      activeDescendantsBeforeRepair,
      0,
      `node active descendants before repair: expected=0 actual=${activeDescendantsBeforeRepair}`
    );
    assert.equal(
      nestedAttemptsBeforeRepair,
      0,
      `nested resolver attempts before repair: expected=0 actual=${nestedAttemptsBeforeRepair}`
    );

    overwriteRolloutRecords(parentPath, [...parentRecords, duplicateNestedSeed]);
    const recovered = await collector.collect(82_100);
    const nestedAttemptsAfterRepair = calls.filter((id) => id === NESTED).length;
    assert.equal(recovered.visibleAgentCount, 2);
    assert.equal(recovered.rows[0]?.activeDescendantCount, 1);
    assert.equal(
      recovered.rows[0]?.status,
      'running',
      'the first same-batch nested seed must keep its immutable identity'
    );
    assert.equal(
      nestedAttemptsAfterRepair,
      1,
      `nested resolver attempts after same-path repair: expected=1 actual=${nestedAttemptsAfterRepair}`
    );
    assert.equal(logCount(logs, PARENT), 2, 'one error and one recovery');

    console.log(
      `METRIC node-batch-transaction visibleBeforeRepair=${visibleCountBeforeRepair} ` +
        `activeDescendantsBeforeRepair=${activeDescendantsBeforeRepair} ` +
        `nestedAttemptsBeforeRepair=${nestedAttemptsBeforeRepair} ` +
        `nestedAttemptsAfterRepair=${nestedAttemptsAfterRepair}`
    );
  });

  await check('inherits complete-only and abort-only physical lifecycle turn IDs', async () => {
    const ROOT = thread(320);
    const CHILD = thread(321);
    const rootTurn = 'physical-root-turn';
    const completeOnlyTurn = 'physical-complete-only-turn';
    const abortOnlyTurn = 'physical-abort-only-turn';
    const localTurn = 'physical-local-turn';
    const rootPath = writeRolloutFile(testRoot, {
      sessionId: ROOT,
      relativeDir: '2026/07/12',
      timestampLabel: '2026-07-12T04-20-00',
      records: [
        canonicalSessionMeta({ id: ROOT }),
        taskStarted({
          turnId: rootTurn,
          startedAt: 90,
          timestamp: timestamp(90_000),
        }),
        taskComplete({
          turnId: completeOnlyTurn,
          timestamp: timestamp(90_100),
        }),
        turnAborted({
          turnId: abortOnlyTurn,
          timestamp: timestamp(90_200),
        }),
        legacyAgentStart({
          eventId: 'call_physical_child',
          childThreadId: CHILD,
          agentPath: '/root/physical_child',
          occurredAtMs: 90_300,
          timestamp: timestamp(90_300),
        }),
      ],
    });
    const childPath = writeRolloutFile(testRoot, {
      sessionId: CHILD,
      relativeDir: '2026/07/12',
      timestampLabel: '2026-07-12T04-21-00',
      records: [
        childMeta({
          id: CHILD,
          parentThreadId: ROOT,
          agentPath: '/root/physical_child',
        }),
        taskStarted({
          turnId: completeOnlyTurn,
          startedAt: 90,
          timestamp: timestamp(90_400),
        }),
        taskStarted({
          turnId: abortOnlyTurn,
          startedAt: 91,
          timestamp: timestamp(91_000),
        }),
        taskStarted({
          turnId: localTurn,
          startedAt: 92,
          timestamp: timestamp(92_000),
        }),
      ],
    });
    const calls = [];
    const collector = new AgentActivityCollector({
      inactivityTimeoutMs: 1_000,
      resolveRollout: createResolver(new Map([[CHILD, { path: childPath }]]), calls),
      logError: () => {},
    });
    collector.setRootSession(rolloutSessionFile(rootPath, ROOT));

    const activity = await collector.collect(92_100);
    const elapsedActual = activity.rows[0]?.elapsedStartedAt?.getTime();
    assert.equal(activity.visibleAgentCount, 1);
    assert.equal(
      elapsedActual,
      92_000,
      `physical lifecycle boundary elapsed: expected=92000 actual=${elapsedActual}`
    );
    assert.equal(
      calls.filter((id) => id === CHILD).length,
      1,
      `physical lifecycle child resolver attempts: expected=1 actual=${calls.filter((id) => id === CHILD).length}`
    );
    console.log(
      `ASSERTED_CASE inherited-lifecycle completeOnly=1 abortOnly=1 ` +
        `elapsedExpected=92000 elapsedActual=${elapsedActual}`
    );
  });

  await check('keeps canonical child identity errors local and retries one exact path', async () => {
    const ROOT = thread(100);
    const CHILD = thread(101);
    const WRONG = thread(102);
    const rootTurn = 'canonical-root-turn';
    const childTurn = 'canonical-child-turn';
    const childPath = '/root/canonical_child';
    const rootPath = writeRolloutFile(testRoot, {
      sessionId: ROOT,
      relativeDir: '2026/07/12',
      timestampLabel: '2026-07-12T02-00-00',
      records: [
        canonicalSessionMeta({ id: ROOT }),
        taskStarted({
          turnId: rootTurn,
          startedAt: 40,
          timestamp: timestamp(40_000),
        }),
        legacyAgentStart({
          eventId: 'call_canonical_child',
          childThreadId: CHILD,
          agentPath: childPath,
          occurredAtMs: 40_100,
          timestamp: timestamp(40_100),
        }),
      ],
    });
    const rolloutPath = writeRolloutFile(testRoot, {
      sessionId: CHILD,
      relativeDir: '2026/07/12',
      timestampLabel: '2026-07-12T02-01-00',
      records: [
        childMeta({ id: CHILD, parentThreadId: ROOT, agentPath: childPath }),
      ],
    });
    const files = new Map([
      [CHILD, { path: rolloutPath, sessionId: WRONG }],
    ]);
    const calls = [];
    const logs = [];
    const collector = new AgentActivityCollector({
      inactivityTimeoutMs: 1_000,
      resolveRollout: createResolver(files, calls),
      logError: (message) => logs.push(message),
    });
    collector.setRootSession(rolloutSessionFile(rootPath, ROOT));

    const assertLocalError = async (expectedLogCount) => {
      const activity = await collector.collect(40_200);
      assert.equal(activity.rootTrackingError, false);
      assert.equal(activity.visibleAgentCount, 1);
      assert.equal(activity.rows[0].status, 'tracking-error');
      assert.equal(logCount(logs, CHILD), expectedLogCount);
    };

    await assertLocalError(1);
    assert.equal(
      logs.at(-1)?.includes('resolved rollout session mismatch'),
      true,
      `child resolver SessionFile.sessionId mismatch: expected=true actual=${logs.at(-1)?.includes('resolved rollout session mismatch')}`
    );
    files.set(CHILD, { path: rolloutPath });
    overwriteRolloutRecords(rolloutPath, [
      childMeta({ id: WRONG, parentThreadId: ROOT, agentPath: childPath }),
    ]);
    await assertLocalError(2);
    overwriteRolloutRecords(rolloutPath, [
      childMeta({
        id: CHILD,
        parentThreadId: WRONG,
        agentPath: childPath,
      }),
    ]);
    await assertLocalError(3);
    overwriteRolloutRecords(rolloutPath, [
      childMeta({
        id: CHILD,
        parentThreadId: ROOT,
        agentPath: '/root/wrong_path',
      }),
    ]);
    await assertLocalError(4);
    overwriteRolloutRecords(rolloutPath, [
      canonicalSessionMeta({
        id: CHILD,
        source: 'cli',
        parentThreadId: ROOT,
        agentPath: childPath,
      }),
    ]);
    await assertLocalError(5);
    const duplicatedMismatch = childMeta({
      id: CHILD,
      parentThreadId: ROOT,
      agentPath: childPath,
    });
    duplicatedMismatch.payload.parent_thread_id = WRONG;
    overwriteRolloutRecords(rolloutPath, [duplicatedMismatch]);
    await assertLocalError(6);
    const duplicatedPathMismatch = childMeta({
      id: CHILD,
      parentThreadId: ROOT,
      agentPath: childPath,
    });
    duplicatedPathMismatch.payload.agent_path = '/root/wrong_duplicate_path';
    overwriteRolloutRecords(rolloutPath, [duplicatedPathMismatch]);
    await assertLocalError(7);
    assert.equal(
      logs.at(-1)?.includes('duplicate agent_path mismatch'),
      true,
      `duplicate top-level payload.agent_path mismatch: expected=true actual=${logs.at(-1)?.includes('duplicate agent_path mismatch')}`
    );

    overwriteRolloutRecords(rolloutPath, [
      childMeta({ id: CHILD, parentThreadId: ROOT, agentPath: childPath }),
      taskStarted({
        turnId: rootTurn,
        startedAt: 40,
        timestamp: timestamp(40_000),
      }),
      taskStarted({
        turnId: childTurn,
        startedAt: 41,
        timestamp: timestamp(41_000),
      }),
    ]);
    const recovered = await collector.collect(41_100);
    assert.equal(recovered.visibleAgentCount, 1);
    assert.equal(recovered.rows[0].status, 'running');
    assert.equal(recovered.rows[0].elapsedStartedAt.getTime(), 41_000);
    assert.equal(logCount(logs, CHILD), 8, 'seven errors and one recovery');
    assert.equal(calls.every((threadId) => threadId === CHILD), true);
    assert.equal(files.get(CHILD).path, rolloutPath);
    const trackingErrorTransitions = logs.filter(
      (message) => message.includes(CHILD) && message.includes('tracking error')
    ).length;
    const trackingRecoveryTransitions = logs.filter(
      (message) => message.includes(CHILD) && message.includes('recovered')
    ).length;
    const assertedIdentityMismatchCases = [
      'resolved-session-id',
      'canonical-id',
      'canonical-parent',
      'canonical-path',
      'canonical-source',
      'duplicate-parent',
      'duplicate-agent-path',
    ].length;
    assert.equal(
      trackingErrorTransitions,
      7,
      `child tracking error transitions: expected=7 actual=${trackingErrorTransitions}`
    );
    assert.equal(
      trackingRecoveryTransitions,
      1,
      `child tracking recovery transitions: expected=1 actual=${trackingRecoveryTransitions}`
    );

    console.log(
      `METRIC canonical-errors trackingErrorTransitions=${trackingErrorTransitions} ` +
        `trackingRecoveryTransitions=${trackingRecoveryTransitions} ` +
        `resolverAttempts=${calls.length} ` +
        `assertedIdentityMismatchCases=${assertedIdentityMismatchCases}`
    );
  });

  await check('surfaces and transactionally recovers exact root-fork source errors', async () => {
    const SOURCE = thread(200);
    const ROOT = thread(201);
    const COPIED_LEGACY = thread(202);
    const COPIED_PAGINATED = thread(203);
    const LOCAL_CHILD = thread(204);
    const WRONG_SOURCE = thread(205);
    const sourceTurn = 'root-error-source-turn';
    const rootTurn = 'root-error-local-turn';
    const childTurn = 'root-error-child-turn';
    const copiedLegacy = legacyAgentStart({
      eventId: 'call_root_error_copied_legacy',
      childThreadId: COPIED_LEGACY,
      agentPath: '/root/copied_legacy',
      occurredAtMs: 50_100,
      timestamp: timestamp(50_100),
    });
    const copiedPaginated = paginatedAgentStart({
      eventId: 'call_root_error_copied_paginated',
      childThreadId: COPIED_PAGINATED,
      agentPath: '/root/copied_paginated',
      occurredAtMs: 50_200,
      parentThreadId: SOURCE,
      turnId: sourceTurn,
      timestamp: timestamp(50_200),
    });
    const rootPath = writeRolloutFile(testRoot, {
      sessionId: ROOT,
      relativeDir: '2026/07/12',
      timestampLabel: '2026-07-12T03-00-00',
      records: [
        canonicalSessionMeta({ id: ROOT, forkedFromId: SOURCE }),
        taskStarted({
          turnId: sourceTurn,
          startedAt: 50,
          timestamp: timestamp(50_000),
        }),
        copiedLegacy,
        copiedPaginated,
        taskComplete({ turnId: sourceTurn, timestamp: timestamp(50_500) }),
        taskStarted({
          turnId: rootTurn,
          startedAt: 51,
          timestamp: timestamp(51_000),
        }),
        legacyAgentStart({
          eventId: 'call_root_error_local',
          childThreadId: LOCAL_CHILD,
          agentPath: '/root/local_child',
          occurredAtMs: 51_100,
          timestamp: timestamp(51_100),
        }),
      ],
    });
    const localChildPath = writeRolloutFile(testRoot, {
      sessionId: LOCAL_CHILD,
      relativeDir: '2026/07/12',
      timestampLabel: '2026-07-12T03-01-00',
      records: [
        childMeta({
          id: LOCAL_CHILD,
          parentThreadId: ROOT,
          agentPath: '/root/local_child',
        }),
        taskStarted({
          turnId: rootTurn,
          startedAt: 51,
          timestamp: timestamp(51_000),
        }),
        taskStarted({
          turnId: childTurn,
          startedAt: 52,
          timestamp: timestamp(52_000),
        }),
      ],
    });
    const files = new Map([[LOCAL_CHILD, { path: localChildPath }]]);
    const calls = [];
    const logs = [];
    const collector = new AgentActivityCollector({
      inactivityTimeoutMs: 1_000,
      resolveRollout: createResolver(files, calls),
      logError: (message) => logs.push(message),
    });
    collector.setRootSession(rolloutSessionFile(rootPath, ROOT));

    const missing = await collector.collect(52_100);
    assert.equal(missing.rootTrackingError, true);
    assert.deepEqual(missing.rows, []);
    assert.equal(missing.visibleAgentCount, 0);
    assert.deepEqual(calls, [SOURCE]);
    assert.equal(logCount(logs, SOURCE), 1);

    const repeatedMissing = await collector.collect(52_100);
    assert.equal(repeatedMissing.rootTrackingError, true);
    assert.equal(logCount(logs, SOURCE), 1);
    assert.deepEqual(calls, [SOURCE, SOURCE]);

    const sourcePath = writeRolloutFile(testRoot, {
      sessionId: SOURCE,
      storage: 'archived_sessions',
      relativeDir: '2016/01/01',
      timestampLabel: '2016-01-01T00-00-00',
      records: [],
    });
    appendRolloutText(sourcePath, '{"malformed":\n');
    files.set(SOURCE, { path: sourcePath });
    const malformed = await collector.collect(52_100);
    assert.equal(malformed.rootTrackingError, true);
    assert.equal(logCount(logs, SOURCE), 2);
    assert.equal(calls.every((id) => id === SOURCE), true);

    overwriteRolloutRecords(sourcePath, [
      canonicalSessionMeta({ id: SOURCE }),
      taskStarted({
        turnId: sourceTurn,
        startedAt: 50,
        timestamp: timestamp(50_000),
      }),
    ]);
    files.set(SOURCE, { path: sourcePath, sessionId: WRONG_SOURCE });
    const resolvedSessionMismatch = await collector.collect(52_100);
    assert.equal(resolvedSessionMismatch.rootTrackingError, true);
    assert.equal(logCount(logs, SOURCE), 3);
    assert.equal(
      logs.at(-1)?.includes('resolved rollout session mismatch'),
      true,
      `root-source resolver SessionFile.sessionId mismatch: expected=true actual=${logs.at(-1)?.includes('resolved rollout session mismatch')}`
    );

    files.set(SOURCE, { path: sourcePath });
    overwriteRolloutRecords(sourcePath, [
      canonicalSessionMeta({ id: WRONG_SOURCE }),
      taskStarted({
        turnId: sourceTurn,
        startedAt: 50,
        timestamp: timestamp(50_000),
      }),
    ]);
    const mismatched = await collector.collect(52_100);
    assert.equal(mismatched.rootTrackingError, true);
    assert.equal(logCount(logs, SOURCE), 4);
    assert.equal(calls.every((id) => id === SOURCE), true);

    overwriteRolloutRecords(sourcePath, [
      canonicalSessionMeta({ id: SOURCE }),
      taskStarted({
        turnId: sourceTurn,
        startedAt: 50,
        timestamp: timestamp(50_000),
      }),
      copiedLegacy,
      copiedPaginated,
      taskComplete({ turnId: sourceTurn, timestamp: timestamp(50_500) }),
    ]);
    const recovered = await collector.collect(52_100);
    assert.equal(recovered.rootTrackingError, false);
    assert.equal(recovered.visibleAgentCount, 1);
    assert.deepEqual(recovered.rows.map((row) => row.threadId), [LOCAL_CHILD]);
    assert.equal(logCount(logs, SOURCE), 5, 'four errors and one recovery');
    assert.equal(calls.filter((id) => id === COPIED_LEGACY).length, 0);
    assert.equal(calls.filter((id) => id === COPIED_PAGINATED).length, 0);
    assert.equal(calls.filter((id) => id === LOCAL_CHILD).length, 1);

    const idle = await collector.collect(52_100);
    assert.equal(idle.visibleAgentCount, 1);
    assert.equal(calls.filter((id) => id === LOCAL_CHILD).length, 1);
    const rootTrackingErrorTransitions = logs.filter((message) =>
      message.includes('tracking error')
    ).length;
    const rootTrackingRecoveryTransitions = logs.filter((message) =>
      message.includes('recovered')
    ).length;
    const sourceAttempts = calls.filter((id) => id === SOURCE).length;
    const copiedLegacyRegistrations = calls.filter(
      (id) => id === COPIED_LEGACY
    ).length;
    const copiedPaginatedRegistrations = calls.filter(
      (id) => id === COPIED_PAGINATED
    ).length;
    const duplicateRegistrations =
      calls.filter((id) => id === LOCAL_CHILD).length - 1;
    const assertedRootSourceErrorCases = [
      'missing',
      'malformed',
      'resolved-session-id',
      'canonical-id',
    ].length;
    assert.equal(
      rootTrackingErrorTransitions,
      4,
      `root tracking error transitions: expected=4 actual=${rootTrackingErrorTransitions}`
    );
    assert.equal(
      rootTrackingRecoveryTransitions,
      1,
      `root tracking recovery transitions: expected=1 actual=${rootTrackingRecoveryTransitions}`
    );

    console.log(
      `METRIC root-errors trackingErrorTransitions=${rootTrackingErrorTransitions} ` +
        `trackingRecoveryTransitions=${rootTrackingRecoveryTransitions} ` +
        `sourceAttempts=${sourceAttempts} ` +
        `copiedLegacyRegistrations=${copiedLegacyRegistrations} ` +
        `copiedPaginatedRegistrations=${copiedPaginatedRegistrations} ` +
        `duplicateRegistrations=${duplicateRegistrations} ` +
        `assertedRootSourceErrorCases=${assertedRootSourceErrorCases}`
    );
  });
} finally {
  cleanupAgentTestRoot(testRoot);
}

if (failures.length > 0) {
  console.error(
    `test-agent-activity-tree: FAIL (${passed}/${passed + failures.length} passed)`
  );
  process.exitCode = 1;
} else {
  console.log(`test-agent-activity-tree: PASS (${passed}/${passed} passed)`);
}
