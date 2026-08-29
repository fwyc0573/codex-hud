import assert from 'node:assert/strict';
import {
  colors,
  padEnd,
  stripAnsi,
  truncate,
  truncateAnsi,
  visualLength,
} from '../../dist/render/colors.js';
import { renderProjectLine } from '../../dist/render/lines/project-line.js';
import { renderToStdout } from '../../dist/render/index.js';

function plain(value) {
  return stripAnsi(value);
}

// Basic terminal-column measurements must follow Unicode display semantics.
assert.equal(visualLength('中文项目'), 8, 'CJK characters occupy two terminal columns');
assert.equal(visualLength('e\u0301'), 1, 'combining marks do not consume a column');
assert.equal(visualLength('👨‍👩‍👧‍👦'), 2, 'a ZWJ emoji sequence is one two-column grapheme');
assert.equal(visualLength('🇨🇳'), 2, 'a regional-indicator flag occupies two columns');
assert.equal(visualLength('🙂'), 2, 'a supplementary-plane emoji occupies two columns');

// ANSI controls, including OSC hyperlinks, do not consume terminal columns.
const coloredCjk = colors.yellow('中文');
const hyperlink = '\x1b]8;;https://example.test\x07中文\x1b]8;;\x07';
const c1Hyperlink = '\x9d8;;https://example.test\x9c中文\x9d8;;\x9c';
assert.equal(stripAnsi(coloredCjk), '中文');
assert.equal(stripAnsi(hyperlink), '中文');
assert.equal(stripAnsi(c1Hyperlink), '中文');
assert.equal(visualLength(coloredCjk), 4);
assert.equal(visualLength(hyperlink), 4);
assert.equal(visualLength(c1Hyperlink), 4);
assert.equal(stripAnsi('\x1b(Ba'), 'a', 'ESC intermediate/final sequences must be stripped as one control');
assert.equal(visualLength('\x1b(Ba'), 1);
assert.equal(stripAnsi('\x85a'), 'a', 'a single-byte C1 control must not consume the next character');
assert.equal(visualLength('\x85a'), 1);

// Padding and both truncation paths share the same column budget.
const padded = padEnd('中文', 6);
assert.equal(plain(padded), '中文  ');
assert.equal(visualLength(padded), 6);

assert.equal(plain(truncate('中文项目', 5)), '中文…');
assert.equal(visualLength(truncate('中文项目', 5)), 5);

const truncatedColored = truncateAnsi(colors.yellow('中文项目'), 5);
assert.equal(plain(truncatedColored), '中文…');
assert.equal(visualLength(truncatedColored), 5);
assert.ok(truncatedColored.endsWith('\x1b[0m'), 'truncated styled text closes its active SGR');

const truncatedGrapheme = truncateAnsi(colors.cyan('👨‍👩‍👧‍👦abc'), 3);
assert.equal(plain(truncatedGrapheme), '👨‍👩‍👧‍👦…');
assert.equal(visualLength(truncatedGrapheme), 3);

const openHyperlink = '\x1b]8;;https://example.test\x07中文项目';
const truncatedHyperlink = truncateAnsi(openHyperlink, 5);
assert.equal(plain(truncatedHyperlink), '中文…');
assert.equal(visualLength(truncatedHyperlink), 5);
assert.ok(truncatedHyperlink.endsWith('\x1b]8;;\x07'), 'truncated OSC8 text closes its active hyperlink');

const truncatedCombining = truncate('e\u0301xyz', 2);
assert.equal(plain(truncatedCombining), 'e\u0301…');
assert.equal(visualLength(truncatedCombining), 2);

const splitFamily = `👨${colors.yellow('')}‍👩‍👧‍👦`;
assert.equal(visualLength(splitFamily), 2, 'ANSI controls between ZWJ parts must not split the grapheme width');
assert.equal(plain(truncateAnsi(splitFamily + 'abc', 3)), '👨‍👩‍👧‍👦…');

const splitCombining = `e${colors.yellow('')}\u0301xyz`;
assert.equal(visualLength(splitCombining), 4, 'ANSI controls between a base and combining mark must preserve width');
assert.equal(plain(truncateAnsi(splitCombining, 2)), 'e\u0301…');

// Project-line truncation must use physical columns, not JavaScript string length.
const projectData = {
  config: {},
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
    cwd: '/tmp/中文项目',
    projectName: '中文项目',
    agentsMdCount: 0,
    hasCodexDir: false,
    instructionsMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    configsCount: 0,
    extensionsCount: 0,
    skillsCount: 0,
    hooksCount: 0,
    workMode: 'development',
  },
  sessionStart: new Date('2026-08-29T00:00:00Z'),
  displayMode: 'single',
};

const boundedProject = renderProjectLine(projectData, { maxWidth: 5 });
assert.equal(plain(boundedProject), '中文…');
assert.equal(visualLength(boundedProject), 5);

// A real stdout refresh must emit fixed physical rows for a CJK project.
const originalWrite = process.stdout.write.bind(process.stdout);
const originalColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
const originalRows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
const originalColumnsEnv = process.env.COLUMNS;
const originalRowsEnv = process.env.LINES;
const writes = [];
const renderWidth = 108;
Object.defineProperty(process.stdout, 'columns', { configurable: true, value: renderWidth });
Object.defineProperty(process.stdout, 'rows', { configurable: true, value: 5 });
process.env.COLUMNS = String(renderWidth);
process.env.LINES = '5';
process.stdout.write = (chunk) => {
  writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
  return true;
};

const refreshData = {
  ...projectData,
  project: {
    ...projectData.project,
    agentsMdCount: 1,
    extensionsCount: 4,
    skillsCount: 65,
    hooksCount: 8,
    projectName: '中文项目',
    cwd: '/tmp/中文项目',
  },
  config: { model: 'gpt-5.2-codex', model_provider: 'openai', approval_policy: 'never' },
  session: {
    id: '019f9db5-0000-7000-8000-000000000000',
    cwd: '/tmp/中文项目',
    cliVersion: '0.149.1',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
  },
  git: {
    ...projectData.git,
    branch: 'main',
    isDirty: true,
    isGitRepo: true,
    modified: 1,
  },
};

const boundaryWidths = [107, renderWidth, 109];
const boundaryRows = [];

try {
  renderToStdout(refreshData);
  renderToStdout({
    ...refreshData,
    project: { ...refreshData.project, projectName: '新项目', cwd: '/tmp/新项目' },
    session: { ...refreshData.session, cwd: '/tmp/新项目' },
  });

  // Exercise the real stdout path immediately below, at, and above the issue's pane width.
  const originalCaptureWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    boundaryRows.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  };
  try {
    for (const width of boundaryWidths) {
      Object.defineProperty(process.stdout, 'columns', { configurable: true, value: width });
      process.env.COLUMNS = String(width);
      renderToStdout({
        ...refreshData,
        project: { ...refreshData.project, projectName: `中文项目-${width}`, cwd: `/tmp/中文项目-${width}` },
        session: { ...refreshData.session, cwd: `/tmp/中文项目-${width}` },
      });
      const frameRows = boundaryRows
        .join('')
        .split('\x1b[2K')
        .slice(-5);
      assert.equal(frameRows.length, 5, `boundary frame at ${width} columns must contain five rows`);
      for (const row of frameRows) {
        const withoutNewline = row.endsWith('\n') ? row.slice(0, -1) : row;
        assert.doesNotMatch(withoutNewline, /\r|\n/, 'a boundary row must not contain an embedded line break');
        assert.ok(visualLength(withoutNewline) <= width, `boundary row must fit ${width} columns`);
      }
      boundaryRows.length = 0;
    }
  } finally {
    process.stdout.write = originalCaptureWrite;
  }
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
  if (originalColumnsEnv === undefined) delete process.env.COLUMNS;
  else process.env.COLUMNS = originalColumnsEnv;
  if (originalRowsEnv === undefined) delete process.env.LINES;
  else process.env.LINES = originalRowsEnv;
}

const physicalRows = writes.join('').split('\x1b[2K').slice(1);
assert.equal(physicalRows.length, 10, 'two refreshes must write five fixed rows each');
for (const row of physicalRows) {
  const withoutNewline = row.endsWith('\n') ? row.slice(0, -1) : row;
  assert.doesNotMatch(withoutNewline, /\r|\n/, 'a logical row must not contain an embedded line break');
  assert.ok(visualLength(withoutNewline) <= renderWidth, 'a physical row must fit the pane width');
}
const secondFramePlain = physicalRows.slice(5).map((row) => plain(row)).join('\n');
assert.match(secondFramePlain, /新项目/);
assert.doesNotMatch(secondFramePlain, /中文项目/);

const metrics = {
  cjkColumns: visualLength('中文项目'),
  familyEmojiColumns: visualLength('👨‍👩‍👧‍👦'),
  combiningColumns: visualLength('e\u0301'),
  flagColumns: visualLength('🇨🇳'),
  boundedProjectColumns: visualLength(boundedProject),
  refreshedRows: physicalRows.length,
  boundaryWidths,
  boundaryRowsChecked: boundaryWidths.length * 5,
};
console.log(`test-terminal-width: PASS ${JSON.stringify(metrics)}`);
