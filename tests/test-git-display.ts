/**
 * Test script for P1-1: Git Repository Display Verification
 * 
 * Tests:
 * 1. Branch name display (magenta)
 * 2. Dirty state indicator (*) in yellow
 * 3. Ahead/behind indicators (↑N, ↓N)
 * 4. File stats (modified, added, deleted, untracked)
 */

import { renderHud } from '../src/render/header.js';
import { collectGitStatus } from '../src/collectors/git.js';
import type { HudData, RenderOptions } from '../src/types.js';

// Render options
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

console.log('═══════════════════════════════════════════════════════════════');
console.log('  P1-1: Git Repository Display Verification');
console.log('═══════════════════════════════════════════════════════════════\n');

// Test 1: Collect real git status
console.log('[Test 1: Real Git Status Collection]');
console.log('─'.repeat(60));
const realGitStatus = collectGitStatus(process.cwd());
console.log('Git Status:', JSON.stringify(realGitStatus, null, 2));

// Test 2: Mock git scenarios
console.log('\n[Test 2: Mock Git Scenarios]');
console.log('─'.repeat(60));

const gitScenarios = [
  {
    label: 'Clean main branch, synced',
    git: {
      branch: 'main',
      isDirty: false,
      isGitRepo: true,
      ahead: 0,
      behind: 0,
      modified: 0,
      added: 0,
      deleted: 0,
      untracked: 0,
    },
  },
  {
    label: 'Dirty feature branch, ahead 3',
    git: {
      branch: 'feature/new-ui',
      isDirty: true,
      isGitRepo: true,
      ahead: 3,
      behind: 0,
      modified: 5,
      added: 2,
      deleted: 1,
      untracked: 3,
    },
  },
  {
    label: 'Behind and dirty',
    git: {
      branch: 'develop',
      isDirty: true,
      isGitRepo: true,
      ahead: 2,
      behind: 5,
      modified: 1,
      added: 0,
      deleted: 0,
      untracked: 0,
    },
  },
  {
    label: 'Not a git repo',
    git: {
      branch: null,
      isDirty: false,
      isGitRepo: false,
      ahead: 0,
      behind: 0,
      modified: 0,
      added: 0,
      deleted: 0,
      untracked: 0,
    },
  },
];

for (const scenario of gitScenarios) {
  console.log(`\n[Scenario: ${scenario.label}]`);
  
  const data: HudData = {
    config: {
      model: 'gpt-5.2-codex',
      approval_policy: 'on-request',
    },
    git: scenario.git,
    project: {
      cwd: '/test/project',
      projectName: 'my-project',
      agentsMdCount: 1,
      hasCodexDir: true,
      instructionsMdCount: 0,
      rulesCount: 0,
      mcpCount: 2,
      configsCount: 1,
      extensionsCount: 2,
      workMode: 'development',
    },
    sessionStart: new Date(),
  };
  
  const lines = renderHud(data, options);
  for (const line of lines) {
    console.log(line);
  }
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  Git Display Format Reference');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('Expected format: project-name git:(branch-name*) !N +N -N ?N');
console.log('');
console.log('Components:');
console.log('  - project-name: Yellow');
console.log('  - git:(...)   : Magenta wrapper');
console.log('  - branch-name : Magenta');
console.log('  - *           : Yellow (if dirty)');
console.log('  - ↑N          : Green (commits ahead)');
console.log('  - ↓N          : Red (commits behind)');
console.log('  - !N          : Yellow (modified files)');
console.log('  - +N          : Green (added files)');
console.log('  - -N          : Red (deleted files)');
console.log('  - ?N          : Dim (untracked files)');

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  Test Complete');
console.log('═══════════════════════════════════════════════════════════════\n');
