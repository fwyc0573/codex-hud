import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  canonicalSessionMeta,
  cleanupAgentTestRoot,
  legacyAgentStart,
  makeAgentTestRoot,
  paginatedAgentStart,
  writeRolloutFile,
} from '../helpers/agent-rollout-fixture.mjs';

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

const root = makeAgentTestRoot();
const originalCodexHome = process.env.CODEX_HOME;
const originalSessionsPath = process.env.CODEX_SESSIONS_PATH;

try {
  const agentActivity = async () => import('../../dist/collectors/agent-activity.js');

  await check('normalizes the official Legacy started record', async () => {
    const { normalizeAgentSpawnSeed } = await agentActivity();
    const record = legacyAgentStart({
      eventId: 'call_legacy_123',
      occurredAtMs: 1_720_742_400_123,
      childThreadId: '019d7299-b246-7ad3-b14a-0e4a47e5a682',
      agentPath: '/root/legacy_child',
    });

    assert.deepEqual(normalizeAgentSpawnSeed(record), {
      eventId: 'call_legacy_123',
      occurredAtMs: 1_720_742_400_123,
      childThreadId: '019d7299-b246-7ad3-b14a-0e4a47e5a682',
      agentPath: '/root/legacy_child',
    });
  });

  await check('normalizes the official Paginated started record', async () => {
    const { normalizeAgentSpawnSeed } = await agentActivity();
    const record = paginatedAgentStart({
      eventId: 'call_paginated_123',
      occurredAtMs: 1_720_742_400_456,
      childThreadId: '019d729a-c357-7bd4-824b-1f5b58f6b793',
      agentPath: '/root/paginated_child',
    });

    assert.deepEqual(normalizeAgentSpawnSeed(record), {
      eventId: 'call_paginated_123',
      occurredAtMs: 1_720_742_400_456,
      childThreadId: '019d729a-c357-7bd4-824b-1f5b58f6b793',
      agentPath: '/root/paginated_child',
    });
  });

  await check('ignores legal non-start activity and unrelated item shapes', async () => {
    const { normalizeAgentSpawnSeed } = await agentActivity();
    const ignored = [
      legacyAgentStart({ kind: 'interacted' }),
      legacyAgentStart({ kind: 'interrupted' }),
      legacyAgentStart({ kind: 'completed' }),
      paginatedAgentStart({ kind: 'interacted' }),
      paginatedAgentStart({ kind: 'interrupted' }),
      paginatedAgentStart({ kind: 'completed' }),
      paginatedAgentStart({ itemType: 'CommandExecution' }),
      {
        timestamp: '2026-07-12T00:00:00.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'spawn_agent',
          call_id: 'call_generic_spawn',
        },
      },
    ];

    assert.deepEqual(
      ignored.map((record) => normalizeAgentSpawnSeed(record)),
      ignored.map(() => null)
    );
  });

  await check('rejects malformed activity kinds in recognized records', async () => {
    const { normalizeAgentSpawnSeed } = await agentActivity();
    const missingLegacyKind = legacyAgentStart();
    delete missingLegacyKind.payload.kind;
    const missingPaginatedKind = paginatedAgentStart();
    delete missingPaginatedKind.payload.item.kind;
    const malformed = [
      missingLegacyKind,
      legacyAgentStart({ kind: 123 }),
      missingPaginatedKind,
      paginatedAgentStart({ kind: 123 }),
    ];

    for (const record of malformed) {
      assert.throws(
        () => normalizeAgentSpawnSeed(record),
        /Invalid agent spawn activity: kind/
      );
    }
  });

  await check('rejects invalid Legacy and Paginated started identities', async () => {
    const { normalizeAgentSpawnSeed } = await agentActivity();
    const missingLegacyTimestamp = legacyAgentStart();
    delete missingLegacyTimestamp.payload.occurred_at_ms;
    const missingPaginatedTimestamp = paginatedAgentStart();
    delete missingPaginatedTimestamp.payload.completed_at_ms;
    const invalid = [
      legacyAgentStart({ eventId: '' }),
      missingLegacyTimestamp,
      legacyAgentStart({ occurredAtMs: 0 }),
      legacyAgentStart({ occurredAtMs: -1 }),
      legacyAgentStart({ childThreadId: '' }),
      legacyAgentStart({ agentPath: '   ' }),
      paginatedAgentStart({ eventId: '' }),
      missingPaginatedTimestamp,
      paginatedAgentStart({ occurredAtMs: 0 }),
      paginatedAgentStart({ occurredAtMs: -1 }),
      paginatedAgentStart({ childThreadId: '' }),
      paginatedAgentStart({ agentPath: '   ' }),
    ];

    for (const record of invalid) {
      assert.throws(
        () => normalizeAgentSpawnSeed(record),
        /Invalid agent spawn activity:/
      );
    }
  });

  await check('classifies only structured subagent session sources', async () => {
    const { isSubagentSessionSource } = await agentActivity();
    assert.equal(isSubagentSessionSource({ subagent: 'review' }), true);
    assert.equal(isSubagentSessionSource({ subagent: 'compact' }), true);
    assert.equal(isSubagentSessionSource({ subagent: 'memory_consolidation' }), true);
    assert.equal(isSubagentSessionSource({ subagent: { other: 'fixture' } }), true);
    assert.equal(
      isSubagentSessionSource({
        subagent: {
          thread_spawn: {
            parent_thread_id: '019d7291-a135-7fe1-b46f-8f3eca4fa451',
            depth: 1,
            agent_path: '/root/protocol_test',
          },
        },
      }),
      true
    );
    assert.equal(isSubagentSessionSource(undefined), false);
    assert.equal(isSubagentSessionSource('cli'), false);
    assert.equal(isSubagentSessionSource('vscode'), false);
    assert.equal(isSubagentSessionSource({ custom: 'fixture' }), false);
    assert.equal(isSubagentSessionSource({ internal: 'memory_consolidation' }), false);
  });

  await check('finds exact old active and archived rollout paths', async () => {
    process.env.CODEX_HOME = root;
    delete process.env.CODEX_SESSIONS_PATH;

    const oldActiveThread = '019a1111-a111-7aa1-8111-111111111111';
    const archivedThread = '019a2222-b222-7bb2-8222-222222222222';
    const oldActivePath = writeRolloutFile(root, {
      sessionId: oldActiveThread,
      relativeDir: '2019/01/02',
      timestampLabel: '2019-01-02T03-04-05',
      records: [canonicalSessionMeta({ id: oldActiveThread })],
    });
    const archivedPath = writeRolloutFile(root, {
      sessionId: archivedThread,
      storage: 'archived_sessions',
      relativeDir: '2020/02/03',
      timestampLabel: '2020-02-03T04-05-06',
      records: [canonicalSessionMeta({ id: archivedThread })],
    });

    const { findRolloutByThreadId } = await import(
      '../../dist/collectors/session-finder.js'
    );
    assert.equal(typeof findRolloutByThreadId, 'function');
    assert.equal(
      fs.realpathSync(findRolloutByThreadId(oldActiveThread).path),
      fs.realpathSync(oldActivePath)
    );
    assert.equal(
      fs.realpathSync(findRolloutByThreadId(archivedThread).path),
      fs.realpathSync(archivedPath)
    );
    assert.equal(
      findRolloutByThreadId('019affff-ffff-7fff-8fff-ffffffffffff'),
      null
    );
  });

  await check('prefers an active rollout over an archived duplicate', async () => {
    process.env.CODEX_HOME = root;
    delete process.env.CODEX_SESSIONS_PATH;

    const duplicateThread = '019a3333-c333-7cc3-8333-333333333333';
    const activePath = writeRolloutFile(root, {
      sessionId: duplicateThread,
      relativeDir: '2018/03/04',
      timestampLabel: '2018-03-04T05-06-07',
      records: [canonicalSessionMeta({ id: duplicateThread })],
    });
    writeRolloutFile(root, {
      sessionId: duplicateThread,
      storage: 'archived_sessions',
      relativeDir: '2021/04/05',
      timestampLabel: '2021-04-05T06-07-08',
      records: [canonicalSessionMeta({ id: duplicateThread })],
    });

    const { findRolloutByThreadId } = await import(
      '../../dist/collectors/session-finder.js'
    );
    assert.equal(
      fs.realpathSync(findRolloutByThreadId(duplicateThread).path),
      fs.realpathSync(activePath)
    );
  });

  await check('keeps the first SessionMeta canonical', async () => {
    const currentThread = '019a4444-d444-7dd4-8444-444444444444';
    const currentSource = {
      subagent: {
        thread_spawn: {
          parent_thread_id: '019a5555-e555-7ee5-8555-555555555555',
          depth: 1,
          agent_path: '/root/current_child',
        },
      },
    };
    const rolloutPath = writeRolloutFile(root, {
      sessionId: currentThread,
      relativeDir: '2026/07/12',
      timestampLabel: '2026-07-12T07-08-09',
      records: [
        canonicalSessionMeta({
          id: currentThread,
          source: currentSource,
          forkedFromId: '019a6666-f666-7ff6-8666-666666666666',
          parentThreadId: '019a5555-e555-7ee5-8555-555555555555',
          agentPath: '/root/current_child',
        }),
        canonicalSessionMeta({
          id: '019a7777-a777-7aa7-8777-777777777777',
          source: 'cli',
          forkedFromId: '019a8888-b888-7bb8-8888-888888888888',
          parentThreadId: '019a9999-c999-7cc9-8999-999999999999',
          agentPath: '/root/copied_source',
        }),
      ],
    });

    const { parseRolloutFile } = await import('../../dist/collectors/rollout.js');
    const { result } = await parseRolloutFile(rolloutPath);

    assert.equal(result.session?.id, currentThread);
    assert.deepEqual(result.session?.source, currentSource);
    assert.equal(
      result.session?.forkedFromId,
      '019a6666-f666-7ff6-8666-666666666666'
    );
    assert.equal(
      result.session?.parentThreadId,
      '019a5555-e555-7ee5-8555-555555555555'
    );
    assert.equal(result.session?.agentPath, '/root/current_child');
  });
} finally {
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }

  if (originalSessionsPath === undefined) {
    delete process.env.CODEX_SESSIONS_PATH;
  } else {
    process.env.CODEX_SESSIONS_PATH = originalSessionsPath;
  }

  cleanupAgentTestRoot(root);
}

if (failures.length > 0) {
  console.error(
    `test-agent-activity-protocol: FAIL (${passed}/${passed + failures.length} passed)`
  );
  process.exitCode = 1;
} else {
  console.log(`test-agent-activity-protocol: PASS (${passed}/${passed} passed)`);
}
