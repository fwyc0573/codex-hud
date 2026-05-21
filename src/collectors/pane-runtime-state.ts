/**
 * Runtime state fallback for native Windows Codex sessions.
 *
 * Native Codex on Windows can fail to emit rollout files / shell snapshots
 * for the currently attached tmux pane. In that case we derive the visible
 * runtime state from a pane-output bridge file when available, falling back to
 * a direct tmux pane capture only when explicitly needed.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import type { SessionInfo } from '../types.js';

export type RuntimeSessionState = Partial<
  Pick<SessionInfo, 'approvalPolicy' | 'sandboxMode' | 'collaborationMode'>
>;

const ANSI_ESCAPE_REGEX =
  // eslint-disable-next-line no-control-regex
  /[\u001b\u009b][[\]()#;?]*(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/g;

function stripAnsi(input: string): string {
  return input.replace(ANSI_ESCAPE_REGEX, '');
}

function normalizeCapture(input: string): string {
  return stripAnsi(input).replace(/\r/g, '\n').replace(/\s+/g, ' ').trim();
}

function mapPermissionLabelToRuntimeState(label: string): RuntimeSessionState | null {
  const normalized = label.trim().toLowerCase();

  switch (normalized) {
    case 'full access':
      return {
        approvalPolicy: 'never',
        sandboxMode: 'danger-full-access',
      };
    case 'workspace write':
      return {
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
      };
    case 'read only':
    case 'read-only':
      return {
        approvalPolicy: 'untrusted',
        sandboxMode: 'read-only',
      };
    default:
      return null;
  }
}

function findLatestPermissionLabel(input: string): string | null {
  const candidates: Array<{ index: number; label: string }> = [];

  const updateRegex = /Permissions updated to (Full Access|Workspace Write|Read Only|Read-Only)\b/gi;
  for (const match of input.matchAll(updateRegex)) {
    if (typeof match.index === 'number' && match[1]) {
      candidates.push({ index: match.index, label: match[1] });
    }
  }

  const footerRegex = /\b(Full Access|Workspace Write|Read Only|Read-Only)\s+\(shift\+tab to cycle/gi;
  for (const match of input.matchAll(footerRegex)) {
    if (typeof match.index === 'number' && match[1]) {
      candidates.push({ index: match.index, label: match[1] });
    }
  }

  candidates.sort((a, b) => a.index - b.index);
  return candidates[candidates.length - 1]?.label ?? null;
}

function findLatestCollaborationMode(input: string): string | null {
  const candidates: Array<{ index: number; mode: string }> = [];
  const patterns: Array<{ regex: RegExp; mode: string }> = [
    { regex: /\/plan\s+switch to Default mode/gi, mode: 'plan' },
    { regex: /\bPlan mode\s+\(shift\+tab to cycle/gi, mode: 'plan' },
    { regex: /\b(?:switched|updated)\s+to\s+Plan mode\b/gi, mode: 'plan' },
    { regex: /\/plan\s+switch to Plan mode/gi, mode: 'default' },
    { regex: /\bDefault mode\s+\(shift\+tab to cycle/gi, mode: 'default' },
    { regex: /\b(?:switched|updated)\s+to\s+Default mode\b/gi, mode: 'default' },
  ];

  for (const { regex, mode } of patterns) {
    for (const match of input.matchAll(regex)) {
      if (typeof match.index === 'number') {
        candidates.push({ index: match.index, mode });
      }
    }
  }

  candidates.sort((a, b) => a.index - b.index);
  return candidates[candidates.length - 1]?.mode ?? null;
}

export function parsePaneRuntimeStateFromCapture(capture: string): RuntimeSessionState {
  const normalized = normalizeCapture(capture);
  const state: RuntimeSessionState = {};

  const permissionLabel = findLatestPermissionLabel(normalized);
  if (permissionLabel) {
    Object.assign(state, mapPermissionLabelToRuntimeState(permissionLabel) ?? {});
  }

  const collaborationMode = findLatestCollaborationMode(normalized);
  if (collaborationMode) {
    state.collaborationMode = collaborationMode;
  }

  return state;
}

function captureTmuxPane(mainPaneId: string): string | null {
  const tmuxCommand = process.env.CODEX_HUD_TMUX_BIN || 'tmux';
  const result = spawnSync(tmuxCommand, ['capture-pane', '-p', '-J', '-S', '-200', '-t', mainPaneId], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout || null;
}

function readTailFromFile(filePath: string, maxBytes: number = 64 * 1024): string | null {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const stats = fs.statSync(filePath);
  if (stats.size <= 0) {
    return null;
  }

  const start = Math.max(0, stats.size - maxBytes);
  const length = stats.size - start;
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, start);
    if (bytesRead <= 0) {
      return null;
    }

    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

export class PaneRuntimeStateCollector {
  private readonly mainPaneId: string | null;
  private readonly captureFilePath: string | null;
  private cachedState: RuntimeSessionState = {};

  constructor(
    mainPaneId: string | null = process.env.CODEX_HUD_MAIN_PANE ?? null,
    private readonly capturePane: (mainPaneId: string) => string | null = captureTmuxPane,
    captureFilePath: string | null = process.env.CODEX_HUD_PANE_CAPTURE_FILE ?? null
  ) {
    this.mainPaneId = mainPaneId;
    this.captureFilePath = captureFilePath;
  }

  collect(): RuntimeSessionState | null {
    if (!this.mainPaneId) {
      return null;
    }

    const capture =
      (this.captureFilePath ? readTailFromFile(this.captureFilePath) : null) ??
      this.capturePane(this.mainPaneId);
    if (!capture) {
      return Object.keys(this.cachedState).length > 0 ? { ...this.cachedState } : null;
    }

    const parsed = parsePaneRuntimeStateFromCapture(capture);
    if (parsed.approvalPolicy) {
      this.cachedState.approvalPolicy = parsed.approvalPolicy;
    }
    if (parsed.sandboxMode) {
      this.cachedState.sandboxMode = parsed.sandboxMode;
    }
    if (parsed.collaborationMode) {
      this.cachedState.collaborationMode = parsed.collaborationMode;
    }

    return Object.keys(this.cachedState).length > 0 ? { ...this.cachedState } : null;
  }
}
