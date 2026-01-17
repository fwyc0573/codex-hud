import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { RolloutParser, parseRolloutFile } from '../dist/collectors/rollout.js';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function appendJsonLine(filePath, payload, lineEnding = '\n') {
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}${lineEnding}`);
}

async function testIncrementalToolCalls() {
  const tempDir = makeTempDir('codex-hud-rollout-');
  const rolloutPath = path.join(tempDir, 'rollout.jsonl');
  fs.writeFileSync(rolloutPath, '');

  const parser = new RolloutParser(10);
  parser.setRolloutPath(rolloutPath);

  const startEntry = {
    timestamp: new Date().toISOString(),
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'Read',
      id: 'call-1',
      arguments: JSON.stringify({ path: '/tmp/input.txt' }),
    },
  };

  appendJsonLine(rolloutPath, startEntry);
  const first = await parser.parse();
  assert(first, 'Expected first parse result');

  const running = first.toolActivity.recentCalls.find((call) => call.id === 'call-1');
  assert(running, 'Expected running call after first parse');
  assert.strictEqual(running.status, 'running');

  const outputEntry = {
    timestamp: new Date().toISOString(),
    type: 'response_item',
    payload: {
      type: 'function_call_output',
      call_id: 'call-1',
      output: { success: true },
    },
  };

  appendJsonLine(rolloutPath, outputEntry);
  const second = await parser.parse();
  assert(second, 'Expected second parse result');

  const completed = second.toolActivity.recentCalls.find((call) => call.id === 'call-1');
  assert(completed, 'Expected completed call after output parse');
  assert.strictEqual(completed.status, 'completed');
}

async function testOffsetTracking() {
  const tempDir = makeTempDir('codex-hud-rollout-');

  const crlfPath = path.join(tempDir, 'rollout-crlf.jsonl');
  const crlfEntry1 = {
    timestamp: new Date().toISOString(),
    type: 'response_item',
    payload: { type: 'function_call', name: 'Edit', id: 'call-crlf-1', arguments: '{}' },
  };
  const crlfEntry2 = {
    timestamp: new Date().toISOString(),
    type: 'response_item',
    payload: { type: 'function_call', name: 'Write', id: 'call-crlf-2', arguments: '{}' },
  };
  fs.writeFileSync(
    crlfPath,
    `${JSON.stringify(crlfEntry1)}\r\n${JSON.stringify(crlfEntry2)}\r\n`
  );

  const crlfStats = fs.statSync(crlfPath);
  const crlfResult = await parseRolloutFile(crlfPath, 0, 10);
  assert.strictEqual(crlfResult.newOffset, crlfStats.size, 'CRLF offset should match file size');
  assert.strictEqual(crlfResult.result.toolActivity.totalCalls, 2);

  const crlfResult2 = await parseRolloutFile(crlfPath, crlfResult.newOffset, 10);
  assert.strictEqual(crlfResult2.newOffset, crlfStats.size, 'CRLF offset should remain stable');
  assert.strictEqual(crlfResult2.result.toolActivity.totalCalls, 0);

  const noNlPath = path.join(tempDir, 'rollout-no-nl.jsonl');
  const noNlEntry1 = {
    timestamp: new Date().toISOString(),
    type: 'response_item',
    payload: { type: 'function_call', name: 'Grep', id: 'call-nl-1', arguments: '{}' },
  };
  const noNlEntry2 = {
    timestamp: new Date().toISOString(),
    type: 'response_item',
    payload: { type: 'function_call', name: 'Bash', id: 'call-nl-2', arguments: '{}' },
  };
  fs.writeFileSync(noNlPath, `${JSON.stringify(noNlEntry1)}\n${JSON.stringify(noNlEntry2)}`);

  const noNlStats = fs.statSync(noNlPath);
  const noNlResult = await parseRolloutFile(noNlPath, 0, 10);
  assert.strictEqual(noNlResult.newOffset, noNlStats.size, 'No-NL offset should match file size');
  assert.strictEqual(noNlResult.result.toolActivity.totalCalls, 2);

  const noNlResult2 = await parseRolloutFile(noNlPath, noNlResult.newOffset, 10);
  assert.strictEqual(noNlResult2.newOffset, noNlStats.size, 'No-NL offset should remain stable');
  assert.strictEqual(noNlResult2.result.toolActivity.totalCalls, 0);
}

await testIncrementalToolCalls();
await testOffsetTracking();

console.log('Rollout incremental parsing tests passed.');
