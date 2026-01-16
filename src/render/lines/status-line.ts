/**
 * Status Line Renderer (Compact Version)
 * Renders token and session info lines
 */

import type { HudData } from '../../types.js';
import { theme, colors } from '../colors.js';
import { formatTokenCount } from './identity-line.js';

/**
 * Render compact token usage line with context window info
 * Uses contextUsage for consistent data (includes proper calculation)
 * 
 * Display format:
 * - Tokens: Shows cumulative total (input + output)
 * - Ctx: Shows current context window usage percentage (from last request)
 * 
 * Note: cached_input_tokens is a SUBSET of input_tokens, not additional tokens
 */
export function renderTokenDetailLine(data: HudData): string {
    const parts: string[] = [];

    // Use contextUsage for consistent data display
    if (data.contextUsage) {
        const ctx = data.contextUsage;
        // Total tokens = input + output (cached is subset of input, don't add separately)
        const totalDisplay = ctx.inputTokens + ctx.outputTokens;

        // Build breakdown parts for cumulative usage
        const breakdownParts: string[] = [];
        breakdownParts.push(theme.value(formatTokenCount(ctx.inputTokens)) + colors.dim(' in'));
        if (ctx.cachedTokens > 0) {
            breakdownParts.push(theme.value(formatTokenCount(ctx.cachedTokens)) + colors.dim(' cache'));
        }
        breakdownParts.push(theme.value(formatTokenCount(ctx.outputTokens)) + colors.dim(' out'));

        parts.push(
            colors.dim('Tokens: ') +
            theme.info(formatTokenCount(totalDisplay)) +
            colors.dim(' (') +
            breakdownParts.join(colors.dim(', ')) +
            colors.dim(')')
        );

        // Context window usage - use ctx.used which is from last_token_usage
        // This represents current context window occupation, not cumulative
        const percentColor = ctx.percent >= 85 ? theme.error :
            ctx.percent >= 70 ? theme.warning : theme.success;

        // Show "context left" style: how much of context window is available
        const contextLeft = 100 - ctx.percent;
        parts.push(
            colors.dim('Ctx: ') +
            percentColor(`${contextLeft}%`) +
            colors.dim(' left (') +
            theme.value(formatTokenCount(ctx.used)) +
            colors.dim('/') +
            theme.value(formatTokenCount(ctx.total)) +
            colors.dim(')')
        );
    } else if (data.tokenUsage?.total_token_usage) {
        // Fallback to raw tokenUsage if contextUsage not available
        const usage = data.tokenUsage.total_token_usage;
        const total = usage.total_tokens ?? 0;
        const input = usage.input_tokens ?? 0;
        const cached = usage.cached_input_tokens ?? 0;
        const output = usage.output_tokens ?? 0;

        const breakdownParts: string[] = [];
        breakdownParts.push(theme.value(formatTokenCount(input)) + colors.dim(' in'));
        if (cached > 0) {
            breakdownParts.push(theme.value(formatTokenCount(cached)) + colors.dim(' cache'));
        }
        breakdownParts.push(theme.value(formatTokenCount(output)) + colors.dim(' out'));

        parts.push(
            colors.dim('Tokens: ') +
            theme.info(formatTokenCount(total)) +
            colors.dim(' (') +
            breakdownParts.join(colors.dim(', ')) +
            colors.dim(')')
        );

        // Context window if available - use last_token_usage for accurate percentage
        // IMPORTANT: cached_input_tokens don't occupy NEW context window space (already in KV cache)
        if (data.tokenUsage.model_context_window && data.tokenUsage.last_token_usage) {
            const contextWindow = data.tokenUsage.model_context_window;
            const lastInput = data.tokenUsage.last_token_usage.input_tokens ?? 0;
            const lastOutput = data.tokenUsage.last_token_usage.output_tokens ?? 0;
            const lastReasoning = data.tokenUsage.last_token_usage.reasoning_output_tokens ?? 0;
            const lastCached = data.tokenUsage.last_token_usage.cached_input_tokens ?? 0;
            // Subtract cached tokens - they don't consume new context space
            const contextUsed = (lastInput - lastCached) + lastOutput + lastReasoning;
            const percent = Math.min(100, Math.round((contextUsed / contextWindow) * 100));
            const contextLeft = 100 - percent;
            const percentColor = percent >= 85 ? theme.error :
                percent >= 70 ? theme.warning : theme.success;
            parts.push(
                colors.dim('Ctx: ') +
                percentColor(`${contextLeft}%`) +
                colors.dim(' left (') +
                theme.value(formatTokenCount(contextUsed)) +
                colors.dim('/') +
                theme.value(formatTokenCount(contextWindow)) +
                colors.dim(')')
            );
        }
    } else {
        parts.push(colors.dim('Tokens: ') + theme.value('--'));
    }

    return parts.join(colors.dim(' | '));
}

/**
 * Render directory and session info line
 * Format: Dir: /path/to/project | Session: abc123...
 */
export function renderDirSessionLine(data: HudData): string {
    const parts: string[] = [];

    // Directory (shortened)
    const cwd = data.project.cwd;
    const shortDir = cwd.length > 40 ? '...' + cwd.slice(-37) : cwd;
    parts.push(colors.dim('Dir: ') + theme.info(shortDir));

    // Session ID (shortened)
    if (data.session?.id) {
        const shortId = data.session.id.slice(0, 8) + '...';
        parts.push(colors.dim('Session: ') + theme.value(shortId));
    }

    return parts.join(colors.dim(' | '));
}

/**
 * Collect status lines for display
 * Returns token line and dir/session line
 */
export function collectStatusLines(data: HudData): string[] {
    const lines: string[] = [];

    // Token line
    lines.push(renderTokenDetailLine(data));

    // Dir/Session line (only if session exists)
    if (data.session?.id) {
        lines.push(renderDirSessionLine(data));
    }

    return lines;
}

// Legacy exports for backward compatibility
export function renderModelProviderLine(_data: HudData): string | null {
    return null;
}

export function renderDirectoryLine(_data: HudData): string {
    return '';
}

export function renderAccountLine(_data: HudData): string | null {
    return null;
}

export function renderSessionIdLine(_data: HudData): string | null {
    return null;
}

export function renderLimitsLine(_data: HudData): string {
    return '';
}
