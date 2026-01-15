/**
 * Activity Line Renderer
 * Renders: ◐ Edit: file.ts | ✓ Read ×3
 * Shows current and recent tool/agent activity
 */
import { theme, colors, icons, getSpinnerFrame, truncate } from '../colors.js';
/**
 * Truncate a target string for display
 */
function truncateTarget(target, maxLen = 20) {
    if (target.length <= maxLen) {
        return target;
    }
    // For file paths, show the end
    if (target.includes('/')) {
        const parts = target.split('/');
        const filename = parts[parts.length - 1];
        if (filename.length <= maxLen) {
            return '…/' + filename;
        }
        return '…' + filename.slice(-(maxLen - 1));
    }
    return target.slice(0, maxLen - 1) + '…';
}
/**
 * Group consecutive calls by tool name and count them
 * Returns array of { name, count, status }
 */
function groupToolCalls(calls) {
    const groups = [];
    // Only look at completed/error calls for grouping
    const finishedCalls = calls.filter(c => c.status === 'completed' || c.status === 'error');
    for (const call of finishedCalls) {
        const last = groups[groups.length - 1];
        const status = call.status === 'error' ? 'error' : 'completed';
        if (last && last.name === call.name && last.status === status) {
            last.count++;
        }
        else {
            groups.push({ name: call.name, count: 1, status });
        }
    }
    return groups;
}
/**
 * Render the tools activity line
 * Format: ◐ Edit: file.ts | ✓ Read ×3 | ✓ Bash ×2
 */
export function renderToolsLine(toolActivity) {
    if (!toolActivity || toolActivity.recentCalls.length === 0) {
        return null;
    }
    const parts = [];
    // Currently running tool (if any)
    const running = toolActivity.recentCalls.filter(c => c.status === 'running');
    if (running.length > 0) {
        const current = running[running.length - 1];
        const spinner = getSpinnerFrame();
        const targetStr = current.target ? `: ${truncateTarget(current.target)}` : '';
        parts.push(theme.toolRunning(`${spinner} ${current.name}${targetStr}`));
    }
    // Group completed calls
    const groups = groupToolCalls(toolActivity.recentCalls);
    // Render grouped calls (limit to last 5 groups)
    const recentGroups = groups.slice(-5);
    for (const group of recentGroups) {
        const icon = group.status === 'error' ? icons.cross : icons.check;
        const colorFn = group.status === 'error' ? theme.error : theme.success;
        if (group.count > 1) {
            parts.push(colorFn(`${icon} ${group.name} ${icons.multiply}${group.count}`));
        }
        else {
            parts.push(colorFn(`${icon} ${group.name}`));
        }
    }
    // Show total if more calls exist
    if (toolActivity.totalCalls > toolActivity.recentCalls.length) {
        parts.push(colors.dim(`(${toolActivity.totalCalls} total)`));
    }
    if (parts.length === 0) {
        return null;
    }
    return parts.join(` ${colors.dim(icons.pipe)} `);
}
/**
 * Render the todos/plan progress line
 * Format: 📝 3/7 steps | ✓ Task 1 | ◐ Task 2
 */
export function renderTodosLine(planProgress) {
    if (!planProgress) {
        return null;
    }
    const parts = [];
    // Overall progress (if steps exist)
    if (planProgress.totalSteps > 0) {
        const { completedSteps, totalSteps } = planProgress;
        parts.push(theme.planProgress(`${icons.plan} ${completedSteps}/${totalSteps}`));
    }
    // Current step (if in progress)
    const inProgressSteps = planProgress.steps.filter(s => s.status === 'in_progress');
    if (inProgressSteps.length > 0) {
        const current = inProgressSteps[0];
        const spinner = getSpinnerFrame();
        const stepText = truncate(current.step, 30);
        parts.push(theme.planStepInProgress(`${spinner} ${stepText}`));
    }
    // Recent completed steps (last 2)
    const completedSteps = planProgress.steps.filter(s => s.status === 'completed').slice(-2);
    for (const step of completedSteps) {
        const stepText = truncate(step.step, 20);
        parts.push(theme.planStepCompleted(`${icons.check} ${stepText}`));
    }
    if (parts.length === 0) {
        return null;
    }
    return parts.join(` ${colors.dim(icons.pipe)} `);
}
/**
 * Collect all activity lines (tools + todos)
 */
export function collectActivityLines(data) {
    const lines = [];
    // Tools line
    const toolsLine = renderToolsLine(data.toolActivity);
    if (toolsLine) {
        lines.push(toolsLine);
    }
    // Todos/plan line
    const todosLine = renderTodosLine(data.planProgress);
    if (todosLine) {
        lines.push(todosLine);
    }
    return lines;
}
//# sourceMappingURL=activity-line.js.map