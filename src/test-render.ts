/**
 * Test script for Codex HUD rendering
 * Creates mock data to verify all UI components
 */

import { renderHud } from './render/header.js';
import type { HudData, RenderOptions, ContextUsage, ToolActivity, ToolCall } from './types.js';
import { DEFAULT_LAYOUT, BASELINE_TOKENS } from './types.js';

// ANSI color codes for visual verification output
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

function log(label: string, value: string): void {
  console.log(`${CYAN}[TEST]${RESET} ${label}: ${value}`);
}

function divider(title: string): void {
  console.log(`\n${DIM}${'='.repeat(60)}${RESET}`);
  console.log(`${YELLOW}${title}${RESET}`);
  console.log(`${DIM}${'='.repeat(60)}${RESET}\n`);
}

/**
 * Create mock HUD data with customizable token usage
 */
function createMockData(options: {
  tokenPercent?: number;
  hasGit?: boolean;
  isDirty?: boolean;
  hasToolActivity?: boolean;
  toolCount?: number;
}): HudData {
  const { tokenPercent = 0, hasGit = false, isDirty = false, hasToolActivity = false, toolCount = 0 } = options;

  // Calculate token values based on percentage (using official Codex CLI formula)
  const contextWindow = 200000;  // 200K context window
  // For testing: tokenPercent represents USAGE percentage
  // Official formula uses BASELINE_TOKENS (12000) to calculate effective window
  const effectiveWindow = contextWindow - BASELINE_TOKENS;
  const contextLeftPercent = 100 - tokenPercent;  // Convert usage to "left"
  const used = Math.floor(effectiveWindow * (tokenPercent / 100));
  const totalTokens = used + BASELINE_TOKENS;

  const contextUsage: ContextUsage | undefined = tokenPercent > 0 ? {
    used: totalTokens,
    total: contextWindow,
    percent: tokenPercent,  // Usage percentage (for progress bar)
    contextLeftPercent,     // Context left percentage (official)
    inputTokens: Math.floor(totalTokens * 0.7),
    outputTokens: Math.floor(totalTokens * 0.3),
    cachedTokens: Math.floor(totalTokens * 0.2),
    lastTotalTokens: totalTokens,
  } : undefined;

  // Create tool activity if requested
  let toolActivity: ToolActivity | undefined;
  if (hasToolActivity && toolCount > 0) {
    const toolTypes = ['Read', 'Bash', 'Edit', 'Write', 'Grep'];
    const recentCalls: ToolCall[] = [];
    const callsByType: Record<string, number> = {};

    for (let i = 0; i < Math.min(toolCount, 5); i++) {
      const toolName = toolTypes[i % toolTypes.length];
      callsByType[toolName] = (callsByType[toolName] || 0) + 1;
      recentCalls.push({
        id: `call-${i}`,
        name: toolName,
        timestamp: new Date(),
        status: 'completed',
        duration: Math.floor(Math.random() * 1000),
        target: `/path/to/file-${i}.ts`,
      });
    }

    toolActivity = {
      recentCalls,
      totalCalls: toolCount,
      callsByType,
      lastUpdateTime: new Date(),
    };
  }

  return {
    config: {
      model: 'gpt-5.2-codex',
      model_provider: 'openai',
      approval_policy: 'on-request',
      sandbox_mode: 'workspace-write',
      mcp_servers: {
        'context7': { enabled: true },
        'playwright': { enabled: true },
      },
    },
    git: {
      branch: hasGit ? 'feature/hud-improvements' : null,
      isDirty,
      isGitRepo: hasGit,
      ahead: hasGit ? 2 : 0,
      behind: hasGit ? 0 : 0,
      modified: isDirty ? 3 : 0,
      added: isDirty ? 1 : 0,
      deleted: 0,
      untracked: isDirty ? 2 : 0,
    },
    project: {
      cwd: '/local/ycfeng/codex-hud',
      projectName: 'codex-hud',
      agentsMdCount: 2,
      hasCodexDir: true,
      instructionsMdCount: 1,
      rulesCount: 3,
      mcpCount: 2,
      configsCount: 2,
      extensionsCount: 2,
      workMode: 'development',
    },
    sessionStart: new Date(Date.now() - 12 * 60 * 1000),  // 12 minutes ago
    contextUsage,
    toolActivity,
  };
}

/**
 * Render and display test case
 */
function runTestCase(name: string, data: HudData): void {
  divider(name);

  const options: RenderOptions = {
    width: 120,
    showDetails: true,
    layout: {
      ...DEFAULT_LAYOUT,
      mode: 'expanded',
      showContextBreakdown: true,
      barWidth: 12,
    },
  };

  const lines = renderHud(data, options);

  console.log('Rendered output:');
  console.log('');
  for (const line of lines) {
    console.log(line);
  }
  console.log('');

  log('Lines rendered', lines.length.toString());
}

// =============================================================================
// Test Cases
// =============================================================================

console.log('\n');
console.log(`${GREEN}╔════════════════════════════════════════════════════════════╗${RESET}`);
console.log(`${GREEN}║         CODEX-HUD RENDERING TEST SUITE                      ║${RESET}`);
console.log(`${GREEN}╚════════════════════════════════════════════════════════════╝${RESET}`);

// Test 1: Token Progress Bar at various percentages
runTestCase('TEST 1: Token Progress Bar - 0% (No usage)', createMockData({ tokenPercent: 0 }));
runTestCase('TEST 2: Token Progress Bar - 25% (Green)', createMockData({ tokenPercent: 25 }));
runTestCase('TEST 3: Token Progress Bar - 50% (Green)', createMockData({ tokenPercent: 50 }));
runTestCase('TEST 4: Token Progress Bar - 70% (Yellow threshold)', createMockData({ tokenPercent: 70 }));
runTestCase('TEST 5: Token Progress Bar - 85% (Red threshold + breakdown)', createMockData({ tokenPercent: 85 }));
runTestCase('TEST 6: Token Progress Bar - 95% (Critical)', createMockData({ tokenPercent: 95 }));

// Test 7: Git repository display
runTestCase('TEST 7: Git Branch (clean)', createMockData({ tokenPercent: 45, hasGit: true, isDirty: false }));
runTestCase('TEST 8: Git Branch (dirty)', createMockData({ tokenPercent: 45, hasGit: true, isDirty: true }));

// Test 9: Tool activity
runTestCase('TEST 9: Tool Activity (5 calls)', createMockData({
  tokenPercent: 60,
  hasGit: true,
  isDirty: true,
  hasToolActivity: true,
  toolCount: 5
}));

runTestCase('TEST 10: Full Display (all features)', createMockData({
  tokenPercent: 78,
  hasGit: true,
  isDirty: true,
  hasToolActivity: true,
  toolCount: 25
}));

console.log(`\n${GREEN}All tests completed!${RESET}\n`);
