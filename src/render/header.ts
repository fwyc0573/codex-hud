/**
 * Header line renderer
 * Phase 3: Redesigned to match claude-hud layout
 * 
 * Layout:
 * Row 1: [Model] █████░░░░░ 45% | project-name git:(branch *) | ⏱️ 10m
 * Row 2: 2 AGENTS.md | 3 extensions | 3 skills | 2 hooks | Approval: ask for approval | Fast: on
 * Row 3: Ctx: ████░░░░ 45% (50K/128K) | Tokens: 12.5K
 * Row 4: Dir: ~/project | Session: abc12345
 * Row 5 (optional): ◐ Edit: file.ts | ✓ Read ×3
 */

import type { AgentActivity, HudData, RenderOptions, LayoutConfig } from '../types.js';
import { DEFAULT_LAYOUT } from '../types.js';
import { colors, theme, icons, coloredBar, coloredPercent, truncateAnsi, visualLength } from './colors.js';
import {
  renderIdentityLine,
  renderProjectLine,
  renderEnvironmentLine,
  renderUsageLine,
  renderTokenLine,
  renderSessionDetailLine,
  collectActivityLines,
} from './lines/index.js';

export function renderCompactAgentSummary(agentActivity: AgentActivity | undefined): string | null {
  if (!agentActivity) {
    return null;
  }
  if (agentActivity.rootTrackingError) {
    return theme.error('Agents: tracking error');
  }
  if (agentActivity.visibleAgentCount > 0) {
    return theme.agentType(`Agents: ${agentActivity.visibleAgentCount}`);
  }
  return null;
}

/**
 * Render the compact layout (single line)
 * Format: [Model] █████ 45% | project git:(branch *) | 2 MCPs | ⏱️ 10m
 */
function renderCompactLayout(data: HudData, layout: LayoutConfig, width: number): string[] {
  const parts: string[] = [];
  
  // Identity (model + context bar)
  parts.push(renderIdentityLine(data, layout, { maxWidth: width }));
  
  // Project + git
  parts.push(renderProjectLine(data));

  const agentSummary = renderCompactAgentSummary(data.agentActivity);
  if (agentSummary) {
    parts.push(agentSummary);
  }
  
  // Quick stats (just MCP count)
  const mcpCount = data.project.mcpCount;
  if (mcpCount > 0) {
    parts.push(theme.info(`${mcpCount}`) + colors.dim(' MCPs'));
  }
  
  // Duration
  const usageLine = renderUsageLine(data, layout);
  if (usageLine) {
    parts.push(usageLine);
  }
  
  const separator = layout.showSeparators ? theme.separator(' │ ') : ' ';
  let row = parts.join(separator);
  if (visualLength(row) <= width) {
    return [row];
  }

  if (agentSummary) {
    const identity = parts[0] ?? '';
    const project = parts[1] ?? '';

    const withoutMcp = [identity, project, agentSummary];
    if (usageLine) {
      withoutMcp.push(usageLine);
    }
    row = withoutMcp.join(separator);
    if (visualLength(row) <= width) {
      return [row];
    }

    const withoutDuration = [identity, project, agentSummary];
    row = withoutDuration.join(separator);
    if (visualLength(row) <= width) {
      return [row];
    }

    const reservedWidth = visualLength(identity)
      + visualLength(agentSummary)
      + (2 * visualLength(separator));
    const availableForProject = width - reservedWidth;
    if (availableForProject > 0) {
      const shortenedProject = renderProjectLine(data, {
        includeFileStats: false,
        maxWidth: availableForProject,
      });
      row = [identity, shortenedProject, agentSummary].join(separator);
      if (visualLength(row) <= width) {
        return [row];
      }
    }

    row = [identity, agentSummary].join(separator);
    if (visualLength(row) <= width) {
      return [row];
    }

    const availableForIdentity = width - visualLength(agentSummary) - visualLength(separator);
    if (availableForIdentity > 0) {
      const shortenedIdentity = renderIdentityLine(data, layout, { maxWidth: availableForIdentity });
      row = [shortenedIdentity, agentSummary].join(separator);
      if (visualLength(row) <= width) {
        return [row];
      }
    }

    if (visualLength(agentSummary) <= width) {
      return [agentSummary];
    }
    return [truncateAnsi(agentSummary, width)];
  }

  const trimmedParts = parts.slice(0, 2);
  row = trimmedParts.join(separator);
  if (visualLength(row) <= width) {
    return [row];
  }

  const identity = parts[0] ?? '';
  const availableForProject = Math.max(0, width - visualLength(identity) - visualLength(separator));
  const project = renderProjectLine(data, { includeFileStats: false, maxWidth: availableForProject });
  return [identity + separator + project];
}

/**
 * Render the expanded layout (multiple lines)
 * Row 1: [Model] █████░░░░░ 45% | project-name git:(branch *) | ⏱️ 10m
 * Row 2: 2 AGENTS.md | 3 extensions | 3 skills | 2 hooks | Approval: ask for approval | Fast: on
 * Row 3: Ctx: ████░░░░ 45% (50K/128K) | Tokens: 12.5K
 * Row 4: Dir: ~/project | Session: abc12345
 * Row 5+: Activity lines (tools, todos)
 */
function renderExpandedLayout(data: HudData, layout: LayoutConfig, width: number): string[] {
  const lines: string[] = [];
  
  // Row 1: Identity | Project | Duration
  // The identity line omits the context bar here (showContext: false) because
  // Row 3 (the token line) already renders the context bar with full detail.
  const row1Parts: string[] = [];
  const identityLine = renderIdentityLine(data, layout, { maxWidth: width, showContext: false });
  row1Parts.push(identityLine);
  row1Parts.push(renderProjectLine(data));
  
  const usageLine = renderUsageLine(data, layout);
  if (usageLine) {
    row1Parts.push(usageLine);
  }
  
  const separator = layout.showSeparators ? theme.separator(' │ ') : ' ';
  let row1 = row1Parts.join(separator);
  if (usageLine && visualLength(row1) > width) {
    row1 = row1Parts.slice(0, 2).join(separator);
  }
  if (visualLength(row1) > width) {
    const availableForProject = Math.max(0, width - visualLength(identityLine) - visualLength(separator));
    const projectLine = renderProjectLine(data, { includeFileStats: false, maxWidth: availableForProject });
    row1 = [identityLine, projectLine].join(separator);
  }
  lines.push(row1);
  
  // Row 2: Environment line
  const envLine = renderEnvironmentLine(data);
  if (envLine) {
    lines.push(envLine);
  }
  
  // Row 3: Token usage and context progress bar (ALWAYS show if data available)
  const tokenLine = renderTokenLine(data);
  if (tokenLine) {
    lines.push(tokenLine);
  }
  
  // Row 4: Session details (directory, session ID, etc.)
  const sessionLine = renderSessionDetailLine(data);
  if (sessionLine) {
    lines.push(sessionLine);
  }
  
  // Row 5+: Activity lines (tools, todos) - but exclude token and session lines since we rendered them above
  const activityLines = collectActivityLines(data, width);
  // Filter out token and session lines since we already rendered them.
  // The token line is the sole producer of both "Tokens:" and "Ctx:"; when only
  // contextUsage (no tokenUsage) is present it renders "Ctx:" without "Tokens:",
  // so excluding "Ctx:" here prevents a duplicate context bar at the activity tail.
  const filteredActivityLines = activityLines.filter(line => {
    return (
      !line.includes('Tokens:') &&
      !line.includes('Ctx:') &&
      !line.includes('Dir: ') &&
      !line.includes('Session: ')
    );
  });
  lines.push(...filteredActivityLines);
  
  return lines;
}

/**
 * Render the overview layout (active sessions only)
 * Each line: Ctx ███░░ 45% | Session: abc12345
 */
function renderOverviewLayout(data: HudData, layout: LayoutConfig): string[] {
  const overview = data.overview;
  if (!overview || overview.sessions.length === 0) {
    return [colors.dim('No active sessions')];
  }

  return overview.sessions.map((session) => {
    const shortId = session.id.length > 8 ? session.id.slice(0, 8) : session.id;
    const ctx = session.contextUsage;
    const ctxDisplay = ctx
      ? `${coloredBar(ctx.percent, layout.barWidth)} ${coloredPercent(ctx.percent)}`
      : colors.dim('Ctx: --');

    const ctxLabel = ctx ? colors.dim('Ctx ') : '';
    const sessionLabel = colors.dim('Session: ');
    return `${ctxLabel}${ctxDisplay} ${sessionLabel}${theme.info(shortId)}`;
  });
}

/**
 * Render the full HUD output (all lines)
 */
export function renderHud(data: HudData, options: RenderOptions): string[] {
  const layout = options.layout ?? DEFAULT_LAYOUT;

  if (data.displayMode === 'overview') {
    return renderOverviewLayout(data, layout);
  }
  
  if (layout.mode === 'compact') {
    return renderCompactLayout(data, layout, options.width);
  }
  
  return renderExpandedLayout(data, layout, options.width);
}

// ============================================================================
// Legacy exports for backward compatibility
// ============================================================================

/**
 * Render the main header line (legacy)
 * @deprecated Use renderHud instead
 */
export function renderHeader(data: HudData, options: RenderOptions): string {
  const lines = renderHud(data, options);
  return lines[0] || '';
}

/**
 * Render the second line with detailed info (legacy)
 * @deprecated Use renderHud instead
 */
export function renderDetails(data: HudData, options: RenderOptions): string {
  const lines = renderHud(data, options);
  return lines[1] || '';
}

/**
 * Render the third line with tool activity (legacy)
 * @deprecated Use renderHud instead
 */
export function renderActivityLine(data: HudData, _options: RenderOptions): string | null {
  const lines = renderHud(data, _options);
  return lines[2] || null;
}
