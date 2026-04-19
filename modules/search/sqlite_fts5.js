/**
 * SQLite FTS5 Search — Hermes FTS5-style Full-text Search
 * 会话搜索 - Hermes SQLite FTS5 实现
 *
 * 使用 Python sqlite3 FTS5 实现 BM25 排名
 * 数据源: OpenClaw session .jsonl 文件
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const STATE_DIR = 'C:/Users/Administrator/.openclaw';
const MEMORY_DIR = STATE_DIR + '/memory';
const SESSIONS_DIR = STATE_DIR + '/agents/main/sessions';
const DB_PATH = MEMORY_DIR + '/fts5.db';
const BRIDGE_SCRIPT = resolve(import.meta.dirname, 'sqlite_fts5_bridge.py');

// ============================================================================
// Bridge Helpers
// ============================================================================

function pythonBridge(args) {
  try {
    const result = execFileSync('python', [BRIDGE_SCRIPT, ...args], {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(result.trim());
  } catch (e) {
    // Extract error from stderr
    const match = e.stderr ? e.stderr.match(/Error: (.+)/) : null;
    throw new Error(match ? match[1] : e.message);
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Index all sessions in the sessions directory
 * @returns {Promise<{indexed_sessions: number, stats: object}>}
 */
export async function buildIndex() {
  if (!existsSync(SESSIONS_DIR)) {
    return { indexed_sessions: 0, stats: { error: 'Sessions dir not found' } };
  }
  return pythonBridge(['index', SESSIONS_DIR, DB_PATH]);
}

/**
 * Search sessions with BM25 ranking
 * @param {string} query - Search query
 * @param {object} [options]
 * @param {number} [options.limit=20] - Max results
 * @param {string} [options.session_id] - Filter by session
 * @param {string} [options.role] - Filter by role (user/assistant)
 * @returns {Promise<Array>} Search results with snippets
 */
export async function search(query, options = {}) {
  const { limit = 20, session_id, role } = options;
  const results = pythonBridge([
    'search',
    query,
    DB_PATH,
    String(limit),
    ...(session_id ? [session_id] : []),
    ...(role ? [role] : [])
  ]);
  return results;
}

/**
 * Get session summary
 * @param {string} sessionId
 * @returns {Promise<object>} Session summary
 */
export async function getSummary(sessionId) {
  return pythonBridge(['summary', sessionId, DB_PATH]);
}

/**
 * Get index statistics
 * @returns {Promise<object>} Stats
 */
export async function getStats() {
  return pythonBridge(['stats', DB_PATH]);
}

/**
 * List indexed sessions
 * @returns {Promise<string[]>} Session IDs
 */
export async function listSessions() {
  return pythonBridge(['list', DB_PATH]);
}

// ============================================================================
// EventEmitter Session Store Integration
// ============================================================================

import { EventEmitter } from '../eventEmitter.js';

class Fts5SessionIndexer extends EventEmitter {
  constructor() {
    super();
    this.dbPath = DB_PATH;
    this.indexedSessions = new Set();
  }

  async indexAllSessions() {
    const result = await buildIndex();
    if (result.stats?.total_sessions) {
      const sessions = await listSessions();
      sessions.forEach(s => this.indexedSessions.add(s));
    }
    return result;
  }

  async searchSessions(query, options = {}) {
    return search(query, options);
  }
}

let _indexer = null;

export function getFts5Indexer() {
  if (!_indexer) {
    _indexer = new Fts5SessionIndexer();
  }
  return _indexer;
}
