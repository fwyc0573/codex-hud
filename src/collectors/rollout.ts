/**
 * Rollout file parser for extracting tool activity and plan updates
 * Parses ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl files
 */

import * as fs from 'fs';
import { StringDecoder } from 'string_decoder';
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
  maxRecentCalls: number = 10,
  activeCalls?: Map<string, ToolCall>
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
  const runningCalls = activeCalls ?? new Map<string, ToolCall>();

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

  let skipFirstLine = false;
  if (startOffset > 0) {
    try {
      const fd = fs.openSync(rolloutPath, 'r');
      try {
        const buffer = Buffer.alloc(1);
        const bytes = fs.readSync(fd, buffer, 0, 1, startOffset - 1);
        if (bytes === 1 && buffer[0] !== 0x0a) {
          skipFirstLine = true;
        }
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      // Ignore offset boundary checks
    }
  }

  return new Promise((resolve) => {
    const fileStream = fs.createReadStream(rolloutPath, {
      start: startOffset,
    });

    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let bytesRead = 0;

    const processLine = (line: string): void => {
      if (skipFirstLine) {
        skipFirstLine = false;
        return;
      }

      const cleanedLine = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (!cleanedLine.trim()) return;

      try {
        const entry = JSON.parse(cleanedLine) as RolloutLine;
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
    };

    fileStream.on('data', (chunk: Buffer | string) => {
      const bufferChunk = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      bytesRead += bufferChunk.length;
      buffer += decoder.write(bufferChunk);

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        processLine(line);
        newlineIndex = buffer.indexOf('\n');
      }
    });

    fileStream.on('end', () => {
      const tail = buffer + decoder.end();
      if (tail) {
        processLine(tail);
      }

      resolve({
        result: { session, toolActivity, planProgress, tokenUsage, rateLimits, approvalPolicy, sandboxMode },
        newOffset: startOffset + bytesRead,
      });
    });

    fileStream.on('error', () => {
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
  private runningCalls: Map<string, ToolCall> = new Map();

  constructor(private maxRecentCalls: number = 10) { }

  /**
   * Set the rollout file to parse
   */
  setRolloutPath(path: string): void {
    if (this.rolloutPath !== path) {
      this.rolloutPath = path;
      this.lastOffset = 0;
      this.cachedResult = null;
      this.runningCalls.clear();
    }
  }

  /**
   * Parse the rollout file, reading only new content since last parse
   */
  async parse(): Promise<RolloutParseResult | null> {
    if (!this.rolloutPath) {
      return null;
    }

    try {
      const stats = fs.statSync(this.rolloutPath);
      if (this.lastOffset > stats.size) {
        this.lastOffset = 0;
        this.cachedResult = null;
        this.runningCalls.clear();
      }
    } catch {
      return this.cachedResult;
    }

    const { result, newOffset } = await parseRolloutFile(
      this.rolloutPath,
      this.lastOffset,
      this.maxRecentCalls,
      this.runningCalls
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

    if (this.runningCalls.size > 0) {
      const seen = new Set(result.toolActivity.recentCalls.map((call) => call.id));
      for (const call of this.runningCalls.values()) {
        if (!seen.has(call.id)) {
          result.toolActivity.recentCalls.push(call);
          seen.add(call.id);
        }
      }
      if (result.toolActivity.recentCalls.length > this.maxRecentCalls) {
        result.toolActivity.recentCalls = result.toolActivity.recentCalls.slice(-this.maxRecentCalls);
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
    this.runningCalls.clear();
    return this.parse();
  }

  /**
   * Get the current cached result without re-parsing
   */
  getCached(): RolloutParseResult | null {
    return this.cachedResult;
  }
}
