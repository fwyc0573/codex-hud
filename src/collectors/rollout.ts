/**
 * Rollout file parser for extracting tool activity and plan updates
 * Parses ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl files
 */

import * as fs from 'fs';
import * as readline from 'readline';
import type {
  RolloutLine,
  ResponseItemPayload,
  EventMsgPayload,
  SessionMetaPayload,
  TurnContextPayload,
  ToolCall,
  ToolActivity,
  PlanProgress,
  SessionInfo,
  TokenUsageInfo,
  RateLimitSnapshot,
} from '../types.js';

/**
 * Result of parsing a rollout file
 */
export interface RolloutParseResult {
  session: SessionInfo | null;
  toolActivity: ToolActivity;
  planProgress: PlanProgress | null;
  tokenUsage: TokenUsageInfo | null;
  rateLimits: RateLimitSnapshot | null;
  // Session context from turn_context events
  approvalPolicy: string | null;
  sandboxMode: string | null;
}

/**
 * Extract target/path from tool arguments for display
 */
function extractToolTarget(toolName: string, argsStr?: string): string | undefined {
  if (!argsStr) return undefined;

  try {
    const args = JSON.parse(argsStr);
    switch (toolName.toLowerCase()) {
      case 'read':
      case 'write':
      case 'edit':
        return args.file_path ?? args.path ?? args.filePath;
      case 'glob':
      case 'grep':
        return args.pattern;
      case 'bash':
      case 'run_terminal_command':
        const cmd = args.command as string;
        if (cmd) {
          return cmd.length > 40 ? cmd.slice(0, 37) + '...' : cmd;
        }
        return undefined;
      case 'task':
        return args.description ?? args.subagent_type;
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

/**
 * Parse a single rollout file incrementally
 * Supports reading from a specific byte offset for incremental updates
 */
export async function parseRolloutFile(
  rolloutPath: string,
  fromOffset: number = 0,
  maxRecentCalls: number = 10
): Promise<{ result: RolloutParseResult; newOffset: number }> {
  const toolActivity: ToolActivity = {
    recentCalls: [],
    totalCalls: 0,
    callsByType: {},
    lastUpdateTime: new Date(),
  };

  let session: SessionInfo | null = null;
  let planProgress: PlanProgress | null = null;
  let tokenUsage: TokenUsageInfo | null = null;
  let rateLimits: RateLimitSnapshot | null = null;
  let approvalPolicy: string | null = null;
  let sandboxMode: string | null = null;

  // Track running tool calls by ID for duration calculation
  const runningCalls = new Map<string, ToolCall>();

  if (!fs.existsSync(rolloutPath)) {
    return {
      result: { session, toolActivity, planProgress, tokenUsage, rateLimits, approvalPolicy, sandboxMode },
      newOffset: 0,
    };
  }

  const stats = fs.statSync(rolloutPath);
  const fileSize = stats.size;

  // If fromOffset is beyond file size, file might have been truncated
  const startOffset = fromOffset > fileSize ? 0 : fromOffset;

  return new Promise((resolve) => {
    const fileStream = fs.createReadStream(rolloutPath, {
      encoding: 'utf8',
      start: startOffset,
    });

    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let bytesRead = startOffset;

    rl.on('line', (line) => {
      bytesRead += Buffer.byteLength(line, 'utf8') + 1; // +1 for newline

      if (!line.trim()) return;

      try {
        const entry = JSON.parse(line) as RolloutLine;
        const timestamp = new Date(entry.timestamp);

        // Process based on entry type
        if (entry.type === 'session_meta') {
          const meta = entry.payload as SessionMetaPayload;
          session = {
            id: meta.id,
            rolloutPath,
            startTime: new Date(meta.timestamp),
            cwd: meta.cwd,
            cliVersion: meta.cli_version,
            modelProvider: meta.model_provider,
            git: meta.git
              ? {
                branch: meta.git.branch,
                commitHash: meta.git.commit_hash,
              }
              : undefined,
          };
        } else if (entry.type === 'response_item') {
          const payload = entry.payload as ResponseItemPayload;

          if (payload.type === 'function_call' && payload.name) {
            // New tool call started
            const toolCall: ToolCall = {
              id: payload.id ?? payload.call_id ?? `call_${Date.now()}`,
              name: payload.name,
              timestamp,
              status: 'running',
              target: extractToolTarget(payload.name, payload.arguments),
            };

            runningCalls.set(toolCall.id, toolCall);
            toolActivity.totalCalls++;
            toolActivity.callsByType[payload.name] =
              (toolActivity.callsByType[payload.name] ?? 0) + 1;

            // Add to recent calls (will update status when completed)
            toolActivity.recentCalls.push(toolCall);
            if (toolActivity.recentCalls.length > maxRecentCalls) {
              toolActivity.recentCalls.shift();
            }
          } else if (payload.type === 'function_call_output' && payload.call_id) {
            // Tool call completed
            const runningCall = runningCalls.get(payload.call_id);
            if (runningCall) {
              runningCall.status =
                payload.output?.success === false ? 'error' : 'completed';
              runningCall.duration = timestamp.getTime() - runningCall.timestamp.getTime();
              runningCalls.delete(payload.call_id);

              // Update in recentCalls array
              const idx = toolActivity.recentCalls.findIndex(
                (c) => c.id === payload.call_id
              );
              if (idx >= 0) {
                toolActivity.recentCalls[idx] = runningCall;
              }
            }
          }
        } else if (entry.type === 'event_msg') {
          const payload = entry.payload as EventMsgPayload;

          if (payload.type === 'plan_update' && payload.plan) {
            const completed = payload.plan.filter((s) => s.status === 'completed').length;
            planProgress = {
              steps: payload.plan,
              todos: [],
              completedSteps: completed,
              totalSteps: payload.plan.length,
              completedTodos: 0,
              totalTodos: 0,
              lastUpdate: timestamp,
            };
          } else if (payload.type === 'token_count' && payload.info) {
            tokenUsage = payload.info;
          } else if (payload.type === 'rate_limit' && payload.rate_limits) {
            rateLimits = payload.rate_limits;
          }
        } else if (entry.type === 'turn_context') {
          // Parse turn_context for approval_policy and sandbox_mode
          const payload = entry.payload as TurnContextPayload;
          if (payload.approval_policy) {
            approvalPolicy = payload.approval_policy;
          }
          if (payload.sandbox_policy?.type) {
            sandboxMode = payload.sandbox_policy.type;
          }
        }

        toolActivity.lastUpdateTime = timestamp;
      } catch {
        // Skip malformed lines
      }
    });

    rl.on('close', () => {
      resolve({
        result: { session, toolActivity, planProgress, tokenUsage, rateLimits, approvalPolicy, sandboxMode },
        newOffset: bytesRead,
      });
    });

    rl.on('error', () => {
      resolve({
        result: { session, toolActivity, planProgress, tokenUsage, rateLimits, approvalPolicy, sandboxMode },
        newOffset: startOffset,
      });
    });
  });
}

/**
 * Rollout parser with state tracking for incremental updates
 */
export class RolloutParser {
  private rolloutPath: string | null = null;
  private lastOffset: number = 0;
  private cachedResult: RolloutParseResult | null = null;

  constructor(private maxRecentCalls: number = 10) { }

  /**
   * Set the rollout file to parse
   */
  setRolloutPath(path: string): void {
    if (this.rolloutPath !== path) {
      this.rolloutPath = path;
      this.lastOffset = 0;
      this.cachedResult = null;
    }
  }

  /**
   * Parse the rollout file, reading only new content since last parse
   */
  async parse(): Promise<RolloutParseResult | null> {
    if (!this.rolloutPath) {
      return null;
    }

    const { result, newOffset } = await parseRolloutFile(
      this.rolloutPath,
      this.lastOffset,
      this.maxRecentCalls
    );

    this.lastOffset = newOffset;

    // Merge with cached result for session info and accumulated stats
    if (this.cachedResult) {
      // Keep session from first parse
      result.session = this.cachedResult.session ?? result.session;

      // Merge tool activity - accumulate counts
      result.toolActivity.totalCalls += this.cachedResult.toolActivity.totalCalls;
      for (const [type, count] of Object.entries(
        this.cachedResult.toolActivity.callsByType
      )) {
        result.toolActivity.callsByType[type] =
          (result.toolActivity.callsByType[type] ?? 0) + count;
      }

      // Prepend cached recent calls, then trim
      const allCalls = [
        ...this.cachedResult.toolActivity.recentCalls,
        ...result.toolActivity.recentCalls,
      ];
      result.toolActivity.recentCalls = allCalls.slice(-this.maxRecentCalls);

      // For tokenUsage and planProgress, use the LATEST value (not merge)
      // These represent current state, not accumulated history
      // Only fall back to cached if new parse didn't find any
      if (!result.tokenUsage && this.cachedResult.tokenUsage) {
        result.tokenUsage = this.cachedResult.tokenUsage;
      }
      if (!result.planProgress && this.cachedResult.planProgress) {
        result.planProgress = this.cachedResult.planProgress;
      }
      // Same for rateLimits - use latest or fall back to cached
      if (!result.rateLimits && this.cachedResult.rateLimits) {
        result.rateLimits = this.cachedResult.rateLimits;
      }

      // Same for approvalPolicy and sandboxMode - use latest or fall back to cached
      // This prevents flickering when incremental parse doesn't encounter new turn_context events
      if (!result.approvalPolicy && this.cachedResult.approvalPolicy) {
        result.approvalPolicy = this.cachedResult.approvalPolicy;
      }
      if (!result.sandboxMode && this.cachedResult.sandboxMode) {
        result.sandboxMode = this.cachedResult.sandboxMode;
      }
    }

    this.cachedResult = result;
    return result;
  }

  /**
   * Force a full re-parse from the beginning
   */
  async fullParse(): Promise<RolloutParseResult | null> {
    this.lastOffset = 0;
    this.cachedResult = null;
    return this.parse();
  }

  /**
   * Get the current cached result without re-parsing
   */
  getCached(): RolloutParseResult | null {
    return this.cachedResult;
  }
}
