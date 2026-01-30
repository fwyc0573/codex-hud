/**
 * Identity Line Renderer
 * Renders: [Model] █████░░░░░ 45%
 * Model name with context usage bar
 */

import type { HudData, ContextUsage, LayoutConfig } from '../../types.js';
import { theme, colors, coloredBar, coloredPercent, icons, truncate, truncateAnsi, visualLength } from '../colors.js';
import { getModelDisplayName } from '../../collectors/codex-config.js';

/**
 * Format token count for display (e.g., 12500 -> "12.5K")
 */
function formatTokenCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

/**
 * Render context breakdown (shown when usage >= 85%)
 * Format: (in: 135K, cache: 2K, ↻2)
 */
function renderContextBreakdown(context: ContextUsage): string {
  const parts: string[] = [];
  
  if (context.inputTokens > 0) {
    parts.push(`in: ${formatTokenCount(context.inputTokens)}`);
  }
  if (context.cachedTokens > 0) {
    parts.push(`cache: ${formatTokenCount(context.cachedTokens)}`);
  }
  // Show compact count if any compactions occurred
  if (context.compactCount && context.compactCount > 0) {
    parts.push(`${icons.refresh}${context.compactCount}`);
  }
  
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

/**
 * Render the identity line
 * Format: [Model] █████░░░░░ 45%
 */
export function renderIdentityLine(
  data: HudData,
  layout: LayoutConfig,
  options: { maxWidth?: number } = {}
): string {
  const parts: string[] = [];
  
  // Model name in brackets
  const modelName = getModelDisplayName(data.config);
  let contextDisplay = '';

  // Context usage bar (if available)
  if (data.contextUsage) {
    const ctx = data.contextUsage;
    const bar = coloredBar(ctx.percent, layout.barWidth);
    const percentStr = coloredPercent(ctx.percent);
    
    contextDisplay = `${bar} ${percentStr}`;
    
    // Add breakdown when usage is high
    if (layout.showContextBreakdown && ctx.percent >= 85) {
      contextDisplay += colors.dim(renderContextBreakdown(ctx));
    }
    
  } else if (data.tokenUsage?.total_token_usage) {
    // Fallback to old token usage format
    const usage = data.tokenUsage.total_token_usage;
    const total = usage.total_tokens ?? 0;
    const contextWindow = data.tokenUsage.model_context_window;
    
    if (contextWindow && contextWindow > 0) {
      const percent = Math.round((total / contextWindow) * 100);
      const bar = coloredBar(percent, layout.barWidth);
      const percentStr = coloredPercent(percent);
      contextDisplay = `${bar} ${percentStr}`;
    } else {
      // Just show token count without bar
      contextDisplay = colors.dim(`Tokens: ${formatTokenCount(total)}`);
    }
  }

  const maxWidth = options.maxWidth;
  let modelDisplay = theme.modelBracket('[') + theme.model(modelName) + theme.modelBracket(']');
  if (maxWidth && maxWidth > 0) {
    const contextLen = contextDisplay ? visualLength(contextDisplay) + 1 : 0;
    const availableForModel = Math.max(0, maxWidth - contextLen);
    if (availableForModel <= 2 && contextDisplay) {
      return truncateAnsi(contextDisplay, maxWidth);
    }
    if (availableForModel > 2) {
      const maxModelLen = Math.max(1, availableForModel - 2);
      const trimmedModel = truncate(modelName, maxModelLen, '…');
      modelDisplay = theme.modelBracket('[') + theme.model(trimmedModel) + theme.modelBracket(']');
    }
  }

  parts.push(modelDisplay);
  if (contextDisplay) {
    parts.push(contextDisplay);
  }
  
  const line = parts.join(' ');
  return maxWidth ? truncateAnsi(line, maxWidth) : line;
}
