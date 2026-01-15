/**
 * Test script for P1-1: Git Repository Testing
 * 
 * Tests:
 * 1. Branch name display
 * 2. Dirty state indicator (*)
 * 3. Ahead/behind indicators (↑N/↓N)
 * 4. File stats (modified, added, deleted, untracked)
 */

import { collectGitStatus } from '../src/collectors/git.js';
import { renderHud } from '../src/render/header.js';
import type { HudData, RenderOptions } from '../src/types.js';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  P1-1: Git Repository Testing');
console.log('═══════════════════════════════════════════════════════════════\n');

// Get actual git status
const cwd = process.cwd();
console.log(`Testing in: ${cwd}\n`);

const gitStatus = collectGitStatus(cwd);
console.log('Git Status Collected:');
console.log(JSON.stringify(gitStatus, null, 2));
console.log('');

// Create HUD data with actual git status
const data: HudData = {
  config: {
    model: 'gpt-5.2-codex',
    model_provider: 'openai',
    approval_policy: 'on-request',
  },
  git: gitStatus,
  project: {
    cwd,
    projectName: cwd.split('/').pop() || 'unknown',
    agentsMdCount: 0,
    hasCodexDir: false,
    instructionsMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    configsCount: 0,
    extensionsCount: 0,
    workMode: 'development',
  },
  sessionStart: new Date(),
};

const options: RenderOptions = {
  width: 120,
  showDetails: true,
  layout: {
    mode: 'expanded',
    showSeparators: false,
    showDuration: true,
    showContextBreakdown: true,
    barWidth: 10,
  },
};

console.log('\n[Rendered Output]');
console.log('─'.repeat(60));
const lines = renderHud(data, options);
for (const line of lines) {
  console.log(line);
}

// Verification table
console.log('\n\n[Verification Results]');
console.log('─'.repeat(60));
console.log(`| Check              | Expected  | Actual    | Pass |`);
console.log(`|--------------------|-----------|-----------|------|`);

const checks = [
  { name: 'isGitRepo', expected: true, actual: gitStatus.isGitRepo },
  { name: 'branch !== null', expected: true, actual: gitStatus.branch !== null },
  { name: 'isDirty defined', expected: true, actual: typeof gitStatus.isDirty === 'boolean' },
  { name: 'ahead >= 0', expected: true, actual: gitStatus.ahead >= 0 },
  { name: 'behind >= 0', expected: true, actual: gitStatus.behind >= 0 },
];

for (const check of checks) {
  const pass = check.actual === check.expected;
  console.log(`| ${check.name.padEnd(18)} | ${String(check.expected).padEnd(9)} | ${String(check.actual).padEnd(9)} | ${pass ? '✓' : '✗'}    |`);
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  Test Complete');
console.log('═══════════════════════════════════════════════════════════════\n');
