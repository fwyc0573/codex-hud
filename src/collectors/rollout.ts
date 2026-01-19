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
  ToolCall,
  ToolActivity,
  PlanProgress,
  SessionInfo,
  TokenUsageInfo,
} from '../types.js';

/**
 * Result of parsing a rollout file
 */
export interface RolloutParseResult {
  session: SessionInfo | null;
  toolActivity: ToolActivity;
  planProgress: PlanProgress | null;
  tokenUsage: TokenUsageInfo | null;
  // Compact event tracking
  compactCount: number;
  lastCompactTime: Date | null;
  // Activity timestamps
  lastToolActivityTime: Date | null;
  lastAssistantMessageTime: Date | null;
  lastEventTime: Date | null;
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
  let compactCount = 0;
  let lastCompactTime: Date | null = null;
  let lastToolActivityTime: Date | null = null;
  let lastAssistantMessageTime: Date | null = null;
  let lastEventTime: Date | null = null;

  // Track running tool calls by ID for duration calculation
  const runningCalls = new Map<string, ToolCall>();

  if (!fs.existsSync(rolloutPath)) {
    return {
      result: {
        session,
        toolActivity,
        planProgress,
        tokenUsage,
        compactCount,
        lastCompactTime,
        lastToolActivityTime,
        lastAssistantMessageTime,
        lastEventTime,
      },
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
        lastEventTime = timestamp;
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
            lastToolActivityTime = timestamp;
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
            lastToolActivityTime = timestamp;
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
          } else if (payload.type === 'message' && payload.role === 'assistant') {
            lastAssistantMessageTime = timestamp;
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
          } else if (payload.type === 'context_compacted') {
            // /compact command was executed - track it
            compactCount++;
            lastCompactTime = timestamp;
          } else if (payload.type === 'turn_started' && payload.model_context_window) {
            // New turn started - update context window if provided
            if (!tokenUsage) {
              tokenUsage = { model_context_window: payload.model_context_window };
            } else {
              tokenUsage.model_context_window = payload.model_context_window;
            }
          }
        }

        toolActivity.lastUpdateTime = timestamp;
      } catch {
        // Skip malformed lines
      }
    });

    rl.on('close', () => {
      resolve({
        result: {
          session,
          toolActivity,
          planProgress,
          tokenUsage,
          compactCount,
          lastCompactTime,
          lastToolActivityTime,
          lastAssistantMessageTime,
          lastEventTime,
        },
        newOffset: bytesRead,
      });
    });

    rl.on('error', () => {
      resolve({
        result: {
          session,
          toolActivity,
          planProgress,
          tokenUsage,
          compactCount,
          lastCompactTime,
          lastToolActivityTime,
          lastAssistantMessageTime,
          lastEventTime,
        },
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

  constructor(private maxRecentCalls: number = 10) {}

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

      // Merge tool activity
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

      // Merge compact tracking
      result.compactCount += this.cachedResult.compactCount;
      if (!result.lastCompactTime && this.cachedResult.lastCompactTime) {
        result.lastCompactTime = this.cachedResult.lastCompactTime;
      }

      // Keep tokenUsage from latest parse (it contains cumulative data from API)
      // but preserve model_context_window if not in new result
      if (this.cachedResult.tokenUsage?.model_context_window && result.tokenUsage) {
        result.tokenUsage.model_context_window = 
          result.tokenUsage.model_context_window ?? this.cachedResult.tokenUsage.model_context_window;
      }

      // Keep tokenUsage from latest parse if available, otherwise use cached
      if (!result.tokenUsage && this.cachedResult.tokenUsage) {
        result.tokenUsage = this.cachedResult.tokenUsage;
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
