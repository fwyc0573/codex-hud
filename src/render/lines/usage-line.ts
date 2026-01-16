/**
 * Usage Line Renderer
 * Now simplified - duration moved to identity line (claude-hud style)
 * This file kept for backward compatibility
 */

import type { HudData, LayoutConfig } from '../../types.js';
import { colors, icons } from '../colors.js';

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
 * Render the usage line (legacy - duration now in identity line)
 * Returns null in new layout since duration is in identity line
 */
export function renderUsageLine(_data: HudData, _layout: LayoutConfig): string | null {
  // Duration is now rendered in identity line (claude-hud style)
  // This function returns null to avoid duplicate display
  return null;
}

/**
 * Render standalone duration (for compact mode or other uses)
 */
export function renderDuration(data: HudData): string {
  const duration = formatDuration(data.sessionStart);
  return colors.dim(`${icons.clock} ${duration}`);
}
