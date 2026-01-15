/**
 * Environment Line Renderer
 * Renders Codex-specific module status:
 * Format: 2 configs | mode: development | 3 extensions | N AGENTS.md | Approval: policy
 */

import type { HudData } from '../../types.js';
import { theme, colors, icons } from '../colors.js';
import { getMcpServerCount, getApprovalPolicyDisplay } from '../../collectors/codex-config.js';

/**
 * Render work mode with appropriate color
 */
function renderWorkMode(mode: 'development' | 'production' | 'unknown'): string {
  switch (mode) {
    case 'production':
      return theme.error('prod');
    case 'development':
      return theme.success('dev');
    default:
      return colors.dim('unknown');
  }
}

/**
 * Render the environment line
 * Format: 2 configs | mode: dev | 3 extensions | N AGENTS.md | Approval: policy
 */
export function renderEnvironmentLine(data: HudData): string | null {
  const parts: string[] = [];
  
  // Codex-specific: Active configs count
  if (data.project.configsCount > 0) {
    parts.push(theme.info(`${data.project.configsCount}`) + colors.dim(' configs'));
  }
  
  // Codex-specific: Work mode
  parts.push(colors.dim('mode: ') + renderWorkMode(data.project.workMode));
  
  // Codex-specific: Extensions count (MCP servers)
  if (data.project.extensionsCount > 0) {
    parts.push(theme.info(`${data.project.extensionsCount}`) + colors.dim(' extensions'));
  }
  
  // AGENTS.md count
  if (data.project.agentsMdCount > 0) {
    parts.push(theme.success(`${data.project.agentsMdCount}`) + colors.dim(' AGENTS.md'));
  }
  
  // INSTRUCTIONS.md count (if exists)
  if (data.project.instructionsMdCount > 0) {
    parts.push(theme.success(`${data.project.instructionsMdCount}`) + colors.dim(' INSTRUCTIONS.md'));
  }
  
  // Rules count (if exists)
  if (data.project.rulesCount > 0) {
    parts.push(theme.info(`${data.project.rulesCount}`) + colors.dim(' rules'));
  }
  
  // MCP servers count (legacy display, kept for backward compat)
  const mcpCount = getMcpServerCount(data.config);
  if (mcpCount > 0 && data.project.extensionsCount === 0) {
    // Only show if not already shown as extensions
    parts.push(theme.info(`${mcpCount}`) + colors.dim(' MCPs'));
  }
  
  // Approval policy
  const approvalPolicy = getApprovalPolicyDisplay(data.config);
  parts.push(colors.dim('Approval: ') + theme.value(approvalPolicy));
  
  // Sandbox mode (if set and not default)
  if (data.config.sandbox_mode) {
    const sandbox = data.config.sandbox_mode;
    let sandboxDisplay: string;
    if (sandbox === 'danger-full-access') {
      sandboxDisplay = theme.error('DANGER');
    } else if (sandbox === 'workspace-write') {
      sandboxDisplay = theme.warning('ws-write');
    } else {
      sandboxDisplay = theme.info(sandbox);
    }
    parts.push(colors.dim('Sandbox: ') + sandboxDisplay);
  }
  
  if (parts.length === 0) {
    return null;
  }
  
  return parts.join(` ${colors.dim(icons.pipe)} `);
}
