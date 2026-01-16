/**
 * Identity Line Renderer
 * Renders: [Model] ████████ 70% left ⏱️ 12m @ provider
 * Compact model name with context usage bar, session duration, and provider
 * 
 * Context display matches official Codex CLI:
 * - Progress bar shows USAGE (filled = used)
 * - Percentage shows CONTEXT LEFT (matching "X% context left" in Codex CLI)
 */

import type { HudData, LayoutConfig } from '../../types.js';
import { BASELINE_TOKENS } from '../../types.js';
import { theme, colors, coloredBar, coloredPercent, icons } from '../colors.js';
import { getModelWithReasoning, getModelProviderShort } from '../../collectors/codex-config.js';

/**
 * Format token count for display (e.g., 12500 -> "12.5K")
 */
export function formatTokenCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

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
 * Calculate context left percentage using official Codex CLI formula
 * This is used as a fallback when contextUsage is not pre-calculated
 */
function calculateContextLeftPercent(totalTokens: number, contextWindow: number): number {
  if (contextWindow <= BASELINE_TOKENS) {
    return 0;
  }
  const effectiveWindow = contextWindow - BASELINE_TOKENS;
  const used = Math.max(0, totalTokens - BASELINE_TOKENS);
  const remaining = Math.max(0, effectiveWindow - used);
  return Math.round((remaining / effectiveWindow) * 100);
}

/**
 * Render the identity line (compact format)
 * Format: [Model:reasoning] ████████ 70% left ⏱️ 12m @ provider
 * 
 * Progress bar shows context window USAGE (filled = used)
 * Percentage shows context LEFT (matching official Codex CLI "X% context left")
 */
export function renderIdentityLine(data: HudData, layout: LayoutConfig): string {
  const parts: string[] = [];

  // Model name with reasoning level in brackets
  const modelWithReasoning = getModelWithReasoning(data.config);
  const modelDisplay = theme.modelBracket('[') + theme.model(modelWithReasoning) + theme.modelBracket(']');
  parts.push(modelDisplay);

  // Context usage bar (if available)
  // Bar shows USAGE (filled portion = used)
  // Percentage shows CONTEXT LEFT (matching official Codex CLI)
  if (data.contextUsage) {
    const ctx = data.contextUsage;
    // ctx.percent is usage percentage (for progress bar)
    // ctx.contextLeftPercent is the official "context left" percentage
    const bar = coloredBar(ctx.percent, layout.barWidth);
    // Display context LEFT percentage with "left" suffix (matching Codex CLI)
    const leftPercent = ctx.contextLeftPercent;
    const percentStr = coloredPercent(leftPercent, true);  // true = show as "left"
    parts.push(`${bar} ${percentStr}`);
  } else if (data.tokenUsage?.last_token_usage) {
    // Fallback: calculate from raw token usage using official formula
    const lastUsage = data.tokenUsage.last_token_usage;
    const lastTotal = lastUsage.total_tokens ?? 0;
    const contextWindow = data.tokenUsage.model_context_window;

    if (contextWindow && contextWindow > 0) {
      const contextLeftPercent = calculateContextLeftPercent(lastTotal, contextWindow);
      const usedPercent = 100 - contextLeftPercent;
      const bar = coloredBar(usedPercent, layout.barWidth);
      const percentStr = coloredPercent(contextLeftPercent, true);
      parts.push(`${bar} ${percentStr}`);
    } else if (lastTotal > 0) {
      // Just show token count without bar
      parts.push(colors.dim(`${icons.tokens} ${formatTokenCount(lastTotal)}`));
    }
  } else if (data.tokenUsage?.total_token_usage) {
    // Fallback to total_token_usage (less accurate for context window)
    const usage = data.tokenUsage.total_token_usage;
    const total = usage.total_tokens ?? 0;
    if (total > 0) {
      parts.push(colors.dim(`${icons.tokens} ${formatTokenCount(total)}`));
    }
  }

  // Duration
  if (layout.showDuration) {
    const duration = formatDuration(data.sessionStart);
    parts.push(colors.dim(`${icons.clock} ${duration}`));
  }

  // Model provider at the end (shortened)
  const provider = getModelProviderShort(data.config);
  if (provider) {
    parts.push(colors.dim('@') + theme.value(provider));
  }

  // Join with single space - no separators for compact display
  return parts.join(' ');
}
