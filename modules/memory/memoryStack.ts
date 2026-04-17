/**
 * MemoryStack - 4层记忆栈
 * =========================
 *
 * L0: Identity (~50 tokens) — 始终加载, 身份信息
 * L1: Essential Story (~500-800 tokens) — 始终加载, 关键事实
 * L2: On-Demand (~200-500 tokens) — 按需加载, 特定 Wing/Room
 * L3: Deep Search — 语义搜索, 按需触发
 *
 * Wake-up 成本: ~600-900 tokens (L0+L1)
 * 留出 95%+ 上下文空间
 */

import * as fs from 'fs'
import * as path from 'path'
import {
  Layer0Identity,
  Layer1Essential,
  Layer2OnDemand,
  Layer3SearchResult,
  SearchHit,
  Drawer,
  DEFAULT_MEMORY_CONFIG,
  SearchRequest,
} from './types'
import { Palace } from './palace'

// ============================================================================
// Layer 0 — Identity (身份)
// ============================================================================

/**
 * 获取 L0 Identity
 */
export async function getLayer0(identityPath?: string): Promise<Layer0Identity> {
  const config = DEFAULT_MEMORY_CONFIG
  const filePath = identityPath || config.layer0Path.replace('~', process.env.HOME || '')

  let content = `## L0 — IDENTITY
No identity configured. Create ~/.openclaw/memory/identity.txt`

  try {
    if (fs.existsSync(filePath)) {
      content = fs.readFileSync(filePath, 'utf-8').trim()
    }
  } catch {
    // 返回默认
  }

  return {
    content,
    tokenEstimate: Math.ceil(content.length / 4),
  }
}

/**
 * 设置 L0 Identity
 */
export async function setLayer0(content: string, identityPath?: string): Promise<void> {
  const config = DEFAULT_MEMORY_CONFIG
  const filePath = identityPath || config.layer0Path.replace('~', process.env.HOME || '')

  // 确保目录存在
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(filePath, content, 'utf-8')
}

// ============================================================================
// Layer 1 — Essential Story (关键事实)
// ============================================================================

const L1_MAX_DRAWERS = 15
const L1_MAX_CHARS = 3200 // ~800 tokens

/**
 * 获取 L1 Essential Story
 */
export async function getLayer1(wing?: string): Promise<Layer1Essential> {
  const drawers = wing
    ? Palace.getDrawersByWing(wing, 1000)
    : Palace.getAllDrawers(1000)

  if (drawers.length === 0) {
    return {
      content: '## L1 — No memories yet.',
      tokenEstimate: 0,
      drawerCount: 0,
      rooms: [],
    }
  }

  // 按重要性 + 时间评分
  const scored = drawers.map(drawer => {
    let importance = 3 // 默认重要性
    if (drawer.importance) {
      importance = drawer.importance
    } else if (drawer.emotionalWeight) {
      importance = drawer.emotionalWeight
    }

    // 时间因子: 越新分数越高
    const age = Date.now() - drawer.filedAt.getTime()
    const ageFactor = Math.max(0, 1 - age / (30 * 24 * 60 * 60 * 1000)) // 30天衰减

    return {
      drawer,
      score: importance * 0.7 + ageFactor * 0.3,
    }
  })

  // 排序并取 Top N
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, L1_MAX_DRAWERS)

  // 按 Room 分组
  const byRoom = new Map<string, Drawer[]>()
  for (const { drawer } of top) {
    const room = drawer.room
    if (!byRoom.has(room)) {
      byRoom.set(room, [])
    }
    byRoom.get(room)!.push(drawer)
  }

  // 构建文本
  const lines = ['## L1 — ESSENTIAL STORY']
  let totalLen = 0
  const rooms: string[] = []

  for (const [roomName, roomDrawers] of Array.from(byRoom.entries()).sort()) {
    rooms.push(roomName)
    const roomLine = `\n[${roomName}]`
    lines.push(roomLine)
    totalLen += roomLine.length

    for (const drawer of roomDrawers) {
      const source = drawer.sourceFile ? path.basename(drawer.sourceFile) : ''

      let snippet = drawer.content.replace(/\n+/g, ' ').trim()
      if (snippet.length > 200) {
        snippet = snippet.slice(0, 197) + '...'
      }

      let entryLine = `  - ${snippet}`
      if (source) {
        entryLine += `  (${source})`
      }

      if (totalLen + entryLine.length > L1_MAX_CHARS) {
        lines.push('  ... (more in L3 search)')
        break
      }

      lines.push(entryLine)
      totalLen += entryLine.length
    }

    if (totalLen >= L1_MAX_CHARS) break
  }

  return {
    content: lines.join('\n'),
    tokenEstimate: Math.ceil(totalLen / 4),
    drawerCount: top.length,
    rooms,
  }
}

// ============================================================================
// Layer 2 — On-Demand (按需加载)
// ============================================================================

const L2_DEFAULT_LIMIT = 10

/**
 * 获取 L2 On-Demand
 */
export async function getLayer2(
  wing?: string,
  room?: string,
  nResults = L2_DEFAULT_LIMIT
): Promise<Layer2OnDemand> {
  const drawers = room
    ? Palace.getDrawersByRoom(wing || 'default', room, nResults)
    : wing
    ? Palace.getDrawersByWing(wing, nResults)
    : Palace.getAllDrawers(nResults)

  if (drawers.length === 0) {
    const label = wing ? `wing=${wing}` : room ? `room=${room}` : 'all'
    return {
      content: `## L2 — No drawers found for ${label}.`,
      tokenEstimate: 0,
      drawerCount: 0,
      wing,
      room,
    }
  }

  const lines = [`## L2 — ON-DEMAND (${drawers.length} drawers)`]
  let totalLen = 0

  for (const drawer of drawers) {
    const source = drawer.sourceFile ? path.basename(drawer.sourceFile) : ''

    let snippet = drawer.content.replace(/\n+/g, ' ').trim()
    if (snippet.length > 300) {
      snippet = snippet.slice(0, 297) + '...'
    }

    let entry = `  [${drawer.room}] ${snippet}`
    if (source) {
      entry += `  (${source})`
    }

    lines.push(entry)
    totalLen += entry.length
  }

  return {
    content: lines.join('\n'),
    tokenEstimate: Math.ceil(totalLen / 4),
    drawerCount: drawers.length,
    wing,
    room,
  }
}

// ============================================================================
// Layer 3 — Deep Search (深度搜索)
// ============================================================================

const L3_DEFAULT_LIMIT = 5

/**
 * 搜索 L3
 */
export async function searchLayer3(
  query: string,
  wing?: string,
  room?: string,
  nResults = L3_DEFAULT_LIMIT
): Promise<Layer3SearchResult> {
  const results = Palace.searchDrawers({
    query,
    wing,
    room,
    limit: nResults,
    threshold: 0.1, // 低阈值，获取更多结果
  })

  const hits: SearchHit[] = results.map(result => ({
    drawer: result.drawer,
    similarity: result.similarity,
    room: result.drawer.room,
    wing: result.drawer.wing,
  }))

  const lines = [`## L3 — SEARCH RESULTS for "${query}"`]

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]
    const { drawer, similarity } = hit

    lines.push(`  [${i + 1}] ${hit.wing}/${hit.room} (sim=${similarity})`)

    let snippet = drawer.content.replace(/\n+/g, ' ').trim()
    if (snippet.length > 300) {
      snippet = snippet.slice(0, 297) + '...'
    }
    lines.push(`      ${snippet}`)

    if (drawer.sourceFile) {
      lines.push(`      src: ${path.basename(drawer.sourceFile)}`)
    }
  }

  return {
    query,
    results: hits,
    totalResults: hits.length,
  }
}

/**
 * 获取 L3 原始结果
 */
export async function searchLayer3Raw(
  query: string,
  wing?: string,
  room?: string,
  nResults = L3_DEFAULT_LIMIT
): Promise<SearchHit[]> {
  const results = Palace.searchDrawers({
    query,
    wing,
    room,
    limit: nResults,
    threshold: 0.1,
  })

  return results.map(result => ({
    drawer: result.drawer,
    similarity: result.similarity,
    room: result.drawer.room,
    wing: result.drawer.wing,
  }))
}

// ============================================================================
// Wake-Up (唤醒)
// ============================================================================

/**
 * 完整唤醒 - 获取 L0 + L1
 */
export async function wakeUp(wing?: string): Promise<{
  layer0: Layer0Identity
  layer1: Layer1Essential
  totalTokens: number
}> {
  const layer0 = await getLayer0()
  const layer1 = await getLayer1(wing)

  return {
    layer0,
    layer1,
    totalTokens: layer0.tokenEstimate + layer1.tokenEstimate,
  }
}

/**
 * 完整内存栈
 */
export async function getFullStack(wing?: string): Promise<{
  layer0: Layer0Identity
  layer1: Layer1Essential
  layer2?: Layer2OnDemand
  layer3?: Layer3SearchResult
  totalTokens: number
}> {
  const layer0 = await getLayer0()
  const layer1 = await getLayer1(wing)

  // L2 和 L3 按需加载
  let layer2: Layer2OnDemand | undefined
  let layer3: Layer3SearchResult | undefined

  let totalTokens = layer0.tokenEstimate + layer1.tokenEstimate

  // 如果 L1 超过阈值，提供 L2
  if (layer1.tokenEstimate > 400) {
    layer2 = await getLayer2(wing)
    totalTokens += layer2.tokenEstimate
  }

  return {
    layer0,
    layer1,
    layer2,
    layer3,
    totalTokens,
  }
}

// ============================================================================
// Token Budget Helper
// ============================================================================

/**
 * 计算 token 数量 (简化估算)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * 检查是否符合 budget
 */
export function fitsBudget(
  currentTokens: number,
  additionalTokens: number,
  maxTokens = 150000
): boolean {
  return currentTokens + additionalTokens <= maxTokens
}

// ============================================================================
// Export
// ============================================================================

export const MemoryStack = {
  // Layers
  getLayer0,
  setLayer0,
  getLayer1,
  getLayer2,
  searchLayer3,
  searchLayer3Raw,
  // Wake-up
  wakeUp,
  getFullStack,
  // Helpers
  estimateTokens,
  fitsBudget,
}

export default MemoryStack
