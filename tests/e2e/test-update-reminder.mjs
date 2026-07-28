import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  createEmptyState,
  readState,
  registerSession,
  resolveStatePaths,
  writeStateAtomic,
} from '../../bin/codex-hud-update.mjs';

function run(cwd, command, ...args) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function waitForFile(file, expectedText, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file) && readFileSync(file, 'utf8').includes(expectedText)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${file} to contain ${expectedText}`);
}

async function waitForPendingClear(paths, checkout, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (readState(paths, checkout).pending_update === null) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for pending update to clear for ${checkout}`);
}

test('real tmux last-session closure launches detached updater and clears pending state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-hud-update-e2e-'));
  const socketName = `codexhud-e2e-${process.pid}`;
  const socketDir = join(root, 'tmux');
  const stateHome = join(root, 'state');
  const checkout = join(root, 'checkout');
  const remote = join(root, 'remote.git');
  const helperCopy = join(root, 'codex-hud-update.mjs');
  const tmuxWrapper = join(root, 'tmux-wrapper');
  const upgradeLog = join(root, 'upgrade.log');
  const sessionName = 'codex-hud-e2e-session';
  const env = {
    ...process.env,
    HOME: join(root, 'home'),
    XDG_STATE_HOME: stateHome,
    TMUX_TMPDIR: socketDir,
  };
  try {
    run(root, 'mkdir', '-p', socketDir, env.HOME);
    run(root, 'git', 'init', '--bare', '--quiet', remote);
    run(root, 'git', 'init', '--quiet', '-b', 'main', checkout);
    run(checkout, 'git', 'config', 'user.email', 'codex-hud-e2e@example.com');
    run(checkout, 'git', 'config', 'user.name', 'Codex HUD E2E');
    writeFileSync(join(checkout, 'file.txt'), 'initial\n');
    run(checkout, 'git', 'add', 'file.txt');
    run(checkout, 'git', 'commit', '--quiet', '-m', 'initial');
    run(checkout, 'git', 'tag', 'v0.1.0');
    run(checkout, 'git', 'remote', 'add', 'origin', remote);
    run(checkout, 'git', 'push', '--quiet', '--set-upstream', 'origin', 'main');
    run(checkout, 'git', 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');

    const sourceHelper = join(dirname(fileURLToPath(import.meta.url)), '../../bin/codex-hud-update.mjs');
    writeFileSync(helperCopy, readFileSync(sourceHelper));
    writeFileSync(join(root, 'codex-hud-upgrade'), `#!/usr/bin/env bash\nset -e\nprintf '%s\\n' "upgrade" >> "${upgradeLog}"\ngit tag v0.2.0\n`);
    chmodSync(join(root, 'codex-hud-upgrade'), 0o700);
    writeFileSync(tmuxWrapper, `#!/usr/bin/env bash\nexec tmux -L ${socketName} -f /dev/null "$@"\n`);
    chmodSync(tmuxWrapper, 0o700);

    const paths = resolveStatePaths(checkout, env);
    const state = createEmptyState(checkout);
    state.pending_update = {
      target_version: 'v0.2.0',
      release_url: 'https://example.test/v0.2.0',
      scheduled_at: new Date().toISOString(),
    };
    writeStateAtomic(paths.stateFile, state, paths.stateRoot);

    const tmuxEnv = { ...env, TMUX_BIN: tmuxWrapper };
    execFileSync(tmuxWrapper, ['new-session', '-d', '-s', sessionName, 'sleep 60'], { env: tmuxEnv });
    const registration = registerSession({
      checkoutPath: checkout,
      sessionName,
      env: tmuxEnv,
      launchPath: process.env.PATH,
      upgradeCommand: join(root, 'codex-hud-upgrade'),
      tmuxPath: tmuxWrapper,
      tmuxSocket: socketName,
      nodePath: process.execPath,
      helperPath: helperCopy,
    });
    assert.equal(registration.status, 'registered');
    const hooksBeforeClose = execFileSync(tmuxWrapper, ['show-hooks', '-g'], { env: tmuxEnv, encoding: 'utf8' });
    assert.match(hooksBeforeClose, new RegExp(`codex-hud-update-hook-v2:${paths.checkoutId}`));
    assert.match(hooksBeforeClose, new RegExp(`--checkout-id '${paths.checkoutId}'`));

    execFileSync(tmuxWrapper, ['kill-session', '-t', sessionName], { env: tmuxEnv });
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && (!existsSync(upgradeLog) || !readFileSync(upgradeLog, 'utf8').includes('upgrade'))) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!existsSync(upgradeLog)) {
      console.error(`e2e diagnostics root=${root}`);
      console.error(`registry=${existsSync(paths.registryRoot) ? readdirSync(paths.registryRoot).join(',') : 'directory'}`);
      console.error(`state=${readFileSync(paths.stateFile, 'utf8')}`);
      console.error(`updateLog=${existsSync(paths.logFile) ? readFileSync(paths.logFile, 'utf8') : 'missing'}`);
      try {
        console.error(`hooks=${execFileSync(tmuxWrapper, ['show-hooks', '-g'], { env: tmuxEnv, encoding: 'utf8' })}`);
      } catch (error) {
        console.error(`hooks unavailable: ${error.message}`);
      }
    }
    assert.equal(readFileSync(upgradeLog, 'utf8').trim(), 'upgrade');
    await waitForPendingClear(paths, checkout);
    const finalState = readState(paths, checkout);
    assert.equal(finalState.pending_update, null);
    const log = readFileSync(paths.logFile, 'utf8');
    assert.match(log, /"result":"success"/);
    assert.match(log, /v0\.2\.0/);
  } finally {
    try {
      execFileSync(tmuxWrapper, ['kill-server'], { env, stdio: 'ignore' });
    } catch {
      // The isolated server is expected to exit with the last session.
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test('one tmux server routes independent hooks and updates to two checkouts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-hud-update-multi-e2e-'));
  const socketName = `codexhud-multi-e2e-${process.pid}`;
  const socketDir = join(root, 'tmux');
  const stateHome = join(root, 'state');
  const tmuxWrapper = join(root, 'tmux-wrapper');
  const env = {
    ...process.env,
    HOME: join(root, 'home'),
    XDG_STATE_HOME: stateHome,
    TMUX_TMPDIR: socketDir,
  };
  const fixtures = [];
  try {
    run(root, 'mkdir', '-p', socketDir, env.HOME);
    writeFileSync(tmuxWrapper, `#!/usr/bin/env bash\nexec tmux -L ${socketName} -f /dev/null "$@"\n`);
    chmodSync(tmuxWrapper, 0o700);
    const sourceHelper = join(dirname(fileURLToPath(import.meta.url)), '../../bin/codex-hud-update.mjs');

    for (const name of ['a', 'b']) {
      const checkout = join(root, `checkout-${name}`);
      const remote = join(root, `remote-${name}.git`);
      const helper = join(checkout, 'bin', 'codex-hud-update.mjs');
      const upgrade = join(checkout, 'bin', 'codex-hud-upgrade');
      const upgradeLog = join(root, `upgrade-${name}.log`);
      const sessionName = `codex-hud-multi-${name}`;
      run(root, 'git', 'init', '--bare', '--quiet', remote);
      run(root, 'git', 'init', '--quiet', '-b', 'main', checkout);
      run(checkout, 'git', 'config', 'user.email', `codex-hud-${name}@example.com`);
      run(checkout, 'git', 'config', 'user.name', `Codex HUD ${name}`);
      run(checkout, 'mkdir', '-p', 'bin');
      writeFileSync(join(checkout, 'file.txt'), `${name}\n`);
      writeFileSync(helper, readFileSync(sourceHelper));
      writeFileSync(upgrade, `#!/usr/bin/env bash\nset -e\nprintf '%s\\n' '${name}' >> '${upgradeLog}'\ngit tag v0.2.0\n`);
      chmodSync(upgrade, 0o700);
      run(checkout, 'git', 'add', 'file.txt', 'bin');
      run(checkout, 'git', 'commit', '--quiet', '-m', 'initial');
      run(checkout, 'git', 'tag', 'v0.1.0');
      run(checkout, 'git', 'remote', 'add', 'origin', remote);
      run(checkout, 'git', 'push', '--quiet', '--set-upstream', 'origin', 'main');
      run(checkout, 'git', 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
      const paths = resolveStatePaths(checkout, env);
      const state = createEmptyState(checkout);
      state.pending_update = {
        target_version: 'v0.2.0',
        release_url: `https://example.test/v0.2.0-${name}`,
        scheduled_at: new Date().toISOString(),
      };
      writeStateAtomic(paths.stateFile, state, paths.stateRoot);
      fixtures.push({ name, checkout, helper, upgrade, upgradeLog, sessionName, paths });
    }

    const tmuxEnv = { ...env, TMUX_BIN: tmuxWrapper };
    for (const fixture of fixtures) {
      execFileSync(tmuxWrapper, ['new-session', '-d', '-s', fixture.sessionName, 'sleep 60'], { env: tmuxEnv });
      const registration = registerSession({
        checkoutPath: fixture.checkout,
        sessionName: fixture.sessionName,
        env: tmuxEnv,
        launchPath: process.env.PATH,
        upgradeCommand: fixture.upgrade,
        tmuxPath: tmuxWrapper,
        tmuxSocket: socketName,
        nodePath: process.execPath,
        helperPath: fixture.helper,
        writeOutput: () => {},
      });
      assert.equal(registration.status, 'registered');
      assert.equal(registration.pending, true);
      fixture.recordFile = registration.file;
    }
    execFileSync(tmuxWrapper, ['new-session', '-d', '-s', 'codex-hud-multi-sentinel', 'sleep 60'], { env: tmuxEnv });

    const hooks = execFileSync(tmuxWrapper, ['show-hooks', '-g'], { env: tmuxEnv, encoding: 'utf8' });
    for (const fixture of fixtures) {
      assert.match(hooks, new RegExp(`codex-hud-update-hook-v2:${fixture.paths.checkoutId}`));
      assert.match(hooks, new RegExp(fixture.helper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }

    execFileSync(tmuxWrapper, ['kill-session', '-t', fixtures[0].sessionName], { env: tmuxEnv });
    await waitForFile(fixtures[0].upgradeLog, 'a');
    await waitForPendingClear(fixtures[0].paths, fixtures[0].checkout);
    assert.equal(existsSync(fixtures[1].upgradeLog), false);
    assert.equal(readState(fixtures[0].paths, fixtures[0].checkout).pending_update, null);
    assert.equal(readState(fixtures[1].paths, fixtures[1].checkout).pending_update.target_version, 'v0.2.0');
    assert.equal(existsSync(fixtures[1].recordFile), true);
    execFileSync(tmuxWrapper, ['has-session', '-t', fixtures[1].sessionName], { env: tmuxEnv });

    execFileSync(tmuxWrapper, ['kill-session', '-t', fixtures[1].sessionName], { env: tmuxEnv });
    await waitForFile(fixtures[1].upgradeLog, 'b');
    await waitForPendingClear(fixtures[1].paths, fixtures[1].checkout);
    assert.equal(readState(fixtures[1].paths, fixtures[1].checkout).pending_update, null);
  } finally {
    try {
      execFileSync(tmuxWrapper, ['kill-server'], { env, stdio: 'ignore' });
    } catch {
      // The isolated server is expected to exit with the last session.
    }
    rmSync(root, { recursive: true, force: true });
  }
});
