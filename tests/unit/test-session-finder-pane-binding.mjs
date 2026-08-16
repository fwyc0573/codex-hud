import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SessionFinder } from '../../dist/collectors/session-finder.js';

function makeTempCodexHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-session-finder-'));
}

function todayParts() {
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return { year, month, day };
}

function rolloutTimestampLabelAt(timestamp) {
  const year = timestamp.getFullYear();
  const month = String(timestamp.getMonth() + 1).padStart(2, '0');
  const day = String(timestamp.getDate()).padStart(2, '0');
  const hour = String(timestamp.getHours()).padStart(2, '0');
  const minute = String(timestamp.getMinutes()).padStart(2, '0');
  const second = String(timestamp.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}-${minute}-${second}`;
}

function rolloutTimestampLabel(offsetMinutes = 0) {
  return rolloutTimestampLabelAt(new Date(Date.now() + offsetMinutes * 60_000));
}

function writeRollout(home, {
  sessionId,
  cwd,
  fileOffsetMinutes = 0,
  fileTimestamp,
  metadataTimestamp,
  modifiedAt,
  source = 'cli',
  extraLines = [],
}) {
  const { year, month, day } = todayParts();
  const dir = path.join(home, 'sessions', year, month, day);
  fs.mkdirSync(dir, { recursive: true });

  const timestampLabel = fileTimestamp
    ? rolloutTimestampLabelAt(fileTimestamp)
    : rolloutTimestampLabel(fileOffsetMinutes);
  const filePath = path.join(dir, `rollout-${timestampLabel}-${sessionId}.jsonl`);
  const sessionTimestamp = (metadataTimestamp ?? fileTimestamp ?? new Date()).toISOString();
  const lines = [
    JSON.stringify({
      timestamp: sessionTimestamp,
      type: 'session_meta',
      payload: {
        id: sessionId,
        timestamp: sessionTimestamp,
        cwd,
        originator: 'codex-tui',
        cli_version: '0.118.0',
        source,
        model_provider: 'openai',
      },
    }),
    ...extraLines.map((line) => JSON.stringify(line)),
  ];

  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');

  if (modifiedAt) {
    fs.utimesSync(filePath, modifiedAt, modifiedAt);
  }

  return filePath;
}

function writeSnapshot(home, threadId, paneId, nonce, assignment = `export TMUX_PANE='${paneId}'`) {
  const dir = path.join(home, 'shell_snapshots');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${threadId}.${nonce}.sh`);
  fs.writeFileSync(
    filePath,
    [
      '# Snapshot file',
      assignment,
      "export PATH='/usr/bin'",
      '',
    ].join('\n'),
    'utf8'
  );
  return filePath;
}

function assertSamePath(actual, expected, message) {
  assert.equal(fs.realpathSync(actual), fs.realpathSync(expected), message);
}

const originalCodexHome = process.env.CODEX_HOME;
const originalMainPane = process.env.CODEX_HUD_MAIN_PANE;
const originalSessionsPath = process.env.CODEX_SESSIONS_PATH;

try {
  {
    const home = makeTempCodexHome();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-cwd-'));
    process.env.CODEX_HOME = home;
    delete process.env.CODEX_SESSIONS_PATH;
    process.env.CODEX_HUD_MAIN_PANE = '%70';

    const modifiedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    writeRollout(home, {
      sessionId: '019d7291-a135-7fe1-b46f-8f3eca4fa451',
      cwd,
      modifiedAt,
    });

    const finder = new SessionFinder(cwd);
    assert.equal(
      finder.check(),
      null,
      'fresh launch without a bound shell snapshot should stay in initialization state'
    );
  }

  {
    const home = makeTempCodexHome();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-cwd-'));
    process.env.CODEX_HOME = home;
    delete process.env.CODEX_SESSIONS_PATH;
    process.env.CODEX_HUD_MAIN_PANE = '%70';

    const activeThread = '019d7291-a135-7fe1-b46f-8f3eca4fa451';
    const boundThread = '019d7295-3ef8-7292-a039-fdf7ecd4f53e';

    writeRollout(home, {
      sessionId: activeThread,
      cwd,
      modifiedAt: new Date(),
    });
    const boundRollout = writeRollout(home, {
      sessionId: boundThread,
      cwd,
      fileOffsetMinutes: -1,
      modifiedAt: new Date(Date.now() - 5 * 60 * 1000),
    });
    writeSnapshot(home, boundThread, '%70', 1775743876858615370n);

    const finder = new SessionFinder(cwd);
    const resolved = finder.check();
    assert.ok(resolved, 'expected a pane-bound session to resolve');
    assertSamePath(
      resolved.path,
      boundRollout,
      'pane-bound shell snapshot should override the newest unrelated rollout'
    );

    const snapshotPath = path.join(
      home,
      'shell_snapshots',
      `${boundThread}.1775743876858615370.sh`
    );
    fs.unlinkSync(snapshotPath);
    const retained = finder.check();
    assert.ok(
      retained,
      'an established session must remain available after its shell snapshot disappears'
    );
    assertSamePath(
      retained.path,
      boundRollout,
      'snapshot loss must not replace the established root rollout'
    );
  }

  {
    const home = makeTempCodexHome();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-cwd-'));
    process.env.CODEX_HOME = home;
    delete process.env.CODEX_SESSIONS_PATH;
    process.env.CODEX_HUD_MAIN_PANE = '%70';

    const thread = '019d7296-3ef8-7292-a039-fdf7ecd4f53e';
    const snapshotPath = writeSnapshot(home, thread, '%70', 1775743876858615370n);
    const finder = new SessionFinder(cwd);
    assert.equal(
      finder.check(),
      null,
      'an exact snapshot may arrive before its rollout is visible'
    );

    fs.unlinkSync(snapshotPath);
    const rollout = writeRollout(home, {
      sessionId: thread,
      cwd,
      modifiedAt: new Date(),
    });
    const resolved = finder.check();
    assert.ok(
      resolved,
      'an accepted exact thread must remain resolvable after its snapshot disappears'
    );
    assertSamePath(
      resolved.path,
      rollout,
      'snapshot loss before rollout visibility must retain the exact thread identity'
    );
  }

  {
    const home = makeTempCodexHome();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-cwd-'));
    process.env.CODEX_HOME = home;
    delete process.env.CODEX_SESSIONS_PATH;
    process.env.CODEX_HUD_MAIN_PANE = '%70';

    const targetStartTime = new Date(Date.now() - 40_000);
    const rolloutTime = new Date(targetStartTime.getTime() + 10_000);
    writeRollout(home, {
      sessionId: '019d7298-3ef8-7292-a039-fdf7ecd4f53e',
      cwd,
      fileTimestamp: rolloutTime,
      metadataTimestamp: rolloutTime,
    });

    const callbacks = [];
    const finder = new SessionFinder(
      cwd,
      (session) => callbacks.push(session?.sessionId ?? null),
      targetStartTime
    );
    const startedAt = Date.now();
    assert.equal(
      finder.check(),
      null,
      'a launch timestamp must not authorize heuristic binding without an exact pane snapshot'
    );
    assert.deepEqual(
      callbacks,
      [],
      'a rejected heuristic candidate must not emit a session-change callback'
    );
    assert.ok(
      Date.now() - startedAt < 1_000,
      'rejecting heuristic startup binding must be immediate'
    );
  }

  {
    const home = makeTempCodexHome();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-cwd-'));
    process.env.CODEX_HOME = home;
    delete process.env.CODEX_SESSIONS_PATH;
    process.env.CODEX_HUD_MAIN_PANE = '%70';

    const oldThread = '019d729b-3ef8-7292-a039-fdf7ecd4f53e';
    const newThread = '019d729c-3ef8-7292-a039-fdf7ecd4f53e';
    const oldRollout = writeRollout(home, {
      sessionId: oldThread,
      cwd,
      modifiedAt: new Date(Date.now() - 60_000),
    });
    const newRollout = writeRollout(home, {
      sessionId: newThread,
      cwd,
      modifiedAt: new Date(),
    });
    const oldSnapshot = writeSnapshot(home, oldThread, '%70', 100n);
    const newSnapshot = writeSnapshot(home, newThread, '%70', 200n);

    const finder = new SessionFinder(cwd);
    const resolved = finder.check();
    assert.ok(resolved, 'newest snapshot should resolve');
    assertSamePath(resolved.path, newRollout, 'newest snapshot should bind to the new thread');

    fs.unlinkSync(newSnapshot);
    const afterNewSnapshotRemoval = finder.check();
    assert.ok(
      afterNewSnapshotRemoval,
      'removing the newest snapshot must not clear an existing binding while its rollout exists'
    );
    assertSamePath(
      afterNewSnapshotRemoval.path,
      newRollout,
      'removing the newest snapshot must not roll back to an older snapshot thread'
    );
    assert.ok(fs.existsSync(oldSnapshot), 'the older fixture snapshot remains for rollback coverage');
    assert.ok(fs.existsSync(oldRollout), 'the older fixture rollout remains for rollback coverage');
  }

  {
    const home = makeTempCodexHome();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-cwd-'));
    process.env.CODEX_HOME = home;
    delete process.env.CODEX_SESSIONS_PATH;

    const paneOneThread = '019d7291-a135-7fe1-b46f-8f3eca4fa451';
    const paneTwoThread = '019d7295-3ef8-7292-a039-fdf7ecd4f53e';

    const paneOneRollout = writeRollout(home, {
      sessionId: paneOneThread,
      cwd,
      modifiedAt: new Date(Date.now() - 60 * 1000),
    });
    const paneTwoRollout = writeRollout(home, {
      sessionId: paneTwoThread,
      cwd,
      fileOffsetMinutes: -1,
      modifiedAt: new Date(),
    });

    writeSnapshot(home, paneOneThread, '%70', 1775743639864947215n);
    writeSnapshot(home, paneTwoThread, '%72', 1775743876858615370n);

    process.env.CODEX_HUD_MAIN_PANE = '%70';
    const finderOne = new SessionFinder(cwd);
    const resultOne = finderOne.check();
    assert.ok(resultOne, 'expected pane one to resolve');
    assertSamePath(resultOne.path, paneOneRollout, 'pane one should stay on its own thread');

    process.env.CODEX_HUD_MAIN_PANE = '%72';
    const finderTwo = new SessionFinder(cwd);
    const resultTwo = finderTwo.check();
    assert.ok(resultTwo, 'expected pane two to resolve');
    assertSamePath(resultTwo.path, paneTwoRollout, 'pane two should stay on its own thread');
  }

  {
    const home = makeTempCodexHome();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-cwd-'));
    process.env.CODEX_HOME = home;
    delete process.env.CODEX_SESSIONS_PATH;
    process.env.CODEX_HUD_MAIN_PANE = '%70';

    const thread = '019d7291-a135-7fe1-b46f-8f3eca4fa451';
    const rollout = writeRollout(home, {
      sessionId: thread,
      cwd,
      modifiedAt: new Date(),
    });
    writeSnapshot(home, thread, '%70', 1775743876858615370n, 'declare -x TMUX_PANE="%70"');

    const finder = new SessionFinder(cwd);
    const result = finder.check();
    assert.ok(result, 'expected declare -x TMUX_PANE snapshots to resolve');
    assertSamePath(result.path, rollout, 'declare -x snapshot should bind the HUD to its rollout');
  }

  // --- PR#5 hardening: every exported TMUX_PANE form across shells must bind ---
  // The pane id is exported into the codex child by different shells using
  // different syntaxes; each of these must resolve to the same rollout.
  for (const assignment of [
    'declare -rx TMUX_PANE="%70"', // bash read-only export, combined flags
    "declare -ax TMUX_PANE='%70'", // combined flags, single-quoted value
    'typeset -x TMUX_PANE=%70',    // zsh/ksh export, bare value
    'typeset -gx TMUX_PANE="%70"', // zsh global export, combined flags
    'TMUX_PANE=%70',               // bare assignment (no export keyword)
  ]) {
    const home = makeTempCodexHome();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-cwd-'));
    process.env.CODEX_HOME = home;
    delete process.env.CODEX_SESSIONS_PATH;
    process.env.CODEX_HUD_MAIN_PANE = '%70';

    const thread = '019d7291-a135-7fe1-b46f-8f3eca4fa451';
    const rollout = writeRollout(home, {
      sessionId: thread,
      cwd,
      modifiedAt: new Date(),
    });
    writeSnapshot(home, thread, '%70', 1775743876858615370n, assignment);

    const finder = new SessionFinder(cwd);
    const result = finder.check();
    assert.ok(result, `expected snapshot form to resolve: ${assignment}`);
    assertSamePath(result.path, rollout, `snapshot form should bind to rollout: ${assignment}`);
  }

  // --- PR#5 hardening (negative): a variable that merely ends with TMUX_PANE
  // (e.g. OLD_TMUX_PANE) must never be mistaken for the real TMUX_PANE. ---
  {
    const home = makeTempCodexHome();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-cwd-'));
    process.env.CODEX_HOME = home;
    delete process.env.CODEX_SESSIONS_PATH;
    process.env.CODEX_HUD_MAIN_PANE = '%70';

    const thread = '019d7291-a135-7fe1-b46f-8f3eca4fa451';
    writeRollout(home, {
      sessionId: thread,
      cwd,
      modifiedAt: new Date(),
    });
    writeSnapshot(home, thread, '%70', 1775743876858615370n, "export OLD_TMUX_PANE='%70'");

    const finder = new SessionFinder(cwd);
    assert.equal(
      finder.check(),
      null,
      'OLD_TMUX_PANE must not be mistaken for TMUX_PANE'
    );
  }

  // --- PR#5 hardening (negative): a non-exported `declare -r` local has no `x`
  // flag, is not inherited by the codex child, and must not bind. ---
  {
    const home = makeTempCodexHome();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-cwd-'));
    process.env.CODEX_HOME = home;
    delete process.env.CODEX_SESSIONS_PATH;
    process.env.CODEX_HUD_MAIN_PANE = '%70';

    const thread = '019d7291-a135-7fe1-b46f-8f3eca4fa451';
    writeRollout(home, {
      sessionId: thread,
      cwd,
      modifiedAt: new Date(),
    });
    writeSnapshot(home, thread, '%70', 1775743876858615370n, 'declare -r TMUX_PANE="%70"');

    const finder = new SessionFinder(cwd);
    assert.equal(
      finder.check(),
      null,
      'non-exported declare -r TMUX_PANE must not bind'
    );
  }
} finally {
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }

  if (originalMainPane === undefined) {
    delete process.env.CODEX_HUD_MAIN_PANE;
  } else {
    process.env.CODEX_HUD_MAIN_PANE = originalMainPane;
  }

  if (originalSessionsPath === undefined) {
    delete process.env.CODEX_SESSIONS_PATH;
  } else {
    process.env.CODEX_SESSIONS_PATH = originalSessionsPath;
  }
}

console.log('test-session-finder-pane-binding: PASS');
