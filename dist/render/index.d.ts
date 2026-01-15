/**
 * Main renderer module
 * Phase 3: Updated to use new LayoutConfig system
 */
import type { HudData } from '../types.js';
/**
 * Get terminal width
 */
export declare function getTerminalWidth(): number;
/**
 * Get terminal height
 */
export declare function getTerminalHeight(): number;
/**
 * Render the HUD to stdout
 * This is called in a loop to update the display
 */
export declare function render(data: HudData): void;
/**
 * Initialize the renderer
 * Sets up the terminal for rendering
 */
export declare function initRenderer(): void;
/**
 * Cleanup the renderer
 * Restores terminal state
 */
export declare function cleanupRenderer(): void;
/**
 * Simple single-line render mode
 * Used for tmux status bar integration
 */
export declare function renderSingleLine(data: HudData): string;
/**
 * Output HUD to stdout without screen control
 * Used when running in a tmux pane
 */
export declare function renderToStdout(data: HudData): void;
//# sourceMappingURL=index.d.ts.map