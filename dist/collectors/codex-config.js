/**
 * Codex config.toml parser
 * Reads configuration from ~/.codex/config.toml
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as TOML from '@iarna/toml';
/**
 * Get the Codex home directory
 * Priority: CODEX_HOME env var > ~/.codex
 */
export function getCodexHome() {
    return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}
/**
 * Get the path to config.toml
 */
export function getConfigPath() {
    return path.join(getCodexHome(), 'config.toml');
}
/**
 * Read and parse the Codex config.toml file
 */
export function readCodexConfig() {
    const configPath = getConfigPath();
    try {
        if (!fs.existsSync(configPath)) {
            return {};
        }
        const content = fs.readFileSync(configPath, 'utf-8');
        const parsed = TOML.parse(content);
        return {
            model: parsed.model,
            model_provider: parsed.model_provider,
            approval_policy: parsed.approval_policy,
            sandbox_mode: parsed.sandbox_mode,
            mcp_servers: parseMcpServers(parsed.mcp_servers),
        };
    }
    catch (error) {
        // Return empty config on error
        console.error(`Error reading config: ${error}`);
        return {};
    }
}
/**
 * Parse MCP servers configuration
 */
function parseMcpServers(raw) {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }
    const servers = {};
    for (const [name, config] of Object.entries(raw)) {
        if (config && typeof config === 'object') {
            const serverConfig = config;
            servers[name] = {
                command: serverConfig.command,
                url: serverConfig.url,
                enabled: serverConfig.enabled !== false, // Default to true
            };
        }
    }
    return Object.keys(servers).length > 0 ? servers : undefined;
}
/**
 * Get a display-friendly model name
 */
export function getModelDisplayName(config) {
    if (config.model) {
        // Shorten common model names
        const model = config.model;
        if (model.startsWith('gpt-5'))
            return model;
        if (model.startsWith('gpt-4'))
            return model;
        if (model.startsWith('o1'))
            return model;
        if (model.startsWith('o3'))
            return model;
        if (model.startsWith('codex'))
            return model;
        return model;
    }
    return 'default';
}
/**
 * Get MCP server count
 */
export function getMcpServerCount(config) {
    if (!config.mcp_servers)
        return 0;
    return Object.values(config.mcp_servers).filter(s => s.enabled !== false).length;
}
/**
 * Get approval policy display name
 */
export function getApprovalPolicyDisplay(config) {
    switch (config.approval_policy) {
        case 'never':
            return 'auto';
        case 'on-failure':
            return 'on-fail';
        case 'on-request':
            return 'on-req';
        case 'untrusted':
            return 'untrust';
        default:
            return config.approval_policy || 'default';
    }
}
//# sourceMappingURL=codex-config.js.map