/**
 * Codex HUD - Main entry point
 * Phase 3: Redesigned with claude-hud style rendering
 */

import { readCodexConfig } from './collectors/codex-config.js';
import { collectGitStatus } from './collectors/git.js';
import { collectProjectInfo } from './collectors/project.js';
import { SessionFinder } from './collectors/session-finder.js';
import { RolloutParser } from './collectors/rollout.js';
import { HudFileWatcher } from './collectors/file-watcher.js';
import { renderToStdout, cleanupRenderer } from './render/index.js';
import { BASELINE_TOKENS } from './types.js';
import type { HudData, TokenUsage } from './types.js';

// Session start time
const SESSION_START = new Date();

// Refresh interval in milliseconds
const REFRESH_INTERVAL = 1000;

// Current working directory for the HUD
const HUD_CWD = process.env.CODEX_HUD_CWD || process.cwd();

// Track if we're running
let isRunning = true;

function getNonCachedInputTokens(usage: TokenUsage | undefined): number {
  if (!usage) {
    return 0;
  }

  const input = usage.input_tokens ?? 0;
  const cached = usage.cached_input_tokens ?? 0;
  return Math.max(0, input - cached);
}

function percentOfContextWindowRemaining(tokensInContext: number, contextWindow: number): number {
  if (contextWindow <= BASELINE_TOKENS) {
    return 0;
  }

  const effectiveWindow = contextWindow - BASELINE_TOKENS;
  const used = Math.max(0, tokensInContext - BASELINE_TOKENS);
  const remaining = Math.max(0, effectiveWindow - used);
  const percent = (remaining / effectiveWindow) * 100;
  return Math.round(Math.max(0, Math.min(100, percent)));
}

// Phase 2: Session and rollout tracking
const sessionFinder = new SessionFinder(HUD_CWD, (session) => {
  // When session changes, update rollout path
  if (session) {
    rolloutParser.setRolloutPath(session.path);
    hudFileWatcher.setRolloutPath(session.path);
  }
});

const rolloutParser = new RolloutParser(10);
const hudFileWatcher = new HudFileWatcher();

// Cached data that gets updated by watchers
let cachedHudData: HudData | null = null;
let configNeedsRefresh = false;

/**
 * Collect all HUD data (synchronous parts)
 */
function collectSyncData(): Omit<HudData, 'toolActivity' | 'planProgress' | 'tokenUsage' | 'session' | 'contextUsage'> {
  const cwd = HUD_CWD;
  const config = readCodexConfig();

  return {
    config,
    git: collectGitStatus(cwd),
    project: collectProjectInfo(cwd, config),
    sessionStart: SESSION_START,
  };
}

/**
 * Collect all HUD data including async rollout parsing
 */
async function collectData(): Promise<HudData> {
  const syncData = collectSyncData();

  // Check for active session
  const session = sessionFinder.check();

  // If we have a session, parse the rollout
  let rolloutData = rolloutParser.getCached();
  if (session && (!rolloutData || configNeedsRefresh)) {
    rolloutData = await rolloutParser.parse();
    configNeedsRefresh = false;
  }

  // Build context usage from token usage if available
  // Matches codex "context window left" calculation based on last_token_usage.
  let contextUsage = undefined;
  if (rolloutData?.tokenUsage) {
    const tokenInfo = rolloutData.tokenUsage;
    const contextWindow = tokenInfo.model_context_window ?? 0;
    const lastUsage = tokenInfo.last_token_usage;

    if (contextWindow > 0 && lastUsage) {
      const tokensInContext = lastUsage.total_tokens ?? 0;
      const percentRemaining = percentOfContextWindowRemaining(tokensInContext, contextWindow);
      const percentUsed = 100 - percentRemaining;

      contextUsage = {
        used: tokensInContext,
        total: contextWindow,
        percent: percentUsed,
        inputTokens: getNonCachedInputTokens(lastUsage),
        outputTokens: lastUsage.output_tokens ?? 0,
        cachedTokens: lastUsage.cached_input_tokens ?? 0,
        compactCount: rolloutData.compactCount ?? 0,
        lastCompactTime: rolloutData.lastCompactTime ?? undefined,
      };
    }
  }

  const hudData: HudData = {
    ...syncData,
    session: rolloutData?.session ?? undefined,
    toolActivity: rolloutData?.toolActivity ?? undefined,
    planProgress: rolloutData?.planProgress ?? undefined,
    tokenUsage: rolloutData?.tokenUsage ?? undefined,
    contextUsage,
  };

  cachedHudData = hudData;
  return hudData;
}

/**
 * Main render loop
 */
async function mainLoop(): Promise<void> {
  if (!isRunning) {
    return;
  }

  try {
    const data = await collectData();
    renderToStdout(data);
  } catch (error) {
    console.error('Render error:', error);
  }

  // Schedule next render
  setTimeout(mainLoop, REFRESH_INTERVAL);
}

/**
 * Handle graceful shutdown
 */
function shutdown(): void {
  isRunning = false;

  // Clean up watchers
  sessionFinder.stop();
  hudFileWatcher.stop().catch(() => {
    // Ignore cleanup errors
  });

  cleanupRenderer();
  process.exit(0);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Set up signal handlers
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);

  // Handle stdin close (tmux pane closed)
  process.stdin.on('close', shutdown);
  process.stdin.resume();

  // Set up file watchers
  hudFileWatcher.onConfigChange(() => {
    configNeedsRefresh = true;
  });

  hudFileWatcher.onRolloutChange(async () => {
    // Re-parse rollout when file changes
    await rolloutParser.parse();
  });

  hudFileWatcher.start();
  sessionFinder.start(5000); // Check for session changes every 5 seconds

  // Start the render loop
  console.log('Codex HUD starting...');

  // Initial render
  await mainLoop();
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
