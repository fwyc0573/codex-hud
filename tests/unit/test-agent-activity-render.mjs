import assert from 'node:assert/strict';

import * as activityRender from '../../dist/render/lines/activity-line.js';
import * as lineExports from '../../dist/render/lines/index.js';
import * as headerRender from '../../dist/render/header.js';
import { renderToStdout } from '../../dist/render/index.js';
import {
  colors,
  stripAnsi,
  theme,
  visualLength,
} from '../../dist/render/colors.js';

assert.equal(
  typeof activityRender.formatAgentElapsed,
  'function',
  'formatAgentElapsed must be exported by the activity renderer'
);
assert.equal(
  typeof activityRender.renderAgentLines,
  'function',
  'renderAgentLines must be exported by the activity renderer'
);
assert.equal(
  typeof lineExports.renderAgentLines,
  'function',
  'renderAgentLines must be re-exported by the line renderer index'
);
assert.equal(
  typeof headerRender.renderCompactAgentSummary,
  'function',
  'renderCompactAgentSummary must be exported by the header renderer'
);

const {
  collectActivityLines,
  formatAgentElapsed,
  renderAgentLines,
} = activityRender;
const {
  renderIdentityLine,
  renderProjectLine,
  renderUsageLine,
} = lineExports;
const {
  renderCompactAgentSummary,
  renderHud,
} = headerRender;

function makeRow(overrides = {}) {
  return {
    threadId: 'agent-thread',
    agentPath: '/root/codex_cli_explore',
    label: 'codex_cli_explore',
    status: 'running',
    elapsedStartedAt: new Date(0),
    activeDescendantCount: 0,
    ...overrides,
  };
}

function makeAgentActivity({ rows = [], visibleAgentCount = rows.length, rootTrackingError = false } = {}) {
  return {
    rows,
    visibleAgentCount,
    rootTrackingError,
    updatedAt: new Date(134000),
  };
}

const baseData = {
  config: {
    model: 'gpt-test',
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
    cwd: '/tmp/codex-hud-agent-render',
    projectName: 'agent-render-project',
    agentsMdCount: 0,
    hasCodexDir: false,
    instructionsMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    configsCount: 0,
    extensionsCount: 0,
    workMode: 'development',
  },
  sessionStart: new Date(Date.now() - 120000),
  displayMode: 'single',
};

const expandedLayout = {
  mode: 'expanded',
  showSeparators: false,
  showDuration: true,
  showContextBreakdown: true,
  barWidth: 10,
};

const compactLayout = {
  mode: 'compact',
  showSeparators: true,
  showDuration: true,
  showContextBreakdown: false,
  barWidth: 10,
};

// Elapsed formatting is deterministic, floored, and rejects invalid normal timers.
const elapsedCases = [
  { startedAt: new Date(0), nowMs: 14000, expected: '14s' },
  { startedAt: new Date(0), nowMs: 14999, expected: '14s' },
  { startedAt: new Date(0), nowMs: 59000, expected: '59s' },
  { startedAt: new Date(0), nowMs: 60000, expected: '1m00s' },
  { startedAt: new Date(0), nowMs: 134000, expected: '2m14s' },
  { startedAt: new Date(0), nowMs: 3600000, expected: '1h00m' },
  { startedAt: new Date(0), nowMs: 3720000, expected: '1h02m' },
];

for (const testCase of elapsedCases) {
  assert.equal(
    formatAgentElapsed(testCase.startedAt, testCase.nowMs),
    testCase.expected,
    `elapsed formatting at ${testCase.nowMs} ms`
  );
}

assert.throws(
  () => formatAgentElapsed(new Date(Number.NaN), 134000),
  /startedAt/,
  'invalid start dates must fail fast'
);
assert.throws(
  () => formatAgentElapsed(new Date(0), Number.NaN),
  /nowMs/,
  'invalid current timestamps must fail fast'
);
assert.throws(
  () => formatAgentElapsed(new Date(135000), 134000),
  /before/,
  'negative elapsed durations must fail fast'
);
assert.throws(
  () => renderAgentLines(
    makeAgentActivity({ rows: [makeRow({ elapsedStartedAt: undefined })] }),
    80,
    134000
  ),
  /elapsedStartedAt/,
  'normal rows without a timer must fail fast'
);

// Starting and running rows share the deterministic spinner presentation.
for (const status of ['starting', 'running']) {
  const [rendered] = renderAgentLines(
    makeAgentActivity({
      rows: [makeRow({ status, activeDescendantCount: 2 })],
      visibleAgentCount: 3,
    }),
    80,
    134000
  );
  assert.equal(
    stripAnsi(rendered),
    '◐ codex_cli_explore 2m14s ↳2',
    `${status} row must render spinner, label, elapsed time, and descendants`
  );
  assert.doesNotMatch(stripAnsi(rendered), /starting|running/, 'normal rows omit state words');
  assert.match(rendered, /\x1b\[/, 'normal rows retain ANSI styling');
  assert.ok(rendered.endsWith('\x1b[0m'), 'normal row ANSI styling must be terminated');
}

const [withoutDescendants] = renderAgentLines(
  makeAgentActivity({ rows: [makeRow()] }),
  80,
  134000
);
assert.equal(stripAnsi(withoutDescendants), '◐ codex_cli_explore 2m14s');
assert.doesNotMatch(stripAnsi(withoutDescendants), /↳0/, 'zero descendants are omitted');

const [trackingError] = renderAgentLines(
  makeAgentActivity({
    rows: [makeRow({ status: 'tracking-error', elapsedStartedAt: undefined, activeDescendantCount: 7 })],
  }),
  80,
  134000
);
assert.equal(stripAnsi(trackingError), '✗ codex_cli_explore tracking error');
assert.doesNotMatch(stripAnsi(trackingError), /2m14s|↳7/, 'error rows omit timers and descendant counts');

const rootErrorLines = renderAgentLines(
  makeAgentActivity({
    rows: [makeRow()],
    visibleAgentCount: 9,
    rootTrackingError: true,
  }),
  80,
  134000
);
assert.deepEqual(rootErrorLines.map(stripAnsi), ['✗ agent tracking error']);

// Labels truncate before fixed suffixes, and final ANSI output stays within width.
const [normalWidth20] = renderAgentLines(
  makeAgentActivity({ rows: [makeRow({ activeDescendantCount: 2 })] }),
  20,
  134000
);
assert.equal(stripAnsi(normalWidth20), '◐ codex_cl… 2m14s ↳2');
assert.equal(visualLength(normalWidth20), 20);
assert.ok(normalWidth20.endsWith('\x1b[0m'), 'truncated normal ANSI must be terminated');

const [errorWidth24] = renderAgentLines(
  makeAgentActivity({
    rows: [makeRow({ status: 'tracking-error', elapsedStartedAt: undefined })],
  }),
  24,
  134000
);
assert.equal(stripAnsi(errorWidth24), '✗ codex_… tracking error');
assert.equal(visualLength(errorWidth24), 24);
assert.ok(errorWidth24.endsWith('\x1b[0m'), 'truncated error ANSI must be terminated');

const [extremelyNarrow] = renderAgentLines(
  makeAgentActivity({ rows: [makeRow()] }),
  1,
  134000
);
assert.equal(visualLength(extremelyNarrow), 1);
assert.doesNotMatch(extremelyNarrow, /\x1b\[[0-9;]*$/, 'narrow output must not end in a partial ANSI sequence');

// Compact summaries reflect the full visible tree, with root ownership errors taking precedence.
assert.equal(renderCompactAgentSummary(undefined), null);
assert.equal(renderCompactAgentSummary(null), null);
assert.equal(renderCompactAgentSummary(makeAgentActivity()), null);
const compactCount = renderCompactAgentSummary(
  makeAgentActivity({ rows: [makeRow()], visibleAgentCount: 3 })
);
assert.equal(stripAnsi(compactCount), 'Agents: 3');
const compactRootError = renderCompactAgentSummary(
  makeAgentActivity({ rows: [makeRow()], visibleAgentCount: 99, rootTrackingError: true })
);
assert.equal(stripAnsi(compactRootError), 'Agents: tracking error');
assert.doesNotMatch(stripAnsi(compactRootError), /99/, 'root errors suppress untrusted numeric counts');
const compactRootErrorRow = renderHud(
  {
    ...baseData,
    agentActivity: makeAgentActivity({ rows: [makeRow()], visibleAgentCount: 99, rootTrackingError: true }),
  },
  { width: 200, showDetails: false, layout: compactLayout }
)[0];
assert.match(stripAnsi(compactRootErrorRow), /Agents: tracking error/);
assert.doesNotMatch(stripAnsi(compactRootErrorRow), /Agents: 99/);

// Expanded activity ordering remains tools, agents, then todos, with no agent heading.
const orderedData = {
  ...baseData,
  toolActivity: {
    recentCalls: [{
      id: 'tool-1',
      name: 'Read',
      status: 'completed',
      startTime: new Date(0),
      endTime: new Date(1),
    }],
    totalCalls: 1,
    runningCount: 0,
    lastUpdated: new Date(1),
  },
  agentActivity: makeAgentActivity({
    rows: [makeRow({ status: 'tracking-error', elapsedStartedAt: undefined })],
  }),
  planProgress: {
    steps: [{ step: 'Finish renderer', status: 'completed' }],
    completedSteps: 1,
    totalSteps: 1,
    lastUpdated: new Date(1),
  },
};

const orderedLines = collectActivityLines(orderedData, 80).map(stripAnsi);
const toolsIndex = orderedLines.findIndex((line) => line.includes('✓ Read'));
const agentIndex = orderedLines.findIndex((line) => line.includes('✗ codex_cli_explore tracking error'));
const todosIndex = orderedLines.findIndex((line) => line.includes('📝 1/1'));
assert.ok(toolsIndex >= 0 && toolsIndex < agentIndex, 'tools must precede agent rows');
assert.ok(agentIndex < todosIndex, 'agent rows must precede todos');
assert.equal(orderedLines.some((line) => /^Agents:?$/i.test(line)), false, 'agent rows have no heading');
assert.doesNotThrow(() => collectActivityLines(orderedData), 'the optional width preserves existing callers');

const expandedWidth20 = renderHud(
  {
    ...baseData,
    agentActivity: makeAgentActivity({
      rows: [makeRow({ status: 'tracking-error', elapsedStartedAt: undefined })],
    }),
  },
  { width: 20, showDetails: true, layout: expandedLayout }
);
const expandedAgentLine = expandedWidth20.find((line) => stripAnsi(line).endsWith(' tracking error'));
assert.ok(expandedAgentLine, 'expanded layout must include the agent row');
assert.equal(visualLength(expandedAgentLine), 20, 'expanded layout passes the real terminal width');
assert.ok(stripAnsi(expandedAgentLine).endsWith(' tracking error'), 'expanded truncation preserves the error suffix');

function renderLegacyCompact(data, layout, width) {
  const parts = [];
  parts.push(renderIdentityLine(data, layout, { maxWidth: width }));
  parts.push(renderProjectLine(data));

  if (data.project.mcpCount > 0) {
    parts.push(theme.info(`${data.project.mcpCount}`) + colors.dim(' MCPs'));
  }

  const usageLine = renderUsageLine(data, layout);
  if (usageLine) {
    parts.push(usageLine);
  }

  const separator = layout.showSeparators ? theme.separator(' │ ') : ' ';
  let row = parts.join(separator);
  if (visualLength(row) <= width) {
    return row;
  }

  const trimmedParts = parts.slice(0, 2);
  row = trimmedParts.join(separator);
  if (visualLength(row) <= width) {
    return row;
  }

  const identity = parts[0] ?? '';
  const availableForProject = Math.max(0, width - visualLength(identity) - visualLength(separator));
  const project = renderProjectLine(data, { includeFileStats: false, maxWidth: availableForProject });
  return identity + separator + project;
}

// No-agent compact output stays byte-for-byte identical to the legacy branch.
const legacyData = {
  ...baseData,
  project: {
    ...baseData.project,
    projectName: 'very-long-project-name-for-legacy-regression',
    mcpCount: 7,
  },
};
const legacyLayout = { ...compactLayout, showDuration: false };
for (const width of [120, 20]) {
  const actual = renderHud(legacyData, { width, showDetails: false, layout: legacyLayout })[0];
  const expected = renderLegacyCompact(legacyData, legacyLayout, width);
  assert.equal(actual, expected, `no-agent compact behavior at width ${width}`);
}

// Agent compact degradation removes MCP, then duration, then project, while retaining the summary.
const compactData = {
  ...baseData,
  project: {
    ...baseData.project,
    projectName: 'very-long-project-name-for-agent-priority',
    mcpCount: 7,
  },
  agentActivity: makeAgentActivity({ rows: [makeRow()], visibleAgentCount: 3 }),
};

const fullCompact = renderHud(
  compactData,
  { width: 200, showDetails: false, layout: compactLayout }
)[0];
const fullCompactWidth = visualLength(fullCompact);
assert.match(stripAnsi(fullCompact), /Agents: 3/);
assert.match(stripAnsi(fullCompact), /7 MCPs/);
assert.match(stripAnsi(fullCompact), /⏱️/);

const withoutMcp = renderHud(
  compactData,
  { width: fullCompactWidth - 1, showDetails: false, layout: compactLayout }
)[0];
assert.match(stripAnsi(withoutMcp), /Agents: 3/);
assert.doesNotMatch(stripAnsi(withoutMcp), /7 MCPs/);
assert.match(stripAnsi(withoutMcp), /⏱️/, 'duration remains after MCP is removed');

const withoutMcpWidth = visualLength(withoutMcp);
const withoutDuration = renderHud(
  compactData,
  { width: withoutMcpWidth - 1, showDetails: false, layout: compactLayout }
)[0];
assert.match(stripAnsi(withoutDuration), /Agents: 3/);
assert.doesNotMatch(stripAnsi(withoutDuration), /7 MCPs|⏱️/, 'duration is removed only after MCP');

const summaryWidth = visualLength(compactCount);
const identityWidth = visualLength(renderIdentityLine(compactData, compactLayout, { maxWidth: 200 }));
const separatorWidth = visualLength(theme.separator(' │ '));
const noProjectWidth = identityWidth + separatorWidth + summaryWidth;
const withoutProject = renderHud(
  compactData,
  { width: noProjectWidth, showDetails: false, layout: compactLayout }
)[0];
assert.equal(visualLength(withoutProject), noProjectWidth);
assert.match(stripAnsi(withoutProject), /Agents: 3/);
assert.doesNotMatch(stripAnsi(withoutProject), /very-long-project/, 'project is omitted after it can no longer fit');

const summaryOnly = renderHud(
  compactData,
  { width: summaryWidth, showDetails: false, layout: compactLayout }
)[0];
assert.equal(stripAnsi(summaryOnly), 'Agents: 3', 'summary survives at its exact physical width');

const physicallyImpossible = renderHud(
  compactData,
  { width: summaryWidth - 1, showDetails: false, layout: compactLayout }
)[0];
assert.equal(visualLength(physicallyImpossible), summaryWidth - 1);
assert.notEqual(stripAnsi(physicallyImpossible), 'Agents: 3');

const unshrinkableProject = {
  ...compactData,
  git: {
    ...compactData.git,
    branch: 'feature/branch-that-cannot-fit-the-reserved-project-width',
    isGitRepo: true,
  },
};
const recheckedCompact = renderHud(
  unshrinkableProject,
  { width: noProjectWidth, showDetails: false, layout: compactLayout }
)[0];
assert.ok(visualLength(recheckedCompact) <= noProjectWidth, 'compact composition rechecks project width');
assert.match(stripAnsi(recheckedCompact), /Agents: 3/);
assert.doesNotMatch(stripAnsi(recheckedCompact), /branch-that-cannot-fit/);

// Real stdout rendering remains governed by the existing global height clipper.
const clippedData = {
  ...orderedData,
  agentActivity: makeAgentActivity({
    rows: [
      makeRow({
        threadId: 'agent-one',
        agentPath: '/root/agent_one',
        label: 'agent_one',
        status: 'tracking-error',
        elapsedStartedAt: undefined,
      }),
      makeRow({
        threadId: 'agent-two',
        agentPath: '/root/agent_two',
        label: 'agent_two',
        status: 'tracking-error',
        elapsedStartedAt: undefined,
      }),
      makeRow({
        threadId: 'agent-three',
        agentPath: '/root/agent_three',
        label: 'agent_three',
        status: 'tracking-error',
        elapsedStartedAt: undefined,
      }),
    ],
    visibleAgentCount: 3,
  }),
};

const unclippedLines = renderHud(
  clippedData,
  { width: 80, showDetails: true, layout: expandedLayout }
);
assert.equal(unclippedLines.length, 8, 'unclipped renderer exposes all physical lines');
assert.equal(
  unclippedLines.filter((line) => stripAnsi(line).includes('tracking error')).length,
  3,
  'all agent rows enter the global activity list without an agent-specific cap'
);

const originalWrite = process.stdout.write.bind(process.stdout);
const originalColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
const originalRows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
const writes = [];

Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 80 });
Object.defineProperty(process.stdout, 'rows', { configurable: true, value: 5 });
process.stdout.write = (chunk, encoding, callback) => {
  writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
  if (typeof encoding === 'function') {
    encoding();
  } else if (typeof callback === 'function') {
    callback();
  }
  return true;
};

try {
  renderToStdout(clippedData);
} finally {
  process.stdout.write = originalWrite;
  if (originalColumns) {
    Object.defineProperty(process.stdout, 'columns', originalColumns);
  } else {
    Reflect.deleteProperty(process.stdout, 'columns');
  }
  if (originalRows) {
    Object.defineProperty(process.stdout, 'rows', originalRows);
  } else {
    Reflect.deleteProperty(process.stdout, 'rows');
  }
}

const stdoutOutput = writes.join('');
const physicalLines = stdoutOutput.split('\x1b[2K').slice(1);
assert.equal(physicalLines.length, 5, 'height clipping writes exactly the visible physical line count');
const finalPhysicalLine = stripAnsi(physicalLines[physicalLines.length - 1]).trimEnd();
assert.match(finalPhysicalLine, /…3 more lines hidden/);

const metrics = {
  elapsedExpected: '2m14s',
  elapsedActual: formatAgentElapsed(new Date(0), 134000),
  normalWidthExpected: 20,
  normalWidthActual: visualLength(normalWidth20),
  errorWidthExpected: 24,
  errorWidthActual: visualLength(errorWidth24),
  compactExpected: 3,
  compactActual: Number(stripAnsi(compactCount).split(': ')[1]),
  totalPhysicalLinesExpected: 8,
  totalPhysicalLinesActual: unclippedLines.length,
  visiblePhysicalLinesExpected: 5,
  visiblePhysicalLinesActual: physicalLines.length,
  hiddenPhysicalLinesExpected: 3,
  hiddenPhysicalLinesActual: Number(finalPhysicalLine.match(/…(\d+) more lines hidden/)?.[1]),
  normalPlain: stripAnsi(normalWidth20),
  errorPlain: stripAnsi(errorWidth24),
};

console.log(`test-agent-activity-render: PASS ${JSON.stringify(metrics)}`);
