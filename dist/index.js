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
let cachedHudData = null;
let configNeedsRefresh = false;
/**
 * Collect all HUD data (synchronous parts)
 */
function collectSyncData() {
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
async function collectData() {
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
    let contextUsage = undefined;
    if (rolloutData?.tokenUsage?.total_token_usage) {
        const tu = rolloutData.tokenUsage.total_token_usage;
        const total = tu.total_tokens ?? 0;
        const contextWindow = rolloutData.tokenUsage.model_context_window ?? 0;
        if (contextWindow > 0) {
            contextUsage = {
                used: total,
                total: contextWindow,
                percent: Math.round((total / contextWindow) * 100),
                inputTokens: tu.input_tokens ?? 0,
                outputTokens: tu.output_tokens ?? 0,
                cachedTokens: tu.cached_input_tokens ?? 0,
            };
        }
    }
    const hudData = {
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
async function mainLoop() {
    if (!isRunning) {
        return;
    }
    try {
        const data = await collectData();
        renderToStdout(data);
    }
    catch (error) {
        console.error('Render error:', error);
    }
    // Schedule next render
    setTimeout(mainLoop, REFRESH_INTERVAL);
}
/**
 * Handle graceful shutdown
 */
function shutdown() {
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
async function main() {
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
//# sourceMappingURL=index.js.map