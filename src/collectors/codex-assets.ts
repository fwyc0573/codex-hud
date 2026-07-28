/**
 * Collect effective Codex skills and hooks without starting app-server.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CodexConfig } from '../types.js';

export interface CodexAssetCounts {
  skillsCount: number;
  hooksCount: number;
}

export interface CodexAssetCollectionOptions {
  forceRefresh?: boolean;
}

const ASSET_CACHE_TTL_MS = 5000;
const assetCache = new Map<string, { checkedAt: number; counts: CodexAssetCounts }>();

type AssetEnvironment = NodeJS.ProcessEnv;

interface SkillManifest {
  name: string;
  enabled: boolean;
}

function canonicalPath(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function existingDirectory(candidate: string | undefined): string | null {
  if (!candidate) return null;
  try {
    return fs.statSync(candidate).isDirectory() ? candidate : null;
  } catch {
    return null;
  }
}

function existingFile(candidate: string | undefined): string | null {
  if (!candidate) return null;
  try {
    return fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function ancestorDirectories(cwd: string): string[] {
  const directories: string[] = [];
  let current = path.resolve(cwd);
  while (true) {
    directories.push(current);
    if (fs.existsSync(path.join(current, '.git'))) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories;
}

function parseScalar(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseSkillManifest(filePath: string): SkillManifest | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;

  let name = '';
  let enabled = true;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf(':') >= 0 ? ':' : '=';
    const index = line.indexOf(separator);
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    const value = parseScalar(line.slice(index + 1));
    if (key === 'name') {
      name = value;
    } else if (key === 'enabled') {
      if (value === 'true') enabled = true;
      else if (value === 'false') enabled = false;
      else return null;
    }
  }

  if (!name) return null;
  return { name, enabled };
}

function skillFiles(root: string): string[] {
  const files: string[] = [];
  const visited = new Set<string>();
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop() as string;
    const resolved = canonicalPath(current);
    if (visited.has(resolved)) continue;
    visited.add(resolved);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.name === 'SKILL.md') {
        files.push(entryPath);
        continue;
      }
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        if (existingDirectory(entryPath)) pending.push(entryPath);
      }
    }
  }

  return files;
}

function collectSkillCount(roots: string[]): number {
  const seen = new Set<string>();
  let count = 0;
  for (const root of roots) {
    if (!existingDirectory(root)) continue;
    for (const filePath of skillFiles(root)) {
      const key = canonicalPath(filePath);
      if (seen.has(key)) continue;
      seen.add(key);
      const manifest = parseSkillManifest(filePath);
      if (manifest?.enabled) count++;
    }
  }
  return count;
}

function hookIdentity(eventName: string, entry: Record<string, unknown>): string {
  const identity = entry.sourcePath ?? entry.path ?? entry.command ?? entry.script ?? entry.handler ?? entry.handlerType;
  return `${eventName}:${typeof identity === 'string' ? identity : JSON.stringify(identity ?? entry)}`;
}

function looksLikeHookEntry(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.some((key) => [
    'command', 'script', 'handler', 'handlerType', 'source', 'sourcePath',
    'path', 'executable', 'url', 'name', 'type',
  ].includes(key));
}

function collectHookEntries(value: unknown, eventName: string, output: Array<{ eventName: string; entry: Record<string, unknown> }>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (looksLikeHookEntry(item)) output.push({ eventName, entry: item });
      else collectHookEntries(item, eventName, output);
    }
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'hooks') collectHookEntries(child, eventName, output);
    else collectHookEntries(child, key, output);
  }
}

function collectHookCount(files: string[]): number {
  const seenFiles = new Set<string>();
  const seenEntries = new Set<string>();
  let count = 0;

  for (const filePath of files) {
    const existing = existingFile(filePath);
    if (!existing) continue;
    const canonical = canonicalPath(existing);
    if (seenFiles.has(canonical)) continue;
    seenFiles.add(canonical);

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(existing, 'utf8'));
    } catch {
      continue;
    }

    const entries: Array<{ eventName: string; entry: Record<string, unknown> }> = [];
    collectHookEntries(parsed, '', entries);
    for (const { eventName, entry } of entries) {
      if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') continue;
      if (entry.enabled === false) continue;
      const key = hookIdentity(eventName, entry);
      if (seenEntries.has(key)) continue;
      seenEntries.add(key);
      count++;
    }
  }
  return count;
}

function resolveOptionalRoot(env: AssetEnvironment, key: string): string | null {
  const value = env[key];
  if (!value) return null;
  return existingDirectory(value) ?? existingFile(value);
}

/**
 * Count enabled skills and hooks for the current cwd and configured scopes.
 */
export function collectCodexAssetCounts(
  cwd: string,
  env: AssetEnvironment = process.env,
  config?: CodexConfig,
  options: CodexAssetCollectionOptions = {}
): CodexAssetCounts {
  const cacheKey = JSON.stringify({
    cwd: path.resolve(cwd),
    codexHome: env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    systemSkills: env.CODEX_SYSTEM_SKILLS_DIR || null,
    adminSkills: env.CODEX_ADMIN_SKILLS_DIR || null,
    systemHooks: env.CODEX_SYSTEM_HOOKS_FILE || null,
    adminHooks: env.CODEX_ADMIN_HOOKS_FILE || null,
    hooksEnabled: config?.hooks !== false,
  });
  const now = Date.now();
  const cached = assetCache.get(cacheKey);
  if (!options.forceRefresh && cached && now - cached.checkedAt < ASSET_CACHE_TTL_MS) {
    return cached.counts;
  }

  const ancestors = ancestorDirectories(cwd);
  const skillsRoots: string[] = [];
  const hooksFiles: string[] = [];

  const codexHome = env.CODEX_HOME || path.join(os.homedir(), '.codex');
  skillsRoots.push(path.join(codexHome, 'skills'));
  hooksFiles.push(path.join(codexHome, 'hooks.json'));

  for (const directory of ancestors) {
    skillsRoots.push(path.join(directory, '.agents', 'skills'));
    skillsRoots.push(path.join(directory, '.codex', 'skills'));
    hooksFiles.push(path.join(directory, '.agents', 'hooks.json'));
    hooksFiles.push(path.join(directory, '.codex', 'hooks.json'));
  }

  for (const [envKey, roots] of [
    ['CODEX_SYSTEM_SKILLS_DIR', skillsRoots],
    ['CODEX_ADMIN_SKILLS_DIR', skillsRoots],
  ] as const) {
    const root = resolveOptionalRoot(env, envKey);
    if (root) roots.push(root);
  }
  for (const key of ['CODEX_SYSTEM_HOOKS_FILE', 'CODEX_ADMIN_HOOKS_FILE']) {
    const file = resolveOptionalRoot(env, key);
    if (file) hooksFiles.push(file);
  }

  const counts = {
    skillsCount: collectSkillCount(skillsRoots),
    hooksCount: config?.hooks === false ? 0 : collectHookCount(hooksFiles),
  };
  assetCache.set(cacheKey, { checkedAt: now, counts });
  return counts;
}

export function invalidateCodexAssetCache(): void {
  assetCache.clear();
}
