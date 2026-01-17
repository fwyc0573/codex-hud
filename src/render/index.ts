/**
 * Main renderer module
 * Phase 3: Updated to use new LayoutConfig system
 */

import type { HudData, RenderOptions, LayoutConfig, LayoutMode } from '../types.js';
import { DEFAULT_LAYOUT } from '../types.js';
import { renderHud } from './header.js';
import { colors } from './colors.js';

// ANSI escape codes for cursor/screen control
const CURSOR_HOME = '\x1b[H';
const CLEAR_SCREEN = '\x1b[2J';
const CLEAR_LINE = '\x1b[2K';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

/**
 * Get terminal width
 */
export function getTerminalWidth(): number {
  const stdoutColumns = process.stdout.columns;
  if (Number.isFinite(stdoutColumns) && stdoutColumns > 0) {
    return stdoutColumns;
  }
  const envColumns = process.env.COLUMNS ? Number(process.env.COLUMNS) : NaN;
  if (Number.isFinite(envColumns) && envColumns > 0) {
    return envColumns;
  }
  return 80;
}

/**
 * Get terminal height
 */
export function getTerminalHeight(): number {
  const stdoutRows = process.stdout.rows;
  if (Number.isFinite(stdoutRows) && stdoutRows > 0) {
    return stdoutRows;
  }
  const envLines = process.env.LINES ? Number(process.env.LINES) : NaN;
  if (Number.isFinite(envLines) && envLines > 0) {
    return envLines;
  }
  return 24;
}

/**
 * Respect terminal height by trimming lines and adding a truncation indicator when necessary
 */
function limitLines(lines: string[], maxLines: number): string[] {
  if (maxLines <= 0) {
    return [];
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const limited = lines.slice(0, maxLines);
  const truncatedCount = lines.length - maxLines;
  const moreText =
    truncatedCount === 1
      ? '…1 more line hidden'
      : `…${truncatedCount} more lines hidden`;
  const indicator = colors.dim(moreText);
  limited[limited.length - 1] = `${limited[limited.length - 1]} ${indicator}`;
  return limited;
}

/**
 * Create default layout config based on terminal size
 */
function createDefaultLayout(width: number, height: number): LayoutConfig {
  const mode: LayoutMode = height <= 1 ? 'compact' : 'expanded';
  
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
function writeLine(text: string): void {
  process.stdout.write(CLEAR_LINE + text + '\n');
}

/**
 * Render the HUD to stdout
 * This is called in a loop to update the display
 */
export function render(data: HudData): void {
  const width = getTerminalWidth();
  const height = getTerminalHeight();
  
  const layout = createDefaultLayout(width, height);
  const options: RenderOptions = {
    width,
    showDetails: height >= 2,
    layout,
  };
  
  const maxLines = Math.max(1, height);
  const lines = limitLines(renderHud(data, options), maxLines);
  
  // Move cursor to home position and render
  process.stdout.write(CURSOR_HOME);
  
  for (const line of lines) {
    writeLine(line);
  }
  
  // Clear any remaining lines from previous render
  const remainingLines = maxLines - lines.length;
  for (let i = 0; i < remainingLines; i++) {
    writeLine('');
  }
}

/**
 * Initialize the renderer
 * Sets up the terminal for rendering
 */
export function initRenderer(): void {
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
export function cleanupRenderer(): void {
  // Show cursor
  process.stdout.write(SHOW_CURSOR);
  
  // Clear screen
  process.stdout.write(CLEAR_SCREEN + CURSOR_HOME);
}

/**
 * Simple single-line render mode
 * Used for tmux status bar integration
 */
export function renderSingleLine(data: HudData): string {
  const width = getTerminalWidth();
  const layout = createDefaultLayout(width, 1);
  
  const options: RenderOptions = {
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
export function renderToStdout(data: HudData): void {
  const width = getTerminalWidth();
  const height = getTerminalHeight();
  const layout = createDefaultLayout(width, height);
  
  const options: RenderOptions = {
    width,
    showDetails: true,
    layout,
  };
  
  const maxLines = Math.max(1, height);
  const lines = limitLines(renderHud(data, options), maxLines);
  
  // Clear screen and move to top
  process.stdout.write(CLEAR_SCREEN + CURSOR_HOME);
  
  // Write each line
  for (const line of lines) {
    console.log(line);
  }
}
