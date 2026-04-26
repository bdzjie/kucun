/**
 * failure_recorder.mjs
 * 
 * Records failures, mistakes, and principle violations.
 * Each failure is structured as a "hall_fact" (决策/原则违反 record)
 * in the MemPalace wing/room structure.
 * 
 * When a similar situation arises, the system can retrieve
 * the lesson learned and avoid repeating the mistake.
 * 
 * Based on Constitutional AI's "principle violation recording"
 * and Reflexion's verbal reflection on failures.
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const FAILURE_DIR = join(homedir(), '.openclaw', 'memory', 'failures');

// Ensure directory
function ensureDir() {
        mkdirSync(FAILURE_DIR, { recursive: true });
}

/**
 * Failure categories — each maps to a MemPalace hall
 */
export const FAILURE_CATEGORIES = {
    TECH_DEBT:       'tech_debt',       // Technical debt, bad patterns
    DECISION_ERROR:  'decision_error',   // Wrong judgment call
    WORKFLOW_VIOLATION: 'workflow_violation', // Broke a process/policy
    EXTERNAL_IGNORE: 'external_ignore', // Ignored a clear signal/warning
    REGRESSION:     'regression',       // Broke something that worked
    COMMUNICATION:  'communication',   // Misunderstanding, unclear output
    SECURITY:       'security',         // Safety/privacy concern
    OTHER:          'other',
};

/**
 * Severity levels
 */
export const SEVERITY = {
    LOW:    { label: 'low',    weight: 1 },
    MEDIUM: { label: 'medium', weight: 3 },
    HIGH:   { label: 'high',   weight: 5 },
    CRITICAL:{ label: 'critical', weight: 10 },
};

/**
 * A failure record
 */
export class FailureRecord {
    constructor({ category, severity, description, rootCause, lesson, tags = [], context = '' }) {
        this.id = 'fail_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
        this.category = category;
        this.severity = severity;           // 'low' | 'medium' | 'high' | 'critical'
        this.description = description;     // What happened
        this.rootCause = rootCause;          // Why it happened
        this.lesson = lesson;                // What to do differently
        this.tags = tags;
        this.context = context;              //Situation/context
        this.timestamp = new Date().toISOString();
        this.acknowledged = false;
        this.resolution = '';                // How it was resolved
        this.recurrenceCount = 0;            // How many times similar failure happened
    }

    toJSON() {
        return {
            id: this.id,
            category: this.category,
            severity: this.severity,
            description: this.description,
            rootCause: this.rootCause,
            lesson: this.lesson,
            tags: this.tags,
            context: this.context,
            timestamp: this.timestamp,
            acknowledged: this.acknowledged,
            resolution: this.resolution,
            recurrenceCount: this.recurrenceCount,
        };
    }

    static fromJSON(obj) {
        const r = new FailureRecord({});
        Object.assign(r, obj);
        return r;
    }

    /** Format as a hall_fact string for MemPalace */
    toHallFact() {
        return `[${this.severity.toUpperCase()}] ${this.description} → Lesson: ${this.lesson} (${this.category})`;
    }
}

/**
 * FailureRecorder — stores and retrieves failure records
 */
export class FailureRecorder {
    constructor({ recordFile } = {}) {
        this.recordFile = recordFile || join(FAILURE_DIR, 'failure_log.jsonl');
        this.records = [];
        this._load();
    }

    _load() {
        try {
            if (!existsSync(this.recordFile)) return;
            const raw = readFileSync(this.recordFile, 'utf-8');
            for (const line of raw.trim().split('\n')) {
                if (!line.trim()) continue;
                try {
                    this.records.push(FailureRecord.fromJSON(JSON.parse(line)));
                } catch {}
            }
        } catch (e) {
            console.warn('[failure_recorder] load error:', e.message);
        }
    }

    _save() {
        try {
            ensureDir();
            const lines = this.records.map(r => JSON.stringify(r.toJSON())).join('\n');
            writeFileSync(this.recordFile, lines + '\n', 'utf-8');
        } catch (e) {
            console.warn('[failure_recader] save error:', e.message);
        }
    }

    /**
     * Record a new failure
     */
    record({ category, severity, description, rootCause, lesson, tags = [], context = '' }) {
        const record = new FailureRecord({ category, severity, description, rootCause, lesson, tags, context });
        this.records.push(record);
        this._save();
        return record;
    }

    /**
     * Retrieve failures relevant to current context
     */
    retrieve({ description, tags = [], maxResults = 5 }) {
        const queryWords = (description + ' ' + tags.join(' ')).toLowerCase().split(/\s+/);
        const scored = [];

        for (const r of this.records) {
            let score = 0;
            const text = (r.description + ' ' + r.rootCause + ' ' + r.lesson + ' ' + r.tags.join(' ')).toLowerCase();
            for (const q of queryWords) {
                if (text.includes(q)) score += 1;
            }
            // Penalty for already-acknowledged
            if (r.acknowledged) score *= 0.5;
            // Higher severity failures are more important to recall
            score *= (SEVERITY[r.severity.toUpperCase()]?.weight || 1) / 3;
            if (score > 0) scored.push({ record: r, score });
        }

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, maxResults).map(s => s.record);
    }

    /**
     * Check for similar failures in the past N days
     */
    checkRecurrence({ description, lookbackDays = 30 }) {
        const cutoff = Date.now() - lookbackDays * 24 * 3600 * 1000;
        const recent = this.records.filter(r => new Date(r.timestamp).getTime() > cutoff);
        const words = description.toLowerCase().split(/\s+/);

        const matches = [];
        for (const r of recent) {
            const text = (r.description + ' ' + r.tags.join(' ')).toLowerCase();
            let matchCount = 0;
            for (const w of words) {
                if (w.length > 3 && text.includes(w)) matchCount++;
            }
            if (matchCount >= 2) {
                r.recurrenceCount++;
                matches.push(r);
            }
        }
        return matches;
    }

    /**
     * Acknowledge a failure (mark as seen/dealt with)
     */
    acknowledge(id, resolution = '') {
        const r = this.records.find(r => r.id === id);
        if (r) {
            r.acknowledged = true;
            r.resolution = resolution;
            this._save();
        }
    }

    /**
     * Get failures by category
     */
    byCategory() {
        const groups = {};
        for (const r of this.records) {
            if (!groups[r.category]) groups[r.category] = [];
            groups[r.category].push(r);
        }
        return groups;
    }

    /**
     * Get unresolved failures
     */
    unresolved() {
        return this.records.filter(r => !r.acknowledged);
    }

    /**
     * Get failure density (failures per day) for trend analysis
     */
    failureRate({ days = 7 } = {}) {
        const cutoff = Date.now() - days * 24 * 3600 * 1000;
        const recent = this.records.filter(r => new Date(r.timestamp).getTime() > cutoff);
        return {
            count: recent.length,
            perDay: Math.round(recent.length / days * 10) / 10,
            byCategory: this._byCategory(recent),
        };
    }

    _byCategory(records) {
        const counts = {};
        for (const r of records) {
            counts[r.category] = (counts[r.category] || 0) + 1;
        }
        return counts;
    }

    /**
     * Print a formatted failure report
     */
    report({ days = 7 } = {}) {
        const rate = this.failureRate({ days });
        let report = `=== Failure Report (last ${days}d) ===\n`;
        report += `Total failures: ${rate.count} (${rate.perDay}/day)\n`;
        report += `By category:\n`;
        for (const [cat, count] of Object.entries(rate.byCategory)) {
            report += `  ${cat}: ${count}\n`;
        }
        report += `\nUnresolved:\n`;
        for (const r of this.unresolved().slice(0, 5)) {
            report += `  [${r.severity}] ${r.description} (${r.category})\n`;
            report += `  → ${r.lesson}\n`;
        }
        return report;
    }

    getState() {
        return {
            total: this.records.length,
            unresolved: this.unresolved().length,
            byCategory: this._byCategory(this.records),
            severity: {
                critical: this.records.filter(r => r.severity === 'critical').length,
                high:     this.records.filter(r => r.severity === 'high').length,
                medium:   this.records.filter(r => r.severity === 'medium').length,
                low:      this.records.filter(r => r.severity === 'low').length,
            },
        };
    }
}

// Singleton
let _recorder = null;
export function getFailureRecorder() {
    if (!_recorder) _recorder = new FailureRecorder();
    return _recorder;
}

export default { FAILURE_CATEGORIES, SEVERITY, FailureRecord, FailureRecorder, getFailureRecorder };
