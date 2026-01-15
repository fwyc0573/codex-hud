/**
 * Project Line Renderer
 * Renders: project-name git:(branch * ↑1 ↓2)
 * Oh-My-Zsh style git status display
 */
import { theme, icons, colors } from '../colors.js';
/**
 * Render git sync status (ahead/behind)
 */
function renderGitSync(git) {
    const parts = [];
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
function renderGitFileStats(git) {
    const parts = [];
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
 * Render the project line
 * Format: project-name git:(branch * ↑1)
 */
export function renderProjectLine(data) {
    const parts = [];
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
    return parts.join(' ');
}
