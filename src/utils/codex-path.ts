import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function resolveExistingDirectory(candidate?: string): string | null {
  if (!candidate) {
    return null;
  }

  try {
    if (!fs.existsSync(candidate)) {
      return null;
    }

    const resolved = fs.realpathSync(candidate);
    const stats = fs.statSync(resolved);
    if (stats.isDirectory()) {
      return resolved;
    }
  } catch {
    // ignore resolution errors
  }

  return null;
}

function resolveDirectoryPath(candidate: string, label: string): string {
  const resolved = path.resolve(candidate);

  try {
    if (!fs.existsSync(resolved)) {
      return resolved;
    }

    const realPath = fs.realpathSync(resolved);
    const stats = fs.statSync(realPath);
    if (!stats.isDirectory()) {
      throw new Error(`${label} (${candidate}) exists but is not a directory.`);
    }

    return realPath;
  } catch (error) {
    if (error instanceof Error && error.message.includes('is not a directory')) {
      throw error;
    }

    throw new Error(`Unable to resolve ${label} (${candidate}): ${error}`);
  }
}

export function getCodexHome(): string {
  if (process.env.CODEX_HOME) {
    return resolveDirectoryPath(process.env.CODEX_HOME, 'CODEX_HOME');
  }

  const defaultHome = path.join(os.homedir(), '.codex');
  const candidates = [defaultHome, path.join(os.homedir(), '.codex_home')];

  for (const candidate of candidates) {
    const resolved = resolveExistingDirectory(candidate);
    if (resolved) {
      return resolved;
    }
  }

  return defaultHome;
}

export function getSessionsDir(): string {
  if (process.env.CODEX_SESSIONS_PATH) {
    const overridePath = resolveExistingDirectory(process.env.CODEX_SESSIONS_PATH);
    if (!overridePath) {
      throw new Error(
        `CODEX_SESSIONS_PATH (${process.env.CODEX_SESSIONS_PATH}) does not exist or is not a directory.`
      );
    }
    return overridePath;
  }

  const home = getCodexHome();
  const sessionsDir = path.join(home, 'sessions');
  const resolved = resolveExistingDirectory(sessionsDir);
  if (resolved) {
    return resolved;
  }

  return sessionsDir;
}
