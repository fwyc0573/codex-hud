import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('../..', import.meta.url));
const watcherModule = join(rootDir, 'dist', 'collectors', 'file-watcher.js');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'codex-hud-watcher-rejection-'));
const watchedFile = join(fixtureRoot, 'rollout.jsonl');

const childSource = `
  import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
  import { FileWatcher, HudFileWatcher } from ${JSON.stringify(watcherModule)};
  const target = ${JSON.stringify(watchedFile)};
  writeFileSync(target, 'initial\\n');
  let directCallbacks = 0;
  const watcher = new FileWatcher([target], { usePolling: true });
  watcher.onChange(async () => {
    directCallbacks += 1;
    throw new Error('intentional async watcher rejection');
  });
  watcher.start();
  const codexHome = ${JSON.stringify(join(fixtureRoot, 'codex-home'))};
  const today = new Date();
  const sessionDir = [
    codexHome,
    'sessions',
    String(today.getFullYear()),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('/');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(${JSON.stringify(join(fixtureRoot, 'codex-home', 'config.toml'))}, '');
  process.env.CODEX_HOME = codexHome;
  const hudWatcher = new HudFileWatcher();
  let hudCallbacks = 0;
  hudWatcher.onRolloutChange(async () => {
    hudCallbacks += 1;
    throw new Error('intentional async HUD watcher rejection');
  });
  hudWatcher.start();
  hudWatcher.setRolloutPath(target);
  setTimeout(() => appendFileSync(target, 'changed\\n'), 150);
  setTimeout(async () => {
    await watcher.stop();
    await hudWatcher.stop();
    process.stdout.write('watcher-alive direct=' + directCallbacks + ' hud=' + hudCallbacks + '\\n');
  }, 1800);
`;

try {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    cwd: rootDir,
    encoding: 'utf8',
    timeout: 5000,
  });

  assert.equal(
    result.status,
    0,
    `watcher child exited unexpectedly: status=${result.status} signal=${result.signal}\nstdout=${result.stdout}\nstderr=${result.stderr}`
  );
  assert.match(result.stdout, /watcher-alive/);
  assert.match(result.stderr, /File watcher callback failed/);
  assert.match(result.stderr, /HUD rollout watcher callback failed/);
  const callbackCounts = result.stdout.match(/direct=(\d+) hud=(\d+)/);
  assert.ok(callbackCounts, `watcher callback counts missing: ${result.stdout}`);
  assert.ok(Number(callbackCounts[1]) > 0, `direct callback did not run: ${result.stdout}`);
  assert.ok(Number(callbackCounts[2]) > 0, `HUD callback did not run: ${result.stdout}`);
  console.log(`test-file-watcher-promise-rejection: PASS (${result.stdout.trim()})`);
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
