import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testDir, '../..');
const common = fs.readFileSync(path.join(rootDir, 'bin/windows/common.ps1'), 'utf8');

const resolver = common.match(
  /function Get-RealCodexCommand\s*\{(?<body>[\s\S]*?)\r?\n\}\s*$/
);
assert.ok(resolver?.groups?.body, 'common.ps1 should define Get-RealCodexCommand');

const body = resolver.groups.body;
const exclusionSetupIndex = body.indexOf('$excludeSet =');
const realCodexOverrideIndex = body.indexOf('if ($env:CODEX_HUD_REAL_CODEX)');
assert.ok(exclusionSetupIndex >= 0, 'Codex resolution should construct an excluded-path set');
assert.ok(realCodexOverrideIndex >= 0, 'Codex resolution should inspect CODEX_HUD_REAL_CODEX');
assert.ok(
  exclusionSetupIndex < realCodexOverrideIndex,
  'excluded paths must be prepared before environment-provided Codex candidates are evaluated'
);

assert.match(
  body,
  /\$configured\s*=\s*Resolve-NormalizedPath[\s\S]*?\$excludeSet\.Contains\(\$configured\)[\s\S]*?return\s+\[pscustomobject\]@\{\s*Source\s*=\s*\$configured\s*\}/,
  'CODEX_HUD_REAL_CODEX must not bypass excluded-path validation'
);
assert.match(
  body,
  /\$testPath\s*=\s*Resolve-NormalizedPath[\s\S]*?\$excludeSet\.Contains\(\$testPath\)[\s\S]*?return\s+\[pscustomobject\]@\{\s*Source\s*=\s*\$testPath\s*\}/,
  'CODEX_HUD_TEST_REAL_CODEX must not bypass excluded-path validation'
);
assert.match(
  body,
  /\$normalizedRootPrefix\s*=[\s\S]*?DirectorySeparatorChar/,
  'repo containment should construct a directory-boundary prefix'
);
assert.doesNotMatch(
  body,
  /StartsWith\(\$normalizedRoot,/,
  'repo containment must not reject sibling directories that only share a string prefix'
);

console.log('test-windows-codex-path-exclusion: PASS');
