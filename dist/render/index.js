/**
 * Main renderer module
 * Phase 3: Updated to use new LayoutConfig system
 */
import { renderHud } from './header.js';
// ANSI escape codes for cursor/screen control
const CURSOR_HOME = '\x1b[H';
const CLEAR_SCREEN = '\x1b[2J';
const CLEAR_LINE = '\x1b[2K';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
/**
 * Get terminal width
 */
export function getTerminalWidth() {
    return process.stdout.columns || 80;
}
/**
 * Get terminal height
 */
export function getTerminalHeight() {
    return process.stdout.rows || 24;
}
/**
 * Create default layout config based on terminal size
 */
function createDefaultLayout(width, height) {
    const mode = height <= 2 ? 'compact' : 'expanded';
    return {
        mode,
        showSeparators: false,
        showDuration: true,
        showContextBreakdown: mode === 'expanded',
        barWidth: Math.min(12, Math.floor(width / 10)),
    };
}
/**
 * Clear the current line and write text
 */
function writeLine(text) {
    process.stdout.write(CLEAR_LINE + text + '\n');
}
/**
 * Render the HUD to stdout
 * This is called in a loop to update the display
 */
export function render(data) {
    const width = getTerminalWidth();
    const height = getTerminalHeight();
    const layout = createDefaultLayout(width, height);
    const options = {
        width,
        showDetails: height >= 3,
        layout,
    };
    const lines = renderHud(data, options);
    // Move cursor to home position and render
    process.stdout.write(CURSOR_HOME);
    for (const line of lines) {
        writeLine(line);
    }
    // Clear any remaining lines from previous render
    const remainingLines = height - lines.length;
    for (let i = 0; i < remainingLines; i++) {
        writeLine('');
    }
}
/**
 * Initialize the renderer
 * Sets up the terminal for rendering
 */
export function initRenderer() {
    // Hide cursor
    process.stdout.write(HIDE_CURSOR);
    // Clear screen
    process.stdout.write(CLEAR_SCREEN + CURSOR_HOME);
    // Handle resize
    process.stdout.on('resize', () => {
        process.stdout.write(CLEAR_SCREEN + CURSOR_HOME);
    });
}
/**
 * Cleanup the renderer
 * Restores terminal state
 */
export function cleanupRenderer() {
    // Show cursor
    process.stdout.write(SHOW_CURSOR);
    // Clear screen
    process.stdout.write(CLEAR_SCREEN + CURSOR_HOME);
}
/**
 * Simple single-line render mode
 * Used for tmux status bar integration
 */
export function renderSingleLine(data) {
    const width = getTerminalWidth();
    const layout = createDefaultLayout(width, 1);
    const options = {
        width,
        showDetails: false,
        layout,
    };
    const lines = renderHud(data, options);
    return lines[0] || '';
}
/**
 * Output HUD to stdout without screen control
 * Used when running in a tmux pane
 */
export function renderToStdout(data) {
    const width = getTerminalWidth();
    const height = getTerminalHeight();
    const layout = createDefaultLayout(width, height);
    const options = {
        width,
        showDetails: true,
        layout,
    };
    const lines = renderHud(data, options);
    // Clear screen and move to top
    process.stdout.write(CLEAR_SCREEN + CURSOR_HOME);
    // Write each line
    for (const line of lines) {
        console.log(line);
    }
}
//# sourceMappingURL=index.js.map