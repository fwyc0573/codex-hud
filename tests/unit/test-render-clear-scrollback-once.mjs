import assert from 'node:assert/strict';
import { renderToStdout } from '../../dist/render/index.js';

const originalWrite = process.stdout.write.bind(process.stdout);
const originalColumns = process.env.COLUMNS;
const originalLines = process.env.LINES;
const originalClear = process.env.CODEX_HUD_CLEAR_SCROLLBACK;

const writes = [];
process.stdout.write = (chunk, encoding, callback) => {
  const text = typeof chunk === 'string' ? chunk : chunk.toString();
  writes.push(text);

  if (typeof encoding === 'function') {
    encoding();
  } else if (typeof callback === 'function') {
    callback();
  }
  return true;
};

process.env.COLUMNS = '80';
process.env.LINES = '5';
process.env.CODEX_HUD_CLEAR_SCROLLBACK = '1';

const baseData = {
  config: {
    model: 'gpt-5.2-codex',
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
    projectName: 'project-a',
    agentsMdCount: 0,
    hasCodexDir: false,
    instructionsMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    configsCount: 0,
    extensionsCount: 0,
    workMode: 'development',
  },
  sessionStart: new Date('2026-02-09T00:00:00Z'),
  displayMode: 'single',
};

const nextData = {
  ...baseData,
  project: {
    ...baseData.project,
    projectName: 'project-b',
  },
};

try {
  renderToStdout(baseData);
  renderToStdout(nextData);
} finally {
  process.stdout.write = originalWrite;
  if (originalColumns === undefined) {
    delete process.env.COLUMNS;
  } else {
    process.env.COLUMNS = originalColumns;
  }
  if (originalLines === undefined) {
    delete process.env.LINES;
  } else {
    process.env.LINES = originalLines;
  }
  if (originalClear === undefined) {
    delete process.env.CODEX_HUD_CLEAR_SCROLLBACK;
  } else {
    process.env.CODEX_HUD_CLEAR_SCROLLBACK = originalClear;
  }
}

const output = writes.join('');
const clearScrollbackCount = (output.match(/\x1b\[3J/g) || []).length;

assert.equal(clearScrollbackCount, 1, 'CLEAR_SCROLLBACK should be emitted only on first render');

console.log('test-render-clear-scrollback-once: PASS');
