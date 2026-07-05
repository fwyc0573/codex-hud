import assert from 'node:assert/strict';
import { calculateContextUsage } from '../../dist/context-usage.js';

// Large window: matches Codex's effective-window calculation
// (subtract the 12k baseline from both used and total).
{
  const r = calculateContextUsage(73305, 258400);
  assert.equal(r.percent, 25, 'large window: 73305/258400 -> 25%');
  assert.equal(r.used, 61305, 'large window: effective used');
  assert.equal(r.total, 246400, 'large window: effective window');
}
{
  const r = calculateContextUsage(106000, 200000);
  assert.equal(r.percent, 50, 'large window: 106000/200000 -> 50%');
  assert.equal(r.total, 188000, 'large window: effective window');
}

// Small window (<= BASELINE_TOKENS): raw bounded ratio, never a bogus 100% (0/0).
{
  const r = calculateContextUsage(0, 8000);
  assert.equal(r.percent, 0, 'small window empty -> 0% (not 100%)');
  assert.equal(r.total, 8000, 'small window keeps raw window');
  assert.equal(r.used, 0, 'small window used');
}
{
  const r = calculateContextUsage(4000, 8000);
  assert.equal(r.percent, 50, 'small window half -> 50%');
  assert.equal(r.used, 4000, 'small window used');
}

// Boundary at the baseline itself and one token above it.
{
  const r = calculateContextUsage(6000, 12000); // window == BASELINE_TOKENS
  assert.equal(r.percent, 50, 'window == baseline uses raw ratio -> 50%');
  assert.equal(r.total, 12000, 'window == baseline keeps raw window');
}
{
  const empty = calculateContextUsage(12000, 12001); // window == baseline + 1
  assert.equal(empty.percent, 0, 'window == baseline+1, used at baseline -> 0%');
  assert.equal(empty.total, 1, 'effective window is 1');
  const full = calculateContextUsage(12001, 12001);
  assert.equal(full.percent, 100, 'window == baseline+1, used above baseline -> 100%');
}

// Degenerate window.
{
  const r = calculateContextUsage(1000, 0);
  assert.equal(r.percent, 0, 'zero window -> 0%');
  assert.equal(r.total, 0, 'zero window total');
}

console.log('test-context-usage: PASS');
