/**
 * Extractor - 通用记忆提取器
 * =============================
 *
 * 从文本中提取5种记忆类型:
 * 1. DECISIONS — 决策: "we went with X because Y"
 * 2. PREFERENCES — 偏好: "always use X", "never do Y"
 * 3. MILESTONES — 里程碑: breakthroughs, finally worked
 * 4. PROBLEMS — 问题: what broke, what fixed it
 * 5. EMOTIONAL — 情感: feelings, vulnerability, relationships
 *
 * 无需 LLM, 纯正则/关键词启发式
 */

import {
  MemoryType,
  ExtractedMemory,
  ExtractorConfig,
  Drawer,
} from './types'

// ============================================================================
// Marker Sets (标记词集)
// ============================================================================

const DECISION_MARKERS = [
  /\blet'?s\s+(use|go\s+with|try|pick|choose|switch\s+to)\b/i,
  /\bwe\s+(should|decided|chose|went\s+with|picked|settled\s+on)\b/i,
  /\bi'?m\s+going\s+(to|with)\b/i,
  /\bbetter\s+(to|than|approach|option|choice)\b/i,
  /\binstead\s+of\b/i,
  /\brather\s+than\b/i,
  /\bthe\s+reason\s+(is|was|being)\b/i,
  /\bbecause\b/i,
  /\btrade-?off\b/i,
  /\bpros\s+and\s+cons\b/i,
  /\barchitecture\b/i,
  /\bapproach\b/i,
  /\bstrategy\b/i,
  /\bpattern\b/i,
  /\bstack\b/i,
  /\bframework\b/i,
  /\bswitched\b/i,
  /\bmigrated\b/i,
]

const PREFERENCE_MARKERS = [
  /\bi\s+prefer\b/i,
  /\balways\s+use\b/i,
  /\bnever\s+use\b/i,
  /\bdon'?t\s+(ever\s+)?(use|do|mock|stub|import)\b/i,
  /\bi\s+like\s+(to|when|how)\b/i,
  /\bi\s+hate\s+(when|how|it\s+when)\b/i,
  /\bplease\s+(always|never|don'?t)\b/i,
  /\bmy\s+(rule|preference|style|convention)\s+is\b/i,
  /\bwe\s+(always|never)\b/i,
  /\bfunctional\b.*\bstyle\b/i,
  /\bimperative\b/i,
  /\bsnake_?case\b/i,
  /\bcamel_?case\b/i,
  /\btabs\b.*\bspaces\b/i,
  /\bs paces\b.*\btabs\b/i,
  /\bmy\s+(first|second|third)\s+choice\b/i,
]

const MILESTONE_MARKERS = [
  /\bit\s+works\b/i,
  /\bit\s+worked\b/i,
  /\bgot\s+it\s+working\b/i,
  /\bfixed\b/i,
  /\bsolved\b/i,
  /\bbreakthrough\b/i,
  /\bfigured\s+(it\s+)?out\b/i,
  /\bnailed\s+it\b/i,
  /\bcracked\s+(it|the)\b/i,
  /\bfinally\b/i,
  /\bfirst\s+time\b/i,
  /\bfirst\s+ever\b/i,
  /\bnever\s+(done|been|had)\s+before\b/i,
  /\bdiscovered\b/i,
  /\brealized\b/i,
  /\bfound\s+(out|that)\b/i,
  /\bturns\s+out\b/i,
  /\bthe\s+key\s+(is|was|insight)\b/i,
  /\bthe\s+trick\s+(is|was)\b/i,
  /\bnow\s+i\s+(understand|see|get\s+it)\b/i,
  /\bbuilt\b/i,
  /\bcreated\b/i,
  /\bimplemented\b/i,
  /\bshipped\b/i,
  /\blaunched\b/i,
  /\bdeployed\b/i,
  /\breleased\b/i,
  /\bprototype\b/i,
  /\bproof\s+of\s+concept\b/i,
  /\bdemo\b/i,
  /\b\d+x\s+(compression|faster|slower|better|improvement|reduction)\b/i,
  /\b\d+%\s+(reduction|improvement|faster|better|smaller)\b/i,
]

const PROBLEM_MARKERS = [
  /\b(bug|error|crash|fail|broke|broken|issue|problem)s?\b/i,
  /\bdoesn'?t\s+work\b/i,
  /\bnot\s+working\b/i,
  /\bwon'?t\b.*\bwork\b/i,
  /\bkeeps?\s+(failing|crashing|breaking|erroring)\b/i,
  /\broot\s+cause\b/i,
  /\bthe\s+(problem|issue|bug)\s+(is|was)\b/i,
  /\bthe\s+fix\s+(is|was)\b/i,
  /\bworkaround\b/i,
  /\bthat'?s\s+why\b/i,
  /\bthe\s+reason\s+it\b/i,
  /\bsolution\s+(is|was)\b/i,
  /\bresolved\b/i,
  /\bpatched\b/i,
  /\bthe\s+answer\s+(is|was)\b/i,
]

const EMOTION_MARKERS = [
  /\blove[sd]?\b/i,
  /\bscared\b/i,
  /\bafraid\b/i,
  /\bproud\b/i,
  /\bhurt[ing]?\b/i,
  /\bhappy\b/i,
  /\bsad\b/i,
  /\bcry(ing)?\b/i,
  /\bmiss(ing|ed)?\b/i,
  /\bsorry\b/i,
  /\bgrateful\b/i,
  /\bangry\b/i,
  /\bworried\b/i,
  /\blonely\b/i,
  /\bbeautiful\b/i,
  /\bamazing\b/i,
  /\bwonderful\b/i,
  /\bi\s+feel\b/i,
  /\bi'?m\s+scared\b/i,
  /\bi\s+love\s+you\b/i,
  /\bi'?m\s+sorry\b/i,
  /\bi\s+can'?t\b/i,
  /\bi\s+wish\b/i,
  /\bi\s+need\b/i,
  /\bnever\s+told\s+anyone\b/i,
  /\bnobody\s+knows\b/i,
]

// 代码行模式
const CODE_LINE_PATTERNS = [
  /^\s*[\$#]\s/,
  /^\s*(cd|source|echo|export|pip|npm|git|python|bash|curl|wget|mkdir|rm|cp|mv|ls|cat|grep|find|chmod|sudo|brew|docker)\s/,
  /^\s*```/,
  /^\s*(import|from|def|class|function|const|let|var|return)\s/,
  /^\s*[A-Z_]{2,}=/,
  /^\s*\|/,
  /^\s*[-]{2,}/,
  /^\s*[{}\[\]]\s*$/,
  /^\s*(if|for|while|try|except|elif|else:)\b/,
  /^\s*\w+\.\w+\(/,
  /^\s*\w+\s*=\s*\w+\.\w+/,
]

// ============================================================================
// Sentiment Analysis (情感分析)
// ============================================================================

const POSITIVE_WORDS = new Set([
  'pride', 'proud', 'joy', 'happy', 'love', 'loving', 'beautiful', 'amazing',
  'wonderful', 'incredible', 'fantastic', 'brilliant', 'perfect', 'excited',
  'thrilled', 'grateful', 'warm', 'breakthrough', 'success', 'works', 'working',
  'solved', 'fixed', 'nailed', 'heart', 'hug', 'precious', 'adore',
])

const NEGATIVE_WORDS = new Set([
  'bug', 'error', 'crash', 'crashing', 'crashed', 'fail', 'failed', 'failing',
  'failure', 'broken', 'broke', 'breaking', 'breaks', 'issue', 'problem',
  'wrong', 'stuck', 'blocked', 'unable', 'impossible', 'missing', 'terrible',
  'horrible', 'awful', 'worse', 'worst', 'panic', 'disaster', 'mess',
])

function getSentiment(text: string): 'positive' | 'negative' | 'neutral' {
  const words = new Set(
    text.toLowerCase().match(/\b\w+\b/g) || []
  )

  let pos = 0
  let neg = 0

  for (const word of words) {
    if (POSITIVE_WORDS.has(word)) pos++
    if (NEGATIVE_WORDS.has(word)) neg++
  }

  if (pos > neg) return 'positive'
  if (neg > pos) return 'negative'
  return 'neutral'
}

function hasResolution(text: string): boolean {
  const patterns = [
    /\bfixed\b/i,
    /\bsolved\b/i,
    /\bresolved\b/i,
    /\bpatched\b/i,
    /\bgot\s+it\s+working\b/i,
    /\bit\s+works\b/i,
    /\bnailed\s+it\b/i,
    /\bfigured\s+(it\s+)?out\b/i,
    /\bthe\s+(fix|answer|solution)\b/i,
  ]

  return patterns.some(p => p.test(text))
}

// ============================================================================
// Code Filtering (代码过滤)
// ============================================================================

function isCodeLine(line: string): boolean {
  const stripped = line.trim()
  if (!stripped) return false

  for (const pattern of CODE_LINE_PATTERNS) {
    if (pattern.test(stripped)) return true
  }

  // 字母比例过低可能是代码
  const alphaRatio = (stripped.match(/[a-zA-Z]/g) || []).length / Math.max(stripped.length, 1)
  if (alphaRatio < 0.4 && stripped.length > 10) return true

  return false
}

function extractProse(text: string): string {
  const lines = text.split('\n')
  const prose: string[] = []
  let inCode = false

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCode = !inCode
      continue
    }

    if (inCode) continue

    if (!isCodeLine(line)) {
      prose.push(line)
    }
  }

  const result = prose.join('\n').trim()
  return result || text
}

// ============================================================================
// Weighted Marker Sets (带权重的标记)
// ============================================================================
// Each entry: [RegExp, weight] — strong markers score 2, weak ones score 1

type WeightedMarkers = Array<[RegExp, number]>

const WEIGHTED_DECISION_MARKERS: WeightedMarkers = [
  [/\bwe\s+(should|decided|chose|went\s+with|picked|settled\s+on)\b/i, 2],
  [/\bthe\s+reason\s+(is|was)\b/i, 2],
  [/\bbecause\s+[^.!?]{10,50}\b/i, 2],          // "because ..." (with content)
  [/\btrade-?off\b/i, 2],
  [/\barchitecture\s+(decision|choice|pattern)\b/i, 2],
  [/\b(let'?s|lets)\s+(use|go\s+with|try|pick|choose|switch\s+to)\b/i, 2],
  [/\bi'?m\s+going\s+(to|with)\b/i, 1],
  [/\bbetter\s+(to|than|approach|option|choice)\b/i, 1],
  [/\binstead\s+of\b/i, 1],
  [/\brather\s+than\b/i, 1],
  [/\bpros\s+and\s+cons\b/i, 1],
  [/\bapproach\b/i, 1],
  [/\bstrategy\b/i, 1],
  [/\bpattern\b/i, 1],
  [/\bstack\b/i, 1],
  [/\bframework\b/i, 1],
  [/\bswitched\b/i, 1],
  [/\bmigrated\b/i, 1],
]

const WEIGHTED_PREFERENCE_MARKERS: WeightedMarkers = [
  [/\bi\s+prefer\b/i, 2],
  [/\balways\s+use\b/i, 2],
  [/\bnever\s+use\b/i, 2],
  [/\bdon'?t\s+ever\s+(use|do)\b/i, 2],
  [/\bmy\s+(rule|preference|style|convention)\s+is\b/i, 2],
  [/\bwe\s+(always|never)\b/i, 2],
  [/\bplease\s+(always|never)\b/i, 2],
  [/\bsnake_?case\b/i, 2],
  [/\bcamel_?case\b/i, 2],
  [/\bi\s+like\s+(to|when|how)\b/i, 1],
  [/\bi\s+hate\s+(when|how)\b/i, 1],
  [/\bmy\s+(first|second|third)\s+choice\b/i, 1],
  [/\bfunctional\b.*\bstyle\b/i, 1],
  [/\bimperative\b/i, 1],
  [/\btabs\b.*\bspaces\b/i, 1],
]

const WEIGHTED_MILESTONE_MARKERS: WeightedMarkers = [
  [/\b(fixed|solved|resolved|nailed)\s+it\b/i, 2],
  [/\bit\s+(works?|worked)\b/i, 2],
  [/\b(got|getting)\s+it\s+working\b/i, 2],
  [/\b(breakthrough|figured\s+it\s+out)\b/i, 2],
  [/\b(first\s+time|first\s+ever)\b/i, 2],
  [/\b(shipped|launched|deployed|released)\b/i, 2],
  [/\b(built|created|implemented)\s+it\b/i, 2],
  [/\b(proof\s+of\s+concept|prototype|demo)\b/i, 2],
  [/\b\d+%\s+(reduction|improvement|faster|better|smaller)\b/i, 2],
  [/\b\d+x\s+(compression|faster|better|improvement)\b/i, 2],
  [/\bfinally\b/i, 1],
  [/\b(demo|prototype)\b/i, 1],
  [/\b(discovery|realized|found\s+out)\b/i, 1],
  [/\bthe\s+(key|trick)\s+(is|was)\b/i, 1],
]

const WEIGHTED_PROBLEM_MARKERS: WeightedMarkers = [
  [/\b(bug|error|crash|failing|crashing)\b/i, 2],
  [/\b(broke|broken)\b/i, 2],
  [/\bdoesn'?t\s+work\b/i, 2],
  [/\broot\s+cause\b/i, 2],
  [/\bthe\s+(problem|issue|bug)\s+(is|was)\b/i, 2],
  [/\bkeeps?\s+(failing|crashing|breaking)\b/i, 2],
  [/\bwon'?t\b.*\bwork\b/i, 1],
  [/\bworkaround\b/i, 1],
  [/\bsolution\s+(is|was)\b/i, 1],
  [/\bthat'?s\s+why\b/i, 1],
  [/\bthe\s+answer\s+(is|was)\b/i, 1],
  [/\b/p\b.*\s+.*\s+.*\s+.*\s+.*\b/i, 1],  // short "/" alone is weak
]

const WEIGHTED_EMOTION_MARKERS: WeightedMarkers = [
  [/\b(i\s+love|love[d]?|loving)\b/i, 2],
  [/\b(i\s+hate|hate[d]?|hating)\b/i, 2],
  [/\b(beautiful|amazing|wonderful|fantastic)\b/i, 2],
  [/\bi\s+(feel|felt)\b/i, 2],
  [/\b(grateful|proud|scared|worried)\b/i, 2],
  [/\b(i\s+can'?t|i\s+wish|i\s+need)\b/i, 2],
  [/\bnever\s+told\s+anyone\b/i, 2],
  [/\bnobody\s+knows\b/i, 2],
  [/\b(sorry|angry|sad|lucky)\b/i, 1],
  [/\bmiss|lonely\b/i, 1],
]

// Minimum weighted score to classify as a specific type (vs general)
const MIN_SCORE_THRESHOLD = 2
// Minimum raw marker matches to even consider non-general
const MIN_MATCHES_FOR_TYPE = 2

/**
 * Weighted marker scoring — each marker has a weight (1-2).
 * Returns weighted score and matched markers.
 */
function scoreMarkersWeighted(
  text: string,
  markers: WeightedMarkers
): { score: number; matched: string[]; strongMatches: string[] } {
  const matched: string[] = []
  const strongMatches: string[] = []
  let score = 0

  for (const [marker, weight] of markers) {
    if (marker.test(text)) {
      matched.push(marker.source)
      score += weight
      if (weight >= 2) strongMatches.push(marker.source)
    }
  }

  return { score, matched, strongMatches }
}

// ============================================================================
// Disambiguation (歧义消解)
// ============================================================================

function disambiguate(
  memoryType: MemoryType,
  text: string,
  scores: Record<MemoryType, number>
): MemoryType {
  const sentiment = getSentiment(text)

  // 已解决的问题 → Milestone
  if (memoryType === 'problem' && hasResolution(text)) {
    if (scores.emotional && sentiment === 'positive') {
      return 'emotional'
    }
    return 'milestone'
  }

  // Problem + positive → Milestone or Emotional
  if (memoryType === 'problem' && sentiment === 'positive') {
    if (scores.milestone) return 'milestone'
    if (scores.emotional) return 'emotional'
  }

  return memoryType
}

// ============================================================================
// Chunking (分块)
// ============================================================================

const DEFAULT_CHUNK_SIZE = 800
const DEFAULT_MIN_CHUNK = 50
const DEFAULT_OVERLAP = 100

function chunkText(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  minChunk = DEFAULT_MIN_CHUNK,
  overlap = DEFAULT_OVERLAP
): string[] {
  const cleaned = text.trim()
  if (!cleaned) return []

  const chunks: string[] = []
  let start = 0

  while (start < cleaned.length) {
    let end = Math.min(start + chunkSize, cleaned.length)

    // 尝试在段落边界分割
    if (end < cleaned.length) {
      const paragraphBreak = cleaned.lastIndexOf('\n\n', end)
      if (paragraphBreak > start + chunkSize / 2) {
        end = paragraphBreak
      } else {
        const lineBreak = cleaned.lastIndexOf('\n', end)
        if (lineBreak > start + chunkSize / 2) {
          end = lineBreak
        }
      }
    }

    const chunk = cleaned.slice(start, end).trim()

    if (chunk.length >= minChunk) {
      chunks.push(chunk)
    }

    start = end - overlap
    if (start < 0) start = end
  }

  return chunks
}

// ============================================================================
// Main Extractor (主提取器)
// ============================================================================

/**
 * 从文本中提取记忆
 */
export function extractMemories(
  content: string,
  config: Partial<ExtractorConfig> = {}
): ExtractedMemory[] {
  const includeCode = config.includeCode ?? false
  const minChunk = config.minChunkSize ?? DEFAULT_MIN_CHUNK
  const chunkSize = config.maxChunkSize ?? DEFAULT_CHUNK_SIZE

  // 提取纯文本 (如果配置了)
  const processText = includeCode ? content : extractProse(content)
  if (!processText.trim()) return []

  // 分块
  const chunks = chunkText(processText, chunkSize, minChunk)
  const memories: ExtractedMemory[] = []

  const allWeightedMarkers: Record<MemoryType, WeightedMarkers> = {
    decision: WEIGHTED_DECISION_MARKERS,
    preference: WEIGHTED_PREFERENCE_MARKERS,
    milestone: WEIGHTED_MILESTONE_MARKERS,
    problem: WEIGHTED_PROBLEM_MARKERS,
    emotional: WEIGHTED_EMOTION_MARKERS,
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]

    // Weighted scoring per type
    const scores: Record<MemoryType, number> = {
      decision: 0,
      preference: 0,
      milestone: 0,
      problem: 0,
      emotional: 0,
      general: 0,
    }
    const allMatched: string[] = []
    const strongMatches: string[] = []
    let totalWeightedScore = 0

    for (const [type, markers] of Object.entries(allWeightedMarkers) as [MemoryType, WeightedMarkers][]) {
      const result = scoreMarkersWeighted(chunk, markers)
      scores[type] = result.score
      allMatched.push(...result.matched)
      strongMatches.push(...result.strongMatches)
      totalWeightedScore += result.score
    }

    // Determine best type
    let maxType: MemoryType = 'general'
    let maxScore = 0

    for (const [type, score] of Object.entries(scores) as [MemoryType, number][]) {
      if (type === 'general') continue
      // Require minimum weighted score to beat 'general'
      if (score > maxScore && score >= MIN_SCORE_THRESHOLD) {
        maxScore = score
        maxType = type
      }
    }

    // Disambiguation
    if (maxScore >= MIN_SCORE_THRESHOLD) {
      maxType = disambiguate(maxType, chunk, scores)
    }

    // Confidence: weighted by score + strong match bonus
    // No matches → 0.1 (general)
    // Threshold match (2pts, 1 strong) → 0.5
    // Strong match (4pts+) → 0.8
    // Many strong matches (6pts+) → 0.95
    const strongBonus = strongMatches.length * 0.1
    const confidence = totalWeightedScore === 0
      ? 0.05
      : Math.min(0.95, 0.3 + (maxScore / 10) + strongBonus)

    // Sentiment analysis
    const sentiment = getSentiment(chunk)

    // Only save if confidence is meaningful
    if (totalWeightedScore > 0 && confidence >= 0.3) {
      memories.push({
        content: chunk,
        memoryType: maxType,
        chunkIndex: i,
        confidence,
        markers: allMatched.slice(0, 5),
        sentiment,
        importance: maxScore > 0 ? Math.min(5, Math.ceil(maxScore / 2)) : undefined,
      })
    }
  }

  // 按置信度排序
  memories.sort((a, b) => b.confidence - a.confidence)

  return memories
}

/**
 * 快速分类 (不分块)
 */
export function classifyText(text: string): {
  type: MemoryType
  confidence: number
  markers: string[]
} {
  const scores: Record<MemoryType, number> = {
    decision: 0,
    preference: 0,
    milestone: 0,
    problem: 0,
    emotional: 0,
    general: 0,
  }

  const allWeightedMarkers: Record<MemoryType, WeightedMarkers> = {
    decision: WEIGHTED_DECISION_MARKERS,
    preference: WEIGHTED_PREFERENCE_MARKERS,
    milestone: WEIGHTED_MILESTONE_MARKERS,
    problem: WEIGHTED_PROBLEM_MARKERS,
    emotional: WEIGHTED_EMOTION_MARKERS,
  }

  const allMatched: string[] = []

  for (const [type, markers] of Object.entries(allWeightedMarkers) as [MemoryType, WeightedMarkers][]) {
    const { score, matched } = scoreMarkersWeighted(text, markers)
    scores[type] = score
    allMatched.push(...matched)
  }

  let maxType: MemoryType = 'general'
  let maxScore = 0

  for (const [type, score] of Object.entries(scores) as [MemoryType, number][]) {
    if (type === 'general') continue
    if (score >= MIN_SCORE_THRESHOLD && score > maxScore) {
      maxScore = score
      maxType = type
    }
  }

  if (maxScore >= MIN_SCORE_THRESHOLD) {
    maxType = disambiguate(maxType, text, scores)
  }

  const confidence = maxScore === 0
    ? 0.05
    : Math.min(0.95, 0.4 + (maxScore / 10))

  return {
    type: maxType,
    confidence,
    markers: allMatched.slice(0, 5),
  }
}

// ============================================================================
// Export
// ============================================================================

export const Extractor = {
  extractMemories,
  classifyText,
  // Weighted constants
  WEIGHTED_DECISION_MARKERS,
  WEIGHTED_PREFERENCE_MARKERS,
  WEIGHTED_MILESTONE_MARKERS,
  WEIGHTED_PROBLEM_MARKERS,
  WEIGHTED_EMOTION_MARKERS,
  // Legacy unweighted (for compat)
  DECISION_MARKERS,
  PREFERENCE_MARKERS,
  MILESTONE_MARKERS,
  PROBLEM_MARKERS,
  EMOTION_MARKERS,
  // Helpers
  getSentiment,
  hasResolution,
  isCodeLine,
  extractProse,
  chunkText,
  MIN_SCORE_THRESHOLD,
}

export default Extractor
