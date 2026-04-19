/**
 * Session FTS — Pure TypeScript BM25 Full-text Search
 * =====================================================
 *
 * Hermes FTS5-style search in pure TypeScript.
 * Searches session .jsonl files using BM25 ranking.
 * No native modules required — works in any JS runtime.
 *
 * Architecture:
 * - In-memory inverted index built from session .jsonl files
 * - BM25 scoring with Porter stemming (pure JS)
 * - Snippet extraction with context windows
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

export interface FtsResult {
  sessionId: string;
  messageId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  score: number;
  snippet: string;
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  firstMessage: string;
  lastMessage: string;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  durationMinutes: number;
  topics: string[];
}

export interface IndexStats {
  totalMessages: number;
  totalSessions: number;
  indexedAt: number;
  lastRebuilt: number;
}

// ============================================================================
// Tokenizer — Simple English + Chinese stemmer
// ============================================================================

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could','should',
  'may','might','can','to','of','in','for','on','with','at','by',
  'from','as','or','and','it','its','this','that','these','those',
  'i','me','my','we','our','you','your','he','she','they','them',
  'what','which','who','whom','when','where','why','how',
  '的','了','在','是','和','就','都','也','要','会','能','这','那',
  '我','你','他','她','它','们','个','上','下','来','去','着',
]);

function tokenize(text: string): string[] {
  // Split on non-word chars, keep Chinese chars
  const tokens: string[] = [];
  // CJK chars as individual tokens
  const cjk = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const word of cjk) {
    tokens.push(word.toLowerCase());
  }
  // English/latin words
  const words = text.match(/[a-zA-Z]{2,}/g) || [];
  for (const word of words) {
    const lower = word.toLowerCase();
    if (!STOP_WORDS.has(lower)) {
      tokens.push(lower);
    }
  }
  return tokens;
}

function stem(token: string): string {
  // Simple Porter stemmer for English
  if (token.length <= 2) return token;
  // Very simplified stemming
  if (token.endsWith('ing')) return token.slice(0, -3);
  if (token.endsWith('ed')) return token.slice(0, -2);
  if (token.endsWith('es')) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  if (token.endsWith('ly')) return token.slice(0, -2);
  if (token.endsWith('tion')) return token.slice(0, -4);
  if (token.endsWith('ness')) return token.slice(0, -4);
  return token;
}

// ============================================================================
// BM25 Parameters
// ============================================================================

const BM25_K1 = 1.5;
const BM25_B = 0.75;

// ============================================================================
// In-Mverted Index
// ============================================================================

interface Posting {
  sessionId: string;
  messageId: string;
  role: string;
  content: string;
  timestamp: number;
  terms: string[];
}

interface Index {
  postings: Map<string, Posting[]>;  // term → postings
  documents: Map<string, Posting>;   // messageId → posting
  sessionDocs: Map<string, Set<string>>;  // sessionId → messageIds
  avgDocLen: number;
  N: number;
  docLens: Map<string, number>;
}

let _index: Index | null = null;
let _indexStats: IndexStats | null = null;

function createEmptyIndex(): Index {
  return {
    postings: new Map(),
    documents: new Map(),
    sessionDocs: new Map(),
    avgDocLen: 0,
    N: 0,
    docLens: new Map(),
  };
}

// ============================================================================
// Parsing
// ============================================================================

interface ParsedMessage {
  sessionId: string;
  messageId: string;
  role: string;
  content: string;
  timestamp: number;
}

function parseMessage(obj: Record<string, unknown>, sessionId: string): ParsedMessage | null {
  if (obj.type !== 'message') return null;

  const msg = obj.message as Record<string, unknown> | undefined;
  if (!msg) return null;

  const role = msg.role as string;
  if (!['user', 'assistant', 'tool'].includes(role)) return null;

  const msgId = (obj.id as string) || `msg_${Object.keys(obj).length}`;
  let ts: number;

  const tsVal = obj.timestamp;
  if (typeof tsVal === 'number') {
    ts = tsVal;
  } else if (typeof tsVal === 'string') {
    ts = new Date(tsVal).getTime();
  } else {
    ts = Date.now();
  }

  const contentBlocks = msg.content;
  let text = '';
  if (Array.isArray(contentBlocks)) {
    for (const block of contentBlocks) {
      if (typeof block === 'object' && block && 'type' in block) {
        const b = block as Record<string, unknown>;
        if (b.type === 'text') {
          text += (b.text as string) + ' ';
        }
      }
    }
  }
  text = text.trim();

  if (!text || text.length < 5) return null;

  return { sessionId, messageId: msgId, role, content: text, timestamp: ts };
}

// ============================================================================
// Index Building
// ============================================================================

function buildIndex(sessionsDir: string): Index {
  const index = createEmptyIndex();
  const files = readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl') && !f.endsWith('.lock'));

  let totalLen = 0;

  for (const file of files) {
    const sessionId = file.replace('.jsonl', '');
    const filePath = join(sessionsDir, file);

    let sessionDocIds: Set<string> = new Set();

    try {
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          const parsed = parseMessage(obj, sessionId);
          if (!parsed) continue;

          const terms = tokenize(parsed.content).map(stem);

          const posting: Posting = {
            ...parsed,
            terms,
          };

          // Add to documents
          index.documents.set(parsed.messageId, posting);
          sessionDocIds.add(parsed.messageId);
          index.N++;

          const docLen = terms.length;
          totalLen += docLen;
          index.docLens.set(parsed.messageId, docLen);

          // Add to inverted index
          const uniqueTerms = [...new Set(terms)];
          for (const term of uniqueTerms) {
            const postingList = index.postings.get(term) || [];
            postingList.push(posting);
            index.postings.set(term, postingList);
          }
        } catch { /* skip invalid lines */ }
      }
    } catch { /* skip unreadable files */ }

    if (sessionDocIds.size > 0) {
      index.sessionDocs.set(sessionId, sessionDocIds);
    }
  }

  index.avgDocLen = index.N > 0 ? totalLen / index.N : 0;
  return index;
}

// ============================================================================
// BM25 Scoring
// ============================================================================

function scoreBM25(query: string[], index: Index): Array<{ posting: Posting; score: number }> {
  const scores = new Map<string, number>();

  // IDF for each term
  const idf = new Map<string, number>();
  for (const term of query) {
    const postings = index.postings.get(term) || [];
    const df = postings.length;
    // IDF formula: log((N - n + 0.5) / (n + 0.5) + 1)
    const idfVal = Math.log((index.N - df + 0.5) / (df + 0.5) + 1);
    idf.set(term, idfVal);
  }

  // Score each document
  for (const [docId, doc] of index.documents) {
    let score = 0;
    const docLen = index.docLens.get(docId) || 0;

    for (const term of query) {
      const postings = index.postings.get(term) || [];
      const tf = postings.filter(p => p.messageId === docId).length;
      if (tf === 0) continue;

      const idfVal = idf.get(term) || 0;
      const numerator = tf * (BM25_K1 + 1);
      const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / (index.avgDocLen || 1)));
      score += idfVal * (numerator / denominator);
    }

    if (score > 0) {
      scores.set(docId, score);
    }
  }

  // Sort by score
  const results: Array<{ posting: Posting; score: number }> = [];
  for (const [docId, score] of scores) {
    const posting = index.documents.get(docId);
    if (posting) {
      results.push({ posting, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ============================================================================
// Snippet Generation
// ============================================================================

function generateSnippet(content: string, query: string, maxLen = 200): string {
  const queryWords = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const contentLower = content.toLowerCase();

  let bestPos = -1;
  for (const word of queryWords) {
    const pos = contentLower.indexOf(word);
    if (pos >= 0) {
      bestPos = pos;
      break;
    }
  }

  if (bestPos < 0) {
    return content.slice(0, maxLen) + (content.length > maxLen ? '...' : '');
  }

  const start = Math.max(0, bestPos - 60);
  const end = Math.min(content.length, start + maxLen);
  let snippet = content.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';

  return snippet;
}

// ============================================================================
// Public API
// ============================================================================

export function rebuildIndex(sessionsDir: string): IndexStats {
  _index = buildIndex(sessionsDir);
  _indexStats = {
    totalMessages: _index.N,
    totalSessions: _index.sessionDocs.size,
    indexedAt: Date.now(),
    lastRebuilt: Date.now(),
  };
  return _indexStats;
}

export function search(query: string, options: {
  limit?: number;
  sessionId?: string;
  role?: string;
} = {}): FtsResult[] {
  if (!_index) {
    throw new Error('Index not built. Call rebuildIndex() first.');
  }

  const { limit = 20, sessionId, role } = options;

  // Tokenize and stem query
  const queryTerms = [...new Set(tokenize(query).map(stem))];
  if (queryTerms.length === 0) return [];

  // Score documents
  let results = scoreBM25(queryTerms, _index);

  // Filter
  if (sessionId) {
    results = results.filter(r => r.posting.sessionId === sessionId);
  }
  if (role) {
    results = results.filter(r => r.posting.role === role);
  }

  // Take top N and format
  return results.slice(0, limit).map(({ posting, score }) => ({
    sessionId: posting.sessionId,
    messageId: posting.messageId,
    role: posting.role as 'user' | 'assistant' | 'tool',
    content: posting.content,
    timestamp: posting.timestamp,
    score,
    snippet: generateSnippet(posting.content, query),
  }));
}

export function getStats(): IndexStats | null {
  return _indexStats;
}

export function getSessionSummary(sessionId: string): SessionSummary | null {
  if (!_index) return null;

  const docIds = _index.sessionDocs.get(sessionId);
  if (!docIds || docIds.size === 0) return null;

  const docs = [...docIds].map(id => _index!.documents.get(id)).filter(Boolean) as Posting[];

  if (docs.length === 0) return null;

  // Sort by timestamp
  docs.sort((a, b) => a.timestamp - b.timestamp);

  const userDocs = docs.filter(d => d.role === 'user');
  const assistantDocs = docs.filter(d => d.role === 'assistant');

  const firstMsg = docs[0];
  const lastMsg = docs[docs.length - 1];

  const durationMs = lastMsg.timestamp - firstMsg.timestamp;

  // Extract topics
  const allTokens: string[] = [];
  for (const doc of userDocs) {
    allTokens.push(...doc.terms);
  }
  const tokenCounts = new Map<string, number>();
  for (const t of allTokens) {
    tokenCounts.set(t, (tokenCounts.get(t) || 0) + 1);
  }
  const topTopics = [...tokenCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t);

  return {
    sessionId,
    title: userDocs[0]?.content.slice(0, 80) || 'Untitled',
    firstMessage: userDocs[0]?.content.slice(0, 300) || '',
    lastMessage: userDocs[userDocs.length - 1]?.content.slice(0, 300) || '',
    messageCount: docs.length,
    userMessageCount: userDocs.length,
    assistantMessageCount: assistantDocs.length,
    durationMinutes: durationMs / 60000,
    topics: topTopics,
  };
}

export function listSessions(): string[] {
  if (!_index) return [];
  return [..._index.sessionDocs.keys()];
}
