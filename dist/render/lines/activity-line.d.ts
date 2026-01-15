/**
 * Activity Line Renderer
 * Renders: ◐ Edit: file.ts | ✓ Read ×3
 * Shows current and recent tool/agent activity
 */
import type { HudData, ToolActivity, PlanProgress } from '../../types.js';
/**
 * Render the tools activity line
 * Format: ◐ Edit: file.ts | ✓ Read ×3 | ✓ Bash ×2
 */
export declare function renderToolsLine(toolActivity: ToolActivity | undefined): string | null;
/**
 * Render the todos/plan progress line
 * Format: 📝 3/7 steps | ✓ Task 1 | ◐ Task 2
 */
export declare function renderTodosLine(planProgress: PlanProgress | undefined): string | null;
/**
 * Collect all activity lines (tools + todos)
 */
export declare function collectActivityLines(data: HudData): string[];
//# sourceMappingURL=activity-line.d.ts.map