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
// Marker Scoring (标记评分)
// ============================================================================

function scoreMarkers(
  text: string,
  markers: RegExp[]
): { score: number; matched: string[] } {
  const matched: string[] = []
  let score = 0

  for (const marker of markers) {
    if (marker.test(text)) {
      matched.push(marker.source)
      score++
    }
  }

  return { score, matched }
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

  const allMarkers: Record<MemoryType, RegExp[]> = {
    decision: DECISION_MARKERS,
    preference: PREFERENCE_MARKERS,
    milestone: MILESTONE_MARKERS,
    problem: PROBLEM_MARKERS,
    emotional: EMOTION_MARKERS,
    general: [],
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]

    // 对每种类型评分
    const scores: Record<MemoryType, number> = {
      decision: 0,
      preference: 0,
      milestone: 0,
      problem: 0,
      emotional: 0,
      general: 0,
    }

    const allMatched: string[] = []

    for (const [type, markers] of Object.entries(allMarkers) as [MemoryType, RegExp[]][]) {
      if (type === 'general') continue
      const { score, matched } = scoreMarkers(chunk, markers)
      scores[type] = score
      allMatched.push(...matched)
    }

    // 确定最可能的类型
    let maxType: MemoryType = 'general'
    let maxScore = 0

    for (const [type, score] of Object.entries(scores) as [MemoryType, number][]) {
      if (type === 'general') continue
      if (score > maxScore) {
        maxScore = score
        maxType = type
      }
    }

    // 歧义消解
    if (maxScore > 0) {
      maxType = disambiguate(maxType, chunk, scores)
    }

    // 计算置信度
    const totalMarkers = allMatched.length
    const confidence = Math.min(0.9, 0.3 + totalMarkers * 0.15)

    // 情感分析
    const sentiment = getSentiment(chunk)

    memories.push({
      content: chunk,
      memoryType: maxType,
      chunkIndex: i,
      confidence,
      markers: allMatched.slice(0, 5), // 最多5个标记
      sentiment,
      importance: maxScore > 0 ? Math.min(5, maxScore) : undefined,
    })
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

  const allMarkers: Record<MemoryType, RegExp[]> = {
    decision: DECISION_MARKERS,
    preference: PREFERENCE_MARKERS,
    milestone: MILESTONE_MARKERS,
    problem: PROBLEM_MARKERS,
    emotional: EMOTION_MARKERS,
    general: [],
  }

  const allMatched: string[] = []

  for (const [type, markers] of Object.entries(allMarkers) as [MemoryType, RegExp[]][]) {
    const { score, matched } = scoreMarkers(text, markers)
    scores[type] = score
    allMatched.push(...matched)
  }

  let maxType: MemoryType = 'general'
  let maxScore = 0

  for (const [type, score] of Object.entries(scores) as [MemoryType, number][]) {
    if (score > maxScore) {
      maxScore = score
      maxType = type
    }
  }

  if (maxScore > 0) {
    maxType = disambiguate(maxType, text, scores)
  }

  return {
    type: maxType,
    confidence: Math.min(0.9, 0.3 + maxScore * 0.15),
    markers: allMatched.slice(0, 5),
  }
}

// ============================================================================
// Export
// ============================================================================

export const Extractor = {
  extractMemories,
  classifyText,
  // Constants
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
}

export default Extractor
