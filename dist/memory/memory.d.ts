/**
 * Persistent, dependency-light vector memory store (the "Semantic Memory Buffer").
 *
 * Data lives in a single JSON file under {MATP_DATA_DIR, default ./data}/matp.memory.json.
 * Vectors are stored as JS number arrays and searched with brute-force cosine
 * similarity — exact and fast for thousands-to-low-millions of trajectories.
 *
 * Scale-out note: to go well past a few million rows, swap this for sqlite-vec
 * (vec0 virtual table) behind the same MemoryStore interface.
 *
 * Efficiency notes (vs original):
 *  - markCorrectionFired uses a Map for O(1) id lookup instead of linear scan.
 *  - persist() error recovery no longer re-attempts a write from within the
 *    catch block's finally — it falls back cleanly and always removes the tmp.
 *  - delete / purge helpers let callers trim the buffer without restarting.
 */
import { type Embedder } from '../core/embed.js';
export type SuccessStatus = 'success' | 'failed' | 'partial';
/** The full execution trajectory tuple: (Sub-goal, Tool, Params, Status, Outcome). */
export interface ExecutionTrajectory {
    id: string;
    subGoal: string;
    tool: string;
    parameters: Record<string, unknown>;
    status: SuccessStatus;
    createdAt: number;
    outputSummary?: string;
    /** Optional free-text metadata you don't want vectorized (tenant, task id, ...). */
    meta?: Record<string, unknown>;
}
/** A learned parameter-formatting correction rule extracted from an error/terminal output. */
export interface CorrectionRule {
    id: string;
    tool: string;
    errorPattern: string;
    hint: string;
    timesApplied: number;
    createdAt: number;
    enabled: boolean;
}
export declare class MemoryStore {
    private readonly embedder;
    private readonly file;
    private trajectories;
    private corrections;
    /** O(1) lookup map for correction-fired increments. */
    private correctionById;
    constructor(embedder: Embedder, dataDir?: string);
    private load;
    private persist;
    indexTrajectory(t: Omit<ExecutionTrajectory, 'id' | 'createdAt'>): Promise<ExecutionTrajectory>;
    addCorrectionRule(rule: Omit<CorrectionRule, 'id' | 'createdAt' | 'timesApplied'>): Promise<CorrectionRule>;
    /** Returns nearest trajectories to the sub-goal by cosine similarity (highest first). */
    nearestTrajectories(subGoal: string, k: number): Promise<{
        record: ExecutionTrajectory;
        similarity: number;
        distance: number;
    }[]>;
    /**
     * Recalls correction rules for a tool.
     *
     * Two tiers, best-first:
     *   1. Exact match  — rules whose errorPattern appears (case-insensitive)
     *      as a substring of errorOutput. These always win; the pattern is a
     *      precise signal.
     *   2. Fuzzy match  — remaining rules ranked by embedding similarity.
     *      Callers may threshold these further.
     * Returns at most k rules.
     */
    nearestCorrections(tool: string, errorOutput: string, k: number): Promise<{
        rule: CorrectionRule;
        similarity: number;
    }[]>;
    /**
     * Delete a single trajectory by id.
     * Returns true if it existed, false if not found.
     */
    deleteTrajectory(id: string): boolean;
    /**
     * Disable (soft-delete) a correction rule by id.
     * Returns the public rule, or null if not found.
     */
    disableCorrectionRule(id: string): CorrectionRule | null;
    /**
     * Purge all trajectories older than maxAgeDays days.
     * Returns the number removed.
     */
    purgeOldTrajectories(maxAgeDays: number): number;
    /**
     * List all trajectories with optional tool filter.
     * Returns the public records (no embeddings) sorted newest-first.
     */
    listTrajectories(opts?: {
        tool?: string;
        status?: SuccessStatus;
        limit?: number;
    }): ExecutionTrajectory[];
    /**
     * List all correction rules (optionally filtered by tool).
     */
    listCorrectionRules(opts?: {
        tool?: string;
        enabledOnly?: boolean;
    }): CorrectionRule[];
    /** O(1) in-memory usage counter. Persists lazily on next indexing/persist call. */
    markCorrectionFired(id: string): void;
    /** Flush the (possibly dirty) usage counters to disk. */
    flush(): void;
    stats(): {
        trajectories: number;
        corrections: number;
        dir: string;
        byStatus: Record<string, number>;
        tools: Record<string, number>;
    };
}
