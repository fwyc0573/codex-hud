/**
 * ANSI color and style utilities for terminal rendering
 * Phase 3: Enhanced to match claude-hud style exactly
 */
export declare const colors: {
    black: (text: string) => string;
    red: (text: string) => string;
    green: (text: string) => string;
    yellow: (text: string) => string;
    blue: (text: string) => string;
    magenta: (text: string) => string;
    cyan: (text: string) => string;
    white: (text: string) => string;
    brightBlack: (text: string) => string;
    brightRed: (text: string) => string;
    brightGreen: (text: string) => string;
    brightYellow: (text: string) => string;
    brightBlue: (text: string) => string;
    brightMagenta: (text: string) => string;
    brightCyan: (text: string) => string;
    brightWhite: (text: string) => string;
    dim: (text: string) => string;
    bold: (text: string) => string;
    italic: (text: string) => string;
    underline: (text: string) => string;
};
export declare const theme: {
    model: (text: string) => string;
    modelBracket: (text: string) => string;
    gitBranch: (text: string) => string;
    gitClean: (text: string) => string;
    gitDirty: (text: string) => string;
    gitAhead: (text: string) => string;
    gitBehind: (text: string) => string;
    gitPrefix: (text: string) => string;
    projectName: (text: string) => string;
    projectPath: (text: string) => string;
    success: (text: string) => string;
    warning: (text: string) => string;
    error: (text: string) => string;
    info: (text: string) => string;
    separator: (text: string) => string;
    label: (text: string) => string;
    value: (text: string) => string;
    dim: (text: string) => string;
    contextSafe: (text: string) => string;
    contextWarning: (text: string) => string;
    contextDanger: (text: string) => string;
    toolRunning: (text: string) => string;
    toolCompleted: (text: string) => string;
    toolError: (text: string) => string;
    toolName: (text: string) => string;
    toolTarget: (text: string) => string;
    agentType: (text: string) => string;
    agentRunning: (text: string) => string;
    agentCompleted: (text: string) => string;
    planProgress: (text: string) => string;
    planStepCompleted: (text: string) => string;
    planStepPending: (text: string) => string;
    planStepInProgress: (text: string) => string;
    tokenCount: (text: string) => string;
    tokenWarning: (text: string) => string;
    tokenDanger: (text: string) => string;
};
export declare const progressChars: {
    filled: string;
    empty: string;
    half: string;
};
export declare const icons: {
    dirty: string;
    ahead: string;
    behind: string;
    modified: string;
    added: string;
    deleted: string;
    untracked: string;
    check: string;
    cross: string;
    running: string;
    spinner: string[];
    clock: string;
    folder: string;
    file: string;
    tokens: string;
    plan: string;
    tools: string;
    arrow: string;
    bullet: string;
    multiply: string;
    pipe: string;
    bar: string;
};
/**
 * Strip ANSI codes to get visual length
 */
export declare function stripAnsi(text: string): string;
/**
 * Get visual length of text (excluding ANSI codes)
 */
export declare function visualLength(text: string): number;
/**
 * Pad text to specified width (accounting for ANSI codes)
 */
export declare function padEnd(text: string, width: number): string;
/**
 * Truncate text to specified width (accounting for ANSI codes)
 */
export declare function truncate(text: string, maxWidth: number, ellipsis?: string): string;
/**
 * Get the appropriate color function based on context usage percentage
 */
export declare function getContextColor(percent: number): (text: string) => string;
/**
 * Create a colored progress bar with percentage-based coloring
 * Matches claude-hud style exactly
 */
export declare function coloredBar(percent: number, width?: number): string;
/**
 * Create a progress bar (legacy - for non-context bars)
 */
export declare function progressBar(percent: number, width?: number): string;
/**
 * Format percentage with color based on threshold
 */
export declare function coloredPercent(percent: number): string;
/**
 * Create a separator line
 */
export declare function separator(width: number): string;
/**
 * Get current spinner frame based on time
 */
export declare function getSpinnerFrame(frameIndex?: number): string;
//# sourceMappingURL=colors.d.ts.map