/**
 * OMLS-Inspired Idle Scheduler for OpenClaw
 * 
 * Design philosophy (from Evolver): "The idle system is, the more aggressively it works"
 * - Detects idle windows (no user activity for N minutes)
 * - During idle: triggers failure distillation + active exploration
 * - Uses adaptive multipliers to avoid disrupting active work
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const STATE_FILE = join(process.env.APPDATA || '', '.openclaw', 'memory', 'idle_scheduler_state.json');
const SESSION_DIR = join(process.env.APPDATA || '', '.openclaw', 'sessions');

// Thresholds
const IDLE_THRESHOLD_MS = 5 * 60 * 1000;        // 5 min silent → idle
const MEDIUM_IDLE_MS = 15 * 60 * 1000;         // 15-30 min → medium
const AGGRESSIVE_IDLE_MS = 30 * 60 * 1000;      // 30+ min → aggressive

let _state = null;

function loadState() {
  if (_state) return _state;
  try {
    if (existsSync(STATE_FILE)) {
      _state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
      return _state;
    }
  } catch { /* ignore */ }
  
  _state = {
    last_activity_ts: Date.now(),
    idle_episodes: 0,
    consecutive_idle_cycles: 0,
    last_recommendation: null,
  };
  return _state;
}

function saveState(state) {
  try {
    const dir = dirname(STATE_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch { /* ignore */ }
}

/**
 * Call when user activity is detected — resets idle tracking
 */
export function onActivity() {
  const state = loadState();
  const was_idle = state.consecutive_idle_cycles > 0;
  state.last_activity_ts = Date.now();
  state.consecutive_idle_cycles = 0;
  saveState(state);
  
  if (was_idle) {
    console.log(`[OMLS] Returned from idle (episode #${state.idle_episodes})`);
  }
}

/**
 * Get current idle schedule recommendation
 * Returns: { enabled, idle_seconds, intensity, sleep_multiplier, should_distill, should_explore, reason }
 */
export function getScheduleRecommendation() {
  const state = loadState();
  const elapsed_ms = Date.now() - state.last_activity_ts;
  const is_idle = elapsed_ms >= IDLE_THRESHOLD_MS;
  
  if (!is_idle) {
    const schedule = {
      enabled: false,
      idle_seconds: 0,
      intensity: 0,
      sleep_multiplier: 1,
      should_distill: false,
      should_explore: false,
      reason: 'System is active',
    };
    state.last_recommendation = schedule;
    saveState(state);
    return schedule;
  }
  
  // Idle mode
  state.consecutive_idle_cycles++;
  if (state.consecutive_idle_cycles === 1) {
    state.idle_episodes++;
  }
  saveState(state);
  
  const idle_seconds = Math.floor((elapsed_ms - IDLE_THRESHOLD_MS) / 1000);
  const idle_min = idle_seconds / 60;
  const lastRec = state.last_recommendation;
  
  let intensity, should_distill, should_explore, sleep_multiplier, reason;
  
  if (idle_min >= 30) {
    intensity = 3;
    should_distill = true;
    should_explore = true;
    sleep_multiplier = 4;
    reason = 'Long idle (30+ min) — full aggressive mode';
  } else if (idle_min >= 15) {
    intensity = 2;
    should_distill = state.idle_episodes % 2 === 0;
    should_explore = true;
    sleep_multiplier = 2;
    reason = 'Medium idle (15-30 min) — distill + explore';
  } else {
    intensity = 1;
    should_distill = state.consecutive_idle_cycles % 3 === 1;
    should_explore = state.consecutive_idle_cycles % 2 === 0;
    sleep_multiplier = 1.5;
    reason = `Light idle — cycle #${state.consecutive_idle_cycles}`;
  }
  
  // Throttle explore if we just ran it
  if (lastRec?.should_explore && state.consecutive_idle_cycles < 3) {
    should_explore = false;
  }
  
  // Only distill if failure patterns detected
  if (!hasRecentFailures()) {
    should_distill = false;
  }
  
  return {
    enabled: true,
    idle_seconds,
    intensity,
    sleep_multiplier,
    should_distill,
    should_explore,
    reason,
  };
}

/**
 * Check for failure/error patterns in recent sessions
 */
function hasRecentFailures() {
  try {
    if (!existsSync(SESSION_DIR)) return false;
    
    const files = readdirSync(SESSION_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .slice(-5);
    
    let total = 0, errors = 0;
    
    for (const file of files) {
      const lines = readFileSync(join(SESSION_DIR, file), 'utf8')
        .split('\n').filter(Boolean);
      
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.type !== 'message') continue;
          const content = (msg.message?.content || '').toLowerCase();
          total++;
          if (/\b(error|failed|exception|bug|broken|crash|fix this)\b/.test(content)) {
            errors++;
          }
        } catch { /* skip */ }
      }
    }
    
    return total > 10 && (errors / total) > 0.03;
  } catch {
    return false;
  }
}

/**
 * Explore for new signals during idle window
 * Returns array of signal strings
 */
export async function exploreSignals() {
  const signals = [];
  
  try {
    // 1. New skills in registry
    const regPath = join(process.env.APPDATA || '', '.openclaw', 'memory', 'skill_registry.json');
    if (existsSync(regPath)) {
      const reg = JSON.parse(readFileSync(regPath, 'utf8'));
      const recent = (reg.skills || []).filter(s => {
        if (!s.createdAt) return false;
        return Date.now() - new Date(s.createdAt).getTime() < 24 * 60 * 60 * 1000;
      });
      if (recent.length > 0) {
        signals.push(`new_skills:${recent.map(s => s.id).join(',')}`);
      }
    }
    
    // 2. Sessions with high tool usage
    if (existsSync(SESSION_DIR)) {
      const files = readdirSync(SESSION_DIR)
        .filter(f => f.endsWith('.jsonl'))
        .sort()
        .slice(-3);
      
      for (const file of files) {
        const lines = readFileSync(join(SESSION_DIR, file), 'utf8')
          .split('\n').filter(Boolean);
        const toolCalls = lines.filter(l => {
          try {
            const m = JSON.parse(l);
            return m.type === 'message' && m.message?.role === 'assistant' &&
              /tool_used|using (Bash|node|python)/.test(m.message?.content || '');
          } catch { return false; }
        });
        if (toolCalls.length > 20) {
          signals.push(`high_tool_usage:${file.replace('.jsonl', '')}:calls=${toolCalls.length}`);
        }
      }
    }
    
    // 3. Today's memory contains errors
    const today = new Date().toISOString().slice(0, 10);
    const memPath = join(process.env.APPDATA || '', '.openclaw', 'memory', `${today}.md`);
    if (existsSync(memPath)) {
      const content = readFileSync(memPath, 'utf8');
      if (/error|failed|exception/.test(content)) {
        signals.push('memory_errors_detected');
      }
    }
    
  } catch (e) {
    console.warn('[OMLS] exploreSignals error:', e);
  }
  
  return signals;
}

/**
 * Get idle stats
 */
export function getIdleStats() {
  const state = loadState();
  return {
    idle_episodes: state.idle_episodes,
    consecutive_cycles: state.consecutive_idle_cycles,
    last_activity_age_ms: Date.now() - state.last_activity_ts,
  };
}
