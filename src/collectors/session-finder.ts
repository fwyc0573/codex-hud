/**
 * Session finder for locating active/recent Codex session rollout files
 * Searches ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SessionFile {
  path: string;
  sessionId: string;
  timestamp: Date;
  size: number;
  modifiedAt: Date;
}

interface SessionMetaInfo {
  id: string;
  cwd: string;
  timestamp: Date;
}

interface HudSessionFilter {
  cwd: string | null;
  startTime: Date | null;
}

const META_CACHE = new Map<string, { mtimeMs: number; size: number; meta: SessionMetaInfo | null }>();

/**
 * Get the Codex home directory
 */
export function getCodexHome(): string {
  return process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
}

/**
 * Get the sessions directory
 */
export function getSessionsDir(): string {
  return path.join(getCodexHome(), 'sessions');
}

function parseHudSessionStart(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric)) {
    // Treat 10-digit values as seconds, otherwise milliseconds.
    const millis = trimmed.length <= 10 ? numeric * 1000 : numeric;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getHudSessionFilter(): HudSessionFilter {
  return {
    cwd: process.env.CODEX_HUD_CWD ?? null,
    startTime: process.env.CODEX_HUD_SESSION_START
      ? parseHudSessionStart(process.env.CODEX_HUD_SESSION_START)
      : null,
  };
}

export function isHudSessionScoped(): boolean {
  const filter = getHudSessionFilter();
  return Boolean(filter.cwd || filter.startTime);
}

function readSessionMeta(rolloutPath: string): SessionMetaInfo | null {
  try {
    const stats = fs.statSync(rolloutPath);
    const cached = META_CACHE.get(rolloutPath);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached.meta;
    }

    const fd = fs.openSync(rolloutPath, 'r');
    try {
      const buffer = Buffer.alloc(64 * 1024);
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const chunk = buffer.toString('utf8', 0, bytesRead);
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as { type?: string; payload?: Record<string, unknown>; timestamp?: string };
          if (entry.type !== 'session_meta' || !entry.payload) {
            continue;
          }
          const payload = entry.payload as { id?: string; cwd?: string; timestamp?: string };
          const timestampStr = payload.timestamp ?? entry.timestamp ?? '';
          const timestamp = new Date(timestampStr);
          if (!payload.id || !payload.cwd || Number.isNaN(timestamp.getTime())) {
            continue;
          }
          const meta = { id: payload.id, cwd: payload.cwd, timestamp };
          META_CACHE.set(rolloutPath, { mtimeMs: stats.mtimeMs, size: stats.size, meta });
          return meta;
        } catch {
          // Skip malformed lines
        }
      }
    } finally {
      fs.closeSync(fd);
    }

    META_CACHE.set(rolloutPath, { mtimeMs: stats.mtimeMs, size: stats.size, meta: null });
    return null;
  } catch {
    return null;
  }
}

function hasRolloutEntryAfter(rolloutPath: string, cutoffMillis: number): boolean {
  try {
    const stats = fs.statSync(rolloutPath);
    const readSize = Math.min(stats.size, 64 * 1024);
    const start = Math.max(0, stats.size - readSize);
    const fd = fs.openSync(rolloutPath, 'r');
    try {
      const buffer = Buffer.alloc(readSize);
      const bytesRead = fs.readSync(fd, buffer, 0, readSize, start);
      const chunk = buffer.toString('utf8', 0, bytesRead);
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as { timestamp?: string };
          if (!entry.timestamp) continue;
          const ts = new Date(entry.timestamp);
          if (!Number.isNaN(ts.getTime()) && ts.getTime() >= cutoffMillis) {
            return true;
          }
        } catch {
          // Skip malformed lines
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Ignore IO errors
  }

  return false;
}

function applyHudFilter(sessions: SessionFile[]): SessionFile[] {
  const filter = getHudSessionFilter();
  if (!filter.cwd && !filter.startTime) {
    return sessions;
  }

  const startMillis = filter.startTime ? filter.startTime.getTime() : null;
  const cutoffMillis = startMillis !== null ? startMillis - 2000 : null;

  const strictMatches = sessions.filter((session) => {
    const meta = readSessionMeta(session.path);
    if (!meta) {
      return false;
    }
    if (filter.cwd && meta.cwd !== filter.cwd) {
      return false;
    }
    if (cutoffMillis !== null && meta.timestamp.getTime() < cutoffMillis) {
      return false;
    }
    return true;
  });

  if (strictMatches.length > 0 || cutoffMillis === null) {
    return strictMatches;
  }

  // If no strict matches, allow active sessions that have entries after the HUD start.
  // This supports /resume pointing at older rollout files that are being appended now.
  const resumeCandidates = sessions.filter((session) => {
    const meta = readSessionMeta(session.path);
    if (!meta) {
      return false;
    }
    if (filter.cwd && meta.cwd !== filter.cwd) {
      return false;
    }
    return hasRolloutEntryAfter(session.path, cutoffMillis);
  });
  // Avoid switching when multiple candidates are active in the same cwd.
  if (resumeCandidates.length === 1) {
    return resumeCandidates;
  }
  return [];
}

/**
 * Parse a rollout filename to extract timestamp and session ID
 * Format: rollout-YYYY-MM-DDTHH-MM-SS-<session-id>.jsonl
 */
function parseRolloutFilename(filename: string): { timestamp: Date; sessionId: string } | null {
  // Match pattern: rollout-2026-01-15T17-47-44-019bc10d-c89d-7352-935c-76b351384357.jsonl
  const match = filename.match(
    /^rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-([a-f0-9-]+)\.jsonl$/
  );

  if (!match) {
    return null;
  }

  // Parse timestamp: 2026-01-15T17-47-44 -> 2026-01-15T17:47:44
  const timestampStr = match[1].replace(/-(\d{2})-(\d{2})$/, ':$1:$2');
  const timestamp = new Date(timestampStr);

  if (isNaN(timestamp.getTime())) {
    return null;
  }

  return {
    timestamp,
    sessionId: match[2],
  };
}

/**
 * Find all rollout files in a date directory
 */
function findRolloutsInDir(dirPath: string): SessionFile[] {
  const results: SessionFile[] = [];

  if (!fs.existsSync(dirPath)) {
    return results;
  }

  try {
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      if (!file.startsWith('rollout-') || !file.endsWith('.jsonl')) {
        continue;
      }

      const parsed = parseRolloutFilename(file);
      if (!parsed) {
        continue;
      }

      const fullPath = path.join(dirPath, file);
      try {
        const stats = fs.statSync(fullPath);
        results.push({
          path: fullPath,
          sessionId: parsed.sessionId,
          timestamp: parsed.timestamp,
          size: stats.size,
          modifiedAt: stats.mtime,
        });
      } catch {
        // Skip files we cannot stat
      }
    }
  } catch {
    // Directory read error
  }

  return results;
}

/**
 * Find the most recent rollout file
 * Searches backwards from today's date
 */
export function findMostRecentRollout(maxDaysBack: number = 7): SessionFile | null {
  const sessionsDir = getSessionsDir();

  if (!fs.existsSync(sessionsDir)) {
    return null;
  }

  const now = new Date();
  let allSessions: SessionFile[] = [];

  // Search backwards from today
  for (let daysAgo = 0; daysAgo <= maxDaysBack; daysAgo++) {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);

    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');

    const dayDir = path.join(sessionsDir, year, month, day);
    const rolloutsInDay = findRolloutsInDir(dayDir);
    allSessions = allSessions.concat(rolloutsInDay);
  }

  allSessions = applyHudFilter(allSessions);

  if (allSessions.length === 0) {
    return null;
  }

  // Sort by modification time (most recent first)
  allSessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

  return allSessions[0];
}

/**
 * Find rollout files modified within the last N seconds
 * Useful for finding actively-used sessions
 */
export function findActiveRollouts(withinSeconds: number = 60): SessionFile[] {
  const sessionsDir = getSessionsDir();

  if (!fs.existsSync(sessionsDir)) {
    return [];
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - withinSeconds * 1000);

  // Only search today's directory for active sessions
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');

  const todayDir = path.join(sessionsDir, year, month, day);
  const rolloutsToday = applyHudFilter(findRolloutsInDir(todayDir));

  // Filter to recently modified
  return rolloutsToday
    .filter((r) => r.modifiedAt >= cutoff)
    .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
}

/**
 * Find a rollout file by session ID
 */
/**
 * Find an active session (convenience wrapper)
 * Returns the path to the most recently modified rollout file
 */
export async function findActiveSession(): Promise<string | null> {
  const active = findActiveRollouts(60);
  if (active.length > 0) {
    return active[0].path;
  }
  
  const recent = findMostRecentRollout(1);
  return recent?.path ?? null;
}

/**
 * Find a rollout file by session ID
 */
export function findRolloutBySessionId(
  sessionId: string,
  maxDaysBack: number = 7
): SessionFile | null {
  const sessionsDir = getSessionsDir();

  if (!fs.existsSync(sessionsDir)) {
    return null;
  }

  const now = new Date();

  // Search backwards from today
  for (let daysAgo = 0; daysAgo <= maxDaysBack; daysAgo++) {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);

    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');

    const dayDir = path.join(sessionsDir, year, month, day);
    const rolloutsInDay = findRolloutsInDir(dayDir);

    const match = rolloutsInDay.find((r) => r.sessionId === sessionId);
    if (match) {
      return match;
    }
  }

  return null;
}

/**
 * Watch for the most recently modified rollout file
 * Returns the path to the file that should be monitored
 */
export class SessionFinder {
  private currentSession: SessionFile | null = null;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(private onSessionChange?: (session: SessionFile | null) => void) {}

  /**
   * Start watching for session changes
   */
  start(checkIntervalMs: number = 5000): void {
    this.check();
    this.checkInterval = setInterval(() => this.check(), checkIntervalMs);
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check for active or recent sessions
   */
  check(): SessionFile | null {
    // First, look for actively modified sessions (within last 60s)
    const active = findActiveRollouts(60);
    if (active.length > 0) {
      const newest = active[0];
      if (
        !this.currentSession ||
        this.currentSession.path !== newest.path ||
        this.currentSession.modifiedAt.getTime() !== newest.modifiedAt.getTime()
      ) {
        this.currentSession = newest;
        this.onSessionChange?.(newest);
      }
      return newest;
    }

    // Fall back to most recent rollout
    const recent = findMostRecentRollout(1);
    if (recent) {
      if (!this.currentSession || this.currentSession.path !== recent.path) {
        this.currentSession = recent;
        this.onSessionChange?.(recent);
      }
      return recent;
    }

    // No session found
    if (this.currentSession !== null) {
      this.currentSession = null;
      this.onSessionChange?.(null);
    }

    return null;
  }

  /**
   * Get the current session
   */
  getCurrentSession(): SessionFile | null {
    return this.currentSession;
  }
}
