/**
 * Codex config.toml parser
 * Reads configuration from ~/.codex/config.toml
 */

import * as fs from 'fs';
import * as path from 'path';
import * as TOML from '@iarna/toml';
import type { CodexConfig, FastModeState, McpServerConfig, PermissionState } from '../types.js';
import { getCodexHome } from '../utils/codex-path.js';

/**
 * Get the path to config.toml
 */
export function getConfigPath(): string {
  return path.join(getCodexHome(), 'config.toml');
}

/**
 * Read and parse the Codex config.toml file
 */
export function readCodexConfig(): CodexConfig {
  const configPath = getConfigPath();
  
  try {
    if (!fs.existsSync(configPath)) {
      return {};
    }
    
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = TOML.parse(content) as Record<string, unknown>;
    
    return {
      model: parsed.model as string | undefined,
      model_reasoning_effort: parsed.model_reasoning_effort as string | undefined,
      model_provider: parsed.model_provider as string | undefined,
      service_tier: parsed.service_tier as string | undefined,
      hooks: parsed.hooks as boolean | undefined,
      approval_policy: parsed.approval_policy as string | undefined,
      sandbox_mode: parsed.sandbox_mode as string | undefined,
      mcp_servers: parseMcpServers(parsed.mcp_servers),
    };
  } catch (error) {
    // Return empty config on error
    console.error(`Error reading config: ${error}`);
    return {};
  }
}

/**
 * Parse MCP servers configuration
 */
function parseMcpServers(
  raw: unknown
): Record<string, McpServerConfig> | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  
  const servers: Record<string, McpServerConfig> = {};
  
  for (const [name, config] of Object.entries(raw as Record<string, unknown>)) {
    if (config && typeof config === 'object') {
      const serverConfig = config as Record<string, unknown>;
      servers[name] = {
        command: serverConfig.command as string[] | undefined,
        url: serverConfig.url as string | undefined,
        enabled: serverConfig.enabled !== false, // Default to true
      };
    }
  }
  
  return Object.keys(servers).length > 0 ? servers : undefined;
}

/**
 * Get a display-friendly model name
 */
export function getModelDisplayName(config: CodexConfig): string {
  if (config.model) {
    // Shorten common model names
    const model = config.model;
    if (model.startsWith('gpt-5')) return model;
    if (model.startsWith('gpt-4')) return model;
    if (model.startsWith('o1')) return model;
    if (model.startsWith('o3')) return model;
    if (model.startsWith('codex')) return model;
    return model;
  }
  return 'default';
}

/**
 * Get MCP server count
 */
export function getMcpServerCount(config: CodexConfig): number {
  if (!config.mcp_servers) return 0;
  return Object.values(config.mcp_servers).filter(s => s.enabled !== false).length;
}

/**
 * Get approval policy display name
 */
export function getApprovalPolicyDisplay(
  config: CodexConfig,
  runtime?: PermissionState
): string {
  const approvalPolicy = runtime?.approvalPolicy ?? config.approval_policy;
  const sandboxMode = runtime?.sandboxMode ?? config.sandbox_mode;

  if (!approvalPolicy || approvalPolicy === 'untrusted' || approvalPolicy === 'on-request') {
    return 'ask for approval';
  }

  if (approvalPolicy === 'never' && sandboxMode === 'danger-full-access') {
    return 'full access';
  }

  if (approvalPolicy === 'on-failure' || approvalPolicy === 'never') {
    return 'approve for me';
  }

  return 'unknown';
}

/**
 * Get the fast-mode display from the latest runtime service tier or config fallback.
 */
export function getFastModeDisplay(
  config: CodexConfig,
  runtime?: FastModeState
): string {
  const serviceTier = runtime?.serviceTier ?? config.service_tier;
  return serviceTier === 'priority' || serviceTier === 'fast' ? 'Fast: on' : 'Fast: off';
}
