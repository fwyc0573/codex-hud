/**
 * File watcher for monitoring config and rollout file changes
 * Uses chokidar for efficient file system watching
 */

import { watch, type FSWatcher } from 'chokidar';
import * as path from 'path';
import { getCodexHome, getSessionsDir } from '../utils/codex-path.js';

function reportWatcherError(scope: string, error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[codex-hud] ${scope}: ${message}`);
}

export type FileChangeCallback = (
  path: string,
  event: 'add' | 'change' | 'unlink'
) => void | Promise<void>;

/**
 * File watcher with cleanup support
 */
export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private callbacks: FileChangeCallback[] = [];

  constructor(private paths: string[], private options: { usePolling?: boolean } = {}) {}

  /**
   * Start watching files
   */
  start(): void {
    if (this.watcher) {
      return;
    }

    this.watcher = watch(this.paths, {
      persistent: true,
      ignoreInitial: true,
      usePolling: this.options.usePolling ?? false,
      interval: 1000,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher.on('error', (error) => {
      // Keep the HUD render loop alive while preserving the allocation failure for diagnosis.
      reportWatcherError('File watcher error', error);
    });
    this.watcher.on('add', (filePath) => this.notifyCallbacks(filePath, 'add'));
    this.watcher.on('change', (filePath) => this.notifyCallbacks(filePath, 'change'));
    this.watcher.on('unlink', (filePath) => this.notifyCallbacks(filePath, 'unlink'));
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Add a callback for file changes
   */
  onChange(callback: FileChangeCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Add a new path to watch
   */
  add(filePath: string): void {
    if (this.watcher) {
      this.watcher.add(filePath);
    }
  }

  /**
   * Remove a path from watching
   */
  unwatch(filePath: string): void {
    if (this.watcher) {
      this.watcher.unwatch(filePath);
    }
  }

  private notifyCallbacks(filePath: string, event: 'add' | 'change' | 'unlink'): void {
    for (const callback of this.callbacks) {
      try {
        void Promise.resolve(callback(filePath, event)).catch((error) => {
          reportWatcherError('File watcher callback failed', error);
        });
      } catch (error) {
        reportWatcherError('File watcher callback failed', error);
      }
    }
  }
}

/**
 * Create a watcher for the Codex config file
 */
export function createConfigWatcher(): FileWatcher {
  const configPath = path.join(getCodexHome(), 'config.toml');
  return new FileWatcher([configPath]);
}

/**
 * Create a watcher for today's session rollout files
 */
export function createSessionWatcher(): FileWatcher {
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');

  const todayDir = path.join(getSessionsDir(), year, month, day);
  const globPattern = path.join(todayDir, 'rollout-*.jsonl');

  return new FileWatcher([globPattern], { usePolling: true });
}

/**
 * Create a watcher for shell snapshots.
 */
export function createShellSnapshotWatcher(): FileWatcher {
  const snapshotsDir = path.join(getCodexHome(), 'shell_snapshots', '*.sh');
  return new FileWatcher([snapshotsDir], { usePolling: true });
}

/**
 * Unified watcher manager for all HUD-related file monitoring
 */
export class HudFileWatcher {
  private configWatcher: FileWatcher;
  private sessionWatcher: FileWatcher | null = null;
  private shellSnapshotWatcher: FileWatcher | null = null;
  private rolloutWatcher: FileWatcher | null = null;
  private currentRolloutPath: string | null = null;

  private onConfigChangeCallbacks: (() => void)[] = [];
  private onRolloutChangeCallbacks: ((path: string) => void | Promise<void>)[] = [];

  constructor() {
    this.configWatcher = createConfigWatcher();
    this.configWatcher.onChange(() => {
      this.notifyConfigChange();
    });
  }

  /**
   * Start all watchers
   */
  start(): void {
    this.configWatcher.start();
    this.startSessionWatcher();
  }

  /**
   * Stop all watchers
   */
  async stop(): Promise<void> {
    await this.configWatcher.stop();
    await this.sessionWatcher?.stop();
    await this.shellSnapshotWatcher?.stop();
    await this.rolloutWatcher?.stop();
  }

  /**
   * Set the specific rollout file to watch
   */
  setRolloutPath(rolloutPath: string | null): void {
    if (this.currentRolloutPath === rolloutPath) {
      return;
    }

    // Stop existing rollout watcher
    if (this.rolloutWatcher) {
      this.rolloutWatcher.stop();
      this.rolloutWatcher = null;
    }

    this.currentRolloutPath = rolloutPath;

    if (!rolloutPath) {
      return;
    }

    // Create new watcher for this specific file
    this.rolloutWatcher = new FileWatcher([rolloutPath], { usePolling: true });
    this.rolloutWatcher.onChange((filePath) => {
      this.notifyRolloutChange(filePath);
    });
    this.rolloutWatcher.start();
  }

  /**
   * Register callback for config changes
   */
  onConfigChange(callback: () => void): void {
    this.onConfigChangeCallbacks.push(callback);
  }

  /**
   * Register callback for rollout file changes
   */
  onRolloutChange(callback: (path: string) => void | Promise<void>): void {
    this.onRolloutChangeCallbacks.push(callback);
  }

  private startSessionWatcher(): void {
    this.sessionWatcher = createSessionWatcher();
    this.sessionWatcher.onChange((filePath, event) => {
      // New rollout file added - could be a new session starting
      if (event === 'add' && filePath.includes('rollout-')) {
        // Notify so the main app can check if this is a more recent session
        this.notifyRolloutChange(filePath);
      }
    });
    this.sessionWatcher.start();

    this.shellSnapshotWatcher = createShellSnapshotWatcher();
    this.shellSnapshotWatcher.onChange((filePath) => {
      this.notifyRolloutChange(filePath);
    });
    this.shellSnapshotWatcher.start();
  }

  private notifyConfigChange(): void {
    for (const callback of this.onConfigChangeCallbacks) {
      try {
        void Promise.resolve(callback()).catch((error) => {
          reportWatcherError('HUD config watcher callback failed', error);
        });
      } catch (error) {
        reportWatcherError('HUD config watcher callback failed', error);
      }
    }
  }

  private notifyRolloutChange(path: string): void {
    for (const callback of this.onRolloutChangeCallbacks) {
      try {
        void Promise.resolve(callback(path)).catch((error) => {
          reportWatcherError('HUD rollout watcher callback failed', error);
        });
      } catch (error) {
        reportWatcherError('HUD rollout watcher callback failed', error);
      }
    }
  }
}
