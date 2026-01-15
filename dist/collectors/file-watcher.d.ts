/**
 * File watcher for monitoring config and rollout file changes
 * Uses chokidar for efficient file system watching
 */
export type FileChangeCallback = (path: string, event: 'add' | 'change' | 'unlink') => void;
/**
 * File watcher with cleanup support
 */
export declare class FileWatcher {
    private paths;
    private options;
    private watcher;
    private callbacks;
    constructor(paths: string[], options?: {
        usePolling?: boolean;
    });
    /**
     * Start watching files
     */
    start(): void;
    /**
     * Stop watching
     */
    stop(): Promise<void>;
    /**
     * Add a callback for file changes
     */
    onChange(callback: FileChangeCallback): void;
    /**
     * Add a new path to watch
     */
    add(filePath: string): void;
    /**
     * Remove a path from watching
     */
    unwatch(filePath: string): void;
    private notifyCallbacks;
}
/**
 * Create a watcher for the Codex config file
 */
export declare function createConfigWatcher(): FileWatcher;
/**
 * Create a watcher for today's session rollout files
 */
export declare function createSessionWatcher(): FileWatcher;
/**
 * Unified watcher manager for all HUD-related file monitoring
 */
export declare class HudFileWatcher {
    private configWatcher;
    private sessionWatcher;
    private rolloutWatcher;
    private currentRolloutPath;
    private onConfigChangeCallbacks;
    private onRolloutChangeCallbacks;
    constructor();
    /**
     * Start all watchers
     */
    start(): void;
    /**
     * Stop all watchers
     */
    stop(): Promise<void>;
    /**
     * Set the specific rollout file to watch
     */
    setRolloutPath(rolloutPath: string): void;
    /**
     * Register callback for config changes
     */
    onConfigChange(callback: () => void): void;
    /**
     * Register callback for rollout file changes
     */
    onRolloutChange(callback: (path: string) => void): void;
    private startSessionWatcher;
    private notifyConfigChange;
    private notifyRolloutChange;
}
//# sourceMappingURL=file-watcher.d.ts.map