import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseRolloutFile, RolloutParser } from '../../dist/collectors/rollout.js';

function writeRollout(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-rollout-'));
  const filePath = path.join(dir, 'rollout-2026-04-09T22-11-16-019d7295-3ef8-7292-a039-fdf7ecd4f53e.jsonl');
  fs.writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  return filePath;
}

const sessionId = '019d7295-3ef8-7292-a039-fdf7ecd4f53e';

const rolloutPath = writeRollout([
  {
    timestamp: '2026-04-09T14:17:53.997Z',
    type: 'session_meta',
    payload: {
      id: sessionId,
      timestamp: '2026-04-09T14:11:16.858Z',
      cwd: '/local/ycfeng/codex-hud',
      originator: 'codex-tui',
      cli_version: '0.118.0',
      source: 'cli',
      model_provider: 'packycode',
    },
  },
  {
    timestamp: '2026-04-09T14:17:53.998Z',
    type: 'turn_context',
    payload: {
      turn_id: '019d729b-4e3d-75c0-a1c7-46beee7d0e21',
      cwd: '/local/ycfeng/codex-hud',
      current_date: '2026-04-09',
      timezone: 'Asia/Hong_Kong',
      approval_policy: 'on-request',
      sandbox_policy: { type: 'workspace-write' },
      model: 'gpt-5.4',
      collaboration_mode: {
        mode: 'plan',
        settings: {
          model: 'gpt-5.4',
          reasoning_effort: 'xhigh',
        },
      },
    },
  },
  {
    timestamp: '2026-04-09T14:17:53.999Z',
    type: 'event_msg',
    payload: {
      type: 'thread_settings_applied',
      thread_settings: {
        service_tier: 'priority',
      },
    },
  },
]);

const { result } = await parseRolloutFile(rolloutPath, 0, 5);

assert.equal(result.session?.model, 'gpt-5.4', 'turn_context should populate session model');
assert.equal(
  result.session?.reasoningEffort,
  'xhigh',
  'turn_context should populate session reasoning effort'
);
assert.equal(
  result.session?.approvalPolicy,
  'on-request',
  'turn_context should populate the runtime approval policy'
);
assert.equal(
  result.session?.sandboxMode,
  'workspace-write',
  'turn_context should populate the runtime sandbox mode'
);
assert.equal(
  result.session?.serviceTier,
  'priority',
  'thread_settings_applied should populate the runtime service tier'
);

const parser = new RolloutParser(5);
parser.setRolloutPath(rolloutPath);
const parserResult = await parser.parse();

assert.equal(parserResult?.session?.model, 'gpt-5.4', 'stateful parser should keep session model');
assert.equal(
  parserResult?.session?.reasoningEffort,
  'xhigh',
  'stateful parser should keep session reasoning effort'
);
assert.equal(
  parserResult?.session?.approvalPolicy,
  'on-request',
  'stateful parser should keep the runtime approval policy'
);
assert.equal(
  parserResult?.session?.sandboxMode,
  'workspace-write',
  'stateful parser should keep the runtime sandbox mode'
);
assert.equal(
  parserResult?.session?.serviceTier,
  'priority',
  'stateful parser should keep the runtime service tier'
);

const updatedPermissionRollout = `${fs.readFileSync(rolloutPath, 'utf8')}${JSON.stringify({
  timestamp: '2026-04-09T14:18:05.000Z',
  type: 'turn_context',
  payload: {
    turn_id: '019d729b-4e3d-75c0-a1c7-46beee7d0e22',
    cwd: '/local/ycfeng/codex-hud',
    approval_policy: 'never',
    sandbox_policy: { type: 'danger-full-access' },
  },
})}\n`;
fs.writeFileSync(rolloutPath, updatedPermissionRollout, 'utf8');
const updatedParserResult = await parser.parse();
assert.equal(
  updatedParserResult?.session?.approvalPolicy,
  'never',
  'a later turn_context must update the existing session approval policy'
);
assert.equal(
  updatedParserResult?.session?.sandboxMode,
  'danger-full-access',
  'a later turn_context must update the existing session sandbox mode'
);

const updatedServiceTierRollout = `${fs.readFileSync(rolloutPath, 'utf8')}${JSON.stringify({
  timestamp: '2026-04-09T14:18:06.000Z',
  type: 'event_msg',
  payload: {
    type: 'thread_settings_applied',
    thread_settings: {
      service_tier: 'default',
    },
  },
})}\n`;
fs.writeFileSync(rolloutPath, updatedServiceTierRollout, 'utf8');
const updatedServiceTierResult = await parser.parse();
assert.equal(
  updatedServiceTierResult?.session?.serviceTier,
  'default',
  'a later thread_settings_applied event must update the existing service tier'
);

const rolloutWithRunningCall = writeRollout([
  {
    timestamp: '2026-04-09T14:17:53.997Z',
    type: 'session_meta',
    payload: {
      id: '019d7291-a135-7fe1-b46f-8f3eca4fa451',
      timestamp: '2026-04-09T14:11:16.858Z',
      cwd: '/local/ycfeng/codex-hud',
      originator: 'codex-tui',
      cli_version: '0.118.0',
      source: 'cli',
      model_provider: 'packycode',
    },
  },
  {
    timestamp: '2026-04-09T14:17:54.000Z',
    type: 'response_item',
    payload: {
      type: 'function_call',
      id: 'call-1',
      name: 'Read',
      arguments: '{"file_path":"a.ts"}',
    },
  },
]);

const rolloutWithOutputOnly = writeRollout([
  {
    timestamp: '2026-04-09T14:18:10.000Z',
    type: 'session_meta',
    payload: {
      id: '019d7295-3ef8-7292-a039-fdf7ecd4f53e',
      timestamp: '2026-04-09T14:18:10.000Z',
      cwd: '/local/ycfeng/codex-hud',
      originator: 'codex-tui',
      cli_version: '0.118.0',
      source: 'cli',
      model_provider: 'packycode',
    },
  },
  {
    timestamp: '2026-04-09T14:18:11.000Z',
    type: 'response_item',
    payload: {
      type: 'function_call_output',
      call_id: 'call-1',
      output: {
        success: true,
      },
    },
  },
]);

const switchingParser = new RolloutParser(5);
switchingParser.setRolloutPath(rolloutWithRunningCall);
await switchingParser.parse();
switchingParser.setRolloutPath(rolloutWithOutputOnly);
const switched = await switchingParser.parse();

assert.equal(
  switched?.toolActivity.recentCalls.length,
  0,
  'switching rollouts should clear running tool calls from the previous session'
);

console.log('test-rollout-turn-context: PASS');
