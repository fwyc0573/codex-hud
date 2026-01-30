/**
 * Usage Line Renderer
 * Renders: ⏱️ 10m (session duration and other usage info)
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
 * Render the usage line
 * Format: ⏱️ 10m
 */
export function renderUsageLine(data: HudData, layout: LayoutConfig): string | null {
  if (!layout.showDuration) {
    return null;
  }

  const startTime = data.session?.startTime ?? data.sessionStart;
  const duration = formatDuration(startTime);
  return colors.dim(`${icons.clock} ${duration}`);
}
