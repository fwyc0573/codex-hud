import assert from 'node:assert/strict';

import { parseRolloutFile } from '../../dist/collectors/rollout.js';
import {
  canonicalSessionMeta,
  cleanupAgentTestRoot,
  makeAgentTestRoot,
  writeRolloutFile,
} from '../helpers/agent-rollout-fixture.mjs';

const root = makeAgentTestRoot();

try {
  const distinctIdsPath = writeRolloutFile(root, {
    sessionId: '019a1111-a111-7aa1-8111-111111111111',
    records: [
      canonicalSessionMeta({ id: '019a1111-a111-7aa1-8111-111111111111' }),
      {
        timestamp: '2026-07-12T00:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          id: 'fc_123',
          call_id: 'call_123',
          name: 'spawn_agent',
          arguments: '{"task_name":"protocol_test"}',
        },
      },
      {
        timestamp: '2026-07-12T00:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call_123',
          output: {
            success: true,
          },
        },
      },
    ],
  });

  const output = await parseRolloutFile(distinctIdsPath);

  assert.equal(output.runningCalls.size, 0);
  assert.equal(output.result.toolActivity.recentCalls.length, 1);
  assert.equal(output.result.toolActivity.recentCalls[0].id, 'call_123');
  assert.equal(output.result.toolActivity.recentCalls[0].status, 'completed');

  const idOnlyPath = writeRolloutFile(root, {
    sessionId: '019a2222-b222-7bb2-8222-222222222222',
    timestampLabel: '2026-07-12T00-01-00',
    records: [
      canonicalSessionMeta({ id: '019a2222-b222-7bb2-8222-222222222222' }),
      {
        timestamp: '2026-07-12T00:01:01.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          id: 'fc_id_only',
          name: 'read',
          arguments: '{"file_path":"README.md"}',
        },
      },
    ],
  });

  const idOnlyOutput = await parseRolloutFile(idOnlyPath);
  assert.equal(idOnlyOutput.runningCalls.size, 1);
  assert.equal(idOnlyOutput.runningCalls.has('fc_id_only'), true);
  assert.equal(idOnlyOutput.result.toolActivity.recentCalls[0].id, 'fc_id_only');

  console.log('test-rollout-call-correlation: PASS (2/2 cases)');
} finally {
  cleanupAgentTestRoot(root);
}
