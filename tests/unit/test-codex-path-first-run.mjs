import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { HudFileWatcher } from '../../dist/collectors/file-watcher.js';
import { getCodexHome, getSessionsDir } from '../../dist/utils/codex-path.js';

const originalCodexHome = process.env.CODEX_HOME;
const originalSessionsPath = process.env.CODEX_SESSIONS_PATH;

try {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-first-run-'));
  const missingHome = path.join(tempRoot, 'new-codex-home');

  process.env.CODEX_HOME = missingHome;
  delete process.env.CODEX_SESSIONS_PATH;

  assert.equal(
    getCodexHome(),
    missingHome,
    'explicit CODEX_HOME should be usable before Codex creates the directory'
  );
  assert.equal(
    getSessionsDir(),
    path.join(missingHome, 'sessions'),
    'default sessions directory should be usable before Codex creates it'
  );

  const watcher = new HudFileWatcher();
  watcher.start();
  await watcher.stop();

  process.env.CODEX_SESSIONS_PATH = path.join(tempRoot, 'missing-explicit-sessions');
  assert.throws(
    () => getSessionsDir(),
    /CODEX_SESSIONS_PATH/,
    'explicit invalid CODEX_SESSIONS_PATH should still fail fast'
  );
} finally {
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }

  if (originalSessionsPath === undefined) {
    delete process.env.CODEX_SESSIONS_PATH;
  } else {
    process.env.CODEX_SESSIONS_PATH = originalSessionsPath;
  }
}

console.log('test-codex-path-first-run: PASS');
