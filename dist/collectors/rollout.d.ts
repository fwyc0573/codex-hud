/**
 * Rollout file parser for extracting tool activity and plan updates
 * Parses ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl files
 */
import type { ToolActivity, PlanProgress, SessionInfo, TokenUsageInfo } from '../types.js';
/**
 * Result of parsing a rollout file
 */
export interface RolloutParseResult {
    session: SessionInfo | null;
    toolActivity: ToolActivity;
    planProgress: PlanProgress | null;
    tokenUsage: TokenUsageInfo | null;
}
/**
 * Parse a single rollout file incrementally
 * Supports reading from a specific byte offset for incremental updates
 */
export declare function parseRolloutFile(rolloutPath: string, fromOffset?: number, maxRecentCalls?: number): Promise<{
    result: RolloutParseResult;
    newOffset: number;
}>;
/**
 * Rollout parser with state tracking for incremental updates
 */
export declare class RolloutParser {
    private maxRecentCalls;
    private rolloutPath;
    private lastOffset;
    private cachedResult;
    constructor(maxRecentCalls?: number);
    /**
     * Set the rollout file to parse
     */
    setRolloutPath(path: string): void;
    /**
     * Parse the rollout file, reading only new content since last parse
     */
    parse(): Promise<RolloutParseResult | null>;
    /**
     * Force a full re-parse from the beginning
     */
    fullParse(): Promise<RolloutParseResult | null>;
    /**
     * Get the current cached result without re-parsing
     */
    getCached(): RolloutParseResult | null;
}
//# sourceMappingURL=rollout.d.ts.map