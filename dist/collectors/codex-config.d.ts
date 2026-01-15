/**
 * Codex config.toml parser
 * Reads configuration from ~/.codex/config.toml
 */
import type { CodexConfig } from '../types.js';
/**
 * Get the Codex home directory
 * Priority: CODEX_HOME env var > ~/.codex
 */
export declare function getCodexHome(): string;
/**
 * Get the path to config.toml
 */
export declare function getConfigPath(): string;
/**
 * Read and parse the Codex config.toml file
 */
export declare function readCodexConfig(): CodexConfig;
/**
 * Get a display-friendly model name
 */
export declare function getModelDisplayName(config: CodexConfig): string;
/**
 * Get MCP server count
 */
export declare function getMcpServerCount(config: CodexConfig): number;
/**
 * Get approval policy display name
 */
export declare function getApprovalPolicyDisplay(config: CodexConfig): string;
//# sourceMappingURL=codex-config.d.ts.map