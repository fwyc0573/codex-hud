/**
 * Git status collector
 * Phase 3: Extended with ahead/behind sync status and file change counts
 */
import type { GitStatus } from '../types.js';
/**
 * Check if current directory is inside a git repository
 */
export declare function isGitRepo(cwd?: string): boolean;
/**
 * Get the current git branch name
 */
export declare function getBranch(cwd?: string): string | null;
/**
 * Check if the git working tree has uncommitted changes
 */
export declare function isDirty(cwd?: string): boolean;
/**
 * Get ahead/behind counts relative to upstream
 * Returns { ahead: N, behind: N }
 */
export declare function getAheadBehind(cwd?: string): {
    ahead: number;
    behind: number;
};
/**
 * Parse git status --porcelain output to count file changes
 * Returns { modified, added, deleted, untracked }
 */
export declare function getFileChangeCounts(cwd?: string): {
    modified: number;
    added: number;
    deleted: number;
    untracked: number;
};
/**
 * Get the repository root directory
 */
export declare function getRepoRoot(cwd?: string): string | null;
/**
 * Collect all git status information
 * Phase 3: Extended with sync status and file counts
 */
export declare function collectGitStatus(cwd?: string): GitStatus;
/**
 * Format git status for display
 */
export declare function formatGitStatus(status: GitStatus): string;
//# sourceMappingURL=git.d.ts.map