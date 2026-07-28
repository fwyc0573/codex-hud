import assert from 'node:assert/strict';
import fs from 'node:fs';

import { parseRolloutFile, RolloutParser } from '../../dist/collectors/rollout.js';
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

  const completedIdOnlyPath = writeRolloutFile(root, {
    sessionId: '019a3333-c333-7cc3-8333-333333333333',
    timestampLabel: '2026-07-12T00-02-00',
    records: [
      canonicalSessionMeta({ id: '019a3333-c333-7cc3-8333-333333333333' }),
      {
        timestamp: '2026-07-12T00:02:01.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          id: 'fc_completed_id_only',
          name: 'read',
          arguments: '{"file_path":"README.md"}',
        },
      },
      {
        timestamp: '2026-07-12T00:02:02.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'fc_completed_id_only',
          output: {
            success: true,
          },
        },
      },
    ],
  });

  const completedIdOnlyOutput = await parseRolloutFile(completedIdOnlyPath);
  assert.equal(completedIdOnlyOutput.runningCalls.size, 0);
  assert.equal(completedIdOnlyOutput.result.toolActivity.recentCalls.length, 1);
  assert.equal(
    completedIdOnlyOutput.result.toolActivity.recentCalls[0].id,
    'fc_completed_id_only'
  );
  assert.equal(
    completedIdOnlyOutput.result.toolActivity.recentCalls[0].status,
    'completed'
  );

  const mcpPath = writeRolloutFile(root, {
    sessionId: '019a4444-d444-7dd4-8444-444444444444',
    timestampLabel: '2026-07-12T00-03-00',
    records: [
      canonicalSessionMeta({ id: '019a4444-d444-7dd4-8444-444444444444' }),
      {
        timestamp: '2026-07-12T00:03:01.000Z',
        type: 'event_msg',
        payload: {
          type: 'mcp_tool_call_begin',
          call_id: 'call_mcp_1',
          invocation: {
            server: 'serena',
            tool: 'read_file',
            arguments: { path: 'README.md' },
          },
        },
      },
      {
        timestamp: '2026-07-12T00:03:02.000Z',
        type: 'event_msg',
        payload: {
          type: 'mcp_tool_call_end',
          call_id: 'call_mcp_1',
          invocation: {
            server: 'serena',
            tool: 'read_file',
            arguments: { path: 'README.md' },
          },
          duration: { secs: 1, nanos: 0 },
          result: { Ok: { content: [{ type: 'text', text: 'ok' }] } },
        },
      },
    ],
  });
  const mcpOutput = await parseRolloutFile(mcpPath);
  assert.equal(mcpOutput.runningCalls.size, 0);
  assert.equal(mcpOutput.result.toolActivity.recentCalls.length, 1);
  assert.equal(mcpOutput.result.toolActivity.recentCalls[0].id, 'call_mcp_1');
  assert.equal(mcpOutput.result.toolActivity.recentCalls[0].name, 'serena/read_file');
  assert.equal(mcpOutput.result.toolActivity.recentCalls[0].status, 'completed');

  const legacyMcpPath = writeRolloutFile(root, {
    sessionId: '019a5555-e555-7ee5-8555-555555555555',
    timestampLabel: '2026-07-12T00-04-00',
    records: [
      canonicalSessionMeta({ id: '019a5555-e555-7ee5-8555-555555555555' }),
      {
        timestamp: '2026-07-12T00:04:01.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          call_id: 'call_legacy_mcp',
          name: 'initial_instructions',
          arguments: '{}',
        },
      },
      {
        timestamp: '2026-07-12T00:04:02.000Z',
        type: 'event_msg',
        payload: {
          type: 'mcp_tool_call_end',
          call_id: 'call_legacy_mcp',
          invocation: {
            server: 'serena',
            tool: 'initial_instructions',
            arguments: {},
          },
          duration: { secs: 1, nanos: 0 },
          result: { Ok: {} },
        },
      },
    ],
  });
  const legacyMcpOutput = await parseRolloutFile(legacyMcpPath);
  assert.equal(legacyMcpOutput.result.toolActivity.totalCalls, 1);
  assert.deepEqual(
    legacyMcpOutput.result.toolActivity.callsByType,
    { 'serena/initial_instructions': 1 },
    'MCP enrichment migrates the generic call type without duplicate counting'
  );
  assert.equal(legacyMcpOutput.result.toolActivity.recentCalls[0].name, 'serena/initial_instructions');

  const incrementalLegacyPath = writeRolloutFile(root, {
    sessionId: '019a6666-f666-7ff6-8666-666666666666',
    timestampLabel: '2026-07-12T00-05-00',
    records: [
      canonicalSessionMeta({ id: '019a6666-f666-7ff6-8666-666666666666' }),
      {
        timestamp: '2026-07-12T00:05:01.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          call_id: 'call_incremental_mcp',
          name: 'get_current_config',
          arguments: '{}',
        },
      },
    ],
  });
  const incrementalLegacyParser = new RolloutParser(5);
  incrementalLegacyParser.setRolloutPath(incrementalLegacyPath);
  await incrementalLegacyParser.parse();
  fs.appendFileSync(incrementalLegacyPath, `${JSON.stringify({
    timestamp: '2026-07-12T00:05:02.000Z',
    type: 'event_msg',
    payload: {
      type: 'mcp_tool_call_end',
      call_id: 'call_incremental_mcp',
      invocation: { server: 'serena', tool: 'get_current_config', arguments: {} },
      duration: { secs: 1, nanos: 0 },
      result: { Ok: {} },
    },
  })}\n`, 'utf8');
  const incrementalLegacyOutput = await incrementalLegacyParser.parse();
  assert.equal(incrementalLegacyOutput?.toolActivity.totalCalls, 1);
  assert.deepEqual(
    incrementalLegacyOutput?.toolActivity.callsByType,
    { 'serena/get_current_config': 1 },
    'incremental MCP enrichment migrates cached generic counters'
  );

  console.log('test-rollout-call-correlation: PASS (6/6 cases)');
} finally {
  cleanupAgentTestRoot(root);
}
