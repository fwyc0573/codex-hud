/**
 * Codex HUD - Main entry point
 * Phase 3: Redesigned with claude-hud style rendering
 */

import { readCodexConfig, checkAccountStatus } from './collectors/codex-config.js';
import { collectGitStatus } from './collectors/git.js';
import { collectProjectInfo } from './collectors/project.js';
import { SessionFinder } from './collectors/session-finder.js';
import { RolloutParser } from './collectors/rollout.js';
import { HudFileWatcher } from './collectors/file-watcher.js';
import { renderToStdout, cleanupRenderer } from './render/index.js';
import type { HudData } from './types.js';
import { BASELINE_TOKENS } from './types.js';

// Session start time
const SESSION_START = new Date();

// Refresh interval in milliseconds
const REFRESH_INTERVAL = 1000;

// Track if we're running
let isRunning = true;

// Phase 2: Session and rollout tracking
const sessionFinder = new SessionFinder((session) => {
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
  const cwd = process.env.CODEX_HUD_CWD || process.cwd();
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
  // IMPORTANT: Use the official Codex CLI calculation method:
  // - Use last_token_usage.total_tokens as the context window occupancy
  // - Subtract BASELINE_TOKENS (12000) from both window and usage
  // - Calculate "context left" percentage, not "context used"
  let contextUsage = undefined;
  if (rolloutData?.tokenUsage) {
    const tu = rolloutData.tokenUsage;
    const contextWindow = tu.model_context_window ?? 0;

    // Use last_token_usage for context window calculation (current request size)
    const lastUsage = tu.last_token_usage;
    const totalUsage = tu.total_token_usage;

    if (contextWindow > 0 && lastUsage) {
      // Official Codex CLI calculation uses total_tokens from last_token_usage
      // This represents the actual tokens in the context window for the last request
      const lastTotal = lastUsage.total_tokens ?? 0;
      const lastInput = lastUsage.input_tokens ?? 0;
      const lastOutput = lastUsage.output_tokens ?? 0;
      const lastCached = lastUsage.cached_input_tokens ?? 0;

      // Calculate context LEFT percentage using official Codex CLI formula:
      // effective_window = context_window - BASELINE_TOKENS
      // used = max(0, total_tokens - BASELINE_TOKENS)
      // remaining = max(0, effective_window - used)
      // context_left_percent = (remaining / effective_window) * 100
      let contextLeftPercent = 100;
      if (contextWindow > BASELINE_TOKENS) {
        const effectiveWindow = contextWindow - BASELINE_TOKENS;
        const used = Math.max(0, lastTotal - BASELINE_TOKENS);
        const remaining = Math.max(0, effectiveWindow - used);
        contextLeftPercent = Math.round((remaining / effectiveWindow) * 100);
        contextLeftPercent = Math.max(0, Math.min(100, contextLeftPercent));
      } else {
        // Context window too small, show 0% left
        contextLeftPercent = 0;
      }

      // Usage percent is inverse of context left (for progress bar display)
      const usedPercent = 100 - contextLeftPercent;

      // For display, show cumulative totals
      const totalInput = totalUsage?.input_tokens ?? lastInput;
      const totalOutput = totalUsage?.output_tokens ?? lastOutput;
      const totalCached = totalUsage?.cached_input_tokens ?? lastCached;

      contextUsage = {
        used: lastTotal,
        total: contextWindow,
        percent: usedPercent,  // For progress bar (how much is used)
        contextLeftPercent,    // Official "context left" percentage
        inputTokens: totalInput,
        outputTokens: totalOutput,
        cachedTokens: totalCached,
        // Add last request values for accurate context display
        lastInputTokens: lastInput,
        lastOutputTokens: lastOutput,
        lastCachedTokens: lastCached,
        lastTotalTokens: lastTotal,
      };
    } else if (contextWindow > 0 && totalUsage) {
      // Fallback: if no last_token_usage, use total (less accurate)
      const total = totalUsage.total_tokens ?? 0;
      const input = totalUsage.input_tokens ?? 0;
      const output = totalUsage.output_tokens ?? 0;
      const cached = totalUsage.cached_input_tokens ?? 0;

      // Calculate context left using total_token_usage (less accurate but better than nothing)
      let contextLeftPercent = 100;
      if (contextWindow > BASELINE_TOKENS) {
        const effectiveWindow = contextWindow - BASELINE_TOKENS;
        const used = Math.max(0, total - BASELINE_TOKENS);
        const remaining = Math.max(0, effectiveWindow - used);
        contextLeftPercent = Math.round((remaining / effectiveWindow) * 100);
        contextLeftPercent = Math.max(0, Math.min(100, contextLeftPercent));
      } else {
        contextLeftPercent = 0;
      }

      const usedPercent = 100 - contextLeftPercent;

      contextUsage = {
        used: total,
        total: contextWindow,
        percent: usedPercent,
        contextLeftPercent,
        inputTokens: input,
        outputTokens: output,
        cachedTokens: cached,
        lastTotalTokens: total,
      };
    }
  }

  // Collect account info
  const accountStatus = checkAccountStatus();
  const accountInfo = {
    type: accountStatus.type,
    status: accountStatus.status,
    message: accountStatus.message,
  };

  // Build limits info from rate limits
  let limitsInfo = undefined;
  if (rolloutData?.rateLimits) {
    const rl = rolloutData.rateLimits;
    limitsInfo = {
      requestsRemaining: rl.requests_remaining,
      tokensRemaining: rl.tokens_remaining,
      resetTime: rl.reset_time,
      available: true,
    };
  } else {
    limitsInfo = {
      available: false,
    };
  }

  const hudData: HudData = {
    ...syncData,
    session: rolloutData?.session ?? undefined,
    toolActivity: rolloutData?.toolActivity ?? undefined,
    planProgress: rolloutData?.planProgress ?? undefined,
    tokenUsage: rolloutData?.tokenUsage ?? undefined,
    contextUsage,
    accountInfo,
    limitsInfo,
    // Runtime overrides from rollout turn_context events
    runtimeApprovalPolicy: rolloutData?.approvalPolicy ?? undefined,
    runtimeSandboxMode: rolloutData?.sandboxMode ?? undefined,
  };

  cachedHudData = hudData;
  return hudData;
}

/**
 * Main render loop
 * Uses setInterval for more reliable timing and error recovery
 */
let renderIntervalId: NodeJS.Timeout | null = null;

async function renderOnce(): Promise<void> {
  if (!isRunning) {
    return;
  }

  try {
    const data = await collectData();
    renderToStdout(data);
  } catch (error) {
    // Log error but don't stop the loop
    // Use stderr to avoid corrupting HUD display
    process.stderr.write(`[HUD Error] ${error}\n`);
  }
}

function startRenderLoop(): void {
  // Initial render
  renderOnce();

  // Use setInterval for more reliable timing
  // This ensures the loop continues even if renderOnce throws
  renderIntervalId = setInterval(() => {
    renderOnce();
  }, REFRESH_INTERVAL);
}

function stopRenderLoop(): void {
  if (renderIntervalId) {
    clearInterval(renderIntervalId);
    renderIntervalId = null;
  }
}

/**
 * Handle graceful shutdown
 */
function shutdown(): void {
  if (!isRunning) {
    return; // Prevent multiple shutdown calls
  }

  isRunning = false;

  // Stop render loop
  stopRenderLoop();

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
  // Use stderr for startup message to avoid corrupting HUD display
  process.stderr.write('Codex HUD starting...\n');

  // Start the render loop
  startRenderLoop();
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
