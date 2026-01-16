/**
 * Header line renderer
 * Phase 3: Redesigned to match claude-hud layout
 * 
 * Layout (claude-hud style):
 * Row 1: [Model] ███████░░░ 70% | ⏱️ 12m
 * Row 2: project-name git:(branch * ↑1 ↓2) !3 +1 ?2
 * Row 3: 2 AGENTS.md | 3 rules | 2 MCPs | Approval: on-req | Sandbox: ws-write
 * Row 4+: Status lines (provider, directory, account, session, tokens, limits)
 * Row N+: Activity lines (tools, todos)
 */

import type { HudData, RenderOptions, LayoutConfig } from '../types.js';
import { DEFAULT_LAYOUT } from '../types.js';
import { colors, theme } from './colors.js';
import {
  renderIdentityLine,
  renderProjectLine,
  collectActivityLines,
  collectStatusLines,
} from './lines/index.js';

/**
 * Render the compact layout (single line)
 * Format: [Model] █████ 45% | project git:(branch *) | 2 MCPs | ⏱️ 10m
 */
function renderCompactLayout(data: HudData, layout: LayoutConfig): string[] {
  const parts: string[] = [];

  // Identity (model + context bar + duration)
  parts.push(renderIdentityLine(data, layout));

  // Project + git
  parts.push(renderProjectLine(data));

  // Quick stats (just MCP count)
  const mcpCount = data.project.mcpCount;
  if (mcpCount > 0) {
    parts.push(theme.info(`${mcpCount}`) + colors.dim(' MCPs'));
  }

  const separator = layout.showSeparators ? theme.separator(' | ') : ' | ';
  return [parts.join(separator)];
}

/**
 * Render the expanded layout (multiple lines) - compact version
 * Row 1: [Model] ████████ 70% ⏱️ 12m
 * Row 2: project git:(branch *) !3 ?2 | 2 cfg | Appr:on-req
 * Row 3: Tokens: 12.5K (in: 10K, cache: 2K, out: 2.5K) | Ctx: 70%/128K
 * Row 4+: Activity lines (tools, todos) - only if present
 */
function renderExpandedLayout(data: HudData, layout: LayoutConfig): string[] {
  const lines: string[] = [];

  // Row 1: Identity line (Model + context bar + duration)
  lines.push(renderIdentityLine(data, layout));

  // Row 2: Project line (project name + git status + compact env)
  lines.push(renderProjectLine(data));

  // Row 3: Token line (compact token usage + context)
  const statusLines = collectStatusLines(data);
  lines.push(...statusLines);

  // Row 4+: Activity lines (tools, todos) - only if present
  const activityLines = collectActivityLines(data);
  lines.push(...activityLines);

  return lines;
}

/**
 * Render the full HUD output (all lines)
 */
export function renderHud(data: HudData, options: RenderOptions): string[] {
  const layout = options.layout ?? DEFAULT_LAYOUT;

  if (layout.mode === 'compact') {
    return renderCompactLayout(data, layout);
  }

  return renderExpandedLayout(data, layout);
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
