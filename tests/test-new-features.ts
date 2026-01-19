/**
 * Test script for new HUD features:
 * 1. Model with reasoning level display
 * 2. MCP server status display
 * 3. Config real-time refresh
 */

import { readCodexConfig, getModelWithReasoning, getApprovalPolicyDisplay } from '../src/collectors/codex-config.js';
import { getMcpStatusSummary, formatMcpStatus } from '../src/collectors/mcp-status.js';

console.log('=== Testing New HUD Features ===\n');

// Test 1: Read config and display model with reasoning
console.log('1. Model with Reasoning Level:');
const config = readCodexConfig();
console.log(`   Raw config.model: ${config.model}`);
console.log(`   Raw config.reasoning: ${config.reasoning}`);
console.log(`   Raw config.model_reasoning_effort: ${config.model_reasoning_effort}`);
console.log(`   Display format: ${getModelWithReasoning(config)}`);
console.log();

// Test 2: Approval policy display
console.log('2. Approval Policy:');
console.log(`   Raw: ${config.approval_policy}`);
console.log(`   Display: ${getApprovalPolicyDisplay(config)}`);
console.log();

// Test 3: MCP server status
console.log('3. MCP Server Status:');
const mcpStatus = getMcpStatusSummary(config);
console.log(`   Total: ${mcpStatus.total}`);
console.log(`   Running: ${mcpStatus.running}`);
console.log(`   Stopped: ${mcpStatus.stopped}`);
console.log(`   Error: ${mcpStatus.error}`);
console.log(`   Display: ${formatMcpStatus(mcpStatus)}`);
console.log();

// Test 4: Full config dump
console.log('4. Full Config:');
console.log(JSON.stringify(config, null, 2));
