/**
 * Type definitions for codex-hud
 * Phase 3: Redesigned to match claude-hud structure
 */

// ============================================================================
// Constants (matching openai/codex protocol)
// ============================================================================

/**
 * Baseline tokens reserved for system prompts, tools and space to call compact.
 * This matches the BASELINE_TOKENS constant in codex-rs/protocol/src/protocol.rs
 */
export const BASELINE_TOKENS = 12000;

// ============================================================================
// Configuration Types
// ============================================================================

export interface CodexConfig {
  model?: string;
  model_reasoning_effort?: string;
  model_provider?: string;
  service_tier?: string;
  hooks?: boolean;
  approval_policy?: string;
  sandbox_mode?: string;
  mcp_servers?: Record<string, McpServerConfig>;
}

export interface PermissionState {
  approvalPolicy?: string;
  sandboxMode?: string;
}

export interface FastModeState {
  serviceTier?: string;
}

export interface McpServerConfig {
  command?: string[];
  url?: string;
  enabled?: boolean;
}

// ============================================================================
// Git Status (Extended)
// ============================================================================

export interface GitStatus {
  branch: string | null;
  isDirty: boolean;
  isGitRepo: boolean;
  // Extended git sync status
  ahead: number;
  behind: number;
  // File stats
  modified: number;
  added: number;
  deleted: number;
  untracked: number;
}

// ============================================================================
// Project Information (Extended)
// ============================================================================

export interface ProjectInfo {
  cwd: string;
  projectName: string;
  agentsMdCount: number;
  hasCodexDir: boolean;
  // Extended config counts
  instructionsMdCount: number;  // .codex/INSTRUCTIONS.md
  rulesCount: number;           // .codex/rules/*.md
  mcpCount: number;             // From config
  // Codex-specific module status
  configsCount: number;         // Active configuration files
  extensionsCount: number;      // Loaded extensions/plugins
  skillsCount: number;           // Effective enabled skills
  hooksCount: number;            // Effective enabled hooks
  workMode: 'development' | 'production' | 'unknown';  // Current work mode
}

// ============================================================================
// Context Usage (Token/Context Window)
// ============================================================================

export interface ContextUsage {
  /**
   * Tokens used, in the same basis as `total` — so `used / total` matches
   * `percent`. These are *display* values (effective for a normal window, raw
   * bounded for a small window), not raw `total_tokens`. See
   * `calculateContextUsage` in `context-usage.ts`.
   */
  used: number;
  /** Denominator the percentage is measured against (see `used`). */
  total: number;
  /** Rounded 0–100 context-window usage percentage, matching Codex. */
  percent: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  // Compact tracking
  compactCount: number;
  lastCompactTime?: Date;
}

// ============================================================================
// Display Mode (Single vs Overview)
// ============================================================================

export type HudDisplayMode = 'single' | 'overview';

export interface SessionOverviewItem {
  id: string;
  contextUsage?: ContextUsage;
}

export interface SessionOverview {
  sessions: SessionOverviewItem[];
  updatedAt: Date;
}

// ============================================================================
// Layout Configuration
// ============================================================================

export type LayoutMode = 'compact' | 'standard' | 'expanded';

export interface LayoutConfig {
  mode: LayoutMode;
  maxWidth?: number;
  showSeparators?: boolean;
  showDuration: boolean;
  showContextBar?: boolean;
  showGitStatus?: boolean;
  showToolActivity?: boolean;
  showPlanProgress?: boolean;
  showContextBreakdown?: boolean;  // Show token breakdown when usage >= 85%
  barWidth?: number;               // Width of context progress bar
  contextBarWidth?: number;
}

// ============================================================================
// Rollout Parsing Types
// ============================================================================

export interface RolloutLine {
  timestamp: string;
  type: 'session_meta' | 'response_item' | 'event_msg' | 'turn_context';
  payload: RolloutPayload;
}

export type RolloutPayload =
  | SessionMetaPayload
  | ResponseItemPayload
  | EventMsgPayload
  | TurnContextPayload;

export type SessionSource =
  | 'cli'
  | 'vscode'
  | 'exec'
  | 'mcp'
  | 'unknown'
  | { custom: string }
  | { internal: unknown }
  | { subagent: SubagentSource };

export type SubagentSource =
  | 'review'
  | 'compact'
  | 'memory_consolidation'
  | { other: string }
  | {
      thread_spawn: {
        parent_thread_id: string;
        depth: number;
        agent_path?: string;
        agent_nickname?: string;
        agent_role?: string;
      };
    };

export interface SessionMetaPayload {
  id: string;
  timestamp: string;
  cwd: string;
  originator: string;
  cli_version: string;
  instructions?: string;
  source?: SessionSource;
  forked_from_id?: string;
  parent_thread_id?: string;
  agent_path?: string;
  model_provider?: string;
  git?: {
    commit_hash?: string;
    branch?: string;
    repository_url?: string;
  };
}

export interface ResponseItemPayload {
  type: 'message' | 'function_call' | 'function_call_output';
  role?: 'user' | 'assistant' | 'developer';
  content?: ContentBlock[];
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: FunctionOutput;
}

export interface ContentBlock {
  type: string;
  text?: string;
}

export interface FunctionOutput {
  content?: string;
  success?: boolean;
  content_items?: ContentBlock[];
}

export interface EventMsgPayload {
  type: 'plan_update' | 'token_count' | 'rate_limit' | 'context_compacted' | 'turn_started' | 'thread_settings_applied' | 'other';
  explanation?: string;
  plan?: PlanStep[];
  info?: TokenUsageInfo;
  rate_limits?: RateLimitSnapshot;
  // For context_compacted events
  compacted_items?: CompactedItem[];
  summary?: string;
  // For turn_started events
  model_context_window?: number;
  // For thread_settings_applied events
  thread_settings?: {
    service_tier?: string;
  };
}

export interface TurnContextPayload {
  approval_policy?: string;
  sandbox_policy?: {
    type?: string;
  };
  model?: string;
  reasoning_effort?: string;
  collaboration_mode?: {
    settings?: {
      model?: string;
      reasoning_effort?: string;
    };
  };
}

/**
 * Represents an item that was compacted/summarized during /compact
 */
export interface CompactedItem {
  type: string;
  id?: string;
}

export interface PlanStep {
  step: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface TokenUsageInfo {
  total_token_usage?: TokenUsage;
  last_token_usage?: TokenUsage;
  model_context_window?: number;
}

export interface TokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

export interface RateLimitSnapshot {
  requests_remaining?: number;
  tokens_remaining?: number;
  reset_time?: string;
}

// ============================================================================
// Tool Activity Tracking
// ============================================================================

export type ToolStatus = 'running' | 'completed' | 'error';

export interface ToolCall {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
  timestamp: Date;
  status: ToolStatus;
  duration?: number;
  target?: string;
}

export interface ToolActivity {
  recentCalls: ToolCall[];
  totalCalls: number;
  callsByType: Record<string, number>;
  lastUpdateTime: Date;
}

// ============================================================================
// Agent Activity
// ============================================================================

export type AgentDisplayStatus = 'starting' | 'running' | 'tracking-error';

export interface AgentActivityRow {
  threadId: string;
  agentPath: string;
  label: string;
  status: AgentDisplayStatus;
  elapsedStartedAt?: Date;
  activeDescendantCount: number;
}

export interface AgentActivity {
  rows: AgentActivityRow[];
  visibleAgentCount: number;
  rootTrackingError: boolean;
  updatedAt: Date;
}

// ============================================================================
// Todo/Plan Progress
// ============================================================================

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
}

export interface PlanProgress {
  steps: PlanStep[];
  todos?: TodoItem[];
  completedSteps: number;
  totalSteps: number;
  completedTodos?: number;
  totalTodos?: number;
  // Backward compat aliases
  completed?: number;
  total?: number;
  lastUpdate: Date;
}

// ============================================================================
// Session Information
// ============================================================================

export interface SessionInfo {
  id: string;
  rolloutPath: string;
  startTime: Date;
  cwd: string;
  cliVersion: string;
  model?: string;
  reasoningEffort?: string;
  approvalPolicy?: string;
  sandboxMode?: string;
  serviceTier?: string;
  modelProvider?: string;
  source?: SessionSource;
  forkedFromId?: string;
  parentThreadId?: string;
  agentPath?: string;
  git?: {
    branch?: string;
    commitHash?: string;
  };
}

// ============================================================================
// Complete HUD Data
// ============================================================================

export interface HudData {
  // Core info
  config: CodexConfig;
  git: GitStatus;
  project: ProjectInfo;
  sessionStart: Date;
  
  // Session and rollout data
  session?: SessionInfo;
  
  // Context/token usage
  contextUsage?: ContextUsage;
  tokenUsage?: TokenUsageInfo;
  
  // Activity tracking
  toolActivity?: ToolActivity;
  agentActivity?: AgentActivity;
  planProgress?: PlanProgress;

  // Display mode and overview data
  displayMode?: HudDisplayMode;
  overview?: SessionOverview;
}

// ============================================================================
// Render Options
// ============================================================================

export interface RenderOptions {
  width: number;
  showDetails: boolean;
  layout?: LayoutConfig;
}

export const DEFAULT_LAYOUT: LayoutConfig = {
  mode: 'expanded',
  showSeparators: false,
  showDuration: true,
  showContextBreakdown: true,
  barWidth: 10,
};
