import assert from 'node:assert/strict';
import { computeNextOffset } from '../../dist/collectors/rollout.js';

assert.equal(computeNextOffset(0, 100, 90), 90, 'clamps to latest size');
assert.equal(computeNextOffset(10, 20, 100), 30, 'advances by bytes read');
assert.equal(computeNextOffset(50, 10, 55), 55, 'never exceeds latest size');

console.log('test-rollout-offset: PASS');
