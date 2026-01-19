/**
 * Test script for token calculation fix
 * Verifies that context window percentage is calculated correctly
 */

import type { TokenUsageInfo } from '../src/types.js';

// Sample data from rollout file (session 019bc6c9-f6ba-7902-b292-3c660ec575f5)
const sampleTokenUsage: TokenUsageInfo = {
    total_token_usage: {
        input_tokens: 162899,
        cached_input_tokens: 146176,
        output_tokens: 4114,
        reasoning_output_tokens: 2688,
        total_tokens: 167013,
    },
    last_token_usage: {
        input_tokens: 15612,
        cached_input_tokens: 13952,
        output_tokens: 193,
        reasoning_output_tokens: 64,
        total_tokens: 15805,
    },
    model_context_window: 258400,
};

console.log('=== Token Calculation Test ===\n');

// OLD (incorrect) calculation
const oldContextUsed =
    (sampleTokenUsage.total_token_usage?.input_tokens ?? 0) +
    (sampleTokenUsage.total_token_usage?.cached_input_tokens ?? 0) +
    (sampleTokenUsage.total_token_usage?.output_tokens ?? 0);
const oldPercent = Math.round((oldContextUsed / sampleTokenUsage.model_context_window!) * 100);

console.log('OLD (incorrect) calculation:');
console.log(`  Context used: ${oldContextUsed} (input + cached + output)`);
console.log(`  Percentage: ${oldPercent}%`);
console.log(`  Problem: cached is subset of input, should not be added`);
console.log(`  Problem: uses total_token_usage (cumulative), not last_token_usage (current)`);
console.log();

// NEW (correct) calculation
const lastInput = sampleTokenUsage.last_token_usage?.input_tokens ?? 0;
const lastOutput = sampleTokenUsage.last_token_usage?.output_tokens ?? 0;
const newContextUsed = lastInput + lastOutput;
const newPercent = Math.min(100, Math.round((newContextUsed / sampleTokenUsage.model_context_window!) * 100));
const contextLeft = 100 - newPercent;

console.log('NEW (correct) calculation:');
console.log(`  Last request input: ${lastInput}`);
console.log(`  Last request output: ${lastOutput}`);
console.log(`  Context used: ${newContextUsed} (last input + last output)`);
console.log(`  Percentage used: ${newPercent}%`);
console.log(`  Context left: ${contextLeft}%`);
console.log();

// Expected output format
console.log('Expected HUD display:');
console.log(`  Progress bar: ${newPercent}% (context window usage)`);
console.log(`  Tokens line: Tokens: ${formatTokenCount(sampleTokenUsage.total_token_usage?.total_tokens ?? 0)} (cumulative)`);
console.log(`  Context line: Ctx: ${contextLeft}% left (${formatTokenCount(newContextUsed)}/${formatTokenCount(sampleTokenUsage.model_context_window!)})`);

function formatTokenCount(count: number): string {
    if (count >= 1000000) {
        return `${(count / 1000000).toFixed(1)}M`;
    }
    if (count >= 1000) {
        return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
}
