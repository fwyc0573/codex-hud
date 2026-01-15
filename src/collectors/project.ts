/**
 * Project information collector
 * Phase 3: Extended with INSTRUCTIONS.md count, rules count, MCP count
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProjectInfo, CodexConfig } from '../types.js';
import { getMcpServerCount } from './codex-config.js';

const AGENTS_MD_FILENAMES = [
  'AGENTS.md',
  'agents.md',
  'CODEX.md',
  'codex.md',
];

const INSTRUCTIONS_MD_FILENAMES = [
  'INSTRUCTIONS.md',
  'instructions.md',
];

/**
 * Get the project name from the current directory
 * Tries git remote first, then falls back to folder name
 */
export function getProjectName(cwd: string): string {
  // Just use the folder name
  return path.basename(cwd);
}

/**
 * Count files matching a list of filenames in a directory tree
 * Searches from cwd up to git root or filesystem root
 */
function countFilesInTree(cwd: string, filenames: string[], checkCodexDir: boolean = true): number {
  let count = 0;
  let currentDir = cwd;
  const visited = new Set<string>();
  
  // Walk up the directory tree
  while (currentDir && !visited.has(currentDir)) {
    visited.add(currentDir);
    
    // Check for files in current directory
    for (const filename of filenames) {
      const filePath = path.join(currentDir, filename);
      if (fs.existsSync(filePath)) {
        count++;
        break; // Only count one per directory
      }
    }
    
    // Check in .codex subdirectory too
    if (checkCodexDir) {
      const codexDir = path.join(currentDir, '.codex');
      if (fs.existsSync(codexDir) && fs.statSync(codexDir).isDirectory()) {
        for (const filename of filenames) {
          const filePath = path.join(codexDir, filename);
          if (fs.existsSync(filePath)) {
            count++;
            break;
          }
        }
      }
    }
    
    // Stop at git root or filesystem root
    const gitDir = path.join(currentDir, '.git');
    if (fs.existsSync(gitDir)) {
      break;
    }
    
    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      break; // Reached filesystem root
    }
    currentDir = parent;
  }
  
  return count;
}

/**
 * Count AGENTS.md files in the directory tree
 * Searches from cwd up to git root or filesystem root
 */
export function countAgentsMdFiles(cwd: string): number {
  return countFilesInTree(cwd, AGENTS_MD_FILENAMES, true);
}

/**
 * Count INSTRUCTIONS.md files in the directory tree
 */
export function countInstructionsMdFiles(cwd: string): number {
  return countFilesInTree(cwd, INSTRUCTIONS_MD_FILENAMES, true);
}

/**
 * Count rule files in .codex/rules directory
 */
export function countRulesFiles(cwd: string): number {
  const rulesDir = path.join(cwd, '.codex', 'rules');
  
  if (!fs.existsSync(rulesDir) || !fs.statSync(rulesDir).isDirectory()) {
    return 0;
  }
  
  try {
    const files = fs.readdirSync(rulesDir);
    return files.filter(f => f.endsWith('.md')).length;
  } catch {
    return 0;
  }
}

/**
 * Check if .codex directory exists in cwd
 */
export function hasCodexDir(cwd: string): boolean {
  const codexDir = path.join(cwd, '.codex');
  return fs.existsSync(codexDir) && fs.statSync(codexDir).isDirectory();
}

/**
 * Count configuration files in .codex directory
 * Counts: config.toml, config.json, *.toml, *.json
 */
export function countConfigFiles(cwd: string): number {
  const codexDir = path.join(cwd, '.codex');
  
  if (!fs.existsSync(codexDir) || !fs.statSync(codexDir).isDirectory()) {
    return 0;
  }
  
  try {
    const files = fs.readdirSync(codexDir);
    return files.filter(f => 
      f.endsWith('.toml') || 
      f.endsWith('.json') ||
      f === 'config' ||
      f === 'settings'
    ).length;
  } catch {
    return 0;
  }
}

/**
 * Detect current work mode from environment variables or config
 * Returns 'development', 'production', or 'unknown'
 */
export function detectWorkMode(): 'development' | 'production' | 'unknown' {
  // Check environment variables
  const nodeEnv = process.env.NODE_ENV?.toLowerCase();
  const codexEnv = process.env.CODEX_ENV?.toLowerCase();
  
  if (codexEnv === 'production' || nodeEnv === 'production') {
    return 'production';
  }
  if (codexEnv === 'development' || nodeEnv === 'development') {
    return 'development';
  }
  
  // Default to development if not specified
  return 'development';
}

/**
 * Collect all project information
 * Phase 3: Extended with additional file counts and Codex-specific module status
 */
export function collectProjectInfo(cwd?: string, config?: CodexConfig): ProjectInfo {
  const workDir = cwd || process.cwd();
  
  // Count config files in .codex directory
  const configsCount = countConfigFiles(workDir);
  
  // Detect work mode from environment or config
  const workMode = detectWorkMode();
  
  // Count extensions (MCP servers count as extensions)
  const mcpCount = config ? getMcpServerCount(config) : 0;
  
  return {
    cwd: workDir,
    projectName: getProjectName(workDir),
    agentsMdCount: countAgentsMdFiles(workDir),
    hasCodexDir: hasCodexDir(workDir),
    instructionsMdCount: countInstructionsMdFiles(workDir),
    rulesCount: countRulesFiles(workDir),
    mcpCount,
    configsCount,
    extensionsCount: mcpCount,  // MCP servers are treated as extensions
    workMode,
  };
}

/**
 * Format project path for display
 * Shortens long paths for terminal display
 */
export function formatProjectPath(cwd: string, maxLength: number = 30): string {
  if (cwd.length <= maxLength) {
    return cwd;
  }
  
  // Try to shorten by using ~ for home directory
  const home = process.env.HOME || '';
  if (home && cwd.startsWith(home)) {
    const shortened = '~' + cwd.slice(home.length);
    if (shortened.length <= maxLength) {
      return shortened;
    }
    // Still too long, truncate from the left
    return '…' + shortened.slice(-(maxLength - 1));
  }
  
  // Truncate from the left
  return '…' + cwd.slice(-(maxLength - 1));
}
