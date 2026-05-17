import assert from 'node:assert/strict';

import { renderEnvironmentLine } from '../../dist/render/lines/environment-line.js';
import { stripAnsi } from '../../dist/render/colors.js';

const line = stripAnsi(
  renderEnvironmentLine({
    config: {
      model: 'gpt-5.4',
      approval_policy: 'on-request',
      sandbox_mode: 'workspace-write',
      mcp_servers: {
        demo: { enabled: true, command: ['node', 'server.js'] },
      },
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
      agentsMdCount: 1,
      hasCodexDir: true,
      instructionsMdCount: 0,
      rulesCount: 0,
      mcpCount: 1,
      configsCount: 1,
      extensionsCount: 1,
      workMode: 'development',
    },
    sessionStart: new Date('2026-04-20T00:00:00Z'),
    session: {
      id: '019da632-9a40-7c01-bfa6-b2f069d6083f',
      rolloutPath: '/tmp/rollout.jsonl',
      startTime: new Date('2026-04-20T00:00:00Z'),
      cwd: '/tmp/codex-hud',
      cliVersion: '0.121.0',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      collaborationMode: 'plan',
    },
  })
);

assert.match(line, /mode: plan/, 'environment line should prefer runtime collaboration mode');
assert.match(line, /Approval: auto/, 'environment line should prefer runtime approval policy');
assert.match(line, /Sandbox: DANGER/, 'environment line should prefer runtime sandbox mode');
assert.doesNotMatch(line, /mode: dev/, 'runtime mode should replace project work mode');
assert.doesNotMatch(line, /Approval: on-req/, 'runtime approval should replace config approval');
assert.doesNotMatch(line, /Sandbox: ws-write/, 'runtime sandbox should replace config sandbox');

const runtimeOnlyLine = stripAnsi(
  renderEnvironmentLine({
    config: {
      model: 'gpt-5.4',
      approval_policy: 'on-request',
      sandbox_mode: 'workspace-write',
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
      agentsMdCount: 1,
      hasCodexDir: true,
      instructionsMdCount: 0,
      rulesCount: 0,
      mcpCount: 0,
      configsCount: 1,
      extensionsCount: 0,
      workMode: 'development',
    },
    sessionStart: new Date('2026-04-20T00:00:00Z'),
    runtimeSession: {
      collaborationMode: 'plan',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
    },
  })
);

assert.match(runtimeOnlyLine, /mode: plan/, 'runtime-only fallback should surface plan mode');
assert.match(runtimeOnlyLine, /Approval: auto/, 'runtime-only fallback should surface approval');
assert.match(runtimeOnlyLine, /Sandbox: DANGER/, 'runtime-only fallback should surface sandbox');
assert.doesNotMatch(runtimeOnlyLine, /mode: dev/, 'runtime-only fallback should override project work mode');

console.log('test-environment-line-runtime-state: PASS');
