import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseRolloutFile, RolloutParser } from '../../dist/collectors/rollout.js';

function writeRollout(records) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-mcp-'));
  const file = path.join(root, 'rollout-mcp.jsonl');
  fs.writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
  return { root, file };
}

const { root, file } = writeRollout([
  {
    timestamp: '2026-07-28T14:00:00.000Z',
    type: 'session_meta',
    payload: {
      id: '019f9db5-0000-7000-8000-000000000000',
      timestamp: '2026-07-28T14:00:00.000Z',
      cwd: '/tmp/codex-hud-mcp-fixture',
      originator: 'codex-tui',
      cli_version: '0.144.4',
      source: 'cli',
    },
  },
  {
    timestamp: '2026-07-28T14:00:01.000Z',
    type: 'event_msg',
    payload: {
      type: 'mcp_tool_call_begin',
      call_id: 'mcp-1',
      invocation: {
        server: 'serena',
        tool: 'get_symbols_overview',
        arguments: { relative_path: 'src/index.ts' },
      },
    },
  },
  {
    timestamp: '2026-07-28T14:00:03.000Z',
    type: 'event_msg',
    payload: {
      type: 'mcp_tool_call_end',
      call_id: 'mcp-1',
      invocation: {
        server: 'serena',
        tool: 'get_symbols_overview',
        arguments: { relative_path: 'src/index.ts' },
      },
      duration: { secs: 2, nanos: 500000000 },
      result: { Ok: { content: [] } },
    },
  },
  {
    timestamp: '2026-07-28T14:00:04.000Z',
    type: 'event_msg',
    payload: {
      type: 'mcp_tool_call_end',
      call_id: 'mcp-2',
      invocation: { server: 'serena', tool: 'get_diagnostics_for_file', arguments: {} },
      result: { Err: { message: 'server unavailable' } },
    },
  },
]);

const parsed = await parseRolloutFile(file, 0, 10);
assert.equal(parsed.result.toolActivity.totalCalls, 2, 'MCP calls count as tool activity');
assert.deepEqual(
  parsed.result.toolActivity.recentCalls.map((call) => [call.name, call.status]),
  [
    ['serena/get_symbols_overview', 'completed'],
    ['serena/get_diagnostics_for_file', 'error'],
  ],
  'MCP server/tool names and result status are rendered as tool activity'
);
assert.equal(parsed.result.toolActivity.recentCalls[0].duration, 2500);
assert.equal(parsed.runningCalls.size, 0, 'completed MCP calls leave no running state');

const parser = new RolloutParser(10);
parser.setRolloutPath(file);
const initial = await parser.parse();
assert.equal(initial?.toolActivity.totalCalls, 2);
fs.appendFileSync(file, `${JSON.stringify({
  timestamp: '2026-07-28T14:00:05.000Z',
  type: 'event_msg',
  payload: {
    type: 'mcp_tool_call_end',
    call_id: 'mcp-3',
    invocation: { server: 'serena', tool: 'read_memory', arguments: {} },
    result: { Ok: { content: [] } },
  },
})}\n`, 'utf8');
const incremental = await parser.parse();
assert.equal(incremental?.toolActivity.totalCalls, 3, 'incremental MCP event is observed once');
assert.equal(
  incremental?.toolActivity.recentCalls.at(-1)?.name,
  'serena/read_memory'
);

fs.rmSync(root, { recursive: true, force: true });
console.log('test-rollout-mcp: PASS');
