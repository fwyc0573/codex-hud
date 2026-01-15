/**
 * Identity Line Renderer
 * Renders: [Model] █████░░░░░ 45%
 * Model name with context usage bar
 */

import type { HudData, ContextUsage, LayoutConfig } from '../../types.js';
import { theme, colors, coloredBar, coloredPercent, icons } from '../colors.js';
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
 * Format: (in: 135K, cache: 2K)
 */
function renderContextBreakdown(context: ContextUsage): string {
  const parts: string[] = [];
  
  if (context.inputTokens > 0) {
    parts.push(`in: ${formatTokenCount(context.inputTokens)}`);
  }
  if (context.cachedTokens > 0) {
    parts.push(`cache: ${formatTokenCount(context.cachedTokens)}`);
  }
  
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

/**
 * Render the identity line
 * Format: [Model] █████░░░░░ 45%
 */
export function renderIdentityLine(data: HudData, layout: LayoutConfig): string {
  const parts: string[] = [];
  
  // Model name in brackets
  const modelName = getModelDisplayName(data.config);
  const modelDisplay = theme.modelBracket('[') + theme.model(modelName) + theme.modelBracket(']');
  parts.push(modelDisplay);
  
  // Context usage bar (if available)
  if (data.contextUsage) {
    const ctx = data.contextUsage;
    const bar = coloredBar(ctx.percent, layout.barWidth);
    const percentStr = coloredPercent(ctx.percent);
    
    let contextDisplay = `${bar} ${percentStr}`;
    
    // Add breakdown when usage is high
    if (layout.showContextBreakdown && ctx.percent >= 85) {
      contextDisplay += colors.dim(renderContextBreakdown(ctx));
    }
    
    parts.push(contextDisplay);
  } else if (data.tokenUsage?.total_token_usage) {
    // Fallback to old token usage format
    const usage = data.tokenUsage.total_token_usage;
    const total = usage.total_tokens ?? 0;
    const contextWindow = data.tokenUsage.model_context_window;
    
    if (contextWindow && contextWindow > 0) {
      const percent = Math.round((total / contextWindow) * 100);
      const bar = coloredBar(percent, layout.barWidth);
      const percentStr = coloredPercent(percent);
      parts.push(`${bar} ${percentStr}`);
    } else {
      // Just show token count without bar
      parts.push(colors.dim(`${icons.tokens} ${formatTokenCount(total)}`));
    }
  }
  
  return parts.join(' ');
}
