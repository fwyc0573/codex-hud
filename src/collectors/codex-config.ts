/**
 * Codex config.toml parser
 * Reads configuration from ~/.codex/config.toml
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as TOML from '@iarna/toml';
import type { CodexConfig, McpServerConfig } from '../types.js';

/**
 * Get the Codex home directory
 * Priority: CODEX_HOME env var > ~/.codex
 */
export function getCodexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

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

    // Extract model provider URL from providers section if available
    let modelProviderUrl: string | undefined;
    const modelProvider = parsed.model_provider as string | undefined;
    if (modelProvider && parsed.providers) {
      const providers = parsed.providers as Record<string, unknown>;
      const providerConfig = providers[modelProvider] as Record<string, unknown> | undefined;
      if (providerConfig?.base_url) {
        modelProviderUrl = providerConfig.base_url as string;
      }
    }

    // Parse reasoning effort - support both field names
    const reasoningEffort = (parsed.model_reasoning_effort as string | undefined)
      || (parsed.reasoning as string | undefined);

    return {
      model: parsed.model as string | undefined,
      model_provider: modelProvider,
      model_provider_url: modelProviderUrl,
      approval_policy: parsed.approval_policy as string | undefined,
      sandbox_mode: parsed.sandbox_mode as string | undefined,
      reasoning: reasoningEffort,
      model_reasoning_effort: parsed.model_reasoning_effort as string | undefined,
      summaries: parsed.summaries as string | undefined,
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
 * @param config - The Codex config object
 * @param runtimeOverride - Optional runtime override from rollout turn_context events
 */
export function getApprovalPolicyDisplay(config: CodexConfig, runtimeOverride?: string): string {
  // Use runtime override if available, otherwise fall back to config
  const policy = runtimeOverride ?? config.approval_policy;

  switch (policy) {
    case 'never':
      return 'auto';
    case 'on-failure':
      return 'on-fail';
    case 'on-request':
      return 'on-req';
    case 'untrusted':
      return 'untrust';
    default:
      return policy || 'default';
  }
}

/**
 * Get model display with reasoning and summaries info
 * Format: gpt-5.2-codex (reasoning xhigh, summaries auto)
 */
export function getModelFullDisplay(config: CodexConfig): string {
  const model = getModelDisplayName(config);
  const extras: string[] = [];

  // Use reasoning or model_reasoning_effort
  const reasoning = config.reasoning || config.model_reasoning_effort;
  if (reasoning) {
    extras.push(`reasoning ${reasoning}`);
  }
  if (config.summaries) {
    extras.push(`summaries ${config.summaries}`);
  }

  if (extras.length > 0) {
    return `${model} (${extras.join(', ')})`;
  }
  return model;
}

/**
 * Get compact model display with reasoning level
 * Format: gpt-5.2-codex:medium or gpt-5.2-codex (if no reasoning)
 */
export function getModelWithReasoning(config: CodexConfig): string {
  const model = getModelDisplayName(config);
  const reasoning = config.reasoning || config.model_reasoning_effort;

  if (reasoning) {
    return `${model}:${reasoning}`;
  }
  return model;
}

/**
 * Get model provider display with URL
 * Format: packycode - https://www.packyapi.com/v1
 */
export function getModelProviderDisplay(config: CodexConfig): string | null {
  if (!config.model_provider) {
    return null;
  }

  if (config.model_provider_url) {
    return `${config.model_provider} - ${config.model_provider_url}`;
  }
  return config.model_provider;
}

/**
 * Get shortened model provider name for compact display
 * Extracts domain name from URL or returns provider name
 */
export function getModelProviderShort(config: CodexConfig): string | null {
  if (!config.model_provider) {
    return null;
  }

  // If we have a URL, extract the domain
  if (config.model_provider_url) {
    try {
      const url = new URL(config.model_provider_url);
      // Get domain without www. prefix
      const domain = url.hostname.replace(/^www\./, '');
      // Return just the main domain part (e.g., packyapi.com -> packyapi)
      const parts = domain.split('.');
      if (parts.length >= 2) {
        return parts[parts.length - 2]; // e.g., "packyapi" from "packyapi.com"
      }
      return domain;
    } catch {
      // Fall through to return provider name
    }
  }

  return config.model_provider;
}

/**
 * Check account configuration status
 * Returns account info based on environment and config
 */
export function checkAccountStatus(): { type: 'api_key' | 'chatgpt' | 'unknown'; status: 'configured' | 'not_configured'; message: string } {
  // Check for API key in environment
  const apiKey = process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY;

  if (apiKey) {
    return {
      type: 'api_key',
      status: 'configured',
      message: 'API key configured (run codex login to use ChatGPT)',
    };
  }

  // Check for ChatGPT auth file
  const authFile = path.join(getCodexHome(), 'auth.json');
  if (fs.existsSync(authFile)) {
    return {
      type: 'chatgpt',
      status: 'configured',
      message: 'ChatGPT account configured',
    };
  }

  return {
    type: 'unknown',
    status: 'not_configured',
    message: 'Not configured (run codex login)',
  };
}
