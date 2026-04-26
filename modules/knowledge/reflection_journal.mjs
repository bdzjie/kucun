/**
 * reflection_journal.mjs
 * 
 * Periodic self-reflection journal — generates structured insights
 * from accumulated memory data (reflexions, evals, failures).
 * 
 * Integrates:
 *   - ReflexionBuffer: recent task reflections
 *   - SelfEvaluator: score trends and dimension analysis
 *   - FailureRecorder: failure patterns and lessons
 * 
 * Produces:
 *   - Daily/weekly journal entries with insights
 *   - Trend analysis across dimensions
 *   - Actionable recommendations for next period
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getReflexionBuffer } from './reflexion_buffer.mjs';
import { getSelfEvaluator } from './self_evaluator.mjs';
import { getFailureRecorder } from './failure_recorder.mjs';

const JOURNAL_DIR = join(homedir(), '.openclaw', 'memory', 'journal');

// Ensure directory
function ensureDir() {
        mkdirSync(JOURNAL_DIR, { recursive: true });
}

export const INSIGHT_TYPES = {
    TREND:       'trend',        // Something improving/declining
    PATTERN:     'pattern',      // Recurring theme noticed
    LESSON:      'lesson',       // Key learning from failures
    STRENGTH:    'strength',     // Something working well
    WEAKNESS:    'weakness',     // Area needing attention
    RECOMMEND:   'recommend',    // Actionable recommendation
};

/**
 * A journal entry with structured insights
 */
export class JournalEntry {
    constructor({ periodStart, periodEnd, periodType = 'daily', summary = '', insights = [], nextPeriodFocus = [] }) {
        this.id = 'journal_' + Date.now().toString(36);
        this.periodStart = periodStart;
        this.periodEnd = periodEnd;
        this.periodType = periodType;    // 'daily' | 'weekly'
        this.summary = summary;          // One-paragraph summary
        this.insights = insights;        // Structured insights
        this.nextPeriodFocus = nextPeriodFocus; // Priorities for next period
        this.timestamp = new Date().toISOString();
        this.reflexionCount = 0;
        this.evalCount = 0;
        this.failureCount = 0;
    }

    toJSON() {
        return {
            id: this.id,
            periodStart: this.periodStart,
            periodEnd: this.periodEnd,
            periodType: this.periodType,
            summary: this.summary,
            insights: this.insights,
            nextPeriodFocus: this.nextPeriodFocus,
            timestamp: this.timestamp,
            reflexionCount: this.reflexionCount,
            evalCount: this.evalCount,
            failureCount: this.failureCount,
        };
    }

    static fromJSON(obj) {
        const e = new JournalEntry({});
        Object.assign(e, obj);
        return e;
    }

    /** Format as markdown for Obsidian/wiki compatibility */
    toMarkdown() {
        let md = `# Journal: ${this.periodStart.slice(0, 10)} (${this.periodType})\n\n`;
        md += `**Period**: ${this.periodStart.slice(0, 19)} → ${this.periodEnd.slice(0, 19)}\n`;
        md += `**Generated**: ${this.timestamp}\n\n`;
        md += `## Summary\n\n${this.summary}\n\n`;
        md += `## Insights\n\n`;
        for (const insight of this.insights) {
            const icon = {
                trend: '📈', pattern: '🔄', lesson: '💡',
                strength: '✅', weakness: '⚠️', recommend: '🎯',
            }[insight.type] || '•';
            md += `- ${icon} **[${insight.type}]** ${insight.text}\n`;
            if (insight.evidence) md += `  - Evidence: ${insight.evidence}\n`;
        }
        md += `\n## Next Period Focus\n\n`;
        for (const [i, focus] of this.nextPeriodFocus.entries()) {
            md += `${i + 1}. ${focus}\n`;
        }
        return md;
    }
}

/**
 * ReflectionJournal — generates periodic journal entries
 */
export class ReflectionJournal {
    constructor() {
        this.entries = [];
        this._load();
    }

    _journalPath() { return join(JOURNAL_DIR, 'journal_index.jsonl'); }

    _load() {
        try {
            if (!existsSync(this._journalPath())) return;
            const raw = readFileSync(this._journalPath(), 'utf-8');
            for (const line of raw.trim().split('\n')) {
                if (!line.trim()) continue;
                try {
                    this.entries.push(JournalEntry.fromJSON(JSON.parse(line)));
                } catch {}
            }
        } catch (e) {
            console.warn('[reflection_journal] load error:', e.message);
        }
    }

    _save() {
        try {
            ensureDir();
            const lines = this.entries.map(e => JSON.stringify(e.toJSON())).join('\n');
            writeFileSync(this._journalPath(), lines + '\n', 'utf-8');
        } catch (e) {
            console.warn('[reflection_journal] save error:', e.message);
        }
    }

    /**
     * Generate a journal entry for the given period
     */
    generate({ periodStart, periodEnd, periodType = 'daily' }) {
        const reflexion = getReflexionBuffer();
        const evaluator = getSelfEvaluator();
        const failure = getFailureRecorder();

        // Gather data from the period
        const recentReflexions = reflexion.entries.filter(e => {
            const t = new Date(e.timestamp).getTime();
            return t >= new Date(periodStart).getTime() && t <= new Date(periodEnd).getTime();
        });

        const recentEvals = evaluator.history.filter(e => {
            const t = new Date(e.timestamp).getTime();
            return t >= new Date(periodStart).getTime() && t <= new Date(periodEnd).getTime();
        });

        const recentFailures = failure.records.filter(r => {
            const t = new Date(r.timestamp).getTime();
            return t >= new Date(periodStart).getTime() && t <= new Date(periodEnd).getTime();
        });

        // Generate insights
        const insights = this._generateInsights({
            reflexions: recentReflexions,
            evals: recentEvals,
            failures: recentFailures,
        });

        // Generate summary
        const summary = this._generateSummary({
            reflexions: recentReflexions,
            evals: recentEvals,
            failures: recentFailures,
        });

        // Generate next period focus
        const nextFocus = this._generateNextFocus({
            evaluator,
            failures: recentFailures,
            insights,
        });

        const entry = new JournalEntry({
            periodStart,
            periodEnd,
            periodType,
            summary,
            insights,
            nextPeriodFocus: nextFocus,
        });

        entry.reflexionCount = recentReflexions.length;
        entry.evalCount = recentEvals.length;
        entry.failureCount = recentFailures.length;

        this.entries.push(entry);
        this._save();
        return entry;
    }

    _generateInsights({ reflexions, evals, failures }) {
        const insights = [];

        // Score trends from evaluations
        if (evals.length >= 2) {
            const first = evals[0].overallScore;
            const last = evals[evals.length - 1].overallScore;
            const delta = last - first;
            if (delta >= 5) {
                insights.push({ type: INSIGHT_TYPES.TREND, text: `Overall score improved by ${delta} points this period`, evidence: `From ${first} to ${last}` });
            } else if (delta <= -5) {
                insights.push({ type: INSIGHT_TYPES.TREND, text: `Overall score declined by ${Math.abs(delta)} points this period`, evidence: `From ${first} to ${last}` });
            }

            // Dimension trends
            const dims = ['technical', 'robustness', 'decisions', 'learning', 'discipline'];
            for (const dim of dims) {
                const dimEvals = evals.map(e => e.dimensionScores[dim]).filter(s => s !== undefined);
                if (dimEvals.length >= 2) {
                    const d = dimEvals[dimEvals.length - 1] - dimEvals[0];
                    if (Math.abs(d) >= 8) {
                        const dir = d > 0 ? 'improved' : 'declined';
                        insights.push({ type: INSIGHT_TYPES.TREND, text: `${dim} ${dir} by ${Math.abs(d)} points`, evidence: dimEvals.join(' → ') });
                    }
                }
            }
        }

        // Failure patterns
        if (failures.length > 0) {
            const categories = {};
            for (const f of failures) {
                categories[f.category] = (categories[f.category] || 0) + 1;
            }
            const top = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];
            if (top) {
                insights.push({ type: INSIGHT_TYPES.PATTERN, text: `Most failures in ${top[0]} category (${top[1]} occurrences)`, evidence: Object.entries(categories).map(([k, v]) => `${k}: ${v}`).join(', ') });
            }
        }

        // Recent failure lessons
        const recentFailures = failures.slice(-3).reverse();
        for (const f of recentFailures) {
            insights.push({ type: INSIGHT_TYPES.LESSON, text: f.lesson, evidence: `${f.description} (root cause: ${f.rootCause})` });
        }

        // Success patterns from reflexions
        const successes = reflexions.filter(r => r.outcome === 'success');
        if (successes.length > 0) {
            insights.push({ type: INSIGHT_TYPES.STRENGTH, text: `${successes.length} successful task completions recorded`, evidence: successes.slice(-3).map(s => s.taskDescription).join(', ') });
        }

        // Weakness from lowest eval
        if (evals.length > 0) {
            const weakest = evals[evals.length - 1].weaknesses;
            if (weakest && weakest.length > 0) {
                insights.push({ type: INSIGHT_TYPES.WEAKNESS, text: `Primary weakness: ${weakest[0]}`, evidence: weakest.join(', ') });
            }
        }

        return insights;
    }

    _generateSummary({ reflexions, evals, failures }) {
        const parts = [];
        if (evals.length > 0) {
            const avgScore = Math.round(evals.reduce((a, b) => a + b.overallScore, 0) / evals.length);
            const grade = evals[evals.length - 1].grade;
            parts.push(`${evals.length} self-evaluation(s) conducted, average score ${avgScore}${avgScore >= 90 ? ' (A-range, strong performance)' : avgScore >= 80 ? ' (B-range, steady)' : ' (room for improvement)'}.`);
        }
        if (reflexions.length > 0) {
            const successRate = Math.round(reflexions.filter(r => r.outcome === 'success').length / reflexions.length * 100);
            parts.push(`${reflexions.length} task reflexions recorded, ${successRate}% success rate.`);
        }
        if (failures.length > 0) {
            parts.push(`${failures.length} failure(s) recorded — ${failures.filter(f => !f.acknowledged).length} unresolved.`);
        }
        if (parts.length === 0) {
            return 'No significant activity recorded this period.';
        }
        return parts.join(' ');
    }

    _generateNextFocus({ evaluator, failures, insights }) {
        const focus = [];

        // From weakest dimension
        const weakest = evaluator.weakestDimension();
        if (weakest && weakest.average < 80) {
            focus.push(`Improve ${weakest.key} dimension (currently ${weakest.average}/100)`);
        }

        // From unresolved failures
        const unresolved = failures.filter(f => !f.acknowledged);
        if (unresolved.length > 0) {
            focus.push(`Address ${unresolved.length} unresolved failure(s): ${unresolved.map(f => f.description).join(', ')}`);
        }

        // From insights recommendations
        for (const insight of insights.filter(i => i.type === INSIGHT_TYPES.RECOMMEND)) {
            focus.push(insight.text);
        }

        if (focus.length === 0) {
            focus.push('Continue maintaining quality across all dimensions');
            focus.push('Monitor reflexion buffer for emerging patterns');
        }

        return focus.slice(0, 5);
    }

    /**
     * Generate a daily journal entry for today
     */
    generateDaily() {
        const now = new Date();
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        return this.generate({ periodStart: start.toISOString(), periodEnd: now.toISOString(), periodType: 'daily' });
    }

    /**
     * Get the most recent journal entries
     */
    recent({ maxResults = 7 } = {}) {
        return [...this.entries].reverse().slice(0, maxResults);
    }

    /**
     * Get journal as markdown string
     */
    recentMarkdown({ maxResults = 5 } = {}) {
        return this.recent({ maxResults }).map(e => e.toMarkdown()).join('\n---\n');
    }

    getState() {
        return {
            total: this.entries.length,
            latest: this.entries.length > 0 ? this.entries[this.entries.length - 1].timestamp : null,
        };
    }
}

// Singleton
let _journal = null;
export function getReflectionJournal() {
    if (!_journal) _journal = new ReflectionJournal();
    return _journal;
}

export default { INSIGHT_TYPES, JournalEntry, ReflectionJournal, getReflectionJournal };
