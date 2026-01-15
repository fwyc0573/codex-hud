/**
 * File watcher for monitoring config and rollout file changes
 * Uses chokidar for efficient file system watching
 */
import { watch } from 'chokidar';
import * as path from 'path';
import { getCodexHome, getSessionsDir } from './session-finder.js';
/**
 * File watcher with cleanup support
 */
export class FileWatcher {
    paths;
    options;
    watcher = null;
    callbacks = [];
    constructor(paths, options = {}) {
        this.paths = paths;
        this.options = options;
    }
    /**
     * Start watching files
     */
    start() {
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
        this.watcher.on('add', (filePath) => this.notifyCallbacks(filePath, 'add'));
        this.watcher.on('change', (filePath) => this.notifyCallbacks(filePath, 'change'));
        this.watcher.on('unlink', (filePath) => this.notifyCallbacks(filePath, 'unlink'));
    }
    /**
     * Stop watching
     */
    async stop() {
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
        }
    }
    /**
     * Add a callback for file changes
     */
    onChange(callback) {
        this.callbacks.push(callback);
    }
    /**
     * Add a new path to watch
     */
    add(filePath) {
        if (this.watcher) {
            this.watcher.add(filePath);
        }
    }
    /**
     * Remove a path from watching
     */
    unwatch(filePath) {
        if (this.watcher) {
            this.watcher.unwatch(filePath);
        }
    }
    notifyCallbacks(filePath, event) {
        for (const callback of this.callbacks) {
            try {
                callback(filePath, event);
            }
            catch {
                // Ignore callback errors
            }
        }
    }
}
/**
 * Create a watcher for the Codex config file
 */
export function createConfigWatcher() {
    const configPath = path.join(getCodexHome(), 'config.toml');
    return new FileWatcher([configPath]);
}
/**
 * Create a watcher for today's session rollout files
 */
export function createSessionWatcher() {
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const todayDir = path.join(getSessionsDir(), year, month, day);
    const globPattern = path.join(todayDir, 'rollout-*.jsonl');
    return new FileWatcher([globPattern], { usePolling: true });
}
/**
 * Unified watcher manager for all HUD-related file monitoring
 */
export class HudFileWatcher {
    configWatcher;
    sessionWatcher = null;
    rolloutWatcher = null;
    currentRolloutPath = null;
    onConfigChangeCallbacks = [];
    onRolloutChangeCallbacks = [];
    constructor() {
        this.configWatcher = createConfigWatcher();
        this.configWatcher.onChange(() => {
            this.notifyConfigChange();
        });
    }
    /**
     * Start all watchers
     */
    start() {
        this.configWatcher.start();
        this.startSessionWatcher();
    }
    /**
     * Stop all watchers
     */
    async stop() {
        await this.configWatcher.stop();
        await this.sessionWatcher?.stop();
        await this.rolloutWatcher?.stop();
    }
    /**
     * Set the specific rollout file to watch
     */
    setRolloutPath(rolloutPath) {
        if (this.currentRolloutPath === rolloutPath) {
            return;
        }
        // Stop existing rollout watcher
        if (this.rolloutWatcher) {
            this.rolloutWatcher.stop();
            this.rolloutWatcher = null;
        }
        this.currentRolloutPath = rolloutPath;
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
    onConfigChange(callback) {
        this.onConfigChangeCallbacks.push(callback);
    }
    /**
     * Register callback for rollout file changes
     */
    onRolloutChange(callback) {
        this.onRolloutChangeCallbacks.push(callback);
    }
    startSessionWatcher() {
        this.sessionWatcher = createSessionWatcher();
        this.sessionWatcher.onChange((filePath, event) => {
            // New rollout file added - could be a new session starting
            if (event === 'add' && filePath.includes('rollout-')) {
                // Notify so the main app can check if this is a more recent session
                this.notifyRolloutChange(filePath);
            }
        });
        this.sessionWatcher.start();
    }
    notifyConfigChange() {
        for (const callback of this.onConfigChangeCallbacks) {
            try {
                callback();
            }
            catch {
                // Ignore callback errors
            }
        }
    }
    notifyRolloutChange(path) {
        for (const callback of this.onRolloutChangeCallbacks) {
            try {
                callback(path);
            }
            catch {
                // Ignore callback errors
            }
        }
    }
}
//# sourceMappingURL=file-watcher.js.map