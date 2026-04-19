/**
 * Evolution Events Skill Handler
 * View EvolutionEvent audit trail (Evolver-inspired)
 *
 * Usage: /evolution-events [limit=10]
 */

import { readFileSync, existsSync } from 'node:fs';

const EVOLUTION_EVENTS_FILE = 'C:/Users/Administrator/.openclaw/memory/evolution_events.jsonl';

export default async function handler(event) {
  // Parse limit from input
  let limit = 10;
  const raw = event?.context?.content || event?.message?.content || '';
  const match = raw.match(/\b(\d+)\b/);
  if (match) limit = Math.min(50, Math.max(1, parseInt(match[1], 10)));

  if (!existsSync(EVOLUTION_EVENTS_FILE)) {
    return {
      handled: true,
      skill: 'evolution-events',
      status: 'no_events',
      message: 'No EvolutionEvents recorded yet. Events are logged when skills are created or blocked.',
    };
  }

  try {
    const raw = readFileSync(EVOLUTION_EVENTS_FILE, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean).reverse();
    const events = lines.slice(0, limit).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    if (events.length === 0) {
      return {
        handled: true,
        skill: 'evolution-events',
        status: 'no_events',
        message: 'No EvolutionEvents recorded yet.',
      };
    }

    const formatted = events.map((e, i) => {
      const result = e.result === 'success' ? '✅ success' : `❌ ${e.result}`;
      const intent = e.intent || 'unknown';
      const skill = e.skill_name || 'unknown';
      const ts = e.timestamp ? new Date(e.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '';
      const strategy = e.strategy || '';
      return `${i + 1}. [${ts}] ${result} | intent=${intent} | skill=${skill} | ${strategy}`;
    });

    const total = lines.length;
    return {
      handled: true,
      skill: 'evolution-events',
      status: 'success',
      count: events.length,
      total,
      limit,
      events: events.map(e => ({
        event_id: e.event_id,
        timestamp: e.timestamp,
        intent: e.intent,
        skill_name: e.skill_name,
        result: e.result,
        strategy: e.strategy,
        validation_output: e.validation_output,
      })),
      formatted,
      message: `EvolutionEvents (${events.length}/${total} shown):\n${formatted.join('\n')}`,
    };
  } catch (e) {
    return {
      handled: true,
      skill: 'evolution-events',
      status: 'error',
      message: `Failed to read events: ${e.message}`,
    };
  }
}
