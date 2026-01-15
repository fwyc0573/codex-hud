/**
 * Header line renderer
 * Phase 3: Redesigned to match claude-hud layout
 *
 * Layout:
 * Row 1: [Model] █████░░░░░ 45% | project-name git:(branch *) | ⏱️ 10m
 * Row 2: 2 AGENTS.md | 3 MCPs | Approval: default
 * Row 3 (optional): ◐ Edit: file.ts | ✓ Read ×3
 */
import type { HudData, RenderOptions } from '../types.js';
/**
 * Render the full HUD output (all lines)
 */
export declare function renderHud(data: HudData, options: RenderOptions): string[];
/**
 * Render the main header line (legacy)
 * @deprecated Use renderHud instead
 */
export declare function renderHeader(data: HudData, options: RenderOptions): string;
/**
 * Render the second line with detailed info (legacy)
 * @deprecated Use renderHud instead
 */
export declare function renderDetails(data: HudData, options: RenderOptions): string;
/**
 * Render the third line with tool activity (legacy)
 * @deprecated Use renderHud instead
 */
export declare function renderActivityLine(data: HudData, _options: RenderOptions): string | null;
//# sourceMappingURL=header.d.ts.map