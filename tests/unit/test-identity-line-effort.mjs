import assert from 'node:assert/strict';

import { renderIdentityLine } from '../../dist/render/lines/identity-line.js';
import { stripAnsi } from '../../dist/render/colors.js';

const layout = {
  mode: 'expanded',
  showSeparators: false,
  showDuration: true,
  showContextBreakdown: true,
  barWidth: 10,
};

const baseData = {
  config: {
    model: 'gpt-5.4',
    model_reasoning_effort: 'high',
    model_provider: 'openai',
  },
  git: {
    branch: null,
    isDirty: false,
    isGitRepo: false,
    ahead: 0,
    behind: 0,
    modified: 0,
    added: 0,
    deleted: 0,
    untracked: 0,
  },
  project: {
    cwd: '/tmp/codex-hud',
    projectName: 'codex-hud',
    agentsMdCount: 0,
    hasCodexDir: false,
    instructionsMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    configsCount: 0,
    extensionsCount: 0,
    workMode: 'development',
  },
  sessionStart: new Date('2026-04-09T00:00:00Z'),
};

const sessionDriven = stripAnsi(
  renderIdentityLine(
    {
      ...baseData,
      session: {
        id: '019d7295-3ef8-7292-a039-fdf7ecd4f53e',
        rolloutPath: '/tmp/rollout.jsonl',
        startTime: new Date('2026-04-09T00:00:00Z'),
        cwd: '/tmp/codex-hud',
        cliVersion: '0.118.0',
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      },
    },
    layout
  )
);

assert.match(
  sessionDriven,
  /\[gpt-5\.4 xhigh\]/,
  'identity line should prefer the current session effort over config defaults'
);

const configDriven = stripAnsi(renderIdentityLine(baseData, layout));
assert.match(
  configDriven,
  /\[gpt-5\.4 high\]/,
  'identity line should show config reasoning effort before a session is bound'
);

console.log('test-identity-line-effort: PASS');
