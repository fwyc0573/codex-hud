import assert from 'node:assert/strict';

import { renderIdentityLine } from '../../dist/render/lines/identity-line.js';
import { renderHud } from '../../dist/render/header.js';
import { stripAnsi } from '../../dist/render/colors.js';

// The expanded layout must not repeat the context bar on its first (identity)
// line, because Row 3 (the token line) already renders the context bar with
// more detail. The compact layout has no token line, so it must keep the bar.

const BAR_CHARS = /[█░]/; // █ (filled) or ░ (empty)

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
  session: {
    id: '019d7295-3ef8-7292-a039-fdf7ecd4f53e',
    rolloutPath: '/tmp/rollout.jsonl',
    startTime: new Date('2026-04-09T00:00:00Z'),
    cwd: '/tmp/codex-hud',
    cliVersion: '0.118.0',
    model: 'gpt-5.4',
    reasoningEffort: 'high',
  },
  contextUsage: {
    used: 50000,
    total: 128000,
    percent: 45,
    inputTokens: 50000,
    outputTokens: 0,
    cachedTokens: 0,
    compactCount: 0,
  },
};

// --- Mechanism: the showContext option toggles the context bar ---------------

const suppressed = stripAnsi(renderIdentityLine(baseData, layout, { showContext: false }));
assert.match(suppressed, /\[gpt-5\.4 high\]/, 'identity line keeps model and effort when context is suppressed');
assert.doesNotMatch(suppressed, BAR_CHARS, 'showContext:false must drop the context grid bar');
assert.doesNotMatch(suppressed, /\d+%/, 'showContext:false must drop the context percentage');

const kept = stripAnsi(renderIdentityLine(baseData, layout));
assert.match(kept, BAR_CHARS, 'identity line keeps the context bar by default (compact callers rely on it)');
assert.match(kept, /45%/, 'identity line keeps the context percentage by default');

// --- End to end: expanded suppresses on Row 1 but still shows Ctx on Row 3 ----

const expandedLines = renderHud(baseData, {
  width: 120,
  showDetails: true,
  layout: { ...layout, mode: 'expanded' },
}).map(stripAnsi);

assert.ok(expandedLines.length >= 2, 'expanded layout should produce multiple rows');
const expandedRow1 = expandedLines[0];
assert.match(expandedRow1, /\[gpt-5\.4 high\]/, 'expanded Row 1 still shows model and effort');
assert.doesNotMatch(expandedRow1, BAR_CHARS, 'expanded Row 1 must not render the redundant context bar');
assert.doesNotMatch(expandedRow1, /\d+%/, 'expanded Row 1 must not render the redundant context percentage');

const ctxRow = expandedLines.slice(1).find((l) => l.includes('Ctx:'));
assert.ok(ctxRow, 'expanded layout must still render the context bar on the token line (Row 3)');
assert.match(ctxRow, BAR_CHARS, 'expanded Row 3 (Ctx) keeps the detailed context bar');
assert.match(ctxRow, /45%/, 'expanded Row 3 (Ctx) keeps the context percentage');

// --- End to end: compact keeps the context bar on its single identity row -----

const compactLines = renderHud(baseData, {
  width: 120,
  showDetails: true,
  layout: { ...layout, mode: 'compact' },
}).map(stripAnsi);

const compactRow1 = compactLines[0];
assert.match(compactRow1, /\[gpt-5\.4 high\]/, 'compact Row 1 shows model and effort');
assert.match(compactRow1, BAR_CHARS, 'compact Row 1 must keep the context bar (it has no token line)');
assert.match(compactRow1, /45%/, 'compact Row 1 must keep the context percentage');

console.log('test-identity-context-dedup: PASS');
