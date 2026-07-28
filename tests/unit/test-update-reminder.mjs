import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  buildCurlArgs,
  acquireLock,
  checkForUpdate,
  compareVersions,
  createEmptyState,
  evaluateUpgradeGuards,
  fetchLatestRelease,
  handleSessionClosed,
  ensureGlobalSessionClosedHook,
  parseReleasePayload,
  parseStableVersion,
  readState,
  registerSession,
  removeGlobalSessionClosedHooks,
  resolveStatePaths,
  resolveStateRoot,
  selectNearestStableTag,
  shellQuoteSingle,
  shouldCheckNow,
  validateState,
  writeStateAtomic,
} from '../../bin/codex-hud-update.mjs';

const tempRoots = [];
function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'codex-hud-update-unit-'));
  tempRoots.push(root);
  return root;
}
function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}
function initFixture() {
  const cwd = makeTempRoot();
  git(cwd, 'init', '--quiet');
  git(cwd, 'config', 'user.email', 'codex-hud-test@example.com');
  git(cwd, 'config', 'user.name', 'Codex HUD Test');
  writeFileSync(join(cwd, 'file.txt'), 'one\n');
  git(cwd, 'add', 'file.txt');
  git(cwd, 'commit', '--quiet', '-m', 'initial');
  return cwd;
}

process.on('exit', () => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

test('parseStableVersion accepts only stable numeric triplets', () => {
  assert.deepEqual(parseStableVersion('v1.2.3'), {
    major: 1,
    minor: 2,
    patch: 3,
    normalized: 'v1.2.3',
  });
  assert.deepEqual(parseStableVersion('1.20.30'), {
    major: 1,
    minor: 20,
    patch: 30,
    normalized: 'v1.20.30',
  });
  for (const value of ['v1.2', 'v1.2.3-alpha', 'v1.2.3+build', 'release-1.2.3', '', 'v01.2.3']) {
    assert.equal(parseStableVersion(value), null, value);
  }
});

test('compareVersions compares numeric segments rather than strings', () => {
  assert.equal(compareVersions('v0.9.9', 'v0.10.0'), -1);
  assert.equal(compareVersions('1.10.0', 'v1.2.99'), 1);
  assert.equal(compareVersions('v2.0.0', '2.0.0'), 0);
  assert.equal(compareVersions('v9007199254740993.0.0', 'v9007199254740992.999.999'), 1);
});

test('selectNearestStableTag ignores prerelease and invalid reachable tags', () => {
  const cwd = initFixture();
  git(cwd, 'tag', 'v0.1.0-alpha');
  writeFileSync(join(cwd, 'file.txt'), 'two\n');
  git(cwd, 'commit', '--quiet', '-am', 'second');
  git(cwd, 'tag', 'v0.5.0');
  writeFileSync(join(cwd, 'file.txt'), 'three\n');
  git(cwd, 'commit', '--quiet', '-am', 'third');
  git(cwd, 'tag', 'not-a-version');
  const result = selectNearestStableTag(cwd);
  assert.deepEqual(result.version, parseStableVersion('v0.5.0'));
  assert.equal(result.tag, 'v0.5.0');
  assert.equal(result.distance, 1);
});

test('selectNearestStableTag returns null when no stable tag is reachable', () => {
  const cwd = initFixture();
  git(cwd, 'tag', 'v0.1.0-alpha');
  assert.equal(selectNearestStableTag(cwd), null);
});

test('resolveStatePaths canonicalizes checkout and uses URL-safe path encoding', () => {
  const parent = makeTempRoot();
  const checkout = join(parent, 'checkout with spaces');
  writeFileSync(join(parent, 'placeholder'), '');
  execFileSync('mkdir', ['-p', checkout]);
  const paths = resolveStatePaths(checkout, {
    HOME: join(parent, 'home'),
    XDG_STATE_HOME: join(parent, 'state'),
  }, 'linux');
  assert.equal(paths.checkoutPath, checkout);
  const stateFileName = paths.stateFile.slice(paths.stateFile.lastIndexOf('/') + 1);
  assert.match(stateFileName, /checkout-[A-Za-z0-9_-]+\.json$/);
  assert.doesNotMatch(stateFileName, /[+/=]/);
  assert.equal(paths.stateRoot, join(parent, 'state', 'codex-hud'));
});

test('resolveStateRoot uses the same platform directory for deferred hook lookup', () => {
  const parent = makeTempRoot();
  const home = join(parent, 'home');
  assert.equal(resolveStateRoot({ HOME: home }, 'linux'), join(home, '.local', 'state', 'codex-hud'));
  assert.equal(resolveStateRoot({ HOME: home }, 'darwin'), join(home, 'Library', 'Application Support', 'codex-hud'));
  assert.equal(resolveStateRoot({ HOME: home, LOCALAPPDATA: join(parent, 'local') }, 'win32'), join(parent, 'local', 'codex-hud'));
});

test('state validation rejects unknown keys and mismatched checkout paths', () => {
  const cwd = makeTempRoot();
  const valid = createEmptyState(cwd);
  assert.doesNotThrow(() => validateState(valid, cwd));
  assert.throws(() => validateState({ ...valid, extra: true }, cwd), /schema|unknown/i);
  assert.throws(() => validateState({ ...valid, checkout_path: '/other' }, cwd), /checkout/i);
  assert.throws(() => validateState({ ...valid, last_checked_at: 123 }, cwd), /last_checked_at/i);
  assert.throws(() => validateState({ ...valid, last_check_error: 123 }, cwd), /last_check_error/i);
  assert.throws(() => validateState({ ...valid, declined_version: 'v1.2.3-alpha' }, cwd), /declined_version/i);
  assert.throws(() => validateState({ ...valid, pending_update: {} }, cwd), /pending_update/i);
});

test('writeStateAtomic replaces state atomically with restrictive permissions', () => {
  const parent = makeTempRoot();
  const cwd = join(parent, 'checkout');
  const home = join(parent, 'home');
  execFileSync('mkdir', ['-p', cwd, home]);
  const paths = resolveStatePaths(cwd, { HOME: home }, 'linux');
  const state = createEmptyState(paths.checkoutPath);
  writeStateAtomic(paths.stateFile, state, paths.stateRoot);
  assert.deepEqual(JSON.parse(readFileSync(paths.stateFile, 'utf8')), state);
  assert.equal(statSync(paths.stateRoot).mode & 0o777, 0o700);
  assert.equal(statSync(paths.stateFile).mode & 0o777, 0o600);
});

test('acquireLock reclaims only stale dead owners', () => {
  const root = makeTempRoot();
  const lockFile = join(root, 'state', 'checkout.lock');
  mkdirSync(join(root, 'state'), { recursive: true });
  writeFileSync(lockFile, JSON.stringify({ pid: 99999999, created_at: '2020-01-01T00:00:00.000Z' }));
  const release = acquireLock(lockFile, { timeoutMs: 50, staleMs: 1, pollMs: 1 });
  assert.equal(existsSync(lockFile), true);
  release();
  assert.equal(existsSync(lockFile), false);

  writeFileSync(lockFile, JSON.stringify({ pid: process.pid, created_at: '2020-01-01T00:00:00.000Z' }));
  assert.throws(
    () => acquireLock(lockFile, { timeoutMs: 10, staleMs: 1, pollMs: 1 }),
    /lock is busy/,
  );
});

test('shouldCheckNow treats missing, invalid, and boundary timestamps correctly', () => {
  const now = Date.parse('2026-07-26T12:00:00.000Z');
  const interval = 12 * 60 * 60 * 1000;
  assert.equal(shouldCheckNow(null, now, interval), true);
  assert.equal(shouldCheckNow('not-a-date', now, interval), true);
  assert.equal(shouldCheckNow('2026-07-26T00:00:00.000Z', now, interval), true);
  assert.equal(shouldCheckNow('2026-07-26T00:00:00.001Z', now, interval), false);
});

test('shellQuoteSingle protects arbitrary POSIX path text', () => {
  const value = "/tmp/a path/'$x;\n";
  const quoted = shellQuoteSingle(value);
  assert.equal(quoted, "'/tmp/a path/'\\''$x;\n'");
  assert.match(quoted, /^'.*'$/s);
});

test('evaluateUpgradeGuards diagnoses every rejected Git state', () => {
  const makeRunGit = (overrides = {}) => (args) => {
    const defaults = {
      worktree: 'true',
      'symbolic-ref': 'main',
      upstream: 'origin/main',
      status: '',
      default: 'origin/main',
    };
    const value = Object.hasOwn(overrides, args[0]) ? overrides[args[0]] : defaults[args[0]];
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error(`unexpected git call: ${args.join(' ')}`);
    return value;
  };

  assert.deepEqual(evaluateUpgradeGuards('/checkout', makeRunGit()), { ok: true, reason: null });
  assert.deepEqual(
    evaluateUpgradeGuards('/checkout', makeRunGit({ default: 'origin/master', 'symbolic-ref': 'master', upstream: 'origin/master' })),
    { ok: true, reason: null },
  );
  assert.deepEqual(
    evaluateUpgradeGuards('/checkout', makeRunGit({ worktree: new Error('not a repository') })),
    { ok: false, reason: 'not-a-git-checkout' },
  );
  assert.deepEqual(
    evaluateUpgradeGuards('/checkout', makeRunGit({ 'symbolic-ref': new Error('detached') })),
    { ok: false, reason: 'detached-head' },
  );
  assert.deepEqual(
    evaluateUpgradeGuards('/checkout', makeRunGit({ upstream: new Error('no upstream') })),
    { ok: false, reason: 'missing-upstream' },
  );
  assert.deepEqual(
    evaluateUpgradeGuards('/checkout', makeRunGit({ 'symbolic-ref': 'feature', upstream: 'origin/feature' })),
    { ok: false, reason: 'branch-or-upstream-not-default' },
  );
  assert.deepEqual(
    evaluateUpgradeGuards('/checkout', makeRunGit({ upstream: 'fork/main' })),
    { ok: false, reason: 'branch-or-upstream-not-default' },
  );
  assert.deepEqual(
    evaluateUpgradeGuards('/checkout', makeRunGit({ status: ' M file.txt' })),
    { ok: false, reason: 'dirty-worktree' },
  );
  assert.deepEqual(
    evaluateUpgradeGuards('/checkout', makeRunGit({ default: new Error('origin/HEAD is not configured') })),
    { ok: true, reason: null },
  );
});

test('parseReleasePayload accepts only a stable formal GitHub release', () => {
  const release = parseReleasePayload(JSON.stringify({
    draft: false,
    prerelease: false,
    tag_name: 'v1.20.3',
    html_url: 'https://github.com/fwyc0573/codex-hud/releases/tag/v1.20.3',
  }));
  assert.deepEqual(release, {
    version: 'v1.20.3',
    release_url: 'https://github.com/fwyc0573/codex-hud/releases/tag/v1.20.3',
  });
  for (const value of [
    { draft: true, prerelease: false, tag_name: 'v1.2.3', html_url: 'https://example.test' },
    { draft: false, prerelease: true, tag_name: 'v1.2.3', html_url: 'https://example.test' },
    { draft: false, prerelease: false, tag_name: 'v1.2', html_url: 'https://example.test' },
    { draft: false, prerelease: false, tag_name: 'v1.2.3', html_url: '' },
  ]) {
    assert.throws(() => parseReleasePayload(JSON.stringify(value)), /release|stable|metadata/i);
  }
  assert.throws(() => parseReleasePayload('{not-json'), /JSON/i);
});

test('buildCurlArgs fixes the anonymous GitHub request contract', () => {
  const args = buildCurlArgs('https://api.github.com/repos/fwyc0573/codex-hud/releases/latest');
  assert.ok(args.includes('--fail'));
  assert.ok(args.includes('--silent'));
  assert.ok(args.includes('--show-error'));
  assert.ok(args.includes('--location'));
  assert.ok(args.includes('--max-time'));
  assert.ok(args.includes('--connect-timeout'));
  assert.ok(args.includes('--user-agent'));
  assert.ok(args.includes('--header'));
  assert.ok(args.some((value) => value.includes('application/vnd.github+json')));
  assert.equal(args.at(-1), 'https://api.github.com/repos/fwyc0573/codex-hud/releases/latest');
  assert.equal(args.some((value) => /token|authorization/i.test(value)), false);
});

test('fetchLatestRelease validates curl JSON and exposes the exact command', () => {
  let observedArgs;
  const release = fetchLatestRelease({
    runCurl: (args) => {
      observedArgs = args;
      return JSON.stringify({
        draft: false,
        prerelease: false,
        tag_name: 'v2.0.0',
        html_url: 'https://github.com/fwyc0573/codex-hud/releases/tag/v2.0.0',
      });
    },
  });
  assert.equal(release.version, 'v2.0.0');
  assert.ok(observedArgs.includes('--fail'));
  assert.ok(observedArgs.includes('--silent'));
  assert.ok(observedArgs.includes('--show-error'));
  assert.throws(() => fetchLatestRelease({ runCurl: () => { throw new Error('HTTP 503'); } }), /HTTP 503/);
  assert.throws(() => fetchLatestRelease({ runCurl: () => { throw new Error('request timeout'); } }), /timeout/);
});

function makeTaggedCheckout() {
  const cwd = initFixture();
  git(cwd, 'tag', 'v0.1.0');
  writeFileSync(join(cwd, 'file.txt'), 'next\n');
  git(cwd, 'commit', '--quiet', '-am', 'next');
  return cwd;
}

test('checkForUpdate schedules one interactive pending update and writes state', () => {
  const cwd = makeTaggedCheckout();
  const stateHome = makeTempRoot();
  const output = [];
  let hookCalls = 0;
  const nowMs = Date.parse('2026-07-26T12:00:00.000Z');
  const result = checkForUpdate({
    checkoutPath: cwd,
    env: { HOME: stateHome, XDG_STATE_HOME: join(stateHome, 'state') },
    nowMs,
    fetchRelease: () => ({
      version: 'v0.2.0',
      release_url: 'https://github.com/fwyc0573/codex-hud/releases/tag/v0.2.0',
    }),
    isInteractive: true,
    readInput: () => '',
    writeOutput: (line) => output.push(line),
    ensureHook: () => {
      hookCalls += 1;
      return { installed: true };
    },
  });
  assert.equal(result.status, 'accepted');
  const paths = resolveStatePaths(cwd, { HOME: stateHome, XDG_STATE_HOME: join(stateHome, 'state') });
  const state = readState(paths, cwd);
  assert.equal(state.pending_update.target_version, 'v0.2.0');
  assert.match(output.join('\n'), /\[codex-hud\] Update available: v0\.1\.0 → v0\.2\.0\. Update after this session exits\? \[Y\/n\]/);
  assert.match(output.join('\n'), /Update accepted/);
  assert.doesNotMatch(output.join('\n'), /Update scheduled/);
  assert.equal(hookCalls, 0);
});

test('checkForUpdate records a decline and suppresses the same target', () => {
  const cwd = makeTaggedCheckout();
  const stateHome = makeTempRoot();
  const first = checkForUpdate({
    checkoutPath: cwd,
    env: { HOME: stateHome, XDG_STATE_HOME: join(stateHome, 'state') },
    nowMs: Date.parse('2026-07-26T12:00:00.000Z'),
    fetchRelease: () => ({ version: 'v0.2.0', release_url: 'https://example.test/v0.2.0' }),
    isInteractive: true,
    readInput: () => 'n',
    writeOutput: () => {},
    ensureHook: () => ({ installed: true }),
  });
  assert.equal(first.status, 'declined');
  let fetched = 0;
  const second = checkForUpdate({
    checkoutPath: cwd,
    env: { HOME: stateHome, XDG_STATE_HOME: join(stateHome, 'state') },
    nowMs: Date.parse('2026-07-26T13:00:00.000Z'),
    fetchRelease: () => {
      fetched += 1;
      return { version: 'v0.2.0', release_url: 'https://example.test/v0.2.0' };
    },
    isInteractive: true,
    readInput: () => 'y',
    writeOutput: () => {},
  });
  assert.equal(second.status, 'declined-suppressed');
  assert.equal(fetched, 0);
});

test('checkForUpdate warns and continues for non-TTY and disabled checks', () => {
  const cwd = makeTaggedCheckout();
  const stateHome = makeTempRoot();
  const output = [];
  let fetched = 0;
  let readInputCalled = false;
  const nonTty = checkForUpdate({
    checkoutPath: cwd,
    env: { HOME: stateHome, XDG_STATE_HOME: join(stateHome, 'state') },
    nowMs: Date.parse('2026-07-26T12:00:00.000Z'),
    fetchRelease: () => {
      fetched += 1;
      return { version: 'v0.2.0', release_url: 'https://example.test/v0.2.0' };
    },
    isInteractive: false,
    readInput: () => {
      readInputCalled = true;
      return 'y';
    },
    writeOutput: (line) => output.push(line),
  });
  assert.equal(nonTty.status, 'non-interactive');
  assert.match(output.join('\n'), /non-interactive/i);
  assert.doesNotMatch(output.join('\n'), /Update available/);
  assert.equal(readInputCalled, false);
  const disabled = checkForUpdate({
    checkoutPath: cwd,
    env: { HOME: stateHome, CODEX_HUD_UPDATE_CHECK: 'false' },
    nowMs: Date.parse('2026-07-26T13:00:00.000Z'),
    fetchRelease: () => {
      fetched += 1;
      return { version: 'v0.3.0', release_url: 'https://example.test/v0.3.0' };
    },
    isInteractive: true,
    readInput: () => 'y',
    writeOutput: (line) => output.push(line),
  });
  assert.equal(disabled.status, 'disabled');
  assert.equal(fetched, 1);
});

test('checkForUpdate throttles failures and persists the attempt timestamp', () => {
  const cwd = makeTaggedCheckout();
  const stateHome = makeTempRoot();
  const env = { HOME: stateHome, XDG_STATE_HOME: join(stateHome, 'state') };
  const output = [];
  const nowMs = Date.parse('2026-07-26T12:00:00.000Z');
  const failed = checkForUpdate({
    checkoutPath: cwd,
    env,
    nowMs,
    fetchRelease: () => {
      throw new Error('simulated timeout');
    },
    writeOutput: (line) => output.push(line),
  });
  assert.equal(failed.status, 'check-failed');
  const paths = resolveStatePaths(cwd, env);
  assert.equal(readState(paths, cwd).last_checked_at, '2026-07-26T12:00:00.000Z');
  assert.match(readState(paths, cwd).last_check_error, /simulated timeout/);
  let retried = false;
  const throttled = checkForUpdate({
    checkoutPath: cwd,
    env,
    nowMs: nowMs + 1000,
    fetchRelease: () => {
      retried = true;
      return { version: 'v0.2.0', release_url: 'https://example.test/v0.2.0' };
    },
    writeOutput: (line) => output.push(line),
  });
  assert.equal(throttled.status, 'throttled');
  assert.equal(retried, false);
  assert.match(output.join('\n'), /simulated timeout/);
});

test('checkForUpdate resets malformed state before continuing', () => {
  const cwd = makeTaggedCheckout();
  const stateHome = makeTempRoot();
  const env = { HOME: stateHome, XDG_STATE_HOME: join(stateHome, 'state') };
  const paths = resolveStatePaths(cwd, env);
  mkdirSync(paths.stateRoot, { recursive: true });
  writeFileSync(paths.stateFile, '{broken');
  const output = [];
  const result = checkForUpdate({
    checkoutPath: cwd,
    env,
    nowMs: Date.parse('2026-07-26T12:00:00.000Z'),
    fetchRelease: () => ({ version: 'v0.1.0', release_url: 'https://example.test/v0.1.0' }),
    writeOutput: (line) => output.push(line),
  });
  assert.equal(result.status, 'up-to-date');
  assert.equal(readState(paths, cwd).schema_version, 1);
  assert.match(output.join('\n'), /state was reset/i);
});

test('checkForUpdate rejects invalid answers and retries until y or n', () => {
  const cwd = makeTaggedCheckout();
  const stateHome = makeTempRoot();
  const answers = ['maybe', 'y'];
  const output = [];
  const result = checkForUpdate({
    checkoutPath: cwd,
    env: { HOME: stateHome, XDG_STATE_HOME: join(stateHome, 'state') },
    nowMs: Date.parse('2026-07-26T12:00:00.000Z'),
    fetchRelease: () => ({ version: 'v0.2.0', release_url: 'https://example.test/v0.2.0' }),
    isInteractive: true,
    readInput: () => answers.shift(),
    writeOutput: (line) => output.push(line),
    ensureHook: () => ({ installed: true }),
  });
  assert.equal(result.status, 'accepted');
  assert.match(output.join('\n'), /Please answer y or n/);
});

test('cached releases prompt without refetching and uppercase answers are accepted', () => {
  const cwd = makeTaggedCheckout();
  const stateHome = makeTempRoot();
  const env = { HOME: stateHome, XDG_STATE_HOME: join(stateHome, 'state') };
  let fetches = 0;
  const first = checkForUpdate({
    checkoutPath: cwd,
    env,
    nowMs: Date.parse('2026-07-26T12:00:00.000Z'),
    fetchRelease: () => {
      fetches += 1;
      return { version: 'v0.2.0', release_url: 'https://example.test/v0.2.0' };
    },
    isInteractive: false,
    writeOutput: () => {},
  });
  assert.equal(first.status, 'non-interactive');
  let reads = 0;
  const second = checkForUpdate({
    checkoutPath: cwd,
    env,
    nowMs: Date.parse('2026-07-26T13:00:00.000Z'),
    fetchRelease: () => {
      fetches += 1;
      throw new Error('cached release should avoid refetch');
    },
    isInteractive: true,
    readInput: () => {
      reads += 1;
      return 'Y';
    },
    writeOutput: () => {},
  });
  assert.equal(second.status, 'accepted');
  const third = checkForUpdate({
    checkoutPath: cwd,
    env,
    nowMs: Date.parse('2026-07-26T13:01:00.000Z'),
    isInteractive: true,
    readInput: () => {
      reads += 1;
      return 'N';
    },
    writeOutput: () => {},
  });
  assert.equal(third.status, 'already-scheduled');
  assert.equal(fetches, 1);
  assert.equal(reads, 1);

  const declineCheckout = makeTaggedCheckout();
  const declined = checkForUpdate({
    checkoutPath: declineCheckout,
    env,
    nowMs: Date.parse('2026-07-26T14:00:00.000Z'),
    fetchRelease: () => ({ version: 'v0.2.0', release_url: 'https://example.test/v0.2.0' }),
    isInteractive: true,
    readInput: () => 'N',
    writeOutput: () => {},
  });
  assert.equal(declined.status, 'declined');
});

test('ensureGlobalSessionClosedHook scopes markers and commands by checkout', () => {
  const calls = [];
  let hooks = 'session-closed[7] run-shell "echo user"\n';
  const root = makeTempRoot();
  const checkoutA = join(root, 'checkout-a');
  const checkoutB = join(root, 'checkout-b');
  mkdirSync(checkoutA);
  mkdirSync(checkoutB);
  const env = { HOME: root, XDG_STATE_HOME: join(root, 'state') };
  const pathsA = resolveStatePaths(checkoutA, env);
  const pathsB = resolveStatePaths(checkoutB, env);
  const nodePath = "/opt/node dir/node's";
  const helperA = "/checkout a/bin/helper's.mjs";
  const helperB = '/checkout-b/bin/helper.mjs';
  const tmux = (args) => {
    calls.push(args);
    if (args[0] === 'show-hooks') return hooks;
    if (args[0] === 'set-hook') {
      if (args[1] === '-gu') {
        const slot = args[2].match(/\[(\d+)\]/)[1];
        hooks = hooks.split('\n').filter((line) => !line.startsWith(`session-closed[${slot}]`)).join('\n');
        return '';
      }
      hooks += `session-closed[${args[2].match(/\[(\d+)\]/)[1]}] ${args[3]}\n`;
      return '';
    }
    return '';
  };
  const first = ensureGlobalSessionClosedHook({
    tmux,
    paths: pathsA,
    nodePath,
    helperPath: helperA,
  });
  assert.equal(first.installed, true);
  assert.match(calls.find((args) => args[0] === 'set-hook')[2], /^session-closed\[/);
  assert.doesNotMatch(calls.find((args) => args[0] === 'set-hook')[2], /\[7\]/);
  assert.match(first.command, new RegExp(`codex-hud-update-hook-v2:${pathsA.checkoutId}`));
  const dispatch = [
    'nohup',
    shellQuoteSingle(nodePath),
    shellQuoteSingle(helperA),
    'session-closed',
    '"#{hook_session_name}"',
    '--tmux-socket',
    '"#{socket_path}"',
    '--checkout-id',
    shellQuoteSingle(pathsA.checkoutId),
    '</dev/null',
    '>/dev/null',
    '2>&1',
    '&',
  ].join(' ');
  assert.equal(first.command, `run-shell ${shellQuoteSingle(`: codex-hud-update-hook-v2:${pathsA.checkoutId}; ${dispatch}`)}`);
  const callCount = calls.length;
  const second = ensureGlobalSessionClosedHook({
    tmux,
    paths: pathsA,
    nodePath,
    helperPath: helperA,
  });
  assert.equal(second.installed, false);
  assert.equal(calls.length, callCount + 1);
  const third = ensureGlobalSessionClosedHook({
    tmux,
    paths: pathsB,
    nodePath,
    helperPath: helperB,
  });
  assert.equal(third.installed, true);
  assert.match(third.command, new RegExp(`codex-hud-update-hook-v2:${pathsB.checkoutId}`));
  assert.equal(removeGlobalSessionClosedHooks({ tmux, checkoutId: pathsA.checkoutId }), 1);
  assert.doesNotMatch(hooks, new RegExp(`codex-hud-update-hook-v2:${pathsA.checkoutId}`));
  assert.match(hooks, new RegExp(`codex-hud-update-hook-v2:${pathsB.checkoutId}`));
});

test('registerSession records update-enabled sessions before pending exists', () => {
  const cwd = makeTaggedCheckout();
  const stateHome = makeTempRoot();
  const env = { HOME: stateHome, XDG_STATE_HOME: join(stateHome, 'state') };
  let hookCalls = 0;
  const registered = registerSession({
    checkoutPath: cwd,
    sessionName: 'codex-hud-pre-pending',
    env,
    upgradeCommand: join(cwd, 'bin', 'codex-hud-upgrade'),
    ensureHook: () => {
      hookCalls += 1;
      return { installed: true };
    },
  });
  assert.equal(registered.status, 'registered');
  assert.equal(registered.record.checkout_id, resolveStatePaths(cwd, env).checkoutId);
  assert.equal(registered.record.upgrade_command, join(cwd, 'bin', 'codex-hud-upgrade'));
  assert.equal(existsSync(registered.file), true);
  assert.equal(hookCalls, 0);
});

test('session registry filenames isolate identical names across checkouts', () => {
  const root = makeTempRoot();
  const checkoutA = join(root, 'checkout-a');
  const checkoutB = join(root, 'checkout-b');
  mkdirSync(checkoutA);
  mkdirSync(checkoutB);
  const env = { HOME: root, XDG_STATE_HOME: join(root, 'state') };
  const sessionName = 'codex-hud-shared-name';
  const first = registerSession({
    checkoutPath: checkoutA,
    sessionName,
    env,
    upgradeCommand: join(checkoutA, 'bin', 'codex-hud-upgrade'),
  });
  const second = registerSession({
    checkoutPath: checkoutB,
    sessionName,
    env,
    upgradeCommand: join(checkoutB, 'bin', 'codex-hud-upgrade'),
  });
  assert.equal(first.status, 'registered');
  assert.equal(second.status, 'registered');
  assert.notEqual(first.file, second.file);
  assert.equal(existsSync(first.file), true);
  assert.equal(existsSync(second.file), true);
});

test('checkout closure cannot claim records or upgrade commands from another checkout', () => {
  const checkoutA = makeTaggedCheckout();
  const checkoutB = makeTaggedCheckout();
  const stateHome = makeTempRoot();
  const env = { HOME: stateHome, XDG_STATE_HOME: join(stateHome, 'state') };
  const pathsA = resolveStatePaths(checkoutA, env);
  const pathsB = resolveStatePaths(checkoutB, env);
  for (const [checkout, paths] of [[checkoutA, pathsA], [checkoutB, pathsB]]) {
    const state = createEmptyState(checkout);
    state.pending_update = {
      target_version: 'v0.2.0',
      release_url: 'https://example.test/v0.2.0',
      scheduled_at: '2026-07-26T12:00:00.000Z',
    };
    writeStateAtomic(paths.stateFile, state, paths.stateRoot);
  }
  const tmux = (args) => {
    if (args[0] === 'show-hooks') return '';
    if (args[0] === 'set-hook') return '';
    if (args[0] === 'has-session') throw new Error('session missing');
    return '';
  };
  const recordA = registerSession({
    checkoutPath: checkoutA,
    sessionName: 'codex-hud-checkout-a',
    env,
    tmux,
    upgradeCommand: join(checkoutA, 'bin', 'codex-hud-upgrade'),
    writeOutput: () => {},
  });
  const recordB = registerSession({
    checkoutPath: checkoutB,
    sessionName: 'codex-hud-checkout-b',
    env,
    tmux,
    upgradeCommand: join(checkoutB, 'bin', 'codex-hud-upgrade'),
    writeOutput: () => {},
  });
  let observedUpgrade = null;
  const result = handleSessionClosed({
    sessionName: 'codex-hud-checkout-a',
    checkoutId: pathsA.checkoutId,
    env,
    tmux,
    upgradeRunner: ({ checkoutPath, upgradeCommand }) => {
      observedUpgrade = { checkoutPath, upgradeCommand };
    },
    evaluateGuards: () => ({ ok: true, reason: null }),
    selectTag: () => ({ tag: 'v0.2.0', version: parseStableVersion('v0.2.0'), distance: 0 }),
  });
  assert.equal(result.status, 'success');
  assert.deepEqual(observedUpgrade, {
    checkoutPath: checkoutA,
    upgradeCommand: join(checkoutA, 'bin', 'codex-hud-upgrade'),
  });
  assert.equal(existsSync(recordA.file), false);
  assert.equal(existsSync(recordB.file), true);
  assert.equal(readState(pathsB, checkoutB).pending_update.target_version, 'v0.2.0');
});

test('session closure checks peer sessions on their recorded tmux sockets', () => {
  const cwd = makeTaggedCheckout();
  const stateHome = makeTempRoot();
  const env = { HOME: stateHome, XDG_STATE_HOME: join(stateHome, 'state') };
  const paths = resolveStatePaths(cwd, env);
  const state = createEmptyState(cwd);
  state.pending_update = {
    target_version: 'v0.2.0',
    release_url: 'https://example.test/v0.2.0',
    scheduled_at: '2026-07-26T12:00:00.000Z',
  };
  writeStateAtomic(paths.stateFile, state, paths.stateRoot);

  const activeSockets = new Set(['/tmp/codex-hud-server-b']);
  const tmux = (args, options) => {
    if (args[0] === 'show-hooks') return '';
    if (args[0] === 'set-hook') return '';
    if (args[0] === 'has-session' && activeSockets.has(options.tmuxSocket)) return '';
    if (args[0] === 'has-session') throw new Error('session missing');
    return '';
  };
  const peer = registerSession({
    checkoutPath: cwd,
    sessionName: 'codex-hud-server-b-peer',
    env,
    tmux,
    tmuxSocket: '/tmp/codex-hud-server-b',
    writeOutput: () => {},
  });
  const current = registerSession({
    checkoutPath: cwd,
    sessionName: 'codex-hud-server-a-current',
    env,
    tmux,
    tmuxSocket: '/tmp/codex-hud-server-a',
    writeOutput: () => {},
  });
  assert.equal(peer.pending, true);
  assert.equal(current.pending, true);

  let upgradeRuns = 0;
  const blocked = handleSessionClosed({
    sessionName: current.record.session_name,
    checkoutId: paths.checkoutId,
    env,
    tmux,
    upgradeRunner: () => { upgradeRuns += 1; },
    evaluateGuards: () => ({ ok: true, reason: null }),
    selectTag: () => ({ tag: 'v0.2.0', version: parseStableVersion('v0.2.0'), distance: 0 }),
  });
  assert.equal(blocked.status, 'other-session-alive');
  assert.equal(upgradeRuns, 0);
  assert.equal(existsSync(peer.file), true);
  assert.equal(existsSync(current.file), true);

  activeSockets.clear();
  const completed = handleSessionClosed({
    sessionName: current.record.session_name,
    checkoutId: paths.checkoutId,
    env,
    tmux,
    upgradeRunner: () => { upgradeRuns += 1; },
    evaluateGuards: () => ({ ok: true, reason: null }),
    selectTag: () => ({ tag: 'v0.2.0', version: parseStableVersion('v0.2.0'), distance: 0 }),
  });
  assert.equal(completed.status, 'success');
  assert.equal(upgradeRuns, 1);
});

test('registerSession clears pending state when hook registration fails', () => {
  const cwd = makeTaggedCheckout();
  const stateHome = makeTempRoot();
  const env = { HOME: stateHome, XDG_STATE_HOME: join(stateHome, 'state') };
  const paths = resolveStatePaths(cwd, env);
  const state = createEmptyState(cwd);
  state.pending_update = {
    target_version: 'v0.2.0',
    release_url: 'https://example.test/v0.2.0',
    scheduled_at: '2026-07-26T12:00:00.000Z',
  };
  writeStateAtomic(paths.stateFile, state, paths.stateRoot);
  const output = [];
  const result = registerSession({
    checkoutPath: cwd,
    sessionName: 'codex-hud-hook-failure',
    env,
    upgradeCommand: join(cwd, 'bin', 'codex-hud-upgrade'),
    ensureHook: () => { throw new Error('tmux hook unavailable'); },
    writeOutput: (line) => output.push(line),
  });
  assert.equal(result.status, 'hook-registration-failed');
  assert.equal(readState(paths, cwd).pending_update, null);
  assert.match(output.join('\n'), /unable to schedule deferred update/i);
  assert.doesNotMatch(output.join('\n'), /Update scheduled/);
});

test('abortSession removes a failed-launch record and clears its pending update', async () => {
  const { abortSession } = await import('../../bin/codex-hud-update.mjs');
  assert.equal(typeof abortSession, 'function');
  const cwd = makeTaggedCheckout();
  const stateHome = makeTempRoot();
  const env = { HOME: stateHome, XDG_STATE_HOME: join(stateHome, 'state') };
  const paths = resolveStatePaths(cwd, env);
  const state = createEmptyState(cwd);
  state.pending_update = {
    target_version: 'v0.2.0',
    release_url: 'https://example.test/v0.2.0',
    scheduled_at: '2026-07-26T12:00:00.000Z',
  };
  writeStateAtomic(paths.stateFile, state, paths.stateRoot);
  const registered = registerSession({
    checkoutPath: cwd,
    sessionName: 'codex-hud-aborted-launch',
    env,
    ensureHook: () => {},
    writeOutput: () => {},
  });
  assert.equal(registered.status, 'registered');
  const result = abortSession({
    checkoutPath: cwd,
    sessionName: 'codex-hud-aborted-launch',
    env,
    writeOutput: () => {},
  });
  assert.equal(result.status, 'aborted');
  assert.equal(result.pending_cleared, true);
  assert.equal(existsSync(registered.file), false);
  assert.equal(readState(paths, cwd).pending_update, null);
});

test('registerSession and handleSessionClosed claim pending work once and clear it on failure', () => {
  const cwd = makeTaggedCheckout();
  const stateHome = makeTempRoot();
  const env = { HOME: stateHome, XDG_STATE_HOME: join(stateHome, 'state') };
  const paths = resolveStatePaths(cwd, env);
  const state = createEmptyState(cwd);
  state.pending_update = {
    target_version: 'v0.2.0',
    release_url: 'https://example.test/v0.2.0',
    scheduled_at: '2026-07-26T12:00:00.000Z',
  };
  writeStateAtomic(paths.stateFile, state, paths.stateRoot);
  const tmuxCalls = [];
  const tmux = (args) => {
    tmuxCalls.push(args);
    if (args[0] === 'has-session') throw new Error('session missing');
    return '';
  };
  const registered = registerSession({
    checkoutPath: cwd,
    sessionName: 'codex-hud-test-session',
    env,
    tmux,
    launchPath: '/usr/bin:/bin',
    writeOutput: () => {},
  });
  assert.equal(registered.status, 'registered');
  let ran = 0;
  const closed = handleSessionClosed({
    sessionName: 'codex-hud-test-session',
    checkoutId: paths.checkoutId,
    env,
    tmux,
    upgradeRunner: () => {
      ran += 1;
      throw new Error('simulated upgrade failure');
    },
    evaluateGuards: () => ({ ok: true, reason: null }),
    selectTag: () => ({ tag: 'v0.1.0', version: parseStableVersion('v0.1.0'), distance: 1 }),
    now: () => '2026-07-26T13:00:00.000Z',
  });
  assert.equal(closed.status, 'failed');
  assert.equal(ran, 1);
  assert.equal(readState(paths, cwd).pending_update, null);
  const log = readFileSync(paths.logFile, 'utf8');
  assert.match(log, /"target_version":"v0\.2\.0"/);
  assert.match(log, /"release_url":"https:\/\/example\.test\/v0\.2\.0"/);
  assert.match(log, /"result":"failed"/);
  assert.match(log, /simulated upgrade failure/);
  const duplicate = handleSessionClosed({
    sessionName: 'codex-hud-test-session',
    checkoutId: paths.checkoutId,
    env,
    tmux,
  });
  assert.equal(duplicate.status, 'not-found');
  assert.ok(tmuxCalls.some((args) => args[0] === 'has-session'));
});

test('handleSessionClosed waits for an active peer and removes stale session records', () => {
  const cwd = makeTaggedCheckout();
  const stateHome = makeTempRoot();
  const env = { HOME: stateHome, XDG_STATE_HOME: join(stateHome, 'state') };
  const paths = resolveStatePaths(cwd, env);
  const activeSessions = new Set(['codex-hud-peer-session']);
  const tmux = (args) => {
    if (args[0] === 'show-hooks') return '';
    if (args[0] === 'set-hook') return '';
    if (args[0] === 'has-session' && activeSessions.has(args[2])) return '';
    if (args[0] === 'has-session') throw new Error('session missing');
    return '';
  };
  const peer = registerSession({
    checkoutPath: cwd,
    sessionName: 'codex-hud-peer-session',
    env,
    tmux,
  });
  assert.equal(peer.status, 'registered');
  assert.equal(peer.pending, false);

  const state = createEmptyState(cwd);
  state.pending_update = {
    target_version: 'v0.2.0',
    release_url: 'https://example.test/v0.2.0',
    scheduled_at: '2026-07-26T12:00:00.000Z',
  };
  writeStateAtomic(paths.stateFile, state, paths.stateRoot);
  const current = registerSession({
    checkoutPath: cwd,
    sessionName: 'codex-hud-current-session',
    env,
    tmux,
    writeOutput: () => {},
  });
  assert.equal(current.status, 'registered');
  assert.equal(current.pending, true);

  let upgradeRuns = 0;
  const blocked = handleSessionClosed({
    sessionName: 'codex-hud-current-session',
    checkoutId: paths.checkoutId,
    env,
    tmux,
    upgradeRunner: () => { upgradeRuns += 1; },
    evaluateGuards: () => ({ ok: true, reason: null }),
    selectTag: () => ({ tag: 'v0.2.0', version: parseStableVersion('v0.2.0'), distance: 0 }),
  });
  assert.equal(blocked.status, 'other-session-alive');
  assert.equal(upgradeRuns, 0);
  assert.equal(existsSync(current.file), true);
  assert.equal(existsSync(peer.file), true);

  activeSessions.clear();
  const completed = handleSessionClosed({
    sessionName: 'codex-hud-current-session',
    checkoutId: paths.checkoutId,
    env,
    tmux,
    upgradeRunner: () => { upgradeRuns += 1; },
    evaluateGuards: () => ({ ok: true, reason: null }),
    selectTag: () => ({ tag: 'v0.2.0', version: parseStableVersion('v0.2.0'), distance: 0 }),
  });
  assert.equal(completed.status, 'success');
  assert.equal(upgradeRuns, 1);
  assert.equal(existsSync(current.file), false);
  assert.equal(existsSync(peer.file), false);
});

test('helper CLI returns nonzero for malformed input and hook-management failure', () => {
  const helper = join(process.cwd(), 'bin', 'codex-hud-update.mjs');
  const malformed = spawnSync(process.execPath, [helper, 'remove-hooks', '--unknown-option'], {
    encoding: 'utf8',
  });
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /unknown helper option/);

  const root = makeTempRoot();
  const checkout = join(root, 'checkout');
  const fakeTmux = join(root, 'tmux-failure');
  mkdirSync(checkout);
  writeFileSync(fakeTmux, '#!/usr/bin/env bash\necho "tmux unavailable" >&2\nexit 9\n');
  chmodSync(fakeTmux, 0o700);
  const failedRemoval = spawnSync(process.execPath, [
    helper,
    'remove-hooks',
    '--checkout',
    checkout,
    '--tmux-path',
    fakeTmux,
  ], { encoding: 'utf8' });
  assert.equal(failedRemoval.status, 1);
  assert.match(failedRemoval.stderr, /tmux unavailable|update helper failed/);
});

test('two concurrent session-closed helpers claim and execute one pending update once', async () => {
  const checkout = makeTaggedCheckout();
  git(checkout, 'branch', '-M', 'main');
  const remote = join(makeTempRoot(), 'remote.git');
  execFileSync('git', ['init', '--bare', '--quiet', remote]);
  git(checkout, 'remote', 'add', 'origin', remote);
  git(checkout, 'push', '--quiet', '--set-upstream', 'origin', 'main');
  git(checkout, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  const stateHome = makeTempRoot();
  const env = { ...process.env, HOME: stateHome, XDG_STATE_HOME: join(stateHome, 'state') };
  const paths = resolveStatePaths(checkout, env);
  const upgradeLog = join(stateHome, 'upgrade.log');
  const upgradeCommand = join(stateHome, 'upgrade-once');
  writeFileSync(upgradeCommand, `#!/usr/bin/env bash\nset -e\nprintf 'run\\n' >> '${upgradeLog}'\ngit tag v0.2.0\n`);
  chmodSync(upgradeCommand, 0o700);
  const sessionName = 'codex-hud-concurrent-claim';
  const record = registerSession({
    checkoutPath: checkout,
    sessionName,
    env,
    upgradeCommand,
  });
  assert.equal(record.status, 'registered');
  const state = createEmptyState(checkout);
  state.pending_update = {
    target_version: 'v0.2.0',
    release_url: 'https://example.test/v0.2.0',
    scheduled_at: '2026-07-26T12:00:00.000Z',
  };
  writeStateAtomic(paths.stateFile, state, paths.stateRoot);
  const helper = join(process.cwd(), 'bin', 'codex-hud-update.mjs');
  const runHelper = () => new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [
      helper,
      'session-closed',
      sessionName,
      '--checkout-id',
      paths.checkoutId,
    ], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', rejectPromise);
    child.on('exit', (code) => resolvePromise({ code, stderr }));
  });
  const results = await Promise.all([runHelper(), runHelper()]);
  assert.deepEqual(results.map((result) => result.code), [0, 0]);
  assert.equal(readFileSync(upgradeLog, 'utf8').trim().split('\n').length, 1);
  assert.equal(readState(paths, checkout).pending_update, null);
  assert.equal(readFileSync(paths.logFile, 'utf8').trim().split('\n').length, 1);
});
