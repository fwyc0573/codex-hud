/**
 * Type definitions for codex-hud
 * Phase 3: Redesigned to match claude-hud structure
 */
export interface CodexConfig {
    model?: string;
    model_provider?: string;
    approval_policy?: string;
    sandbox_mode?: string;
    mcp_servers?: Record<string, McpServerConfig>;
}
export interface McpServerConfig {
    command?: string[];
    url?: string;
    enabled?: boolean;
}
export interface GitStatus {
    branch: string | null;
    isDirty: boolean;
    isGitRepo: boolean;
    ahead: number;
    behind: number;
    modified: number;
    added: number;
    deleted: number;
    untracked: number;
}
export interface ProjectInfo {
    cwd: string;
    projectName: string;
    agentsMdCount: number;
    hasCodexDir: boolean;
    instructionsMdCount: number;
    rulesCount: number;
    mcpCount: number;
    configsCount: number;
    extensionsCount: number;
    workMode: 'development' | 'production' | 'unknown';
}
export interface ContextUsage {
    used: number;
    total: number;
    percent: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
}
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
    showContextBreakdown?: boolean;
    barWidth?: number;
    contextBarWidth?: number;
}
export interface RolloutLine {
    timestamp: string;
    type: 'session_meta' | 'response_item' | 'event_msg';
    payload: RolloutPayload;
}
export type RolloutPayload = SessionMetaPayload | ResponseItemPayload | EventMsgPayload;
export interface SessionMetaPayload {
    id: string;
    timestamp: string;
    cwd: string;
    originator: string;
    cli_version: string;
    instructions?: string;
    source?: string;
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
    type: 'plan_update' | 'token_count' | 'rate_limit' | 'other';
    explanation?: string;
    plan?: PlanStep[];
    info?: TokenUsageInfo;
    rate_limits?: RateLimitSnapshot;
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
export type AgentStatus = 'running' | 'completed' | 'error';
export interface AgentCall {
    id: string;
    type: string;
    description: string;
    timestamp: Date;
    status: AgentStatus;
    duration?: number;
}
export interface AgentActivity {
    recentCalls: AgentCall[];
    totalCalls: number;
    lastUpdateTime: Date;
}
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
    completed?: number;
    total?: number;
    lastUpdate: Date;
}
export interface SessionInfo {
    id: string;
    rolloutPath: string;
    startTime: Date;
    cwd: string;
    cliVersion: string;
    modelProvider?: string;
    git?: {
        branch?: string;
        commitHash?: string;
    };
}
export interface HudData {
    config: CodexConfig;
    git: GitStatus;
    project: ProjectInfo;
    sessionStart: Date;
    session?: SessionInfo;
    contextUsage?: ContextUsage;
    tokenUsage?: TokenUsageInfo;
    toolActivity?: ToolActivity;
    agentActivity?: AgentActivity;
    planProgress?: PlanProgress;
}
export interface RenderOptions {
    width: number;
    showDetails: boolean;
    layout?: LayoutConfig;
}
export declare const DEFAULT_LAYOUT: LayoutConfig;
//# sourceMappingURL=types.d.ts.map