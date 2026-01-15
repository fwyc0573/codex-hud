/**
 * Git status collector
 * Phase 3: Extended with ahead/behind sync status and file change counts
 */

import { execSync } from 'child_process';
import type { GitStatus } from '../types.js';

/**
 * Execute a git command and return the output
 * Returns null if the command fails
 */
function execGit(args: string[], cwd?: string): string | null {
  try {
    const result = execSync(`git ${args.join(' ')}`, {
      cwd: cwd || process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000, // 5 second timeout
    });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Check if current directory is inside a git repository
 */
export function isGitRepo(cwd?: string): boolean {
  const result = execGit(['rev-parse', '--is-inside-work-tree'], cwd);
  return result === 'true';
}

/**
 * Get the current git branch name
 */
export function getBranch(cwd?: string): string | null {
  // Try to get branch name
  let branch = execGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  
  // If HEAD is detached, try to get a tag or short SHA
  if (branch === 'HEAD') {
    // Try tag
    const tag = execGit(['describe', '--tags', '--exact-match'], cwd);
    if (tag) {
      return `tag:${tag}`;
    }
    // Fall back to short SHA
    const sha = execGit(['rev-parse', '--short', 'HEAD'], cwd);
    if (sha) {
      return sha;
    }
  }
  
  return branch;
}

/**
 * Check if the git working tree has uncommitted changes
 */
export function isDirty(cwd?: string): boolean {
  const status = execGit(['status', '--porcelain'], cwd);
  return status !== null && status.length > 0;
}

/**
 * Get ahead/behind counts relative to upstream
 * Returns { ahead: N, behind: N }
 */
export function getAheadBehind(cwd?: string): { ahead: number; behind: number } {
  // Get the tracking branch info
  const result = execGit(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], cwd);
  
  if (!result) {
    return { ahead: 0, behind: 0 };
  }
  
  // Format is "behind\tahead"
  const parts = result.split(/\s+/);
  if (parts.length >= 2) {
    return {
      behind: parseInt(parts[0], 10) || 0,
      ahead: parseInt(parts[1], 10) || 0,
    };
  }
  
  return { ahead: 0, behind: 0 };
}

/**
 * Parse git status --porcelain output to count file changes
 * Returns { modified, added, deleted, untracked }
 */
export function getFileChangeCounts(cwd?: string): {
  modified: number;
  added: number;
  deleted: number;
  untracked: number;
} {
  const status = execGit(['status', '--porcelain'], cwd);
  
  const counts = {
    modified: 0,
    added: 0,
    deleted: 0,
    untracked: 0,
  };
  
  if (!status) {
    return counts;
  }
  
  // Parse each line
  for (const line of status.split('\n')) {
    if (!line) continue;
    
    const indexStatus = line[0];
    const workTreeStatus = line[1];
    
    // Untracked files
    if (indexStatus === '?' && workTreeStatus === '?') {
      counts.untracked++;
      continue;
    }
    
    // Modified (either in index or work tree)
    if (indexStatus === 'M' || workTreeStatus === 'M') {
      counts.modified++;
      continue;
    }
    
    // Added (new file in index)
    if (indexStatus === 'A') {
      counts.added++;
      continue;
    }
    
    // Deleted
    if (indexStatus === 'D' || workTreeStatus === 'D') {
      counts.deleted++;
      continue;
    }
    
    // Renamed, copied, etc. count as modified
    if (indexStatus === 'R' || indexStatus === 'C') {
      counts.modified++;
      continue;
    }
  }
  
  return counts;
}

/**
 * Get the repository root directory
 */
export function getRepoRoot(cwd?: string): string | null {
  return execGit(['rev-parse', '--show-toplevel'], cwd);
}

/**
 * Collect all git status information
 * Phase 3: Extended with sync status and file counts
 */
export function collectGitStatus(cwd?: string): GitStatus {
  const isRepo = isGitRepo(cwd);
  
  if (!isRepo) {
    return {
      branch: null,
      isDirty: false,
      isGitRepo: false,
      ahead: 0,
      behind: 0,
      modified: 0,
      added: 0,
      deleted: 0,
      untracked: 0,
    };
  }
  
  const { ahead, behind } = getAheadBehind(cwd);
  const fileCounts = getFileChangeCounts(cwd);
  
  return {
    branch: getBranch(cwd),
    isDirty: isDirty(cwd),
    isGitRepo: true,
    ahead,
    behind,
    ...fileCounts,
  };
}

/**
 * Format git status for display
 */
export function formatGitStatus(status: GitStatus): string {
  if (!status.isGitRepo) {
    return '';
  }
  
  const branch = status.branch || 'unknown';
  const indicator = status.isDirty ? '●' : '';
  
  return `git:(${branch})${indicator ? ' ' + indicator : ''}`;
}
