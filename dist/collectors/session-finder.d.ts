/**
 * Session finder for locating active/recent Codex session rollout files
 * Searches ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 */
export interface SessionFile {
    path: string;
    sessionId: string;
    timestamp: Date;
    size: number;
    modifiedAt: Date;
}
/**
 * Get the Codex home directory
 */
export declare function getCodexHome(): string;
/**
 * Get the sessions directory
 */
export declare function getSessionsDir(): string;
/**
 * Find the most recent rollout file
 * Searches backwards from today's date
 */
export declare function findMostRecentRollout(maxDaysBack?: number): SessionFile | null;
/**
 * Find rollout files modified within the last N seconds
 * Useful for finding actively-used sessions
 */
export declare function findActiveRollouts(withinSeconds?: number): SessionFile[];
/**
 * Find a rollout file by session ID
 */
export declare function findRolloutBySessionId(sessionId: string, maxDaysBack?: number): SessionFile | null;
/**
 * Watch for the most recently modified rollout file
 * Returns the path to the file that should be monitored
 */
export declare class SessionFinder {
    private onSessionChange?;
    private currentSession;
    private checkInterval;
    constructor(onSessionChange?: ((session: SessionFile | null) => void) | undefined);
    /**
     * Start watching for session changes
     */
    start(checkIntervalMs?: number): void;
    /**
     * Stop watching
     */
    stop(): void;
    /**
     * Check for active or recent sessions
     */
    check(): SessionFile | null;
    /**
     * Get the current session
     */
    getCurrentSession(): SessionFile | null;
}
//# sourceMappingURL=session-finder.d.ts.map