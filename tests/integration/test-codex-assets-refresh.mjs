import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collectCodexAssetCounts } from '../../dist/collectors/codex-assets.js';
import { collectProjectInfo } from '../../dist/collectors/project.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-assets-refresh-'));
const cwd = path.join(root, 'repo');
const codexHome = path.join(root, 'home');
const skillsDir = path.join(codexHome, 'skills');
const hooksFile = path.join(codexHome, 'hooks.json');
fs.mkdirSync(cwd, { recursive: true });

function writeSkill(name, enabled = true) {
  const skillDir = path.join(skillsDir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\nenabled: ${enabled}\n---\n# Skill\n`,
    'utf8'
  );
}

function writeHooks(entries) {
  fs.writeFileSync(hooksFile, JSON.stringify({ hooks: { event: entries } }), 'utf8');
}

writeSkill('first');
writeHooks([{ command: 'first-hook', enabled: true }]);

const env = { CODEX_HOME: codexHome };
const refresh = { forceRefresh: true };
const initial = collectCodexAssetCounts(cwd, env, undefined, refresh);
assert.deepEqual(initial, { skillsCount: 1, hooksCount: 1 });

writeSkill('second');
writeHooks([
  { command: 'first-hook', enabled: true },
  { command: 'second-hook', enabled: true },
]);
const added = collectCodexAssetCounts(cwd, env, undefined, refresh);
assert.deepEqual(added, { skillsCount: 2, hooksCount: 2 });

writeSkill('first', false);
writeHooks([
  { command: 'first-hook', enabled: false },
  { command: 'second-hook', enabled: true },
]);
const disabled = collectCodexAssetCounts(cwd, env, undefined, refresh);
assert.deepEqual(disabled, { skillsCount: 1, hooksCount: 1 });

const previousCodexHome = process.env.CODEX_HOME;
process.env.CODEX_HOME = codexHome;
const projectInfo = collectProjectInfo(cwd, {});
if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
else process.env.CODEX_HOME = previousCodexHome;
assert.equal(projectInfo.skillsCount, 1);
assert.equal(projectInfo.hooksCount, 1);

console.log(`test-codex-assets-refresh: PASS (initial=1/1 added=2/2 disabled=1/1)`);
