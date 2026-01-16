/**
 * Environment Line Renderer
 * Renders Codex-specific module status:
 * Format: 2 configs | mode: development | 3 extensions | N AGENTS.md | Approval: policy | MCP: ✓2 ✗1
 */

import type { HudData } from '../../types.js';
import { theme, colors, icons } from '../colors.js';
import { getApprovalPolicyDisplay } from '../../collectors/codex-config.js';
import { getMcpStatusSummary } from '../../collectors/mcp-status.js';

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
 * Format: 2 configs | mode: dev | 3 extensions | N AGENTS.md | Approval: policy | MCP: ✓2 ✗1
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

  // MCP servers status with running/error breakdown
  const mcpStatus = getMcpStatusSummary(data.config);
  if (mcpStatus.total > 0) {
    const mcpParts: string[] = [colors.dim('MCP:')];
    if (mcpStatus.running > 0) {
      mcpParts.push(theme.success(`✓${mcpStatus.running}`));
    }
    if (mcpStatus.error > 0) {
      mcpParts.push(theme.error(`✗${mcpStatus.error}`));
    }
    if (mcpStatus.stopped > 0 && mcpStatus.running === 0 && mcpStatus.error === 0) {
      // Only show stopped if no running or error servers
      mcpParts.push(colors.dim(`○${mcpStatus.stopped}`));
    }
    parts.push(mcpParts.join(' '));
  }

  // Approval policy - use runtime override if available
  const approvalPolicy = getApprovalPolicyDisplay(data.config, data.runtimeApprovalPolicy);
  parts.push(colors.dim('Approval: ') + theme.value(approvalPolicy));

  // Sandbox mode (if set and not default) - check both runtime and config
  const sandboxMode = data.runtimeSandboxMode ?? data.config.sandbox_mode;
  if (sandboxMode) {
    let sandboxDisplay: string;
    if (sandboxMode === 'danger-full-access') {
      sandboxDisplay = theme.error('DANGER');
    } else if (sandboxMode === 'workspace-write') {
      sandboxDisplay = theme.warning('ws-write');
    } else {
      sandboxDisplay = theme.info(sandboxMode);
    }
    parts.push(colors.dim('Sandbox: ') + sandboxDisplay);
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join(` ${colors.dim(icons.pipe)} `);
}
