/**
 * Codex HUD - Main entry point
 * Phase 3: Redesigned with claude-hud style rendering
 */

import { readCodexConfig } from './collectors/codex-config.js';
import { collectGitStatus } from './collectors/git.js';
import { collectProjectInfo } from './collectors/project.js';
import { SessionFinder, findActiveRollouts } from './collectors/session-finder.js';
import { RolloutParser, parseRolloutFile } from './collectors/rollout.js';
import { HudFileWatcher } from './collectors/file-watcher.js';
import { renderToStdout, cleanupRenderer } from './render/index.js';
import { BASELINE_TOKENS } from './types.js';
import type {
  HudData,
  TokenUsage,
  ContextUsage,
  HudDisplayMode,
  SessionOverview,
  SessionOverviewItem,
  TokenUsageInfo,
} from './types.js';

// Session start time
const SESSION_START = new Date();

// Refresh interval in milliseconds
const REFRESH_INTERVAL = 1000;

// Current working directory for the HUD
const HUD_CWD = process.env.CODEX_HUD_CWD || process.cwd();

// Optional HUD session start time (for session isolation)
const HUD_SESSION_START = (() => {
  const raw = process.env.CODEX_HUD_SESSION_START;
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return parsed > 1_000_000_000_000 ? new Date(parsed) : new Date(parsed * 1000);
})();

// Track if we're running
let isRunning = true;

// Display mode (single vs overview)
let displayMode: HudDisplayMode =
  process.env.CODEX_HUD_MODE === 'overview' ? 'overview' : 'single';

const TOGGLE_KEYS = ['\u0014', 't', 'T']; // Ctrl+T or t/T

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

function buildContextUsage(
  tokenUsage: TokenUsageInfo | undefined,
  compactCount: number | undefined,
  lastCompactTime: Date | null | undefined
): ContextUsage | undefined {
  if (!tokenUsage) {
    return undefined;
  }

  const contextWindow = tokenUsage.model_context_window ?? 0;
  const lastUsage = tokenUsage.last_token_usage;

  if (contextWindow > 0 && lastUsage) {
    const tokensInContext = lastUsage.total_tokens ?? 0;
    const percentRemaining = percentOfContextWindowRemaining(tokensInContext, contextWindow);
    const percentUsed = 100 - percentRemaining;

    return {
      used: tokensInContext,
      total: contextWindow,
      percent: percentUsed,
      inputTokens: getNonCachedInputTokens(lastUsage),
      outputTokens: lastUsage.output_tokens ?? 0,
      cachedTokens: lastUsage.cached_input_tokens ?? 0,
      compactCount: compactCount ?? 0,
      lastCompactTime: lastCompactTime ?? undefined,
    };
  }

  return undefined;
}

// Phase 2: Session and rollout tracking
const sessionFinder = new SessionFinder(HUD_CWD, (session) => {
  // When session changes, update rollout path
  if (session) {
    rolloutParser.setRolloutPath(session.path);
    hudFileWatcher.setRolloutPath(session.path);
  }
}, HUD_SESSION_START);

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

async function collectOverviewData(): Promise<SessionOverview> {
  const activeSessions = findActiveRollouts(60, undefined, 7);
  const now = Date.now();
  const activityWindowMs = 60 * 1000;
  const sessions: SessionOverviewItem[] = [];

  for (const sessionFile of activeSessions) {
    const { result } = await parseRolloutFile(sessionFile.path, 0, 3);

    const hasRecentTool =
      result.lastToolActivityTime &&
      now - result.lastToolActivityTime.getTime() <= activityWindowMs;
    const hasRecentAssistant =
      result.lastAssistantMessageTime &&
      now - result.lastAssistantMessageTime.getTime() <= activityWindowMs;

    if (!hasRecentTool && !hasRecentAssistant) {
      continue;
    }

    const contextUsage = buildContextUsage(
      result.tokenUsage ?? undefined,
      result.compactCount,
      result.lastCompactTime
    );

    sessions.push({
      id: result.session?.id ?? sessionFile.sessionId,
      contextUsage,
    });
  }

  return {
    sessions,
    updatedAt: new Date(),
  };
}

/**
 * Collect all HUD data including async rollout parsing
 */
async function collectData(): Promise<HudData> {
  const syncData = collectSyncData();

  if (displayMode === 'overview') {
    const overview = await collectOverviewData();
    const hudData: HudData = {
      ...syncData,
      displayMode,
      overview,
    };
    cachedHudData = hudData;
    return hudData;
  }

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
  const contextUsage = buildContextUsage(
    rolloutData?.tokenUsage ?? undefined,
    rolloutData?.compactCount,
    rolloutData?.lastCompactTime
  );

  const hudData: HudData = {
    ...syncData,
    session: rolloutData?.session ?? undefined,
    toolActivity: rolloutData?.toolActivity ?? undefined,
    planProgress: rolloutData?.planProgress ?? undefined,
    tokenUsage: rolloutData?.tokenUsage ?? undefined,
    contextUsage,
    displayMode,
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

function setupKeyListener(): void {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return;
  }

  process.stdin.setRawMode(true);
  process.stdin.on('data', (data: Buffer) => {
    const input = data.toString('utf8');
    if (TOGGLE_KEYS.some((key) => input.includes(key))) {
      displayMode = displayMode === 'single' ? 'overview' : 'single';
    }
  });
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
  setupKeyListener();

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
