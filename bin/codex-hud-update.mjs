#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const CURL_TIMEOUT_SECONDS = 10;
const CURL_CONNECT_TIMEOUT_SECONDS = 5;
const RELEASE_API_URL = 'https://api.github.com/repos/fwyc0573/codex-hud/releases/latest';
const HOOK_MARKER = 'codex-hud-update-hook-v2';
const STATE_SCHEMA_VERSION = 1;
const SESSION_SCHEMA_VERSION = 3;
const STATE_KEYS = [
  'schema_version',
  'checkout_path',
  'last_checked_at',
  'last_seen_latest',
  'last_check_error',
  'declined_version',
  'pending_update',
];
const RELEASE_KEYS = ['version', 'release_url'];
const PENDING_KEYS = ['target_version', 'release_url', 'scheduled_at'];
const SESSION_KEYS = [
  'schema_version',
  'session_name',
  'tmux_socket',
  'checkout_id',
  'checkout_path',
  'registered_at',
  'launch_path',
  'upgrade_command',
];

function stableVersionParts(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);
  if (!match) return null;
  return match.slice(1);
}

export function parseStableVersion(value) {
  const parts = stableVersionParts(value);
  if (!parts) return null;
  return {
    major: Number(parts[0]),
    minor: Number(parts[1]),
    patch: Number(parts[2]),
    normalized: `v${parts.join('.')}`,
  };
}

export function compareVersions(left, right) {
  const leftParts = stableVersionParts(left);
  const rightParts = stableVersionParts(right);
  if (!leftParts || !rightParts) {
    throw new Error('compareVersions requires stable MAJOR.MINOR.PATCH values');
  }
  for (let index = 0; index < leftParts.length; index += 1) {
    const a = BigInt(leftParts[index]);
    const b = BigInt(rightParts[index]);
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

function runGitCommand(cwd, args) {
  const commandMap = {
    worktree: ['rev-parse', '--is-inside-work-tree'],
    'symbolic-ref': ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    upstream: ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    status: ['status', '--porcelain', '--untracked-files=all'],
    default: ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
  };
  const actualArgs = commandMap[args[0]] ?? args;
  return execFileSync('git', ['-C', cwd, ...actualArgs], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function resolveDefaultBranch(cwd, runGit = (args) => runGitCommand(cwd, args)) {
  try {
    const remoteHead = runGit(['default']);
    if (remoteHead.startsWith('origin/')) return remoteHead.slice('origin/'.length);
    if (/^[A-Za-z0-9._/-]+$/.test(remoteHead) && remoteHead.length > 0) return remoteHead;
  } catch {
    // A repository without origin/HEAD uses the documented main default.
  }
  return 'main';
}

export function selectNearestStableTag(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return null;
  let tags;
  try {
    tags = execFileSync('git', ['-C', cwd, 'tag', '--merged', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .split(/\r?\n/)
      .map((tag) => tag.trim())
      .filter((tag) => parseStableVersion(tag));
  } catch {
    return null;
  }

  const candidates = [];
  for (const tag of tags) {
    let distance;
    try {
      distance = Number(
        execFileSync('git', ['-C', cwd, 'rev-list', '--count', `${tag}..HEAD`], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim(),
      );
    } catch {
      continue;
    }
    if (!Number.isSafeInteger(distance) || distance < 0) continue;
    candidates.push({ tag, version: parseStableVersion(tag), distance });
  }
  candidates.sort((left, right) => {
    if (left.distance !== right.distance) return left.distance - right.distance;
    return compareVersions(right.version.normalized, left.version.normalized);
  });
  return candidates[0] ?? null;
}

function canonicalCheckoutPath(checkoutPath) {
  return realpathSync(checkoutPath);
}

function base64Url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function checkoutIdIsSafe(checkoutId) {
  return typeof checkoutId === 'string'
    && checkoutId.length > 0
    && checkoutId.length <= 4096
    && /^[A-Za-z0-9_-]+$/.test(checkoutId);
}

export function resolveStatePaths(checkoutPath, env = process.env, platform = process.platform) {
  const canonical = canonicalCheckoutPath(checkoutPath);
  const stateRoot = resolveStateRoot(env, platform);
  const checkoutId = base64Url(canonical);
  return {
    checkoutPath: canonical,
    stateRoot,
    stateFile: join(stateRoot, `checkout-${checkoutId}.json`),
    registryRoot: join(stateRoot, 'sessions'),
    logFile: join(stateRoot, 'update.log'),
    lockFile: join(stateRoot, `checkout-${checkoutId}.lock`),
    checkoutId,
    platform,
  };
}

export function resolveStateRoot(env = process.env, platform = process.platform) {
  const home = env.HOME || homedir();
  let configuredRoot;
  if (env.XDG_STATE_HOME) {
    configuredRoot = resolve(env.XDG_STATE_HOME);
  } else if (platform === 'darwin') {
    configuredRoot = join(home, 'Library', 'Application Support');
  } else if (platform === 'win32') {
    configuredRoot = resolve(env.LOCALAPPDATA || join(home, 'AppData', 'Local'));
  } else {
    configuredRoot = join(home, '.local', 'state');
  }
  return join(configuredRoot, 'codex-hud');
}

export function createEmptyState(checkoutPath) {
  return {
    schema_version: STATE_SCHEMA_VERSION,
    checkout_path: canonicalCheckoutPath(checkoutPath),
    last_checked_at: null,
    last_seen_latest: null,
    last_check_error: null,
    declined_version: null,
    pending_update: null,
  };
}

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has an incompatible schema`);
  }
}

function assertIsoOrNull(value, label) {
  if (value === null) return;
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    || !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`${label} must be an ISO timestamp or null`);
  }
}

function assertStableOrNull(value, label) {
  if (value !== null && !parseStableVersion(value)) {
    throw new Error(`${label} must be a stable semver value or null`);
  }
}

function validateReleaseShape(value, label) {
  if (value === null) return;
  assertExactKeys(value, RELEASE_KEYS, label);
  if (!parseStableVersion(value.version) || typeof value.release_url !== 'string' || !/^https:\/\//.test(value.release_url)) {
    throw new Error(`${label} contains invalid release metadata`);
  }
}

export function validateState(value, checkoutPath) {
  const canonical = canonicalCheckoutPath(checkoutPath);
  assertExactKeys(value, STATE_KEYS, 'update state');
  if (value.schema_version !== STATE_SCHEMA_VERSION) {
    throw new Error('update state has an incompatible schema version');
  }
  if (value.checkout_path !== canonical) {
    throw new Error('update state checkout path does not match the canonical checkout');
  }
  assertIsoOrNull(value.last_checked_at, 'last_checked_at');
  validateReleaseShape(value.last_seen_latest, 'last_seen_latest');
  if (value.last_check_error !== null && typeof value.last_check_error !== 'string') {
    throw new Error('last_check_error must be a string or null');
  }
  assertStableOrNull(value.declined_version, 'declined_version');
  if (value.pending_update === null) return value;
  assertExactKeys(value.pending_update, PENDING_KEYS, 'pending_update');
  if (
    !parseStableVersion(value.pending_update.target_version)
    || typeof value.pending_update.release_url !== 'string'
    || !/^https:\/\//.test(value.pending_update.release_url)
  ) {
    throw new Error('pending_update contains invalid release metadata');
  }
  assertIsoOrNull(value.pending_update.scheduled_at, 'pending_update.scheduled_at');
  return value;
}

export function writeStateAtomic(stateFile, state, stateRoot = dirname(stateFile)) {
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  chmodSync(stateRoot, 0o700);
  const tempFile = `${stateFile}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  writeFileSync(tempFile, serialized, { encoding: 'utf8', mode: 0o600 });
  chmodSync(tempFile, 0o600);
  renameSync(tempFile, stateFile);
  chmodSync(stateFile, 0o600);
}

function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

export function readState(paths, checkoutPath) {
  if (!existsSync(paths.stateFile)) return createEmptyState(checkoutPath);
  const parsed = JSON.parse(readFileSync(paths.stateFile, 'utf8'));
  return validateState(parsed, checkoutPath);
}

function loadState(paths, checkoutPath, writeOutput = () => {}) {
  if (!existsSync(paths.stateFile)) return { state: createEmptyState(checkoutPath), warning: null };
  try {
    return { state: readState(paths, checkoutPath), warning: null };
  } catch (error) {
    const state = createEmptyState(checkoutPath);
    try {
      writeStateAtomic(paths.stateFile, state, paths.stateRoot);
    } catch (writeError) {
      writeOutput(`[codex-hud] Warning: unable to reset update state: ${summarizeError(writeError)}`);
    }
    const warning = `update state was reset: ${summarizeError(error)}`;
    writeOutput(`[codex-hud] Warning: ${warning}`);
    return { state, warning };
  }
}

function sleepSync(milliseconds) {
  if (milliseconds <= 0) return;
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
}

export function acquireLock(lockFile, options = {}) {
  const timeoutMs = options.timeoutMs ?? 2000;
  const staleMs = options.staleMs ?? 10 * 60 * 1000;
  const pollMs = options.pollMs ?? 25;
  ensurePrivateDirectory(dirname(lockFile));
  const started = Date.now();
  while (true) {
    try {
      const descriptor = openSync(lockFile, 'wx', 0o600);
      writeFileSync(descriptor, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
      closeSync(descriptor);
      chmodSync(lockFile, 0o600);
      return () => {
        try {
          unlinkSync(lockFile);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner = null;
      let age = 0;
      try {
        const metadata = JSON.parse(readFileSync(lockFile, 'utf8'));
        owner = Number(metadata.pid);
        age = Date.now() - Date.parse(metadata.created_at);
        if (!Number.isFinite(age)) age = staleMs + 1;
      } catch {
        age = staleMs + 1;
      }
      let alive = false;
      if (Number.isInteger(owner) && owner > 0) {
        try {
          process.kill(owner, 0);
          alive = true;
        } catch (probeError) {
          alive = probeError.code === 'EPERM';
        }
      }
      if (!alive && age >= staleMs) {
        try {
          unlinkSync(lockFile);
        } catch (unlinkError) {
          if (unlinkError.code !== 'ENOENT') throw unlinkError;
        }
        continue;
      }
      if (Date.now() - started >= timeoutMs) {
        throw new Error('update state lock is busy');
      }
      sleepSync(pollMs);
    }
  }
}

function withLock(lockFile, callback, options = {}) {
  const release = acquireLock(lockFile, options);
  try {
    return callback();
  } finally {
    release();
  }
}

function summarizeError(error) {
  if (!error) return 'unknown error';
  const text = [error.message, error.stderr, error.stdout].filter(Boolean).join(' | ');
  return text.replace(/\s+/g, ' ').trim().slice(0, 2000) || String(error);
}

export function shouldCheckNow(lastCheckedAt, nowMs = Date.now(), intervalMs = CHECK_INTERVAL_MS) {
  if (lastCheckedAt === null || lastCheckedAt === undefined) return true;
  const lastMs = Date.parse(lastCheckedAt);
  if (!Number.isFinite(lastMs)) return true;
  return nowMs - lastMs >= intervalMs;
}

function updateCheckDisabled(env) {
  const value = String(env.CODEX_HUD_UPDATE_CHECK ?? '').trim().toLowerCase();
  return value === '0' || value === 'false';
}

function defaultReadInput() {
  const buffer = Buffer.alloc(4096);
  const bytes = readSync(0, buffer, 0, buffer.length, null);
  return buffer.subarray(0, bytes).toString('utf8').split(/\r?\n/, 1)[0];
}

function askForConfirmation(options) {
  const readInput = options.readInput || defaultReadInput;
  while (true) {
    const answer = String(readInput() ?? '').trim();
    if (answer === '' || answer === 'y' || answer === 'Y') return true;
    if (answer === 'n' || answer === 'N') return false;
    (options.writeOutput || console.log)('[codex-hud] Please answer y or n.');
  }
}

function outputLine(options, line) {
  (options.writeOutput || console.log)(line);
}

function releaseIsNewerThan(version, other) {
  return compareVersions(version, other) > 0;
}

function stateRelease(state) {
  if (!state.last_seen_latest) return null;
  return state.last_seen_latest;
}

function writeCheckedState(paths, state) {
  writeStateAtomic(paths.stateFile, state, paths.stateRoot);
}

export function checkForUpdate(options = {}) {
  const env = options.env || process.env;
  if (updateCheckDisabled(env)) return { status: 'disabled' };
  const checkoutPath = canonicalCheckoutPath(options.checkoutPath || process.cwd());
  const paths = options.paths || resolveStatePaths(checkoutPath, env, options.platform || process.platform);
  const writeOutput = options.writeOutput || console.log;
  const nowMs = options.nowMs ?? Date.now();
  const nowIso = options.nowIso || new Date(nowMs).toISOString();
  const localCandidate = options.localVersion
    || (options.selectTag ? options.selectTag(checkoutPath) : selectNearestStableTag(checkoutPath));
  const localVersion = typeof localCandidate === 'string'
    ? parseStableVersion(localCandidate)
    : localCandidate?.version;
  if (!localVersion || !parseStableVersion(localVersion.normalized || localVersion)) {
    outputLine(options, '[codex-hud] Update check skipped: local stable version is unknown.');
    return { status: 'unknown-local-version' };
  }
  const localNormalized = localVersion.normalized || parseStableVersion(localVersion).normalized;

  let result;
  try {
    result = withLock(paths.lockFile, () => {
      const loaded = loadState(paths, checkoutPath, writeOutput);
      const state = loaded.state;
      const due = shouldCheckNow(state.last_checked_at, nowMs, options.intervalMs ?? CHECK_INTERVAL_MS);
      let release = stateRelease(state);
      if (due) {
        state.last_checked_at = nowIso;
        // Persist before the request so every real attempt consumes the throttle window.
        writeCheckedState(paths, state);
        try {
          const fetcher = options.fetchRelease || ((fetchOptions) => fetchLatestRelease(fetchOptions));
          release = fetcher({
            endpoint: options.endpoint || RELEASE_API_URL,
            curlPath: options.curlPath,
            timeoutSeconds: options.timeoutSeconds,
            connectTimeoutSeconds: options.connectTimeoutSeconds,
          });
          release = normalizeReleaseResult(release);
          state.last_seen_latest = release;
          state.last_check_error = null;
          writeCheckedState(paths, state);
        } catch (error) {
          state.last_check_error = summarizeError(error);
          writeCheckedState(paths, state);
          outputLine(options, `[codex-hud] Warning: update check failed: ${state.last_check_error}`);
          return { status: 'check-failed', error: state.last_check_error };
        }
      }
      if (!release || !parseStableVersion(release.version)) {
        return { status: due ? 'no-release' : 'throttled' };
      }
      if (!releaseIsNewerThan(release.version, localNormalized)) {
        if (state.declined_version !== null) {
          state.declined_version = null;
          writeCheckedState(paths, state);
        }
        return { status: 'up-to-date', local_version: localNormalized, latest_version: release.version };
      }
      if (state.pending_update) {
        outputLine(options, `[codex-hud] Update already scheduled for ${state.pending_update.target_version}; log: ${paths.logFile}`);
        return { status: 'already-scheduled', pending: state.pending_update };
      }
      if (state.declined_version && compareVersions(release.version, state.declined_version) <= 0) {
        return { status: 'declined-suppressed', latest_version: release.version };
      }
      if (state.declined_version) {
        state.declined_version = null;
        writeCheckedState(paths, state);
      }
      const interactive = options.isInteractive ?? (Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY));
      if (!interactive) {
        outputLine(options, '[codex-hud] Non-interactive session; update was not scheduled.');
        return { status: 'non-interactive', latest_version: release.version };
      }
      const prompt = `[codex-hud] Update available: ${localNormalized} → ${release.version}. Update after this session exits? [Y/n]`;
      outputLine(options, prompt);
      const confirmed = askForConfirmation(options);
      if (!confirmed) {
        state.declined_version = release.version;
        writeCheckedState(paths, state);
        outputLine(options, `[codex-hud] Update declined for ${release.version}.`);
        return { status: 'declined', latest_version: release.version };
      }
      state.pending_update = {
        target_version: release.version,
        release_url: release.release_url,
        scheduled_at: nowIso,
      };
      state.declined_version = null;
      writeCheckedState(paths, state);
      outputLine(options, '[codex-hud] Update accepted; scheduling will complete after this session starts.');
      return { status: 'accepted', pending: state.pending_update, log_file: paths.logFile };
    }, options.lockOptions);
  } catch (error) {
    outputLine(options, `[codex-hud] Warning: update check skipped: ${summarizeError(error)}`);
    result = { status: 'lock-or-state-error', error: summarizeError(error) };
  }
  return result;
}

export function shellQuoteSingle(value) {
  if (typeof value !== 'string') throw new TypeError('shellQuoteSingle requires a string');
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function parseReleasePayload(payload) {
  let value = payload;
  if (typeof payload === 'string') {
    try {
      value = JSON.parse(payload);
    } catch (error) {
      throw new Error(`GitHub release response is not valid JSON: ${error.message}`);
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('GitHub release response must be an object');
  }
  if (value.draft !== false || value.prerelease !== false) {
    throw new Error('GitHub release is draft or prerelease');
  }
  const parsed = parseStableVersion(value.tag_name);
  if (!parsed) throw new Error('GitHub release tag is not stable semver');
  if (typeof value.html_url !== 'string' || !/^https:\/\//.test(value.html_url)) {
    throw new Error('GitHub release metadata has no valid html_url');
  }
  return { version: parsed.normalized, release_url: value.html_url };
}

function normalizeReleaseResult(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)
      && Object.hasOwn(value, 'version') && Object.hasOwn(value, 'release_url')
      && !Object.hasOwn(value, 'tag_name')) {
    const parsed = parseStableVersion(value.version);
    if (!parsed || typeof value.release_url !== 'string' || !/^https:\/\//.test(value.release_url)) {
      throw new Error('release fetcher returned invalid normalized metadata');
    }
    return { version: parsed.normalized, release_url: value.release_url };
  }
  return parseReleasePayload(value);
}

export function buildCurlArgs(url = RELEASE_API_URL, options = {}) {
  const timeout = String(options.timeoutSeconds ?? CURL_TIMEOUT_SECONDS);
  const connectTimeout = String(options.connectTimeoutSeconds ?? CURL_CONNECT_TIMEOUT_SECONDS);
  const userAgent = options.userAgent || 'codex-hud-update-check/1';
  return [
    '--fail',
    '--silent',
    '--show-error',
    '--location',
    '--connect-timeout',
    connectTimeout,
    '--max-time',
    timeout,
    '--user-agent',
    userAgent,
    '--header',
    'Accept: application/vnd.github+json',
    '--header',
    'X-GitHub-Api-Version: 2022-11-28',
    url,
  ];
}

export function fetchLatestRelease(options = {}) {
  const endpoint = options.endpoint || RELEASE_API_URL;
  const args = buildCurlArgs(endpoint, options);
  const raw = options.runCurl
    ? options.runCurl(args)
    : execFileSync(options.curlPath || 'curl', args, {
      encoding: 'utf8',
      timeout: Number(options.timeoutSeconds ?? CURL_TIMEOUT_SECONDS) * 1000 + 1000,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  return parseReleasePayload(raw);
}

export function evaluateUpgradeGuards(cwd, runGit = (args) => runGitCommand(cwd, args)) {
  let branch;
  let upstream;
  let status;
  let defaultRef;
  try {
    if (runGit(['worktree']) !== 'true') return { ok: false, reason: 'not-a-git-checkout' };
  } catch {
    return { ok: false, reason: 'not-a-git-checkout' };
  }
  try {
    branch = runGit(['symbolic-ref']);
  } catch {
    return { ok: false, reason: 'detached-head' };
  }
  try {
    upstream = runGit(['upstream']);
  } catch {
    return { ok: false, reason: 'missing-upstream' };
  }
  try {
    status = runGit(['status']);
  } catch {
    return { ok: false, reason: 'not-a-git-checkout' };
  }
  try {
    defaultRef = runGit(['default']);
  } catch {
    defaultRef = '';
  }
  if (!branch || branch === 'HEAD') return { ok: false, reason: 'detached-head' };
  const defaultBranch = resolveDefaultBranch(cwd, () => defaultRef);
  if (upstream !== `origin/${branch}` || branch !== defaultBranch) {
    return { ok: false, reason: 'branch-or-upstream-not-default' };
  }
  if (status.trim() !== '') return { ok: false, reason: 'dirty-worktree' };
  return { ok: true, reason: null };
}

function runTmuxCommand(args, options = {}) {
  if (options.tmux) return options.tmux(args, options);
  const tmuxSocket = options.tmuxSocket;
  const socketArgs = tmuxSocket
    ? [tmuxSocket.startsWith('/') ? '-S' : '-L', tmuxSocket]
    : [];
  return execFileSync(options.tmuxPath || process.env.TMUX_BIN || 'tmux', [...socketArgs, ...args], {
    encoding: 'utf8',
    env: options.env ? { ...process.env, ...options.env } : undefined,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function resolveTmuxSocket(options = {}) {
  const explicit = options.tmuxSocket;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  const tmux = options.env?.TMUX ?? process.env.TMUX;
  if (typeof tmux === 'string' && tmux.length > 0) {
    const socket = tmux.split(',')[0];
    if (socket.length > 0) return socket;
  }
  // Wrapper-created sessions outside tmux use the default server socket. A
  // nested launch carries its owning absolute socket through TMUX instead.
  return 'default';
}

function tmuxSocketIsSafe(socket) {
  return typeof socket === 'string'
    && socket.length > 0
    && socket.length <= 4096
    && !/[\u0000\r\n]/.test(socket);
}

function sessionNameIsSafe(sessionName) {
  return typeof sessionName === 'string'
    && sessionName.length > 0
    && sessionName.length <= 256
    && /^[A-Za-z0-9._:@%+=,-]+$/.test(sessionName);
}

function sessionFilePath(paths, sessionName) {
  if (!checkoutIdIsSafe(paths.checkoutId)) throw new Error('checkout ID is invalid');
  return join(paths.registryRoot, `session-${paths.checkoutId}-${base64Url(sessionName)}.json`);
}

function createSessionRecord(sessionName, paths, launchPath, upgradeCommand, registeredAt, tmuxSocket) {
  return {
    schema_version: SESSION_SCHEMA_VERSION,
    session_name: sessionName,
    tmux_socket: tmuxSocket,
    checkout_id: paths.checkoutId,
    checkout_path: paths.checkoutPath,
    registered_at: registeredAt,
    launch_path: launchPath,
    upgrade_command: upgradeCommand,
  };
}

function validateSessionRecord(value, paths) {
  assertExactKeys(value, SESSION_KEYS, 'session registry record');
  if (value.schema_version !== SESSION_SCHEMA_VERSION) throw new Error('session registry schema version is incompatible');
  if (!sessionNameIsSafe(value.session_name)) throw new Error('session registry session name is invalid');
  if (!tmuxSocketIsSafe(value.tmux_socket)) throw new Error('session registry tmux socket is invalid');
  if (value.checkout_id !== paths.checkoutId) throw new Error('session registry checkout ID does not match');
  if (value.checkout_path !== paths.checkoutPath) throw new Error('session registry checkout path does not match');
  assertIsoOrNull(value.registered_at, 'registered_at');
  if (typeof value.registered_at !== 'string') throw new Error('registered_at must be an ISO timestamp');
  if (typeof value.launch_path !== 'string') throw new Error('launch_path must be a string');
  if (typeof value.upgrade_command !== 'string' || resolve(value.upgrade_command) !== value.upgrade_command) {
    throw new Error('upgrade_command must be an absolute path');
  }
  return value;
}

function writeSessionAtomic(file, record, root) {
  ensurePrivateDirectory(root);
  const temporary = `${file}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
  chmodSync(file, 0o600);
}

function sessionExists(sessionName, options = {}) {
  try {
    runTmuxCommand(['has-session', '-t', sessionName], options);
    return true;
  } catch {
    return false;
  }
}

function listSessionRecords(paths) {
  if (!existsSync(paths.registryRoot)) return [];
  const records = [];
  const prefix = `session-${paths.checkoutId}-`;
  for (const name of readdirSync(paths.registryRoot)) {
    if (!name.startsWith(prefix) || !name.endsWith('.json')) continue;
    const file = join(paths.registryRoot, name);
    try {
      const record = validateSessionRecord(JSON.parse(readFileSync(file, 'utf8')), paths);
      records.push({ file, record });
    } catch {
      try {
        unlinkSync(file);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  return records;
}

export function ensureGlobalSessionClosedHook(options = {}) {
  const checkoutId = options.paths?.checkoutId || options.checkoutId;
  if (!checkoutIdIsSafe(checkoutId)) throw new Error('checkout ID is required for hook registration');
  const marker = `${HOOK_MARKER}:${checkoutId}`;
  const tmux = options.tmux || ((args) => runTmuxCommand(args, options));
  const output = String(tmux(['show-hooks', '-g']) || '');
  const markerLine = output.split(/\r?\n/).find((line) => line.includes(`${marker};`));
  if (markerLine) {
    const match = markerLine.match(/^session-closed\[(\d+)\]/);
    return { installed: false, slot: match ? Number(match[1]) : null };
  }
  const used = new Set();
  for (const match of output.matchAll(/^session-closed\[(\d+)\]/gm)) used.add(Number(match[1]));
  let slot = 1000;
  while (used.has(slot)) slot += 1;
  const nodePath = options.nodePath || process.execPath;
  const helperPath = options.helperPath || fileURLToPath(import.meta.url);
  const dispatch = [
    'nohup',
    shellQuoteSingle(nodePath),
    shellQuoteSingle(helperPath),
    'session-closed',
    '"#{hook_session_name}"',
    '--tmux-socket',
    '"#{socket_path}"',
    '--checkout-id',
    shellQuoteSingle(checkoutId),
    '</dev/null',
    '>/dev/null',
    '2>&1',
    '&',
  ].join(' ');
  const hookCommand = `run-shell ${shellQuoteSingle(`: ${marker}; ${dispatch}`)}`;
  tmux(['set-hook', '-g', `session-closed[${slot}]`, hookCommand]);
  return { installed: true, slot, command: hookCommand, marker };
}

export function removeGlobalSessionClosedHooks(options = {}) {
  const tmux = options.tmux || ((args) => runTmuxCommand(args, options));
  const output = String(tmux(['show-hooks', '-g']) || '');
  let removed = 0;
  for (const line of output.split(/\r?\n/)) {
    const marker = options.checkoutId ? `${HOOK_MARKER}:${options.checkoutId};` : `${HOOK_MARKER}:`;
    if (!line.includes(marker)) continue;
    const match = line.match(/^session-closed\[(\d+)\]/);
    if (!match) continue;
    tmux(['set-hook', '-gu', `session-closed[${match[1]}]`]);
    removed += 1;
  }
  return removed;
}

export function registerSession(options = {}) {
  const env = options.env || process.env;
  const sessionName = options.sessionName;
  if (!sessionNameIsSafe(sessionName)) return { status: 'invalid-session-name' };
  const checkoutPath = canonicalCheckoutPath(options.checkoutPath || process.cwd());
  const paths = options.paths || resolveStatePaths(checkoutPath, env, options.platform || process.platform);
  return withLock(paths.lockFile, () => {
    const loaded = loadState(paths, checkoutPath, options.writeOutput || console.log);
    const registeredAt = options.registeredAt || new Date(options.nowMs ?? Date.now()).toISOString();
    const upgradeCommand = resolve(
      options.upgradeCommand || join(dirname(fileURLToPath(import.meta.url)), 'codex-hud-upgrade'),
    );
    const tmuxSocket = resolveTmuxSocket(options);
    const record = createSessionRecord(
      sessionName,
      paths,
      options.launchPath ?? env.PATH ?? '',
      upgradeCommand,
      registeredAt,
      tmuxSocket,
    );
    const file = sessionFilePath(paths, sessionName);
    writeSessionAtomic(file, record, paths.registryRoot);
    if (!loaded.state.pending_update) return { status: 'registered', file, record, pending: false };
    try {
      const ensureHook = options.ensureHook || ((hookOptions) => ensureGlobalSessionClosedHook(hookOptions));
      ensureHook({
        env,
        checkoutPath,
        paths,
        tmux: options.tmux,
        tmuxPath: options.tmuxPath,
        nodePath: options.nodePath,
        helperPath: options.helperPath,
        tmuxSocket,
      });
    } catch (error) {
      const summary = summarizeError(error);
      try {
        unlinkSync(file);
      } catch (unlinkError) {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
      }
      loaded.state.pending_update = null;
      writeCheckedState(paths, loaded.state);
      (options.writeOutput || console.log)(`[codex-hud] Warning: unable to schedule deferred update: ${summary}`);
      return { status: 'hook-registration-failed', file, record, error: summary };
    }
    (options.writeOutput || console.log)(`[codex-hud] Update scheduled after this session exits. Log: ${paths.logFile}`);
    return { status: 'registered', file, record, pending: true };
  }, options.lockOptions);
}

export function abortSession(options = {}) {
  const env = options.env || process.env;
  const sessionName = options.sessionName;
  if (!sessionNameIsSafe(sessionName)) return { status: 'invalid-session-name' };
  const checkoutPath = canonicalCheckoutPath(options.checkoutPath || process.cwd());
  const paths = options.paths || resolveStatePaths(checkoutPath, env, options.platform || process.platform);
  return withLock(paths.lockFile, () => {
    const file = sessionFilePath(paths, sessionName);
    let removed = false;
    try {
      unlinkSync(file);
      removed = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const loaded = loadState(paths, checkoutPath, options.writeOutput || console.log);
    const remaining = listSessionRecords(paths);
    let pendingCleared = false;
    if (remaining.length === 0 && loaded.state.pending_update) {
      loaded.state.pending_update = null;
      writeCheckedState(paths, loaded.state);
      pendingCleared = true;
    }
    return {
      status: removed ? 'aborted' : 'not-found',
      file,
      pending_cleared: pendingCleared,
    };
  }, options.lockOptions);
}

function appendUpdateLog(paths, entry) {
  ensurePrivateDirectory(paths.stateRoot);
  appendFileSync(paths.logFile, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(paths.logFile, 0o600);
}

function restoreClaim(claimFile, originalFile) {
  try {
    renameSync(claimFile, originalFile);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export function handleSessionClosed(options = {}) {
  const env = options.env || process.env;
  const sessionName = options.sessionName;
  if (!sessionNameIsSafe(sessionName)) return { status: 'invalid-session-name' };
  const checkoutId = options.checkoutId || options.paths?.checkoutId;
  if (!checkoutIdIsSafe(checkoutId)) return { status: 'invalid-checkout-id' };
  const registryRoot = options.registryRoot
    || options.paths?.registryRoot
    || join(resolveStateRoot(env, options.platform || process.platform), 'sessions');
  const originalFile = sessionFilePath({ registryRoot, checkoutId }, sessionName);
  if (!existsSync(originalFile)) return { status: 'not-found' };
  const tmuxOptions = { tmux: options.tmux, tmuxPath: options.tmuxPath, env };
  const claimFile = `${originalFile}.claim-${process.pid}-${Math.random().toString(16).slice(2)}`;
  try {
    renameSync(originalFile, claimFile);
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'not-found' };
    throw error;
  }
  let record;
  try {
    record = JSON.parse(readFileSync(claimFile, 'utf8'));
  } catch (error) {
    try { unlinkSync(claimFile); } catch (unlinkError) { if (unlinkError.code !== 'ENOENT') throw unlinkError; }
    return { status: 'invalid-record', error: summarizeError(error) };
  }
  let checkoutPath;
  let paths;
  try {
    checkoutPath = canonicalCheckoutPath(record.checkout_path);
    paths = options.paths || resolveStatePaths(checkoutPath, env, options.platform || process.platform);
    if (paths.checkoutId !== checkoutId) throw new Error('hook checkout ID does not match registry record');
    validateSessionRecord(record, paths);
  } catch (error) {
    try { unlinkSync(claimFile); } catch (unlinkError) { if (unlinkError.code !== 'ENOENT') throw unlinkError; }
    return { status: 'invalid-record', error: summarizeError(error) };
  }
  const recordTmuxOptions = { ...tmuxOptions, tmuxSocket: record.tmux_socket };
  if (sessionExists(record.session_name, recordTmuxOptions)) {
    restoreClaim(claimFile, originalFile);
    return { status: 'session-still-alive' };
  }
  const finish = (result) => {
    try { unlinkSync(claimFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return result;
  };
  try {
    return withLock(paths.lockFile, () => {
      const otherRecords = listSessionRecords(paths);
      let active = null;
      for (const candidate of otherRecords) {
        if (sessionExists(candidate.record.session_name, {
          ...tmuxOptions,
          tmuxSocket: candidate.record.tmux_socket,
        })) {
          active ||= candidate;
          continue;
        }
        try {
          unlinkSync(candidate.file);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      if (active) {
        restoreClaim(claimFile, originalFile);
        return { status: 'other-session-alive', session_name: active.record.session_name };
      }
      const loaded = loadState(paths, checkoutPath, options.writeOutput || console.log);
      const state = loaded.state;
      if (!state.pending_update) return finish({ status: 'no-pending' });
      const pending = state.pending_update;
      const now = options.now ? options.now() : new Date().toISOString();
      let result = { status: 'failed' };
      let errorSummary = null;
      try {
        const guards = options.evaluateGuards
          ? options.evaluateGuards(checkoutPath)
          : evaluateUpgradeGuards(checkoutPath, options.runGit);
        if (!guards.ok) throw new Error(`automatic update guard rejected: ${guards.reason}`);
        const upgradeCommand = options.upgradeCommand || record.upgrade_command;
        if (options.upgradeRunner) {
          options.upgradeRunner({ checkoutPath, upgradeCommand, launchPath: record.launch_path, target: pending });
        } else {
          execFileSync(upgradeCommand, [], {
            cwd: checkoutPath,
            env: { ...env, PATH: record.launch_path || env.PATH || '' },
            encoding: 'utf8',
            timeout: options.upgradeTimeoutMs ?? 30 * 60 * 1000,
            maxBuffer: 4 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        }
        const selected = options.selectTag
          ? options.selectTag(checkoutPath)
          : selectNearestStableTag(checkoutPath);
        const actualVersion = selected?.version?.normalized || (typeof selected?.version === 'string' ? selected.version : null);
        if (!actualVersion || compareVersions(actualVersion, pending.target_version) < 0) {
          throw new Error(`local stable version did not reach target ${pending.target_version}`);
        }
        result = { status: 'success', target_version: pending.target_version, actual_version: actualVersion };
      } catch (error) {
        errorSummary = summarizeError(error);
        result = { status: 'failed', error: errorSummary };
      }
      state.pending_update = null;
      writeCheckedState(paths, state);
      appendUpdateLog(paths, {
        timestamp: now,
        checkout_path: checkoutPath,
        target_version: pending.target_version,
        release_url: pending.release_url,
        result: result.status,
        actual_version: result.actual_version || null,
        error: errorSummary,
      });
      return finish(result);
    }, options.lockOptions);
  } catch (error) {
    restoreClaim(claimFile, originalFile);
    return { status: 'failed', error: summarizeError(error) };
  }
}

export {
  CHECK_INTERVAL_MS,
  CURL_CONNECT_TIMEOUT_SECONDS,
  CURL_TIMEOUT_SECONDS,
  HOOK_MARKER,
  RELEASE_API_URL,
  SESSION_SCHEMA_VERSION,
  STATE_SCHEMA_VERSION,
};

function parseCliArguments(argv) {
  const command = argv[0] || 'check';
  const options = { command };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (command === 'session-closed' && index === 1 && !argument.startsWith('-')) {
      options.session = argument;
      continue;
    }
    if (argument === '--checkout' || argument === '--checkout-id' || argument === '--session' || argument === '--upgrade-command' || argument === '--node-path' || argument === '--helper-path' || argument === '--tmux-socket') {
      options[argument.slice(2).replaceAll('-', '_')] = argv[++index];
    } else if (argument === '--platform') {
      options.platform = argv[++index];
    } else if (argument === '--tmux-path') {
      options.tmuxPath = argv[++index];
    } else if (argument === '--curl-path') {
      options.curlPath = argv[++index];
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown helper option: ${argument}`);
    }
  }
  return options;
}

function printCliHelp() {
  process.stdout.write(`Usage: codex-hud-update.mjs <check|register-session|abort-session|session-closed|remove-hooks> [options]\n\n`);
}

function main() {
  let options;
  try {
    options = parseCliArguments(process.argv.slice(2));
    if (options.help) {
      printCliHelp();
      return 0;
    }
    if (options.command === 'check') {
      const result = checkForUpdate({
        checkoutPath: options.checkout,
        env: process.env,
        upgradeCommand: options.upgrade_command,
        nodePath: options.node_path,
        helperPath: options.helper_path,
        tmuxPath: options.tmuxPath,
        tmuxSocket: options.tmux_socket,
        curlPath: options.curlPath,
      });
      return result.status === 'lock-or-state-error' ? 1 : 0;
    }
    if (options.command === 'register-session') {
      const result = registerSession({
        checkoutPath: options.checkout,
        sessionName: options.session,
        env: process.env,
        launchPath: process.env.PATH || '',
        upgradeCommand: options.upgrade_command,
        nodePath: options.node_path,
        helperPath: options.helper_path,
        tmuxPath: options.tmuxPath,
        tmuxSocket: options.tmux_socket,
      });
      return ['invalid-session-name', 'hook-registration-failed'].includes(result.status) ? 1 : 0;
    }
    if (options.command === 'abort-session') {
      const result = abortSession({
        checkoutPath: options.checkout,
        sessionName: options.session,
        env: process.env,
        platform: options.platform,
      });
      return ['invalid-session-name'].includes(result.status) ? 1 : 0;
    }
    if (options.command === 'session-closed') {
      const result = handleSessionClosed({
        sessionName: options.session || process.argv[3],
        checkoutId: options.checkout_id,
        env: process.env,
        upgradeCommand: options.upgrade_command,
        tmuxPath: options.tmuxPath,
        tmuxSocket: options.tmux_socket,
      });
      return ['failed', 'invalid-session-name', 'invalid-checkout-id', 'invalid-record'].includes(result.status) ? 1 : 0;
    }
    if (options.command === 'remove-hooks') {
      const checkoutId = options.checkout
        ? resolveStatePaths(options.checkout, process.env, options.platform || process.platform).checkoutId
        : null;
      removeGlobalSessionClosedHooks({ tmuxPath: options.tmuxPath, checkoutId });
      return 0;
    }
    throw new Error(`unknown helper command: ${options.command}`);
  } catch (error) {
    process.stderr.write(`[codex-hud] Warning: update helper failed: ${summarizeError(error)}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) process.exitCode = main();
