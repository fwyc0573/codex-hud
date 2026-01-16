/**
 * Project Line Renderer
 * Renders: project-name git:(branch * ↑1 ↓2) !3 ?2 | 2 configs | Approval: on-req
 * Oh-My-Zsh style git status with compact environment info
 */

import type { HudData, GitStatus } from '../../types.js';
import { theme, icons, colors } from '../colors.js';
import { getApprovalPolicyDisplay } from '../../collectors/codex-config.js';

/**
 * Render git sync status (ahead/behind)
 */
function renderGitSync(git: GitStatus): string {
  const parts: string[] = [];

  if (git.ahead > 0) {
    parts.push(theme.gitAhead(`${icons.ahead}${git.ahead}`));
  }
  if (git.behind > 0) {
    parts.push(theme.gitBehind(`${icons.behind}${git.behind}`));
  }

  return parts.join('');
}

/**
 * Render git file stats
 * Format: !N +N ✘N ?N
 */
function renderGitFileStats(git: GitStatus): string {
  const parts: string[] = [];

  if (git.modified > 0) {
    parts.push(theme.warning(`${icons.modified}${git.modified}`));
  }
  if (git.added > 0) {
    parts.push(theme.success(`${icons.added}${git.added}`));
  }
  if (git.deleted > 0) {
    parts.push(theme.error(`${icons.deleted}${git.deleted}`));
  }
  if (git.untracked > 0) {
    parts.push(colors.dim(`${icons.untracked}${git.untracked}`));
  }

  return parts.join(' ');
}

/**
 * Render compact environment info
 * Format: 2 configs | Approval: on-req | Sandbox: ws-write
 */
function renderCompactEnv(data: HudData): string {
  const parts: string[] = [];

  // Config count (combine configs + extensions)
  const configCount = data.project.configsCount + data.project.extensionsCount;
  if (configCount > 0) {
    parts.push(theme.info(`${configCount}`) + colors.dim(' cfg'));
  }

  // Approval policy (shortened) - use runtime override if available
  const approvalPolicy = getApprovalPolicyDisplay(data.config, data.runtimeApprovalPolicy);
  parts.push(colors.dim('Appr:') + theme.value(approvalPolicy));

  // Sandbox mode (only if dangerous) - check both runtime and config
  const sandboxMode = data.runtimeSandboxMode ?? data.config.sandbox_mode;
  if (sandboxMode === 'danger-full-access') {
    parts.push(theme.error('DANGER'));
  }

  return parts.join(colors.dim(' | '));
}

/**
 * Render the project line with compact environment info
 * Format: project-name git:(branch * ↑1) !3 ?2 | 2 cfg | Appr:on-req
 */
export function renderProjectLine(data: HudData): string {
  const parts: string[] = [];

  // Project name (yellow like claude-hud)
  parts.push(theme.projectName(data.project.projectName));

  // Git status (if in a git repo)
  if (data.git.isGitRepo && data.git.branch) {
    // Build git status string
    let gitContent = data.git.branch;

    // Add dirty indicator
    if (data.git.isDirty) {
      gitContent += ` ${icons.dirty}`;
    }

    // Add sync status (ahead/behind)
    const syncStatus = renderGitSync(data.git);
    if (syncStatus) {
      gitContent += ` ${syncStatus}`;
    }

    // Format as "git:(branch * ↑1)"
    const gitDisplay = theme.gitPrefix('git:(') + theme.gitBranch(gitContent) + theme.gitPrefix(')');
    parts.push(gitDisplay);

    // Add file stats if any
    const fileStats = renderGitFileStats(data.git);
    if (fileStats) {
      parts.push(fileStats);
    }
  }

  // Add compact environment info with separator
  const envInfo = renderCompactEnv(data);
  if (envInfo) {
    parts.push(colors.dim('|') + ' ' + envInfo);
  }

  return parts.join(' ');
}
