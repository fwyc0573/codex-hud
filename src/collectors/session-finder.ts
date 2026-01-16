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
  const rolloutsToday = findRolloutsInDir(todayDir);

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
