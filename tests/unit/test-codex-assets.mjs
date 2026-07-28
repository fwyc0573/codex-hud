import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collectCodexAssetCounts } from '../../dist/collectors/codex-assets.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-assets-'));
const cwd = path.join(root, 'repo', 'project');
const userSkills = path.join(root, 'user', 'skills');
const systemSkills = path.join(root, 'system', 'skills');
const adminSkills = path.join(root, 'admin', 'skills');
const codexHome = path.join(root, 'user');

function writeSkill(rootDir, dirName, frontmatter) {
  const skillDir = path.join(rootDir, dirName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\n${frontmatter}\n---\n# Skill\n`, 'utf8');
  return skillDir;
}

fs.mkdirSync(cwd, { recursive: true });
const enabledSkill = writeSkill(userSkills, 'enabled', 'name: enabled\nenabled: true');
writeSkill(userSkills, 'disabled', 'name: disabled\nenabled: false');
fs.mkdirSync(path.join(userSkills, 'malformed'), { recursive: true });
fs.writeFileSync(path.join(userSkills, 'malformed', 'SKILL.md'), 'not frontmatter', 'utf8');
fs.symlinkSync(enabledSkill, path.join(userSkills, 'enabled-alias'), 'dir');
writeSkill(path.join(root, 'repo', '.agents', 'skills'), 'repo-agent', 'name: repo-agent');
writeSkill(path.join(root, 'repo', '.codex', 'skills'), 'repo-codex', 'name: repo-codex\nenabled: true');
writeSkill(systemSkills, 'system', 'name: system\nenabled: true');
writeSkill(adminSkills, 'admin', 'name: admin\nenabled: true');

function writeHooks(filePath, entries) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ hooks: { event: entries } }), 'utf8');
}

writeHooks(path.join(codexHome, 'hooks.json'), [
  { command: 'user-hook', enabled: true },
  { command: 'disabled-hook', enabled: false },
  'malformed-hook',
]);
writeHooks(path.join(root, 'repo', '.codex', 'hooks.json'), [
  { command: 'repo-hook', enabled: true, sourcePath: '/hooks/repo' },
]);
writeHooks(path.join(root, 'repo', '.agents', 'hooks.json'), [
  { command: 'repo-hook-duplicate', enabled: true, sourcePath: '/hooks/repo' },
]);
writeHooks(path.join(root, 'system', 'hooks.json'), [
  { command: 'system-hook', enabled: true },
]);
writeHooks(path.join(root, 'admin', 'hooks.json'), [
  { command: 'admin-hook', enabled: true },
]);

const counts = collectCodexAssetCounts(cwd, {
  CODEX_HOME: codexHome,
  CODEX_SYSTEM_SKILLS_DIR: systemSkills,
  CODEX_SYSTEM_HOOKS_FILE: path.join(root, 'system', 'hooks.json'),
  CODEX_ADMIN_SKILLS_DIR: adminSkills,
  CODEX_ADMIN_HOOKS_FILE: path.join(root, 'admin', 'hooks.json'),
});

assert.deepEqual(counts, { skillsCount: 5, hooksCount: 4 });
assert.deepEqual(
  collectCodexAssetCounts(cwd, {
    CODEX_HOME: codexHome,
    CODEX_SYSTEM_SKILLS_DIR: systemSkills,
    CODEX_SYSTEM_HOOKS_FILE: path.join(root, 'system', 'hooks.json'),
    CODEX_ADMIN_SKILLS_DIR: adminSkills,
    CODEX_ADMIN_HOOKS_FILE: path.join(root, 'admin', 'hooks.json'),
  }, { hooks: false }),
  { skillsCount: 5, hooksCount: 0 }
);
console.log(`test-codex-assets: PASS (skills=${counts.skillsCount}, hooks=${counts.hooksCount})`);
