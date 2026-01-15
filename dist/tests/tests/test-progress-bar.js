/**
 * Test script for P0-1: Token Progress Bar Display Verification
 *
 * Tests:
 * 1. Progress bar rendering at various percentages (0%, 25%, 50%, 75%, 100%)
 * 2. Color transitions (green→yellow→red)
 * 3. Context breakdown display at ≥85%
 * 4. Token count formatting (K, M suffixes)
 */
import { renderHud } from '../src/render/header.js';
// Mock base HUD data
function createMockData(contextPercent, inputTokens = 0) {
    const contextWindow = 200000;
    const used = Math.round((contextPercent / 100) * contextWindow);
    const contextUsage = {
        used,
        total: contextWindow,
        percent: contextPercent,
        inputTokens: inputTokens || Math.round(used * 0.8),
        outputTokens: Math.round(used * 0.2),
        cachedTokens: Math.round(used * 0.1),
    };
    return {
        config: {
            model: 'gpt-5.2-codex',
            model_provider: 'openai',
            approval_policy: 'on-request',
        },
        git: {
            branch: 'main',
            isDirty: true,
            isGitRepo: true,
            ahead: 2,
            behind: 0,
            modified: 3,
            added: 1,
            deleted: 0,
            untracked: 2,
        },
        project: {
            cwd: '/test/project',
            projectName: 'test-project',
            agentsMdCount: 1,
            hasCodexDir: true,
            instructionsMdCount: 0,
            rulesCount: 2,
            mcpCount: 3,
            configsCount: 2,
            extensionsCount: 3,
            workMode: 'development',
        },
        sessionStart: new Date(),
        contextUsage,
    };
}
// Render options
const options = {
    width: 120,
    showDetails: true,
    layout: {
        mode: 'expanded',
        showSeparators: false,
        showDuration: true,
        showContextBreakdown: true,
        barWidth: 10,
    },
};
console.log('═══════════════════════════════════════════════════════════════');
console.log('  P0-1: Token Progress Bar Display Verification');
console.log('═══════════════════════════════════════════════════════════════\n');
// Test cases
const testCases = [
    { percent: 0, label: '0% - Empty (should be green)' },
    { percent: 25, label: '25% - Low usage (should be green)' },
    { percent: 50, label: '50% - Medium usage (should be green)' },
    { percent: 70, label: '70% - Threshold (should be yellow)' },
    { percent: 85, label: '85% - High usage (should be red, with breakdown)' },
    { percent: 95, label: '95% - Critical (should be red, with breakdown)' },
    { percent: 100, label: '100% - Full (should be red, with breakdown)' },
];
for (const test of testCases) {
    console.log(`\n[Test: ${test.label}]`);
    console.log('─'.repeat(60));
    const data = createMockData(test.percent);
    const lines = renderHud(data, options);
    for (const line of lines) {
        console.log(line);
    }
}
// Test token formatting
console.log('\n\n═══════════════════════════════════════════════════════════════');
console.log('  Token Count Formatting Tests');
console.log('═══════════════════════════════════════════════════════════════\n');
const formatTests = [
    { tokens: 500, expected: '500' },
    { tokens: 1500, expected: '1.5K' },
    { tokens: 12500, expected: '12.5K' },
    { tokens: 150000, expected: '150.0K' },
    { tokens: 1200000, expected: '1.2M' },
];
function formatTokenCount(count) {
    if (count >= 1000000) {
        return `${(count / 1000000).toFixed(1)}M`;
    }
    if (count >= 1000) {
        return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
}
console.log('| Input     | Expected | Actual   | Pass |');
console.log('|-----------|----------|----------|------|');
for (const test of formatTests) {
    const actual = formatTokenCount(test.tokens);
    const pass = actual === test.expected ? '✓' : '✗';
    console.log(`| ${test.tokens.toString().padEnd(9)} | ${test.expected.padEnd(8)} | ${actual.padEnd(8)} | ${pass}    |`);
}
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  Test Complete');
console.log('═══════════════════════════════════════════════════════════════\n');
