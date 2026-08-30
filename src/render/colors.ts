/**
 * ANSI color and style utilities for terminal rendering
 * Phase 3: Enhanced to match claude-hud style exactly
 */

// ANSI escape codes
const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const DIM = `${ESC}2m`;
const ANSI_ESCAPE = '\x1b';
const ANSI_BEL = '\x07';
const ANSI_C1_STRING_TERMINATOR = '\x9c';
const ANSI_STRING_TERMINATOR = `${ANSI_ESCAPE}\\`;
const OSC8_CLOSE = `${ANSI_ESCAPE}]8;;${ANSI_BEL}`;

type TerminalToken =
  | { kind: 'ansi'; value: string }
  | { kind: 'text'; value: string; width: number };

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// East Asian Wide/Fullwidth ranges used by terminal wcwidth implementations.
const WIDE_CODE_POINT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e],
  [0x3040, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  [0x1b000, 0x1b001],
  [0x1f200, 0x1f251],
  [0x20000, 0x3fffd],
];

const ZERO_WIDTH_CODE_POINT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1160, 0x11ff],
];

const MARK_PATTERN = /^\p{Mark}$/u;
const FORMAT_PATTERN = /^\p{Cf}$/u;
const DEFAULT_IGNORABLE_PATTERN = /^\p{Default_Ignorable_Code_Point}$/u;
const EMOJI_PRESENTATION_PATTERN = /\p{Emoji_Presentation}/u;
const EXTENDED_PICTOGRAPHIC_PATTERN = /\p{Extended_Pictographic}/u;

function isCodePointInRanges(codePoint: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  return ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
}

function isControlCodePoint(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

function isZeroWidthCharacter(character: string, codePoint: number): boolean {
  return (
    isControlCodePoint(codePoint) ||
    isCodePointInRanges(codePoint, ZERO_WIDTH_CODE_POINT_RANGES) ||
    MARK_PATTERN.test(character) ||
    FORMAT_PATTERN.test(character) ||
    DEFAULT_IGNORABLE_PATTERN.test(character)
  );
}

function isEmojiCluster(cluster: string, codePoints: number[]): boolean {
  if (codePoints.some((codePoint) => codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff)) {
    return true;
  }
  if (codePoints.some((codePoint) => codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)) {
    return true;
  }
  if (codePoints.includes(0xfe0f) || codePoints.includes(0x20e3)) {
    return true;
  }
  if (codePoints.some((codePoint) => EMOJI_PRESENTATION_PATTERN.test(String.fromCodePoint(codePoint)))) {
    return true;
  }
  return codePoints.includes(0x200d) && EXTENDED_PICTOGRAPHIC_PATTERN.test(cluster);
}

function graphemeWidth(cluster: string): number {
  const codePoints = [...cluster].map((character) => character.codePointAt(0) ?? 0);
  const visibleCodePoints = codePoints.filter(
    (codePoint) => !isZeroWidthCharacter(String.fromCodePoint(codePoint), codePoint),
  );

  if (visibleCodePoints.length === 0 || codePoints.every((codePoint) => isControlCodePoint(codePoint))) {
    return 0;
  }
  if (isEmojiCluster(cluster, codePoints)) {
    return 2;
  }
  if (visibleCodePoints.some((codePoint) => isCodePointInRanges(codePoint, WIDE_CODE_POINT_RANGES))) {
    return 2;
  }
  return 1;
}

function ansiSequenceEnd(text: string, start: number): number | null {
  const first = text[start];
  const second = text[start + 1];
  const firstCodeUnit = text.charCodeAt(start);
  const isCsi = first === ANSI_ESCAPE && second === '[';
  const isOsc = first === ANSI_ESCAPE && second === ']';
  const isStringControl =
    first === ANSI_ESCAPE && (second === 'P' || second === 'X' || second === '^' || second === '_');
  const isEightBitCsi = first === '\x9b';
  const isEightBitOsc = first === '\x9d';
  const isEightBitStringControl = first === '\x90' || first === '\x98' || first === '\x9e' || first === '\x9f';

  if (isCsi || isEightBitCsi) {
    const bodyStart = isCsi ? start + 2 : start + 1;
    for (let index = bodyStart; index < text.length; index += 1) {
      const codePoint = text.charCodeAt(index);
      if (codePoint >= 0x40 && codePoint <= 0x7e) {
        return index + 1;
      }
    }
    return text.length;
  }

  if (isOsc || isEightBitOsc || isStringControl || isEightBitStringControl) {
    const bodyStart = isEightBitOsc || isEightBitStringControl ? start + 1 : start + 2;
    for (let index = bodyStart; index < text.length; index += 1) {
      if ((isOsc || isEightBitOsc) && text[index] === ANSI_BEL) {
        return index + 1;
      }
      if (text.startsWith(ANSI_STRING_TERMINATOR, index)) {
        return index + ANSI_STRING_TERMINATOR.length;
      }
      if (text[index] === ANSI_C1_STRING_TERMINATOR) {
        return index + 1;
      }
    }
    return text.length;
  }

  if (first === ANSI_ESCAPE) {
    let index = start + 1;
    while (index < text.length) {
      const codePoint = text.charCodeAt(index);
      if (codePoint >= 0x30 && codePoint <= 0x7e) {
        return index + 1;
      }
      if (codePoint >= 0x20 && codePoint <= 0x2f) {
        index += 1;
        continue;
      }
      // An invalid continuation terminates the ESC control itself. Preserve
      // the following visible code point for the normal text tokenizer.
      return start + 1;
    }
    return text.length;
  }
  // C1 controls other than CSI/OSC/string controls are single-byte controls.
  // Do not consume the following printable character as part of the token.
  if (firstCodeUnit >= 0x80 && firstCodeUnit <= 0x9f) {
    return start + 1;
  }
  return null;
}

type RawTerminalToken =
  | { kind: 'ansi'; value: string }
  | { kind: 'text'; value: string };

type GraphemeSpan = {
  start: number;
  end: number;
  width: number;
};

function parseTerminalTokens(text: string): RawTerminalToken[] {
  const tokens: RawTerminalToken[] = [];
  let textStart = 0;
  let index = 0;

  while (index < text.length) {
    const end = ansiSequenceEnd(text, index);
    if (end === null) {
      index += 1;
      continue;
    }
    if (textStart < index) {
      tokens.push({ kind: 'text', value: text.slice(textStart, index) });
    }
    tokens.push({ kind: 'ansi', value: text.slice(index, end) });
    index = end;
    textStart = index;
  }

  if (textStart < text.length) {
    tokens.push({ kind: 'text', value: text.slice(textStart) });
  }
  return tokens;
}

function tokenizeTerminalText(text: string): TerminalToken[] {
  const rawTokens = parseTerminalTokens(text);
  const visibleText = rawTokens
    .filter((token): token is Extract<RawTerminalToken, { kind: 'text' }> => token.kind === 'text')
    .map((token) => token.value)
    .join('');
  const graphemeSpans: GraphemeSpan[] = [];
  for (const segment of graphemeSegmenter.segment(visibleText)) {
    graphemeSpans.push({
      start: segment.index,
      end: segment.index + segment.segment.length,
      width: graphemeWidth(segment.segment),
    });
  }

  const tokens: TerminalToken[] = [];
  const emittedSpans = new Set<number>();
  let visibleOffset = 0;
  let spanIndex = 0;

  for (const token of rawTokens) {
    if (token.kind === 'ansi') {
      tokens.push(token);
      continue;
    }

    const chunkStart = visibleOffset;
    const chunkEnd = chunkStart + token.value.length;
    let cursor = chunkStart;
    while (cursor < chunkEnd) {
      while (spanIndex < graphemeSpans.length && cursor >= (graphemeSpans[spanIndex]?.end ?? 0)) {
        spanIndex += 1;
      }
      const span = graphemeSpans[spanIndex];
      if (!span || span.start > cursor) {
        throw new Error(`Unable to map visible text offset ${cursor} to a grapheme span`);
      }

      const pieceEnd = Math.min(chunkEnd, span.end);
      if (pieceEnd <= cursor) {
        throw new Error(`Invalid grapheme span boundary at visible text offset ${cursor}`);
      }

      tokens.push({
        kind: 'text',
        value: visibleText.slice(cursor, pieceEnd),
        width: emittedSpans.has(spanIndex) ? 0 : span.width,
      });
      emittedSpans.add(spanIndex);
      cursor = pieceEnd;
    }
    visibleOffset = chunkEnd;
  }

  if (visibleOffset !== visibleText.length) {
    throw new Error('Visible text tokenization did not consume the complete input');
  }
  return tokens;
}

function terminalWidth(text: string): number {
  return tokenizeTerminalText(text).reduce(
    (total, token) => total + (token.kind === 'text' ? token.width : 0),
    0,
  );
}

function normalizeWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return width > 0 ? Number.MAX_SAFE_INTEGER : 0;
  }
  return Math.max(0, Math.floor(width));
}

function prefixTokens(tokens: TerminalToken[], maxWidth: number): { value: string; width: number } {
  let value = '';
  let width = 0;
  for (const token of tokens) {
    if (token.kind === 'ansi') {
      continue;
    }
    if (width + token.width > maxWidth) {
      break;
    }
    value += token.value;
    width += token.width;
  }
  return { value, width };
}

function fitEllipsis(ellipsis: string, maxWidth: number): { value: string; width: number } {
  return prefixTokens(tokenizeTerminalText(ellipsis), maxWidth);
}

function isSgrSequence(sequence: string): boolean {
  return /^(?:\x1b\[|\x9b)[0-9:;?]*m$/u.test(sequence);
}

function updateSgrState(sequence: string, active: boolean): boolean {
  if (!isSgrSequence(sequence)) {
    return active;
  }
  const body = sequence.startsWith('\x9b') ? sequence.slice(1, -1) : sequence.slice(2, -1);
  const parameters = body === '' ? [0] : body.split(/[;:]/u).map((value) => Number(value));
  let next = active;
  for (const parameter of parameters) {
    if (parameter === 0) {
      next = false;
    } else if (Number.isFinite(parameter)) {
      next = true;
    }
  }
  return next;
}

function updateOsc8State(sequence: string, active: boolean): boolean {
  const bodyStart = sequence.startsWith('\x9d') ? 1 : 2;
  const bodyEnd = sequence.endsWith(ANSI_STRING_TERMINATOR)
    ? sequence.length - ANSI_STRING_TERMINATOR.length
    : sequence.endsWith(ANSI_C1_STRING_TERMINATOR)
      ? sequence.length - 1
      : sequence.endsWith(ANSI_BEL)
        ? sequence.length - 1
        : sequence.length;
  const body = sequence.slice(bodyStart, bodyEnd);
  if (!body.startsWith('8;')) {
    return active;
  }
  const uriSeparator = body.indexOf(';', 2);
  if (uriSeparator < 0) {
    return active;
  }
  return body.slice(uriSeparator + 1).length > 0;
}

// Foreground colors
export const colors = {
  // Basic colors
  black: (text: string) => `${ESC}30m${text}${RESET}`,
  red: (text: string) => `${ESC}31m${text}${RESET}`,
  green: (text: string) => `${ESC}32m${text}${RESET}`,
  yellow: (text: string) => `${ESC}33m${text}${RESET}`,
  blue: (text: string) => `${ESC}34m${text}${RESET}`,
  magenta: (text: string) => `${ESC}35m${text}${RESET}`,
  cyan: (text: string) => `${ESC}36m${text}${RESET}`,
  white: (text: string) => `${ESC}37m${text}${RESET}`,
  
  // Bright colors
  brightBlack: (text: string) => `${ESC}90m${text}${RESET}`,
  brightRed: (text: string) => `${ESC}91m${text}${RESET}`,
  brightGreen: (text: string) => `${ESC}92m${text}${RESET}`,
  brightYellow: (text: string) => `${ESC}93m${text}${RESET}`,
  brightBlue: (text: string) => `${ESC}94m${text}${RESET}`,
  brightMagenta: (text: string) => `${ESC}95m${text}${RESET}`,
  brightCyan: (text: string) => `${ESC}96m${text}${RESET}`,
  brightWhite: (text: string) => `${ESC}97m${text}${RESET}`,
  
  // Semantic colors
  dim: (text: string) => `${ESC}2m${text}${RESET}`,
  bold: (text: string) => `${ESC}1m${text}${RESET}`,
  italic: (text: string) => `${ESC}3m${text}${RESET}`,
  underline: (text: string) => `${ESC}4m${text}${RESET}`,
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
  gitPrefix: colors.magenta,  // "git:(" prefix
  
  // Project info
  projectName: colors.yellow,  // Changed to yellow like claude-hud
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
  contextSafe: colors.green,      // < 70%
  contextWarning: colors.yellow,  // 70-84%
  contextDanger: colors.red,      // >= 85%
  
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
  running: '◐',       // In-progress spinner character
  spinner: ['◐', '◓', '◑', '◒'],  // Rotating spinner
  
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
  refresh: '↻',  // For compact count indicator
  
  // Separators
  pipe: '|',
  bar: '│',
};

/**
 * Strip ANSI control sequences from terminal text.
 */
export function stripAnsi(text: string): string {
  return tokenizeTerminalText(text)
    .filter((token): token is Extract<TerminalToken, { kind: 'text' }> => token.kind === 'text')
    .map((token) => token.value)
    .join('');
}

/**
 * Get terminal display columns (excluding ANSI codes).
 */
export function visualLength(text: string): number {
  return terminalWidth(text);
}

/**
 * Pad text to specified width (accounting for ANSI codes)
 */
export function padEnd(text: string, width: number): string {
  const targetWidth = normalizeWidth(width);
  const currentWidth = visualLength(text);
  if (currentWidth >= targetWidth) return text;
  return text + ' '.repeat(targetWidth - currentWidth);
}

/**
 * Truncate text to specified width (accounting for ANSI codes)
 */
export function truncate(text: string, maxWidth: number, ellipsis = '…'): string {
  const targetWidth = normalizeWidth(maxWidth);
  if (targetWidth <= 0) return '';
  if (visualLength(text) <= targetWidth) return text;

  const ellipsisFit = fitEllipsis(ellipsis, targetWidth);
  const contentBudget = Math.max(0, targetWidth - ellipsisFit.width);
  const content = prefixTokens(tokenizeTerminalText(text), contentBudget);
  return content.value + ellipsisFit.value;
}

/**
 * Truncate text to a visual width while preserving ANSI sequences.
 */
export function truncateAnsi(text: string, maxWidth: number, ellipsis = '…'): string {
  const targetWidth = normalizeWidth(maxWidth);
  if (targetWidth <= 0) return '';
  if (visualLength(text) <= targetWidth) return text;

  const tokens = tokenizeTerminalText(text);
  const ellipsisFit = fitEllipsis(ellipsis, targetWidth);
  const contentBudget = Math.max(0, targetWidth - ellipsisFit.width);
  let output = '';
  let visibleWidth = 0;
  let activeSgr = false;
  let activeOsc8 = false;

  for (const token of tokens) {
    if (token.kind === 'ansi') {
      output += token.value;
      activeSgr = updateSgrState(token.value, activeSgr);
      if (token.value.startsWith(`${ANSI_ESCAPE}]8;`) || token.value.startsWith('\x9d8;')) {
        activeOsc8 = updateOsc8State(token.value, activeOsc8);
      }
      continue;
    }
    if (visibleWidth + token.width > contentBudget) {
      break;
    }
    output += token.value;
    visibleWidth += token.width;
  }

  output += ellipsisFit.value;
  if (activeOsc8) {
    output += OSC8_CLOSE;
  }
  if (activeSgr) {
    output += RESET;
  }
  return output;
}

/**
 * Get the appropriate color function based on context usage percentage
 */
export function getContextColor(percent: number): (text: string) => string {
  if (percent >= 85) {
    return theme.contextDanger;
  } else if (percent >= 70) {
    return theme.contextWarning;
  }
  return theme.contextSafe;
}

/**
 * Create a colored progress bar with percentage-based coloring
 * Matches claude-hud style exactly
 */
export function coloredBar(percent: number, width: number = 10): string {
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
export function progressBar(percent: number, width: number = 10): string {
  return coloredBar(percent, width);
}

/**
 * Format percentage with color based on threshold
 */
export function coloredPercent(percent: number): string {
  const colorFn = getContextColor(percent);
  return colorFn(`${Math.round(percent)}%`);
}

/**
 * Create a separator line
 */
export function separator(width: number): string {
  return colors.dim('─'.repeat(width));
}

/**
 * Get current spinner frame based on time
 */
export function getSpinnerFrame(frameIndex?: number): string {
  const frames = icons.spinner;
  const idx = frameIndex ?? Math.floor(Date.now() / 100) % frames.length;
  return frames[idx];
}
