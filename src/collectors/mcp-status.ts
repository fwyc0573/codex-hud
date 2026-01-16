/**
 * MCP Server Status Collector
 * Detects running status of configured MCP servers
 */

import { execSync } from 'child_process';
import type { CodexConfig, McpServerConfig, McpStatusSummary, McpServerRunStatus } from '../types.js';

/**
 * Check if a process is running by searching for command pattern
 */
function isProcessRunning(command: string[]): boolean {
    if (!command || command.length === 0) {
        return false;
    }

    try {
        // Search for the command in running processes
        const searchPattern = command[0];
        const result = execSync(`pgrep -f "${searchPattern}" 2>/dev/null`, {
            encoding: 'utf-8',
            timeout: 1000,
        });
        return result.trim().length > 0;
    } catch {
        // pgrep returns non-zero if no process found
        return false;
    }
}

/**
 * Check if a URL-based MCP server is reachable
 */
function isUrlReachable(url: string): boolean {
    try {
        // Quick check using curl with timeout
        execSync(`curl -s --connect-timeout 1 --max-time 2 "${url}" > /dev/null 2>&1`, {
            timeout: 3000,
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * Get the status of a single MCP server
 */
export function getMcpServerStatus(
    name: string,
    config: McpServerConfig
): McpServerRunStatus {
    // If explicitly disabled, return stopped
    if (config.enabled === false) {
        return 'stopped';
    }

    // Check command-based servers
    if (config.command && config.command.length > 0) {
        return isProcessRunning(config.command) ? 'running' : 'stopped';
    }

    // Check URL-based servers
    if (config.url) {
        return isUrlReachable(config.url) ? 'running' : 'error';
    }

    return 'unknown';
}

/**
 * Get summary of all MCP server statuses
 */
export function getMcpStatusSummary(config: CodexConfig): McpStatusSummary {
    const summary: McpStatusSummary = {
        total: 0,
        running: 0,
        stopped: 0,
        error: 0,
    };

    if (!config.mcp_servers) {
        return summary;
    }

    for (const [name, serverConfig] of Object.entries(config.mcp_servers)) {
        // Skip disabled servers from total count
        if (serverConfig.enabled === false) {
            continue;
        }

        summary.total++;
        const status = getMcpServerStatus(name, serverConfig);

        switch (status) {
            case 'running':
                summary.running++;
                break;
            case 'stopped':
                summary.stopped++;
                break;
            case 'error':
                summary.error++;
                break;
            default:
                // unknown counts as stopped
                summary.stopped++;
                break;
        }
    }

    return summary;
}

/**
 * Format MCP status for display
 * Format: MCP: ✓2 ✗1 or MCP: 0 (if none configured)
 */
export function formatMcpStatus(summary: McpStatusSummary): string {
    if (summary.total === 0) {
        return 'MCP: 0';
    }

    const parts: string[] = ['MCP:'];

    if (summary.running > 0) {
        parts.push(`✓${summary.running}`);
    }

    if (summary.error > 0) {
        parts.push(`✗${summary.error}`);
    }

    if (summary.stopped > 0 && summary.running === 0 && summary.error === 0) {
        // Only show stopped count if no running or error
        parts.push(`○${summary.stopped}`);
    }

    return parts.join(' ');
}
