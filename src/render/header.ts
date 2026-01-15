/**
 * Header line renderer
 * Phase 3: Redesigned to match claude-hud layout
 * 
 * Layout:
 * Row 1: [Model] █████░░░░░ 45% | project-name git:(branch *) | ⏱️ 10m
 * Row 2: 2 AGENTS.md | 3 MCPs | Approval: default
 * Row 3 (optional): ◐ Edit: file.ts | ✓ Read ×3
 */

import type { HudData, RenderOptions, LayoutConfig } from '../types.js';
import { DEFAULT_LAYOUT } from '../types.js';
import { colors, theme, icons } from './colors.js';
import {
  renderIdentityLine,
  renderProjectLine,
  renderEnvironmentLine,
  renderUsageLine,
  collectActivityLines,
} from './lines/index.js';

/**
 * Render the compact layout (single line)
 * Format: [Model] █████ 45% | project git:(branch *) | 2 MCPs | ⏱️ 10m
 */
function renderCompactLayout(data: HudData, layout: LayoutConfig): string[] {
  const parts: string[] = [];
  
  // Identity (model + context bar)
  parts.push(renderIdentityLine(data, layout));
  
  // Project + git
  parts.push(renderProjectLine(data));
  
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
  return [parts.join(separator)];
}

/**
 * Render the expanded layout (multiple lines)
 * Row 1: [Model] █████░░░░░ 45% | project-name git:(branch *) | ⏱️ 10m
 * Row 2: 2 AGENTS.md | 3 MCPs | Approval: default
 * Row 3+: Activity lines (tools, todos)
 */
function renderExpandedLayout(data: HudData, layout: LayoutConfig): string[] {
  const lines: string[] = [];
  
  // Row 1: Identity | Project | Duration
  const row1Parts: string[] = [];
  row1Parts.push(renderIdentityLine(data, layout));
  row1Parts.push(renderProjectLine(data));
  
  const usageLine = renderUsageLine(data, layout);
  if (usageLine) {
    row1Parts.push(usageLine);
  }
  
  const separator = layout.showSeparators ? theme.separator(' │ ') : ' ';
  lines.push(row1Parts.join(separator));
  
  // Row 2: Environment line
  const envLine = renderEnvironmentLine(data);
  if (envLine) {
    lines.push(envLine);
  }
  
  // Row 3+: Activity lines (tools, todos)
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
