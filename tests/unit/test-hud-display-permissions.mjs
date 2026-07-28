import assert from 'node:assert/strict';
import { renderHud } from '../../dist/render/header.js';
import { renderTokenLine } from '../../dist/render/lines/activity-line.js';
import { stripAnsi } from '../../dist/render/colors.js';
import { getApprovalPolicyDisplay, getFastModeDisplay } from '../../dist/collectors/codex-config.js';

const layout = {
  mode: 'expanded',
  showSeparators: false,
  showDuration: true,
  showContextBreakdown: true,
  barWidth: 10,
};

const baseData = {
  config: {
    model: 'gpt-5.6-sol',
    model_reasoning_effort: 'high',
    model_provider: 'stepcode',
  },
  git: {
    branch: 'main',
    isDirty: true,
    isGitRepo: true,
    ahead: 0,
    behind: 0,
    modified: 1,
    added: 0,
    deleted: 0,
    untracked: 0,
  },
  project: {
    cwd: '/tmp/new-topic-research',
    projectName: 'new-topic-research',
    agentsMdCount: 0,
    hasCodexDir: false,
    instructionsMdCount: 0,
    rulesCount: 0,
    mcpCount: 2,
    configsCount: 0,
    extensionsCount: 2,
    skillsCount: 3,
    hooksCount: 2,
    workMode: 'development',
  },
  sessionStart: new Date('2026-07-27T00:00:00Z'),
  session: {
    id: '019f9db5-0000-7000-8000-000000000000',
    rolloutPath: '/tmp/rollout.jsonl',
    startTime: new Date('2026-07-27T00:00:00Z'),
    cwd: '/tmp/new-topic-research',
    cliVersion: '0.144.4',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'high',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    serviceTier: 'priority',
  },
  tokenUsage: {
    last_token_usage: {
      total_tokens: 282400,
      input_tokens: 282142,
      cached_input_tokens: 281300,
      output_tokens: 199,
    },
    model_context_window: 341400,
  },
  contextUsage: {
    used: 270400,
    total: 341400,
    percent: 79,
    inputTokens: 842,
    outputTokens: 199,
    cachedTokens: 281300,
    compactCount: 8,
  },
  displayMode: 'single',
};

const tokenLine = stripAnsi(renderTokenLine(baseData));
assert.match(tokenLine, /^Ctx: /, 'context segment must lead the token row');
assert.ok(tokenLine.indexOf('Ctx: ') < tokenLine.indexOf('Tokens: '), 'Tokens must follow Ctx');
assert.match(tokenLine, /Ctx: .*79% \(270\.4K\/341\.4K\) \| Tokens: 282\.4K/);
assert.match(tokenLine, /Tokens: 282\.4K \| \(in: 842, cache: 281\.3K, out: 199\) \| ↻8$/);

const expandedLines = renderHud(baseData, {
  width: 160,
  showDetails: true,
  layout,
}).map(stripAnsi);
const environmentLine = expandedLines.find((line) => line.includes('Approval:'));
assert.ok(environmentLine, 'expanded layout must render an environment line');
assert.doesNotMatch(environmentLine, /mode:/, 'environment line must not expose mode');
assert.match(environmentLine, /Approval: ask for approval/);
assert.match(environmentLine, /Fast: on/);
assert.match(environmentLine, /2 extensions.*3 skills.*2 hooks/);

const runtimePermissionLines = renderHud({
  ...baseData,
  session: {
    ...baseData.session,
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
  },
}, {
  width: 160,
  showDetails: true,
  layout,
}).map(stripAnsi);
const runtimeEnvironmentLine = runtimePermissionLines.find((line) => line.includes('Approval:'));
assert.match(runtimeEnvironmentLine, /Approval: full access/);
assert.match(runtimeEnvironmentLine, /Sandbox: DANGER/);

assert.equal(
  getApprovalPolicyDisplay({ approval_policy: 'on-request' }),
  'ask for approval'
);
assert.equal(
  getApprovalPolicyDisplay({ approval_policy: 'untrusted' }),
  'ask for approval'
);
assert.equal(
  getApprovalPolicyDisplay({ approval_policy: 'on-failure' }),
  'approve for me'
);
assert.equal(
  getApprovalPolicyDisplay({ approval_policy: 'never', sandbox_mode: 'workspace-write' }),
  'approve for me'
);
assert.equal(
  getApprovalPolicyDisplay({ approval_policy: 'never', sandbox_mode: 'danger-full-access' }),
  'full access'
);
assert.equal(
  getApprovalPolicyDisplay(
    { approval_policy: 'on-request', sandbox_mode: 'workspace-write' },
    { approvalPolicy: 'never', sandboxMode: 'danger-full-access' }
  ),
  'full access',
  'runtime permission must override config permission'
);

assert.equal(getFastModeDisplay({ service_tier: 'fast' }), 'Fast: on');
assert.equal(getFastModeDisplay({ service_tier: 'default' }), 'Fast: off');
assert.equal(
  getFastModeDisplay({ service_tier: 'default' }, { serviceTier: 'priority' }),
  'Fast: on'
);
assert.equal(
  getFastModeDisplay({ service_tier: 'fast' }, { serviceTier: 'default' }),
  'Fast: off'
);

console.log('test-hud-display-permissions: PASS');
