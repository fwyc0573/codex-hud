/**
 * ANSI color and style utilities for terminal rendering
 * Phase 3: Enhanced to match claude-hud style exactly
 */
// ANSI escape codes
const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const DIM = `${ESC}2m`;
// Foreground colors
export const colors = {
    // Basic colors
    black: (text) => `${ESC}30m${text}${RESET}`,
    red: (text) => `${ESC}31m${text}${RESET}`,
    green: (text) => `${ESC}32m${text}${RESET}`,
    yellow: (text) => `${ESC}33m${text}${RESET}`,
    blue: (text) => `${ESC}34m${text}${RESET}`,
    magenta: (text) => `${ESC}35m${text}${RESET}`,
    cyan: (text) => `${ESC}36m${text}${RESET}`,
    white: (text) => `${ESC}37m${text}${RESET}`,
    // Bright colors
    brightBlack: (text) => `${ESC}90m${text}${RESET}`,
    brightRed: (text) => `${ESC}91m${text}${RESET}`,
    brightGreen: (text) => `${ESC}92m${text}${RESET}`,
    brightYellow: (text) => `${ESC}93m${text}${RESET}`,
    brightBlue: (text) => `${ESC}94m${text}${RESET}`,
    brightMagenta: (text) => `${ESC}95m${text}${RESET}`,
    brightCyan: (text) => `${ESC}96m${text}${RESET}`,
    brightWhite: (text) => `${ESC}97m${text}${RESET}`,
    // Semantic colors
    dim: (text) => `${ESC}2m${text}${RESET}`,
    bold: (text) => `${ESC}1m${text}${RESET}`,
    italic: (text) => `${ESC}3m${text}${RESET}`,
    underline: (text) => `${ESC}4m${text}${RESET}`,
};
// Semantic aliases for HUD components (claude-hud style)
export const theme = {
    // Model and primary info
    model: colors.brightCyan,
    modelBracket: colors.cyan,
    // Git status (oh-my-zsh style)
    gitBranch: colors.magenta,
    gitClean: colors.green,
    gitDirty: colors.yellow,
    gitAhead: colors.green,
    gitBehind: colors.red,
    gitPrefix: colors.magenta, // "git:(" prefix
    // Project info
    projectName: colors.yellow, // Changed to yellow like claude-hud
    projectPath: colors.dim,
    // Status indicators
    success: colors.green,
    warning: colors.yellow,
    error: colors.red,
    info: colors.cyan,
    // Separators and decorations
    separator: colors.dim,
    label: colors.dim,
    value: colors.white,
    dim: colors.dim,
    // Context bar colors (based on percentage)
    contextSafe: colors.green, // < 70%
    contextWarning: colors.yellow, // 70-84%
    contextDanger: colors.red, // >= 85%
    // Tool activity
    toolRunning: colors.brightYellow,
    toolCompleted: colors.green,
    toolError: colors.red,
    toolName: colors.cyan,
    toolTarget: colors.dim,
    // Agent activity
    agentType: colors.brightMagenta,
    agentRunning: colors.brightYellow,
    agentCompleted: colors.green,
    // Plan/Todo progress
    planProgress: colors.brightMagenta,
    planStepCompleted: colors.green,
    planStepPending: colors.dim,
    planStepInProgress: colors.yellow,
    // Token usage
    tokenCount: colors.brightBlue,
    tokenWarning: colors.yellow,
    tokenDanger: colors.red,
};
// Progress bar characters
export const progressChars = {
    filled: '█',
    empty: '░',
    half: '▓',
};
// Status icons
export const icons = {
    // Git
    dirty: '*',
    ahead: '↑',
    behind: '↓',
    modified: '!',
    added: '+',
    deleted: '✘',
    untracked: '?',
    // Activity
    check: '✓',
    cross: '✗',
    running: '◐', // In-progress spinner character
    spinner: ['◐', '◓', '◑', '◒'], // Rotating spinner
    // Info
    clock: '⏱️',
    folder: '📁',
    file: '📄',
    tokens: '🎫',
    plan: '📝',
    tools: '🔧',
    arrow: '→',
    bullet: '▸',
    multiply: '×',
    // Separators
    pipe: '|',
    bar: '│',
};
/**
 * Strip ANSI codes to get visual length
 */
export function stripAnsi(text) {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, '');
}
/**
 * Get visual length of text (excluding ANSI codes)
 */
export function visualLength(text) {
    return stripAnsi(text).length;
}
/**
 * Pad text to specified width (accounting for ANSI codes)
 */
export function padEnd(text, width) {
    const currentLength = visualLength(text);
    if (currentLength >= width)
        return text;
    return text + ' '.repeat(width - currentLength);
}
/**
 * Truncate text to specified width (accounting for ANSI codes)
 */
export function truncate(text, maxWidth, ellipsis = '…') {
    const stripped = stripAnsi(text);
    if (stripped.length <= maxWidth)
        return text;
    return stripped.slice(0, maxWidth - ellipsis.length) + ellipsis;
}
/**
 * Get the appropriate color function based on context usage percentage
 */
export function getContextColor(percent) {
    if (percent >= 85) {
        return theme.contextDanger;
    }
    else if (percent >= 70) {
        return theme.contextWarning;
    }
    return theme.contextSafe;
}
/**
 * Create a colored progress bar with percentage-based coloring
 * Matches claude-hud style exactly
 */
export function coloredBar(percent, width = 10) {
    const clamped = Math.max(0, Math.min(100, percent));
    const filled = Math.round((clamped / 100) * width);
    const empty = width - filled;
    const colorFn = getContextColor(clamped);
    const filledStr = progressChars.filled.repeat(filled);
    const emptyStr = progressChars.empty.repeat(empty);
    return colorFn(filledStr) + colors.dim(emptyStr);
}
/**
 * Create a progress bar (legacy - for non-context bars)
 */
export function progressBar(percent, width = 10) {
    return coloredBar(percent, width);
}
/**
 * Format percentage with color based on threshold
 */
export function coloredPercent(percent) {
    const colorFn = getContextColor(percent);
    return colorFn(`${Math.round(percent)}%`);
}
/**
 * Create a separator line
 */
export function separator(width) {
    return colors.dim('─'.repeat(width));
}
/**
 * Get current spinner frame based on time
 */
export function getSpinnerFrame(frameIndex) {
    const frames = icons.spinner;
    const idx = frameIndex ?? Math.floor(Date.now() / 100) % frames.length;
    return frames[idx];
}
