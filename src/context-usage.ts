import { BASELINE_TOKENS } from './types.js';

/**
 * Context-window usage prepared for display.
 *
 * `used` and `total` are the values the shown `percent` is computed from, so
 * `used / total` always equals `percent` (they are *display* values, not the
 * raw `total_tokens` / `model_context_window`). For a normal window they are the
 * effective (baseline-subtracted) values; for a small window they are the raw
 * bounded values (see {@link calculateContextUsage}).
 */
export interface ContextUsageBreakdown {
  used: number;
  total: number;
  percent: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toPercent(used: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.round(clamp((used / total) * 100, 0, 100));
}

/**
 * Compute context-window usage the way Codex's own status line does.
 *
 * Codex reserves `BASELINE_TOKENS` (system prompt, tools, and room to run
 * `/compact`) that the user cannot reclaim. For a normal window
 * (`> BASELINE_TOKENS`) it measures usage against the *effective* window
 * (`window - baseline`), subtracting the baseline from BOTH the used tokens and
 * the window, so the percentage matches Codex.
 *
 * For a small window (`<= BASELINE_TOKENS`) the effective window would be `<= 0`,
 * which previously produced a misleading `100% (0/0)`
 * (see docs/issues/issue-007-small-context-window-100-percent.md). In that case
 * we fall back to the raw bounded ratio `used / window`.
 */
export function calculateContextUsage(
  tokensInContext: number,
  contextWindow: number
): ContextUsageBreakdown {
  if (contextWindow <= 0) {
    return { used: 0, total: 0, percent: 0 };
  }

  // Small window: baseline subtraction makes the denominator invalid.
  if (contextWindow <= BASELINE_TOKENS) {
    const used = clamp(tokensInContext, 0, contextWindow);
    return { used, total: contextWindow, percent: toPercent(used, contextWindow) };
  }

  const effectiveWindow = contextWindow - BASELINE_TOKENS;
  const used = clamp(tokensInContext - BASELINE_TOKENS, 0, effectiveWindow);
  return { used, total: effectiveWindow, percent: toPercent(used, effectiveWindow) };
}
