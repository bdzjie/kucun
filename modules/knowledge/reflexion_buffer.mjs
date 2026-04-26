/**
 * reflexion_buffer.mjs
 * 
 * Implements the Reflexion paradigm for AI agents.
 * Stores task outcomes + verbal reflections in episodic buffer.
 * On similar future tasks, retrieves relevant past reflections as guidance.
 * 
 * Core idea (Shinn et al., 2023):
 *   Execute → Feedback → Verbal Reflection → Memory → Improved Next Attempt
 * 
 * Unlike updating model weights (expensive), we use the reflection
 * as a semantic gradient signal in context.
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const REFLEXION_DIR = join(homedir(), '.openclaw', 'memory', 'reflexion');

// Ensure directory exists
function ensureDir() {
        mkdirSync(REFLEXION_DIR, { recursive: true });
}

/**
 * A single Reflexion entry — one task + feedback + reflection
 */
export class ReflexionEntry {
    constructor({ taskType, taskDescription, outcome, feedback, reflection, tags = [] }) {
        this.id = this._genId();
        this.taskType = taskType;           // e.g. 'skill_fix', 'code_analysis', 'memory_maintenance'
        this.taskDescription = taskDescription;
        this.outcome = outcome;             // 'success' | 'partial' | 'failure'
        this.feedback = feedback;           // raw feedback signal
        this.reflection = reflection;       // verbal self-reflection text
        this.tags = tags;                   // e.g. ['python', 'regex', 'yaml']
        this.timestamp = new Date().toISOString();
        this.usageCount = 0;               // how many times this was retrieved
        this.lastUsed = null;
    }

    _genId() {
        return 'ref_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    }

    toJSON() {
        return {
            id: this.id,
            taskType: this.taskType,
            taskDescription: this.taskDescription,
            outcome: this.outcome,
            feedback: this.feedback,
            reflection: this.reflection,
            tags: this.tags,
            timestamp: this.timestamp,
            usageCount: this.usageCount,
            lastUsed: this.lastUsed,
        };
    }

    static fromJSON(obj) {
        const e = new ReflexionEntry({});
        Object.assign(e, obj);
        return e;
    }
}

/**
 * ReflexionBuffer — episodic memory for task reflections
 */
export class ReflexionBuffer {
    constructor({ maxEntries = 500 } = {}) {
        this.maxEntries = maxEntries;
        this.entries = [];
        this._load();
    }

    _path() { return join(REFLEXION_DIR, 'reflexion_log.jsonl'); }

    _load() {
        try {
            if (!existsSync(this._path())) return;
            const raw = readFileSync(this._path(), 'utf-8');
            for (const line of raw.trim().split('\n')) {
                if (!line.trim()) continue;
                try {
                    const obj = JSON.parse(line);
                    this.entries.push(ReflexionEntry.fromJSON(obj));
                } catch {}
            }
        } catch (e) {
            console.warn('[reflexion_buffer] load error:', e.message);
        }
    }

    _save() {
        try {
            ensureDir();
            const lines = this.entries.map(e => JSON.stringify(e.toJSON())).join('\n');
            writeFileSync(this._path(), lines + '\n', 'utf-8');
        } catch (e) {
            console.warn('[reflexion_buffer] save error:', e.message);
        }
    }

    /**
     * Record a new task + reflection
     */
    add({ taskType, taskDescription, outcome, feedback, reflection, tags = [] }) {
        const entry = new ReflexionEntry({ taskType, taskDescription, outcome, feedback, reflection, tags });
        this.entries.push(entry);
        // Trim oldest if over max
        if (this.entries.length > this.maxEntries) {
            this.entries = this.entries.slice(-this.maxEntries);
        }
        this._save();
        return entry;
    }

    /**
     * Retrieve relevant reflections for a task type + description
     * Uses simple keyword overlap scoring
     */
    retrieve({ taskType, description, tags = [], maxResults = 5 }) {
        const queryWords = (description + ' ' + tags.join(' ')).toLowerCase().split(/\s+/);
        const scored = [];

        for (const entry of this.entries) {
            let score = 0;
            // Exact task type match is strong signal
            if (entry.taskType === taskType) score += 3;
            // Tag overlap
            const entryTags = entry.tags.map(t => t.toLowerCase());
            for (const q of queryWords) {
                if (entryTags.includes(q)) score += 1;
                if (entry.taskDescription.toLowerCase().includes(q)) score += 0.5;
            }
            // Outcome quality weighting: failures are more instructive
            if (entry.outcome === 'failure') score *= 1.2;
            else if (entry.outcome === 'success') score *= 0.8; // deprioritize success (already know it works)

            if (score > 0) {
                entry.lastUsed = new Date().toISOString();
                entry.usageCount++;
                scored.push({ entry, score });
            }
        }

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, maxResults).map(s => s.entry);
    }

    /**
     * Get the most recent N entries
     */
    recent({ maxResults = 10, outcome } = {}) {
        let entries = [...this.entries].reverse();
        if (outcome) {
            entries = entries.filter(e => e.outcome === outcome);
        }
        return entries.slice(0, maxResults);
    }

    /**
     * Get entries by task type
     */
    byType(taskType) {
        return this.entries.filter(e => e.taskType === taskType);
    }

    /**
     * Get a summary of failure patterns by task type
     */
    failureSummary() {
        const failures = this.entries.filter(e => e.outcome === 'failure');
        const byType = {};
        for (const f of failures) {
            if (!byType[f.taskType]) byType[f.taskType] = [];
            byType[f.taskType].push(f);
        }
        return byType;
    }

    getState() {
        return {
            total: this.entries.length,
            byOutcome: {
                success: this.entries.filter(e => e.outcome === 'success').length,
                partial: this.entries.filter(e => e.outcome === 'partial').length,
                failure: this.entries.filter(e => e.outcome === 'failure').length,
            },
            topTags: this._topTags(),
        };
    }

    _topTags() {
        const counts = {};
        for (const e of this.entries) {
            for (const t of e.tags) {
                counts[t] = (counts[t] || 0) + 1;
            }
        }
        return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([tag, count]) => ({ tag, count }));
    }
}

// Singleton
let _buffer = null;
export function getReflexionBuffer() {
    if (!_buffer) _buffer = new ReflexionBuffer();
    return _buffer;
}

export default { ReflexionEntry, ReflexionBuffer, getReflexionBuffer };
