import assert from 'assert';
import { spawn, spawnSync } from 'child_process';
import { getMcpServerStatus } from '../dist/collectors/mcp-status.js';

const pgrepCheck = spawnSync('pgrep', ['-V'], { stdio: 'ignore' });
if (pgrepCheck.error) {
  console.log('Skipping MCP status test: pgrep not available.');
  process.exit(0);
}

const pgrepProbe = spawnSync('pgrep', ['-f', 'codex-hud-probe'], { encoding: 'utf8' });
if (pgrepProbe.stderr && /Cannot get process list|sysmon/i.test(pgrepProbe.stderr)) {
  console.log('Skipping MCP status test: pgrep cannot access process list.');
  process.exit(0);
}

const uniqueArg = `--mcp-hud-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const scriptArg = 'setTimeout(() => {}, 5000)';
const nodeArgs = ['-e', scriptArg, uniqueArg];

const child = spawn(process.execPath, nodeArgs, { stdio: 'ignore' });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await wait(150);

const status = getMcpServerStatus('test', { command: [process.execPath, ...nodeArgs], enabled: true });
assert.strictEqual(status, 'running');

child.kill();
await new Promise((resolve) => child.on('exit', resolve));

const statusAfter = getMcpServerStatus('test', { command: [process.execPath, ...nodeArgs], enabled: true });
assert.strictEqual(statusAfter, 'stopped');

console.log('MCP status detection tests passed.');
