import assert from 'node:assert/strict';

import {
  AGENT_INACTIVITY_TIMEOUT_ENV,
  DEFAULT_AGENT_INACTIVITY_TIMEOUT_MS,
  parseAgentInactivityTimeoutMs,
} from '../../dist/collectors/agent-activity.js';

assert.equal(
  AGENT_INACTIVITY_TIMEOUT_ENV,
  'CODEX_HUD_AGENT_INACTIVITY_TIMEOUT_MS'
);
assert.equal(DEFAULT_AGENT_INACTIVITY_TIMEOUT_MS, 900_000);

const validCases = [
  [undefined, 900_000],
  ['1', 1],
  ['900000', 900_000],
  [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
];

for (const [raw, expected] of validCases) {
  assert.equal(parseAgentInactivityTimeoutMs(raw), expected);
}

const invalidValues = [
  '',
  '0',
  '-1',
  '1.5',
  'NaN',
  '9007199254740992',
  ' 900000',
  '900000 ',
];

for (const raw of invalidValues) {
  assert.throws(
    () => parseAgentInactivityTimeoutMs(raw),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /CODEX_HUD_AGENT_INACTIVITY_TIMEOUT_MS/);
      assert.match(error.message, /positive integer/);
      assert.match(error.message, /milliseconds/);
      return true;
    }
  );
}

console.log(
  `test-agent-activity-config: PASS (default=${DEFAULT_AGENT_INACTIVITY_TIMEOUT_MS}, valid=${validCases.length}, invalid=${invalidValues.length})`
);
