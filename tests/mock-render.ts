/**
 * Test script for HUD rendering with mock data
 * Usage: npx ts-node tests/mock-render.ts
 * Or: node dist/tests/mock-render.js (after build)
 */

import type { HudData, ContextUsage, ToolActivity, ToolCall, PlanProgress } from '../src/types.js';
import { renderHud } from '../src/render/header.js';
import type { RenderOptions } from '../src/types.js';
import { DEFAULT_LAYOUT } from '../src/types.js';

// Mock HudData for testing different scenarios
function createMockHudData(overrides: Partial<HudData> = {}): HudData {
  const now = new Date();
  const sessionStart = new Date(now.getTime() - 12 * 60 * 1000); // 12 minutes ago
  
  return {
    config: {
      model: 'gpt-5.2-codex',
      model_provider: 'openai',
      approval_policy: 'on-request',
      sandbox_mode: 'workspace-write',
      mcp_servers: {
        'server1': { enabled: true, command: ['node', 'server.js'] },
        'server2': { enabled: true, url: 'http://localhost:3000' },
        'server3': { enabled: false, command: ['python', 'mcp.py'] },
      },
    },
    git: {
      branch: 'feature/hud-display',
      isDirty: true,
      isGitRepo: true,
      ahead: 2,
      behind: 1,
      modified: 3,
      added: 1,
      deleted: 0,
      untracked: 2,
    },
    project: {
      cwd: '/home/user/projects/my-awesome-project',
      projectName: 'my-awesome-project',
      agentsMdCount: 2,
      hasCodexDir: true,
      instructionsMdCount: 1,
      rulesCount: 3,
      mcpCount: 2,
      configsCount: 2,
      extensionsCount: 2,
      workMode: 'development',
    },
    sessionStart,
    ...overrides,
  };
}

// Create context usage at different percentages
function createContextUsage(percent: number): ContextUsage {
  const total = 128000; // 128K context window
  const used = Math.floor(total * (percent / 100));
  const inputTokens = Math.floor(used * 0.7);
  const outputTokens = Math.floor(used * 0.25);
  const cachedTokens = Math.floor(used * 0.05);
  
  return {
    used,
    total,
    percent,
    inputTokens,
    outputTokens,
    cachedTokens,
  };
}

// Create mock tool activity
function createToolActivity(recentCount: number, totalCount: number): ToolActivity {
  const recentCalls: ToolCall[] = [];
  const toolTypes = ['Bash', 'Read', 'Edit', 'Glob', 'Grep', 'Write'];
  
  for (let i = 0; i < recentCount; i++) {
    const toolName = toolTypes[i % toolTypes.length];
    recentCalls.push({
      id: `call-${i}`,
      name: toolName,
      timestamp: new Date(),
      status: i === 0 ? 'running' : 'completed',
      duration: i === 0 ? undefined : Math.floor(Math.random() * 1000) + 100,
      target: toolName === 'Read' ? 'src/index.ts' : undefined,
    });
  }
  
  return {
    recentCalls,
    totalCalls: totalCount,
    callsByType: {
      'Bash': 15,
      'Read': 42,
      'Edit': 8,
      'Glob': 5,
      'Grep': 12,
      'Write': 3,
    },
    lastUpdateTime: new Date(),
  };
}

// Create mock plan progress
function createPlanProgress(completed: number, total: number): PlanProgress {
  const steps = [];
  for (let i = 0; i < total; i++) {
    steps.push({
      step: `Step ${i + 1}: Task description`,
      status: i < completed ? 'completed' as const : (i === completed ? 'in_progress' as const : 'pending' as const),
    });
  }
  
  return {
    steps,
    completedSteps: completed,
    totalSteps: total,
    completed,
    total,
    lastUpdate: new Date(),
  };
}

// Test scenarios
const scenarios = [
  {
    name: 'Empty/Minimal',
    description: 'No token usage, no tools, no git',
    data: createMockHudData({
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
    }),
  },
  {
    name: 'Low Usage (25%)',
    description: 'Token usage at 25%, green progress bar',
    data: createMockHudData({
      contextUsage: createContextUsage(25),
      toolActivity: createToolActivity(3, 15),
    }),
  },
  {
    name: 'Medium Usage (50%)',
    description: 'Token usage at 50%, green progress bar',
    data: createMockHudData({
      contextUsage: createContextUsage(50),
      toolActivity: createToolActivity(5, 45),
    }),
  },
  {
    name: 'High Usage (75%)',
    description: 'Token usage at 75%, yellow warning',
    data: createMockHudData({
      contextUsage: createContextUsage(75),
      toolActivity: createToolActivity(8, 120),
      planProgress: createPlanProgress(3, 5),
    }),
  },
  {
    name: 'Critical Usage (90%)',
    description: 'Token usage at 90%, red warning with breakdown',
    data: createMockHudData({
      contextUsage: createContextUsage(90),
      toolActivity: createToolActivity(10, 250),
      planProgress: createPlanProgress(4, 5),
    }),
  },
  {
    name: 'Full Usage (100%)',
    description: 'Token usage at 100%, red critical',
    data: createMockHudData({
      contextUsage: createContextUsage(100),
      toolActivity: createToolActivity(12, 500),
      planProgress: createPlanProgress(5, 5),
    }),
  },
  {
    name: 'Production Mode',
    description: 'Production mode with danger sandbox',
    data: createMockHudData({
      config: {
        model: 'gpt-5.2-codex',
        approval_policy: 'full-auto',
        sandbox_mode: 'danger-full-access',
      },
      project: {
        cwd: '/production/critical-service',
        projectName: 'critical-service',
        agentsMdCount: 1,
        hasCodexDir: true,
        instructionsMdCount: 1,
        rulesCount: 5,
        mcpCount: 5,
        configsCount: 3,
        extensionsCount: 5,
        workMode: 'production',
      },
      contextUsage: createContextUsage(60),
    }),
  },
];

// ANSI codes for terminal formatting
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';

// Run tests
console.log(`${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════╗${RESET}`);
console.log(`${BOLD}${CYAN}║           Codex-HUD Mock Render Test Suite                   ║${RESET}`);
console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════╝${RESET}`);
console.log();

for (const scenario of scenarios) {
  console.log(`${BOLD}${GREEN}━━━ ${scenario.name} ━━━${RESET}`);
  console.log(`${DIM}${scenario.description}${RESET}`);
  console.log();
  
  const options: RenderOptions = {
    width: 100,
    showDetails: true,
    layout: {
      ...DEFAULT_LAYOUT,
      mode: 'expanded',
      showSeparators: false,
      showDuration: true,
      showContextBreakdown: true,
      barWidth: 10,
    },
  };
  
  const lines = renderHud(scenario.data, options);
  
  for (const line of lines) {
    console.log(`  ${line}`);
  }
  
  console.log();
  console.log(`${DIM}─────────────────────────────────────────────────────────────────${RESET}`);
  console.log();
}

// Summary
console.log(`${BOLD}${YELLOW}Test Summary${RESET}`);
console.log(`${DIM}Total scenarios: ${scenarios.length}${RESET}`);
console.log(`${DIM}All scenarios rendered successfully.${RESET}`);
console.log();
console.log(`${BOLD}Verification Checklist:${RESET}`);
console.log('  [ ] Progress bar displays correctly for 0%, 25%, 50%, 75%, 100%');
console.log('  [ ] Colors change at correct thresholds (70% yellow, 85% red)');
console.log('  [ ] Token counts formatted correctly (K, M suffixes)');
console.log('  [ ] Git branch and dirty indicator display correctly');
console.log('  [ ] Work mode shows dev (green) or prod (red)');
console.log('  [ ] Sandbox mode shows appropriate warning');
console.log('  [ ] Tool activity shows running spinner and history');
