/**
 * Activity Line Renderer
 * Renders: ◐ Edit: file.ts | ✓ Read ×3
 * Shows current and recent tool/agent activity
 */

import {
  theme,
  colors,
  icons,
  getSpinnerFrame,
  truncate,
  truncateAnsi,
  visualLength,
} from '../colors.js';
import type {
  AgentActivity,
  AgentActivityRow,
  HudData,
  ToolActivity,
  ToolCall,
  PlanProgress,
} from '../../types.js';

const DESCENDANT_PREFIX = '↳';

export function formatAgentElapsed(startedAt: Date, nowMs: number = Date.now()): string {
  const startedAtMs = startedAt.getTime();
  if (!Number.isFinite(startedAtMs)) {
    throw new Error('Agent elapsed startedAt must be a valid Date');
  }
  if (!Number.isFinite(nowMs)) {
    throw new Error('Agent elapsed nowMs must be finite');
  }
  if (nowMs < startedAtMs) {
    throw new Error('Agent elapsed nowMs cannot be before startedAt');
  }

  const elapsedSeconds = Math.floor((nowMs - startedAtMs) / 1000);
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    const seconds = elapsedSeconds % 60;
    return `${elapsedMinutes}m${seconds.toString().padStart(2, '0')}s`;
  }

  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  return `${hours}h${minutes.toString().padStart(2, '0')}m`;
}

function renderAgentRow(
  icon: string,
  label: string,
  suffix: string,
  color: (text: string) => string,
  width: number
): string {
  const fixedWidth = visualLength(icon) + 1 + visualLength(suffix);
  const plain = width >= fixedWidth + 1
    ? `${icon} ${truncate(label, width - fixedWidth)}${suffix}`
    : `${icon} ${label}${suffix}`;
  return truncateAnsi(color(plain), width);
}

function renderAgentActivityRow(row: AgentActivityRow, width: number, nowMs: number): string {
  if (row.status === 'tracking-error') {
    return renderAgentRow(icons.cross, row.label, ' tracking error', theme.error, width);
  }
  if (row.status !== 'starting' && row.status !== 'running') {
    throw new Error(`Unknown agent display status: ${String(row.status)}`);
  }
  if (!row.elapsedStartedAt) {
    throw new Error(`Agent ${row.threadId} ${row.status} row requires elapsedStartedAt`);
  }

  const spinnerIndex = Math.floor(nowMs / 100) % icons.spinner.length;
  const spinner = getSpinnerFrame(spinnerIndex);
  const elapsed = formatAgentElapsed(row.elapsedStartedAt, nowMs);
  const descendants = row.activeDescendantCount > 0
    ? ` ${DESCENDANT_PREFIX}${row.activeDescendantCount}`
    : '';
  return renderAgentRow(
    spinner,
    row.label,
    ` ${elapsed}${descendants}`,
    theme.agentRunning,
    width
  );
}

export function renderAgentLines(
  agentActivity: AgentActivity | undefined,
  width: number,
  nowMs: number = Date.now()
): string[] {
  if (!agentActivity) {
    return [];
  }
  if (agentActivity.rootTrackingError) {
    return [renderAgentRow(icons.cross, 'agent', ' tracking error', theme.error, width)];
  }
  return agentActivity.rows.map((row) => renderAgentActivityRow(row, width, nowMs));
}

/**
 * Truncate a target string for display
 */
function truncateTarget(target: string, maxLen: number = 20): string {
  if (target.length <= maxLen) {
    return target;
  }
  // For file paths, show the end
  if (target.includes('/')) {
    const parts = target.split('/');
    const filename = parts[parts.length - 1];
    if (filename.length <= maxLen) {
      return '…/' + filename;
    }
    return '…' + filename.slice(-(maxLen - 1));
  }
  return target.slice(0, maxLen - 1) + '…';
}

/**
 * Group consecutive calls by tool name and count them
 * Returns array of { name, count, status }
 */
function groupToolCalls(calls: ToolCall[]): Array<{ name: string; count: number; status: 'completed' | 'error' }> {
  const groups: Array<{ name: string; count: number; status: 'completed' | 'error' }> = [];
  
  // Only look at completed/error calls for grouping
  const finishedCalls = calls.filter(c => c.status === 'completed' || c.status === 'error');
  
  for (const call of finishedCalls) {
    const last = groups[groups.length - 1];
    const status = call.status === 'error' ? 'error' : 'completed';
    
    if (last && last.name === call.name && last.status === status) {
      last.count++;
    } else {
      groups.push({ name: call.name, count: 1, status });
    }
  }
  
  return groups;
}

/**
 * Render the tools activity line
 * Format: ◐ Edit: file.ts | ✓ Read ×3 | ✓ Bash ×2
 */
export function renderToolsLine(toolActivity: ToolActivity | undefined): string | null {
  if (!toolActivity || toolActivity.recentCalls.length === 0) {
    return null;
  }
  
  const parts: string[] = [];
  
  // Currently running tool (if any)
  const running = toolActivity.recentCalls.filter(c => c.status === 'running');
  if (running.length > 0) {
    const current = running[running.length - 1];
    const spinner = getSpinnerFrame();
    const targetStr = current.target ? `: ${truncateTarget(current.target)}` : '';
    parts.push(theme.toolRunning(`${spinner} ${current.name}${targetStr}`));
  }
  
  // Group completed calls
  const groups = groupToolCalls(toolActivity.recentCalls);
  
  // Render grouped calls (limit to last 5 groups)
  const recentGroups = groups.slice(-5);
  for (const group of recentGroups) {
    const icon = group.status === 'error' ? icons.cross : icons.check;
    const colorFn = group.status === 'error' ? theme.error : theme.success;
    
    if (group.count > 1) {
      parts.push(colorFn(`${icon} ${group.name} ${icons.multiply}${group.count}`));
    } else {
      parts.push(colorFn(`${icon} ${group.name}`));
    }
  }
  
  // Show total if more calls exist
  if (toolActivity.totalCalls > toolActivity.recentCalls.length) {
    parts.push(colors.dim(`(${toolActivity.totalCalls} total)`));
  }
  
  if (parts.length === 0) {
    return null;
  }
  
  return parts.join(` ${colors.dim(icons.pipe)} `);
}

/**
 * Render the todos/plan progress line
 * Format: 📝 3/7 steps | ✓ Task 1 | ◐ Task 2
 */
export function renderTodosLine(planProgress: PlanProgress | undefined): string | null {
  if (!planProgress) {
    return null;
  }
  
  const parts: string[] = [];
  
  // Overall progress (if steps exist)
  if (planProgress.totalSteps > 0) {
    const { completedSteps, totalSteps } = planProgress;
    parts.push(theme.planProgress(`${icons.plan} ${completedSteps}/${totalSteps}`));
  }
  
  // Current step (if in progress)
  const inProgressSteps = planProgress.steps.filter(s => s.status === 'in_progress');
  if (inProgressSteps.length > 0) {
    const current = inProgressSteps[0];
    const spinner = getSpinnerFrame();
    const stepText = truncate(current.step, 30);
    parts.push(theme.planStepInProgress(`${spinner} ${stepText}`));
  }
  
  // Recent completed steps (last 2)
  const completedSteps = planProgress.steps.filter(s => s.status === 'completed').slice(-2);
  for (const step of completedSteps) {
    const stepText = truncate(step.step, 20);
    parts.push(theme.planStepCompleted(`${icons.check} ${stepText}`));
  }
  
  if (parts.length === 0) {
    return null;
  }
  
  return parts.join(` ${colors.dim(icons.pipe)} `);
}

/**
 * Collect all activity lines (tools + todos)
 */
function formatTokenCount(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toString();
}

/**
 * Render a colored progress bar for context usage
 */
function renderContextProgressBar(percent: number, width: number = 10): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  
  const filledChar = '█';
  const emptyChar = '░';
  
  let colorFn: (s: string) => string;
  if (clamped >= 85) {
    colorFn = theme.error;
  } else if (clamped >= 70) {
    colorFn = theme.warning;
  } else {
    colorFn = theme.success;
  }
  
  const filledStr = filledChar.repeat(filled);
  const emptyStr = emptyChar.repeat(empty);
  
  return colorFn(filledStr) + colors.dim(emptyStr);
}

function formatSessionId(sessionId: string): string {
  if (sessionId.length <= 8) {
    return sessionId;
  }
  if (sessionId.length <= 12) {
    return sessionId.slice(0, 8);
  }
  return `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`;
}

export function renderTokenLine(data: HudData): string | null {
  const usage = data.tokenUsage?.last_token_usage ?? data.tokenUsage?.total_token_usage;
  // Always show token line if we have any token or context data
  if (!usage && !data.contextUsage) {
    return null;
  }

  const parts: string[] = [];

  // Context usage section with progress bar. The context segment leads the
  // row so the most important capacity signal remains visible first.
  const ctx = data.contextUsage;
  if (ctx) {
    const bar = renderContextProgressBar(ctx.percent, 12);
    const percentDisplay = ctx.percent >= 85 
      ? theme.error(`${ctx.percent}%`)
      : ctx.percent >= 70 
        ? theme.warning(`${ctx.percent}%`) 
        : theme.success(`${ctx.percent}%`);
    parts.unshift(
      `Ctx: ${bar} ${percentDisplay} (${formatTokenCount(ctx.used)}/${formatTokenCount(ctx.total)})`
    );
  } else if (data.tokenUsage?.model_context_window && usage) {
    const total = data.tokenUsage.model_context_window;
    const totalTokens = usage.total_tokens ?? 0;
    const percent = total > 0 ? Math.round((totalTokens / total) * 100) : 0;
    const bar = renderContextProgressBar(percent, 12);
    const percentDisplay = percent >= 85 
      ? theme.error(`${percent}%`)
      : percent >= 70 
        ? theme.warning(`${percent}%`) 
        : theme.success(`${percent}%`);
    parts.unshift(
      `Ctx: ${bar} ${percentDisplay} (${formatTokenCount(totalTokens)}/${formatTokenCount(total)})`
    );
  }

  // Token counts section
  if (usage) {
    const cachedInput = usage.cached_input_tokens ?? 0;
    const nonCachedInput = Math.max(0, (usage.input_tokens ?? 0) - cachedInput);

    parts.push(theme.tokenCount(`Tokens: ${formatTokenCount(usage.total_tokens ?? 0)}`));

    const breakdown: string[] = [];
    if (nonCachedInput > 0) {
      breakdown.push(`in: ${formatTokenCount(nonCachedInput)}`);
    }
    if (cachedInput > 0) {
      breakdown.push(`cache: ${formatTokenCount(cachedInput)}`);
    }
    if (usage.output_tokens && usage.output_tokens > 0) {
      breakdown.push(`out: ${formatTokenCount(usage.output_tokens)}`);
    }

    if (breakdown.length > 0) {
      parts.push(colors.dim(`(${breakdown.join(', ')})`));
    }
  }

  // Show compact count if any compactions occurred
  if (ctx?.compactCount && ctx.compactCount > 0) {
    parts.push(colors.dim(`${icons.refresh}${ctx.compactCount}`));
  }

  return parts.length > 0 ? parts.join(' | ') : null;
}

export function renderSessionDetailLine(data: HudData): string | null {
  const parts: string[] = [];
  
  // Always show session info if we have a session
  const session = data.session;
  
  // Show working directory
  const cwd = session?.cwd || data.project.cwd;
  if (cwd) {
    const home = process.env.HOME || '';
    let displayPath = cwd;
    if (home && cwd.startsWith(home)) {
      displayPath = '~' + cwd.slice(home.length);
    }
    if (displayPath.length > 50) {
      displayPath = '…' + displayPath.slice(-49);
    }
    parts.push(colors.dim('Dir: ') + theme.value(displayPath));
  }

  // Show session ID if available
  if (session?.id) {
    parts.push(colors.dim('Session: ') + theme.info(formatSessionId(session.id)));
  }
  
  // Show CLI version if available
  if (session?.cliVersion) {
    parts.push(colors.dim('CLI: ') + theme.value(session.cliVersion));
  }
  
  // Show model provider if available
  if (session?.modelProvider) {
    parts.push(colors.dim('Provider: ') + theme.value(session.modelProvider));
  }

  return parts.length > 0 ? parts.join(` ${colors.dim(icons.pipe)} `) : null;
}

export function collectActivityLines(data: HudData, width?: number): string[] {
  const lines: string[] = [];

  const tokenLine = renderTokenLine(data);
  if (tokenLine) {
    lines.push(tokenLine);
  }

  const sessionLine = renderSessionDetailLine(data);
  if (sessionLine) {
    lines.push(sessionLine);
  }

  // Tools line
  const toolsLine = renderToolsLine(data.toolActivity);
  if (toolsLine) {
    lines.push(toolsLine);
  }

  lines.push(...renderAgentLines(data.agentActivity, width ?? Number.MAX_SAFE_INTEGER));
  
  // Todos/plan line
  const todosLine = renderTodosLine(data.planProgress);
  if (todosLine) {
    lines.push(todosLine);
  }
  
  return lines;
}
