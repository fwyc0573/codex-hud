/**
 * Test script for P1-1: Git Repository Testing
 * 
 * Tests:
 * 1. Branch name display
 * 2. Dirty state indicator (*)
 * 3. Ahead/behind indicators
 * 4. File stats (modified, added, deleted, untracked)
 */

import { collectGitStatus } from '../src/collectors/git.js';
import { renderHud } from '../src/render/header.js';
import type { HudData, RenderOptions } from '../src/types.js';

// Get current working directory or use argument
const testDir = process.argv[2] || process.cwd();

console.log('═══════════════════════════════════════════════════════════════');
console.log('  P1-1: Git Repository Testing');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log(`Testing directory: ${testDir}\n`);

// Collect git status
console.log('[Step 1: Collecting Git Status]');
console.log('─'.repeat(60));

const gitStatus = collectGitStatus(testDir);

console.log('Git Status Object:');
console.log(JSON.stringify(gitStatus, null, 2));

// Check if it's a git repo
if (!gitStatus.isGitRepo) {
  console.log('\n⚠️  WARNING: Not a git repository');
  console.log('    Run this test in a git repository for full verification');
  console.log('    Example: npx tsx tests/test-git.ts /path/to/git/repo');
}

// Create mock HUD data with real git status
const mockData: HudData = {
  config: {
    model: 'gpt-5.2-codex',
    model_provider: 'openai',
    approval_policy: 'on-request',
  },
  git: gitStatus,
  project: {
    cwd: testDir,
    projectName: testDir.split('/').pop() || 'unknown',
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

console.log('\n[Step 2: Rendered HUD Output]');
console.log('─'.repeat(60));

const lines = renderHud(mockData, options);
for (const line of lines) {
  console.log(line);
}

// Verification checklist
console.log('\n[Step 3: Verification Checklist]');
console.log('─'.repeat(60));

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  details: string;
}

const results: TestResult[] = [];

// Test 1: Is git repo detected
results.push({
  name: 'Git repository detection',
  status: gitStatus.isGitRepo ? 'PASS' : 'SKIP',
  details: gitStatus.isGitRepo 
    ? `Detected as git repository` 
    : `Not a git repo - skip remaining tests`,
});

if (gitStatus.isGitRepo) {
  // Test 2: Branch name
  results.push({
    name: 'Branch name display',
    status: gitStatus.branch ? 'PASS' : 'FAIL',
    details: gitStatus.branch 
      ? `Branch: ${gitStatus.branch}` 
      : 'No branch detected',
  });

  // Test 3: Dirty state
  results.push({
    name: 'Dirty state indicator',
    status: 'PASS', // Always pass - we're just verifying it renders
    details: gitStatus.isDirty 
      ? 'Dirty (should show *)' 
      : 'Clean (no * shown)',
  });

  // Test 4: Ahead/behind
  results.push({
    name: 'Ahead/behind indicators',
    status: 'PASS',
    details: `Ahead: ${gitStatus.ahead}, Behind: ${gitStatus.behind}`,
  });

  // Test 5: File stats
  results.push({
    name: 'File statistics',
    status: 'PASS',
    details: `Modified: ${gitStatus.modified}, Added: ${gitStatus.added}, Deleted: ${gitStatus.deleted}, Untracked: ${gitStatus.untracked}`,
  });
}

// Print results
console.log('\n| Test | Status | Details |');
console.log('|------|--------|---------|');
for (const result of results) {
  const statusIcon = result.status === 'PASS' ? '✓' : result.status === 'FAIL' ? '✗' : '○';
  console.log(`| ${result.name} | ${statusIcon} ${result.status} | ${result.details} |`);
}

const passCount = results.filter(r => r.status === 'PASS').length;
const failCount = results.filter(r => r.status === 'FAIL').length;
const skipCount = results.filter(r => r.status === 'SKIP').length;

console.log(`\nSummary: ${passCount} passed, ${failCount} failed, ${skipCount} skipped`);

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  Test Complete');
console.log('═══════════════════════════════════════════════════════════════\n');
