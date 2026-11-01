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
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cosineSimilarity, distance } from '../core/embed.js';
/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */
export class MemoryStore {
    embedder;
    file;
    trajectories = [];
    corrections = [];
    /** O(1) lookup map for correction-fired increments. */
    correctionById = new Map();
    constructor(embedder, dataDir) {
        this.embedder = embedder;
        const dir = resolve(dataDir ?? process.env.MATP_DATA_DIR ?? './data');
        mkdirSync(dir, { recursive: true });
        this.file = join(dir, 'matp.memory.json');
        this.load();
    }
    /* -- persistence -------------------------------------------------- */
    load() {
        if (!existsSync(this.file))
            return;
        try {
            const data = JSON.parse(readFileSync(this.file, 'utf8'));
            if (data.embedder && data.embedder.dim !== this.embedder.dim) {
                console.error(`[matp] WARNING: memory file was written with embedder "${data.embedder.label}" (dim=${data.embedder.dim}) ` +
                    `but current embedder is "${this.embedder.label}" (dim=${this.embedder.dim}). ` +
                    `Similarity results will be unreliable — set EMBED_BACKEND back, or delete the memory file.`);
            }
            this.trajectories = data.trajectories ?? [];
            this.corrections = data.corrections ?? [];
            // Rebuild the O(1) lookup map after loading.
            this.correctionById = new Map(this.corrections.map((c) => [c.id, c]));
        }
        catch (err) {
            console.error(`[matp] failed to load memory file (${this.file}): ${err.message}`);
        }
    }
    persist() {
        const payload = {
            version: 1,
            embedder: { label: this.embedder.label, dim: this.embedder.dim },
            trajectories: this.trajectories,
            corrections: this.corrections,
        };
        const tmp = `${this.file}.${process.pid}.tmp`;
        try {
            // Atomic-ish rename so a crash mid-write cannot corrupt the buffer.
            writeFileSync(tmp, JSON.stringify(payload), 'utf8');
            renameSync(tmp, this.file);
        }
        catch (writeErr) {
            // Clean up the temporary file if it was created.
            try {
                unlinkSync(tmp);
            }
            catch { /* tmp may not exist */ }
            console.error(`[matp] persist failed: ${writeErr.message}`);
        }
    }
    /* -- indexing ------------------------------------------------------ */
    async indexTrajectory(t) {
        const record = {
            ...t,
            id: randomUUID(),
            createdAt: Date.now(),
            embedding: await this.embedder.embed(searchableTrajectoryText(t)),
        };
        this.trajectories.push(record);
        this.persist();
        const { embedding: _e, ...publicRecord } = record;
        return publicRecord;
    }
    async addCorrectionRule(rule) {
        const record = {
            ...rule,
            id: randomUUID(),
            timesApplied: 0,
            createdAt: Date.now(),
            embedding: await this.embedder.embed(searchableErrorText(rule.tool, rule.errorPattern, rule.hint)),
        };
        this.corrections.push(record);
        this.correctionById.set(record.id, record);
        this.persist();
        const { embedding: _e, ...publicRule } = record;
        return publicRule;
    }
    /* -- similarity search --------------------------------------------- */
    /** Returns nearest trajectories to the sub-goal by cosine similarity (highest first). */
    async nearestTrajectories(subGoal, k) {
        if (this.trajectories.length === 0)
            return [];
        const q = await this.embedder.embed(subGoal);
        const scored = this.trajectories
            .map((t) => ({
            record: toPublic(t),
            similarity: cosineSimilarity(q, t.embedding),
            distance: distance(q, t.embedding),
        }))
            .sort((a, b) => b.similarity - a.similarity);
        return scored.slice(0, k);
    }
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
    async nearestCorrections(tool, errorOutput, k) {
        if (this.corrections.length === 0)
            return [];
        const candidates = this.corrections.filter((c) => c.enabled && (c.tool === '*' || c.tool === tool));
        if (candidates.length === 0)
            return [];
        const lower = errorOutput.toLowerCase();
        const exact = candidates
            .filter((c) => lower.includes(c.errorPattern.toLowerCase()))
            .map((c) => ({ rule: toPublicRule(c), similarity: 1 }));
        if (exact.length >= k)
            return exact.slice(0, k);
        const q = await this.embedder.embed(searchableErrorText(tool, errorOutput, ''));
        const fuzzy = candidates
            .filter((c) => !lower.includes(c.errorPattern.toLowerCase()))
            .map((c) => ({ rule: toPublicRule(c), similarity: cosineSimilarity(q, c.embedding) }))
            .sort((a, b) => b.similarity - a.similarity);
        const merged = [...exact, ...fuzzy];
        // de-dupe by rule id (a candidate can't be in both tiers, but guard anyway)
        const seen = new Set();
        return merged.filter((m) => (seen.has(m.rule.id) ? false : (seen.add(m.rule.id), true))).slice(0, k);
    }
    /* -- management ---------------------------------------------------- */
    /**
     * Delete a single trajectory by id.
     * Returns true if it existed, false if not found.
     */
    deleteTrajectory(id) {
        const before = this.trajectories.length;
        this.trajectories = this.trajectories.filter((t) => t.id !== id);
        const deleted = this.trajectories.length < before;
        if (deleted)
            this.persist();
        return deleted;
    }
    /**
     * Disable (soft-delete) a correction rule by id.
     * Returns the public rule, or null if not found.
     */
    disableCorrectionRule(id) {
        const rule = this.correctionById.get(id);
        if (!rule)
            return null;
        rule.enabled = false;
        this.persist();
        const { embedding: _e, ...publicRule } = rule;
        return publicRule;
    }
    /**
     * Purge all trajectories older than maxAgeDays days.
     * Returns the number removed.
     */
    purgeOldTrajectories(maxAgeDays) {
        const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1_000;
        const before = this.trajectories.length;
        this.trajectories = this.trajectories.filter((t) => t.createdAt >= cutoff);
        const removed = before - this.trajectories.length;
        if (removed > 0)
            this.persist();
        return removed;
    }
    /**
     * List all trajectories with optional tool filter.
     * Returns the public records (no embeddings) sorted newest-first.
     */
    listTrajectories(opts = {}) {
        let rows = this.trajectories.map(toPublic);
        if (opts.tool)
            rows = rows.filter((r) => r.tool === opts.tool);
        if (opts.status)
            rows = rows.filter((r) => r.status === opts.status);
        rows.sort((a, b) => b.createdAt - a.createdAt);
        return opts.limit ? rows.slice(0, opts.limit) : rows;
    }
    /**
     * List all correction rules (optionally filtered by tool).
     */
    listCorrectionRules(opts = {}) {
        let rules = this.corrections.map(toPublicRule);
        if (opts.tool)
            rules = rules.filter((r) => r.tool === opts.tool || r.tool === '*');
        if (opts.enabledOnly !== false)
            rules = rules.filter((r) => r.enabled);
        return rules;
    }
    /* -- bookkeeping ---------------------------------------------------- */
    /** O(1) in-memory usage counter. Persists lazily on next indexing/persist call. */
    markCorrectionFired(id) {
        const rule = this.correctionById.get(id);
        if (rule)
            rule.timesApplied += 1;
    }
    /** Flush the (possibly dirty) usage counters to disk. */
    flush() {
        this.persist();
    }
    stats() {
        const byStatus = {};
        const tools = {};
        for (const t of this.trajectories) {
            byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
            tools[t.tool] = (tools[t.tool] ?? 0) + 1;
        }
        return { trajectories: this.trajectories.length, corrections: this.corrections.length, dir: dirname(this.file), byStatus, tools };
    }
}
/* ------------------------------------------------------------------ */
function searchableTrajectoryText(t) {
    return [t.subGoal, t.tool, Object.entries(t.parameters ?? {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' '), t.status].join(' | ');
}
function searchableErrorText(tool, pattern, hint) {
    return [tool, pattern, hint].join(' | ');
}
function toPublic(t) {
    const { embedding: _e, ...rec } = t;
    return rec;
}
function toPublicRule(r) {
    const { embedding: _e, ...rec } = r;
    return rec;
}
