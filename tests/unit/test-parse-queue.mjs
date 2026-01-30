import assert from 'node:assert/strict';
import { createParseQueue } from '../../dist/utils/parse-queue.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let calls = 0;
const parseFn = async () => {
  calls += 1;
  await delay(20);
  return calls;
};

const run = createParseQueue(parseFn);

const first = run();
await delay(5);
const second = run();

const result1 = await first;
const result2 = await second;

assert.equal(calls, 2, 'queues one extra parse during inflight');
assert.equal(result1, 2, 'returns latest parse result');
assert.equal(result2, 2, 'returns latest parse result for queued call');

const result3 = await run();
assert.equal(calls, 3, 'new call after height triggers fresh parse');
assert.equal(result3, 3, 'returns new parse result');

console.log('test-parse-queue: PASS');
