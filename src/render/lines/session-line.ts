/**
 * Session Line Renderer (Compact Mode)
 * Renders all session info in a single line
 * Format: [Model] █████░░░░░ 45% | project git:(branch) | 1 AGENTS.md | ⏱️ 10m
 */

import type { HudData, LayoutConfig } from '../../types.js';
import { colors, icons, separator } from '../colors.js';
import { renderIdentityLine } from './identity-line.js';
import { renderProjectLine } from './project-line.js';
import { getMcpServerCount } from '../../collectors/codex-config.js';

/**
 * Format duration in human-readable form
 */
function formatDuration(startTime: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - startTime.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffHour > 0) {
    return `${diffHour}h${diffMin % 60}m`;
  }
  if (diffMin > 0) {
    return `${diffMin}m`;
  }
  return `${diffSec}s`;
}

/**
 * Render a compact environment summary
 * Format: 1 AGENTS.md, 3 MCPs
 */
function renderCompactEnvironment(data: HudData): string {
  const parts: string[] = [];
  
  if (data.project.agentsMdCount > 0) {
    parts.push(`${data.project.agentsMdCount} AGENTS.md`);
  }
  
  const mcpCount = getMcpServerCount(data.config);
  if (mcpCount > 0) {
    parts.push(`${mcpCount} MCPs`);
  }
  
  return parts.length > 0 ? colors.dim(parts.join(', ')) : '';
}

/**
 * Render the complete session line (compact mode)
 * Format: [Model] █████░░░░░ 45% | project git:(branch) | 1 AGENTS.md | ⏱️ 10m
 */
export function renderSessionLine(data: HudData, layout: LayoutConfig): string {
  const sep = ` ${colors.dim(icons.pipe)} `;
  const parts: string[] = [];
  
  // Identity (model + context bar)
  parts.push(renderIdentityLine(data, layout));
  
  // Project and git
  parts.push(renderProjectLine(data));
  
  // Compact environment info
  const envInfo = renderCompactEnvironment(data);
  if (envInfo) {
    parts.push(envInfo);
  }
  
  // Duration
  if (layout.showDuration) {
    const duration = formatDuration(data.sessionStart);
    parts.push(colors.dim(`${icons.clock} ${duration}`));
  }
  
  return parts.join(sep);
}
