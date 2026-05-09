import assert from 'node:assert/strict';

import { renderHud } from '../../dist/render/header.js';
import { stripAnsi } from '../../dist/render/colors.js';

const layout = {
  mode: 'expanded',
  showSeparators: false,
  showDuration: true,
  showContextBreakdown: true,
  barWidth: 8,
};

const data = {
  config: {
    model: 'gpt-5.5',
    model_reasoning_effort: 'xhigh',
    model_provider: 'openai',
    approval_policy: 'auto',
    sandbox_mode: 'danger-full-access',
  },
  git: {
    branch: 'main',
    isDirty: false,
    isGitRepo: true,
    ahead: 0,
    behind: 0,
    modified: 0,
    added: 0,
    deleted: 0,
    untracked: 0,
  },
  project: {
    cwd: '/Users/rex/soft/everything-claude-code',
    projectName: 'everything-claude-code',
    agentsMdCount: 2,
    hasCodexDir: true,
    instructionsMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    configsCount: 2,
    extensionsCount: 0,
    workMode: 'development',
  },
  sessionStart: new Date('2026-05-09T00:00:00Z'),
  session: {
    id: '019e0b8c-40e8-7523-b527-597946103715',
    rolloutPath: '/tmp/rollout.jsonl',
    startTime: new Date('2026-05-09T00:00:00Z'),
    cwd: '/Users/rex/soft/everything-claude-code',
    cliVersion: '0.130.0',
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
    modelProvider: 'OpenAI',
  },
  tokenUsage: {
    last_token_usage: {
      input_tokens: 225000,
      cached_input_tokens: 220000,
      output_tokens: 46,
      total_tokens: 225046,
    },
    model_context_window: 258400,
  },
  contextUsage: {
    used: 237046,
    total: 258400,
    percent: 92,
    inputTokens: 5000,
    outputTokens: 46,
    cachedTokens: 220000,
    compactCount: 1,
  },
  displayMode: 'single',
};

const lines = renderHud(data, { width: 120, showDetails: true, layout });
const plain = lines.map(stripAnsi).join('\n');

assert.match(plain, /everything-claude-code git:\(main\)/, 'expanded header should keep project and git');
assert.doesNotMatch(plain, /\[gpt-5\.5 xhigh\]/, 'expanded layout should not repeat model identity');
assert.doesNotMatch(plain, /Dir: /, 'expanded layout should not repeat the working directory');
assert.equal((plain.match(/Ctx:/g) ?? []).length, 1, 'context should be shown only on the token line');
assert.equal((plain.match(/92%/g) ?? []).length, 1, 'context percent should not be duplicated');

console.log('test-expanded-layout-no-duplicate-context: PASS');
