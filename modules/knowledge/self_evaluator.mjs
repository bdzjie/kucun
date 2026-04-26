/**
 * self_evaluator.mjs
 * 
 * Quantitative self-evaluation after each significant task.
 * 
 * Based on the 5 dimensions we use:
 *   1. 技术产出 (Technical Output)     - 质量/数量/正确性
 *   2. 健壮性意识 (Robustness)         - 防御性/边界情况/容错
 *   3. 决策质量 (Decision Quality)     - 判断力/权衡取舍
 *   4. GitHub学习转化 (Learning)        - 从外部学习并应用
 *   5. 工作流纪律 (Workflow Discipline) - 流程遵守/HEARTBEAT/记录
 * 
 * Each dimension scored 0-100, weighted average = overall score.
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const EVAL_DIR = join(homedir(), '.openclaw', 'memory', 'self_evaluation');

// Ensure directory
function ensureDir() {
    try { mkdirSync(EVAL_DIR, { recursive: true }); } catch {}
}

export const DIMENSIONS = [
    { key: 'technical',  label: '技术产出',       description: '代码/方案的质量、正确性、完整性' },
    { key: 'robustness', label: '健壮性意识',      description: '边界情况处理、错误处理、容错设计' },
    { key: 'decisions',  label: '决策质量',        description: '判断力、权衡取舍、优先级' },
    { key: 'learning',   label: 'GitHub学习转化',   description: '外部知识获取与实际应用' },
    { key: 'discipline', label: '工作流纪律',      description: '流程遵守、HEARTBEAT、记录完整性' },
];

const WEIGHTS = {
    technical:  0.30,
    robustness: 0.20,
    decisions:  0.20,
    learning:   0.15,
    discipline: 0.15,
};

/**
 * A single self-evaluation record
 */
export class SelfEvalEntry {
    constructor({ taskDescription, taskType, dimensionScores, overallScore, strengths, weaknesses, nextActions = [], reflectionText = '' }) {
        this.id = 'eval_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
        this.taskDescription = taskDescription;
        this.taskType = taskType;
        this.dimensionScores = dimensionScores; // { technical: 85, robustness: 70, ... }
        this.overallScore = overallScore;      // weighted average
        this.grade = this._scoreToGrade(overallScore);
        this.strengths = strengths;            // what went well (string[])
        this.weaknesses = weaknesses;          // what needs improvement (string[])
        this.nextActions = nextActions;        // actionable todos for next time
        this.reflectionText = reflectionText;  // free-form reflection
        this.timestamp = new Date().toISOString();
        this.intervalScore = null;             // delta vs previous eval
    }

    _scoreToGrade(score) {
        if (score >= 95) return 'S';
        if (score >= 90) return 'A';
        if (score >= 80) return 'B';
        if (score >= 70) return 'C';
        if (score >= 60) return 'D';
        return 'F';
    }

    toJSON() {
        return {
            id: this.id,
            taskDescription: this.taskDescription,
            taskType: this.taskType,
            dimensionScores: this.dimensionScores,
            overallScore: this.overallScore,
            grade: this.grade,
            strengths: this.strengths,
            weaknesses: this.weaknesses,
            nextActions: this.nextActions,
            reflectionText: this.reflectionText,
            timestamp: this.timestamp,
            intervalScore: this.intervalScore,
        };
    }

    static fromJSON(obj) {
        const e = new SelfEvalEntry({});
        Object.assign(e, obj);
        return e;
    }
}

/**
 * SelfEvaluator — scores own performance after significant tasks
 */
export class SelfEvaluator {
    constructor({ historyFile } = {}) {
        this.historyFile = historyFile || join(EVAL_DIR, 'eval_history.jsonl');
        this.history = [];
        this._load();
    }

    _load() {
        try {
            if (!existsSync(this.historyFile)) return;
            const raw = readFileSync(this.historyFile, 'utf-8');
            for (const line of raw.trim().split('\n')) {
                if (!line.trim()) continue;
                try {
                    this.history.push(SelfEvalEntry.fromJSON(JSON.parse(line)));
                } catch {}
            }
        } catch (e) {
            console.warn('[self_evaluator] load error:', e.message);
        }
    }

    _save() {
        try {
            ensureDir();
            const lines = this.history.map(e => JSON.stringify(e.toJSON())).join('\n');
            writeFileSync(this.historyFile, lines + '\n', 'utf-8');
        } catch (e) {
            console.warn('[self_evaluator] save error:', e.message);
        }
    }

    /**
     * Submit a self-evaluation after a task.
     * Returns the entry with interval score calculated.
     */
    evaluate({ taskDescription, taskType, dimensionScores, strengths, weaknesses, nextActions = [], reflectionText = '' }) {
        // Compute weighted overall score
        let overall = 0;
        for (const dim of DIMENSIONS) {
            const score = dimensionScores[dim.key] ?? 80;
            overall += WEIGHTS[dim.key] * score;
        }
        overall = Math.round(overall);

        // Compute interval vs previous
        let intervalScore = null;
        if (this.history.length > 0) {
            const prev = this.history[this.history.length - 1].overallScore;
            intervalScore = overall - prev;
        }

        const entry = new SelfEvalEntry({ taskDescription, taskType, dimensionScores, overallScore: overall, strengths, weaknesses, nextActions, reflectionText });
        entry.intervalScore = intervalScore;
        this.history.push(entry);
        this._save();
        return entry;
    }

    /**
     * Get trend for a specific dimension across history
     */
    dimensionTrend(key) {
        const entries = this.history.filter(e => e.dimensionScores[key] !== undefined);
        return entries.map(e => ({ timestamp: e.timestamp, score: e.dimensionScores[key] }));
    }

    /**
     * Get overall score trend
     */
    overallTrend() {
        return this.history.map(e => ({ timestamp: e.timestamp, score: e.overallScore, grade: e.grade }));
    }

    /**
     * Get average scores per dimension across all evaluations
     */
    dimensionAverages() {
        const result = {};
        for (const dim of DIMENSIONS) {
            const scores = this.history
                .map(e => e.dimensionScores[dim.key])
                .filter(s => s !== undefined);
            result[dim.key] = scores.length > 0
                ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
                : null;
        }
        return result;
    }

    /**
     * Get recent evaluations
     */
    recent({ maxResults = 10 } = {}) {
        return [...this.history].reverse().slice(0, maxResults);
    }

    /**
     * Get weakest dimension (lowest average)
     */
    weakestDimension() {
        const avg = this.dimensionAverages();
        let weakest = null, lowest = 100;
        for (const [key, score] of Object.entries(avg)) {
            if (score !== null && score < lowest) {
                lowest = score;
                weakest = key;
            }
        }
        return weakest ? { key: weakest, average: lowest } : null;
    }

    /**
     * Print a formatted report for the latest evaluation
     */
    latestReport() {
        if (this.history.length === 0) return 'No evaluations yet.';
        const latest = this.history[this.history.length - 1];
        const trend = latest.intervalScore;
        const trendStr = trend !== null
            ? (trend >= 0 ? `+${trend}` : `${trend}`)
            : 'first';

        let report = `=== Self-Eval #${this.history.length} | ${latest.grade}${latest.overallScore} | ${trendStr} ===\n`;
        report += `Task: ${latest.taskDescription}\n\n`;
        report += `Dimensions:\n`;
        for (const dim of DIMENSIONS) {
            const score = latest.dimensionScores[dim.key];
            if (score !== undefined) {
                const bar = '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10));
                report += `  ${dim.label}: ${bar} ${score}\n`;
            }
        }
        report += `\nStrengths: ${latest.strengths.join(', ') || 'none'}\n`;
        report += `Weaknesses: ${latest.weaknesses.join(', ') || 'none'}\n`;
        if (latest.nextActions.length > 0) {
            report += `Next Actions: ${latest.nextActions.join(', ')}\n`;
        }
        return report;
    }

    getState() {
        return {
            total: this.history.length,
            latest: this.history.length > 0 ? this.history[this.history.length - 1].overallScore : null,
            averages: this.dimensionAverages(),
            weakest: this.weakestDimension(),
        };
    }
}

// Singleton
let _evaluator = null;
export function getSelfEvaluator() {
    if (!_evaluator) _evaluator = new SelfEvaluator();
    return _evaluator;
}

export default { DIMENSIONS, WEIGHTS, SelfEvalEntry, SelfEvaluator, getSelfEvaluator };
