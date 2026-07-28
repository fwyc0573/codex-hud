/**
 * Environment Line Renderer
 * Renders Codex-specific module status:
 * Format: 2 configs | 3 extensions | N skills | M hooks | Approval: policy | Fast: on
 */

import type { HudData } from '../../types.js';
import { theme, colors, icons } from '../colors.js';
import { getMcpServerCount, getApprovalPolicyDisplay, getFastModeDisplay } from '../../collectors/codex-config.js';

/**
 * Render the environment line
 * Format: 2 configs | 3 extensions | N skills | M hooks | Approval: policy | Fast: on
 */
export function renderEnvironmentLine(data: HudData): string | null {
  const parts: string[] = [];
  
  // Codex-specific: Active configs count
  if (data.project.configsCount > 0) {
    parts.push(theme.info(`${data.project.configsCount}`) + colors.dim(' configs'));
  }
  
  // Codex-specific: Extensions count (MCP servers)
  if (data.project.extensionsCount > 0) {
    parts.push(theme.info(`${data.project.extensionsCount}`) + colors.dim(' extensions'));
  }

  if (data.project.skillsCount > 0) {
    parts.push(theme.info(`${data.project.skillsCount}`) + colors.dim(' skills'));
  }

  if (data.project.hooksCount > 0) {
    parts.push(theme.info(`${data.project.hooksCount}`) + colors.dim(' hooks'));
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
  const approvalPolicy = getApprovalPolicyDisplay(data.config, {
    approvalPolicy: data.session?.approvalPolicy,
    sandboxMode: data.session?.sandboxMode,
  });
  parts.push(colors.dim('Approval: ') + theme.value(approvalPolicy));

  // Fast mode reflects the latest runtime service tier when available.
  parts.push(theme.value(getFastModeDisplay(data.config, {
    serviceTier: data.session?.serviceTier,
  })));
  
  // Sandbox mode (if set and not default). Runtime turn_context state takes
  // precedence so the permission and sandbox labels cannot drift apart.
  const sandbox = data.session?.sandboxMode ?? data.config.sandbox_mode;
  if (sandbox) {
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
