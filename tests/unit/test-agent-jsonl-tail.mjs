import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readCompleteJsonl } from '../../dist/utils/jsonl-tail.js';

const TEMP_PREFIX = 'codex-hud-agent-tail-';

function createTestRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
}

function removeTestRoot(testRoot) {
  const resolvedRoot = fs.realpathSync(testRoot);
  assert.equal(
    path.dirname(resolvedRoot),
    fs.realpathSync(os.tmpdir()),
    'cleanup must stay directly under the operating-system temp directory'
  );
  assert.ok(
    path.basename(resolvedRoot).startsWith(TEMP_PREFIX),
    'cleanup requires the test-owned directory prefix'
  );
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function writeBytes(filePath, contents) {
  fs.writeFileSync(filePath, contents, 'utf8');
  return Buffer.byteLength(contents);
}

const testRoot = createTestRoot();

try {
  {
    const filePath = path.join(testRoot, 'empty.jsonl');
    writeBytes(filePath, '');

    const batch = await readCompleteJsonl(filePath, 0);

    assert.deepEqual(batch.records, []);
    assert.equal(batch.nextOffset, 0);
    assert.equal(batch.truncated, false);
  }

  {
    const filePath = path.join(testRoot, 'ascii.jsonl');
    const record = { value: 'complete' };
    const contents = `${JSON.stringify(record)}\n`;
    const byteLength = writeBytes(filePath, contents);

    const batch = await readCompleteJsonl(filePath, 0);

    assert.deepEqual(batch.records, [record]);
    assert.equal(batch.nextOffset, byteLength);
    assert.equal(batch.truncated, false);
  }

  {
    const filePath = path.join(testRoot, 'partial.jsonl');
    const firstRecord = { value: 'first' };
    const firstLine = `${JSON.stringify(firstRecord)}\n`;
    writeBytes(filePath, `${firstLine}{"value":"partial`);

    const first = await readCompleteJsonl(filePath, 0);
    assert.deepEqual(first.records, [firstRecord]);
    assert.equal(first.nextOffset, Buffer.byteLength(firstLine));

    fs.appendFileSync(filePath, '"}\n', 'utf8');
    const second = await readCompleteJsonl(filePath, first.nextOffset);
    assert.deepEqual(second.records, [{ value: 'partial' }]);
    assert.equal(second.nextOffset, fs.statSync(filePath).size);

    const third = await readCompleteJsonl(filePath, second.nextOffset);
    assert.deepEqual(third.records, []);
    assert.equal(third.nextOffset, second.nextOffset);
    assert.equal(third.truncated, false);
  }

  {
    const filePath = path.join(testRoot, 'partial-only.jsonl');
    writeBytes(filePath, '{"value":"not-committed"}');

    const batch = await readCompleteJsonl(filePath, 0);

    assert.deepEqual(batch.records, []);
    assert.equal(batch.nextOffset, 0);
    assert.equal(batch.truncated, false);
  }

  {
    const filePath = path.join(testRoot, 'utf8.jsonl');
    const record = { value: '子代理状态' };
    const contents = `${JSON.stringify(record)}\n`;
    writeBytes(filePath, contents);

    const batch = await readCompleteJsonl(filePath, 0);

    assert.deepEqual(batch.records, [record]);
    assert.equal(batch.nextOffset, Buffer.byteLength(contents));
    assert.ok(batch.nextOffset > contents.length, 'cursor must count UTF-8 bytes, not characters');
  }

  {
    const filePath = path.join(testRoot, 'malformed.jsonl');
    const validLine = `${JSON.stringify({ value: 'before-error' })}\n`;
    writeBytes(filePath, `${validLine}{not-json}\n`);
    const committedOffset = 0;

    await assert.rejects(
      readCompleteJsonl(filePath, committedOffset),
      SyntaxError,
      'a complete malformed line must fail the whole batch'
    );
    assert.equal(committedOffset, 0, 'the caller retains its prior committed cursor after failure');
  }

  {
    const filePath = path.join(testRoot, 'truncated.jsonl');
    const originalContents = `${JSON.stringify({ value: 'a deliberately long original record' })}\n`;
    writeBytes(filePath, originalContents);
    const original = await readCompleteJsonl(filePath, 0);

    const replayRecord = { value: 'new' };
    const replayContents = `${JSON.stringify(replayRecord)}\n`;
    writeBytes(filePath, replayContents);
    assert.ok(fs.statSync(filePath).size < original.nextOffset, 'fixture must shrink the file');

    const replay = await readCompleteJsonl(filePath, original.nextOffset);

    assert.deepEqual(replay.records, [replayRecord]);
    assert.equal(replay.nextOffset, Buffer.byteLength(replayContents));
    assert.equal(replay.truncated, true);
  }

  {
    const filePath = path.join(testRoot, 'invalid-offset.jsonl');
    writeBytes(filePath, '');

    await assert.rejects(readCompleteJsonl(filePath, -1), /offset/i);
    await assert.rejects(readCompleteJsonl(filePath, 1.5), /offset/i);
    await assert.rejects(readCompleteJsonl(filePath, Number.NaN), /offset/i);
  }

  console.log('test-agent-jsonl-tail: PASS');
} finally {
  removeTestRoot(testRoot);
}
