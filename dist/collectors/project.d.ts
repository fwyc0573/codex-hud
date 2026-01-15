/**
 * Project information collector
 * Phase 3: Extended with INSTRUCTIONS.md count, rules count, MCP count
 */
import type { ProjectInfo, CodexConfig } from '../types.js';
/**
 * Get the project name from the current directory
 * Tries git remote first, then falls back to folder name
 */
export declare function getProjectName(cwd: string): string;
/**
 * Count AGENTS.md files in the directory tree
 * Searches from cwd up to git root or filesystem root
 */
export declare function countAgentsMdFiles(cwd: string): number;
/**
 * Count INSTRUCTIONS.md files in the directory tree
 */
export declare function countInstructionsMdFiles(cwd: string): number;
/**
 * Count rule files in .codex/rules directory
 */
export declare function countRulesFiles(cwd: string): number;
/**
 * Check if .codex directory exists in cwd
 */
export declare function hasCodexDir(cwd: string): boolean;
/**
 * Count configuration files in .codex directory
 * Counts: config.toml, config.json, *.toml, *.json
 */
export declare function countConfigFiles(cwd: string): number;
/**
 * Detect current work mode from environment variables or config
 * Returns 'development', 'production', or 'unknown'
 */
export declare function detectWorkMode(): 'development' | 'production' | 'unknown';
/**
 * Collect all project information
 * Phase 3: Extended with additional file counts and Codex-specific module status
 */
export declare function collectProjectInfo(cwd?: string, config?: CodexConfig): ProjectInfo;
/**
 * Format project path for display
 * Shortens long paths for terminal display
 */
export declare function formatProjectPath(cwd: string, maxLength?: number): string;
//# sourceMappingURL=project.d.ts.map