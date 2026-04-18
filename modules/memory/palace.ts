/**
 * Palace - MemPalace 风格的记忆宫殿
 * ==================================
 *
 * 核心结构:
 * - Wing (翅膀): 人或项目
 * - Room (房间): 具体主题
 * - Hall (走廊): 记忆类型 (facts/events/discoveries/preferences/advice)
 * - Drawer (抽屉): 原始记忆块 (verbatim)
 * - Tunnel (隧道): 跨 Wing 连接
 *
 * 灵感来自古希腊演说家的"记忆宫殿" - 将想法放在虚拟建筑的房间里
 */

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import {
  Drawer,
  Wing,
  Room,
  HallType,
  MemoryTaxonomy,
  WingInfo,
  RoomInfo,
  SearchRequest,
  SearchResult,
  DEFAULT_MEMORY_CONFIG,
  MemoryConfig,
} from './types'
import { PalaceSearch, getGlobalPalaceSearch, indexDrawer } from '../search/palace_search'

// ============================================================================
// In-Memory Storage (可替换为 ChromaDB/SQLite)
// ============================================================================

interface Storage {
  drawers: Map<string, Drawer>
  wings: Map<string, Wing>
  rooms: Map<string, Room>
}

const storage: Storage = {
  drawers: new Map(),
  wings: new Map(),
  rooms: new Map(),
}

// ============================================================================
// Drawer Operations
// ============================================================================

/**
 * 生成 Drawer ID
 */
function generateDrawerId(wing: string, room: string, sourceFile: string, chunkIndex: number): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${wing}${room}${sourceFile}${chunkIndex}`)
    .digest('hex')
    .slice(0, 24)
  return `drawer_${wing}_${room}_${hash}`
}

/**
 * 添加抽屉到宫殿
 */
export async function addDrawer(
  wing: string,
  room: string,
  content: string,
  metadata: {
    sourceFile?: string
    hall?: HallType
    addedBy?: string
    importance?: number
    emotionalWeight?: number
  } = {}
): Promise<Drawer> {
  const config = DEFAULT_MEMORY_CONFIG
  const chunkIndex = 0 // 简化版本

  const drawerId = generateDrawerId(
    wing,
    room,
    metadata.sourceFile || 'memory',
    chunkIndex
  )

  const drawer: Drawer = {
    id: drawerId,
    wing,
    room,
    hall: metadata.hall,
    content: content.slice(0, config.maxDrawerSize),
    sourceFile: metadata.sourceFile,
    chunkIndex,
    addedBy: metadata.addedBy || 'system',
    filedAt: new Date(),
    importance: metadata.importance,
    emotionalWeight: metadata.emotionalWeight,
  }

  // 存储
  storage.drawers.set(drawerId, drawer)

  // BM25 索引 (异步，不阻塞存储)
  try {
    const search = getGlobalPalaceSearch()
    indexDrawer(search, drawer)
  } catch (error) {
    console.warn('[Palace] BM25 indexing failed:', error)
  }

  // 更新 Wing
  if (!storage.wings.has(wing)) {
    storage.wings.set(wing, {
      name: wing,
      createdAt: new Date(),
      updatedAt: new Date(),
      drawerCount: 0,
    })
  }
  const wingData = storage.wings.get(wing)!
  wingData.updatedAt = new Date()
  wingData.drawerCount++

  // 更新 Room
  const roomKey = `${wing}:${room}`
  if (!storage.rooms.has(roomKey)) {
    storage.rooms.set(roomKey, {
      name: room,
      wing,
      description: '',
      keywords: [],
      drawerCount: 0,
    })
  }
  const roomData = storage.rooms.get(roomKey)!
  roomData.drawerCount++

  return drawer
}

/**
 * 批量添加抽屉 (分块)
 */
export async function addDrawerBulk(
  wing: string,
  room: string,
  contents: string[],
  metadata: {
    sourceFile?: string
    hall?: HallType
    addedBy?: string
  } = {}
): Promise<Drawer[]> {
  const drawers: Drawer[] = []

  for (let i = 0; i < contents.length; i++) {
    const drawerId = generateDrawerId(
      wing,
      room,
      metadata.sourceFile || 'memory',
      i
    )

    const drawer: Drawer = {
      id: drawerId,
      wing,
      room,
      hall: metadata.hall,
      content: contents[i],
      sourceFile: metadata.sourceFile,
      chunkIndex: i,
      addedBy: metadata.addedBy || 'system',
      filedAt: new Date(),
    }

    storage.drawers.set(drawerId, drawer)
    drawers.push(drawer)
  }

  // 更新计数
  if (!storage.wings.has(wing)) {
    storage.wings.set(wing, {
      name: wing,
      createdAt: new Date(),
      updatedAt: new Date(),
      drawerCount: 0,
    })
  }
  const wingData = storage.wings.get(wing)!
  wingData.drawerCount += contents.length
  wingData.updatedAt = new Date()

  const roomKey = `${wing}:${room}`
  if (!storage.rooms.has(roomKey)) {
    storage.rooms.set(roomKey, {
      name: room,
      wing,
      description: '',
      keywords: [],
      drawerCount: 0,
    })
  }
  storage.rooms.get(roomKey)!.drawerCount += contents.length

  return drawers
}

/**
 * 获取抽屉
 */
export function getDrawer(drawerId: string): Drawer | undefined {
  return storage.drawers.get(drawerId)
}

/**
 * 删除抽屉
 */
export function deleteDrawer(drawerId: string): boolean {
  const drawer = storage.drawers.get(drawerId)
  if (!drawer) return false

  storage.drawers.delete(drawerId)

  // 更新计数
  const wingData = storage.wings.get(drawer.wing)
  if (wingData) wingData.drawerCount = Math.max(0, wingData.drawerCount - 1)

  const roomKey = `${drawer.wing}:${drawer.room}`
  const roomData = storage.rooms.get(roomKey)
  if (roomData) roomData.drawerCount = Math.max(0, roomData.drawerCount - 1)

  return true
}

/**
 * 获取所有抽屉
 */
export function getAllDrawers(limit = 1000, offset = 0): Drawer[] {
  return Array.from(storage.drawers.values())
    .slice(offset, offset + limit)
}

/**
 * 按 Wing 获取抽屉
 */
export function getDrawersByWing(wing: string, limit = 100): Drawer[] {
  return Array.from(storage.drawers.values())
    .filter(d => d.wing === wing)
    .slice(0, limit)
}

/**
 * 按 Wing + Room 获取抽屉
 */
export function getDrawersByRoom(wing: string, room: string, limit = 100): Drawer[] {
  return Array.from(storage.drawers.values())
    .filter(d => d.wing === wing && d.room === room)
    .slice(0, limit)
}

// ============================================================================
// Search (L3 Deep Search — BM25)
// ============================================================================

/**
 * L3 Deep Search using BM25
 * Delegates to global PalaceSearch engine.
 */
export function searchDrawers(request: SearchRequest): SearchResult[] {
  const { query, wing, room, hall, limit = 10, threshold = 0.1 } = request

  try {
    const search = getGlobalPalaceSearch()

    const hits = search.search(query, {
      wing,
      room,
      hall,
      limit,
      threshold,
    })

    return hits.map(hit => ({
      drawer: hit.doc as unknown as Drawer,
      similarity: hit.score,
      highlight: hit.snippet,
    }))
  } catch (error) {
    console.warn('[Palace] BM25 search failed, falling back to keyword:', error)
    return keywordSearchFallback(request)
  }
}

/**
 * Fallback keyword search when BM25 is unavailable.
 */
function keywordSearchFallback(request: SearchRequest): SearchResult[] {
  const { query, wing, room, hall, limit = 10, threshold = 0.3 } = request

  let results = Array.from(storage.drawers.values())

  if (wing) results = results.filter(d => d.wing === wing)
  if (room) results = results.filter(d => d.room === room)
  if (hall) results = results.filter(d => d.hall === hall)

  const queryWords = query.toLowerCase().split(/\s+/)
  const scored = results.map(drawer => {
    const content = drawer.content.toLowerCase()
    let matches = 0
    for (const word of queryWords) {
      if (content.includes(word)) matches++
    }
    const similarity = matches / queryWords.length
    return { drawer, similarity }
  })

  return scored
    .filter(s => s.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
    .map(s => ({
      drawer: s.drawer,
      similarity: s.similarity,
      highlight: extractHighlight(s.drawer.content, query),
    }))
}

/**
 * 提取高亮片段
 */
function extractHighlight(content: string, query: string): string {
  const queryWords = query.toLowerCase().split(/\s+/)
  const lowerContent = content.toLowerCase()

  for (const word of queryWords) {
    const idx = lowerContent.indexOf(word)
    if (idx !== -1) {
      const start = Math.max(0, idx - 30)
      const end = Math.min(content.length, idx + word.length + 50)
      return '...' + content.slice(start, end) + '...'
    }
  }

  return content.slice(0, 100) + '...'
}

// ============================================================================
// Taxonomy (分类树)
// ============================================================================

/**
 * 获取完整分类树
 */
export function getTaxonomy(): MemoryTaxonomy {
  const wings: Record<string, WingInfo> = {}

  for (const [wingName, wingData] of storage.wings) {
    const rooms: Record<string, number> = {}

    for (const [roomKey, roomData] of storage.rooms) {
      if (roomData.wing === wingName) {
        rooms[roomData.name] = roomData.drawerCount
      }
    }

    wings[wingName] = {
      name: wingName,
      drawerCount: wingData.drawerCount,
      rooms,
    }
  }

  return {
    wings,
    rooms: Object.fromEntries(
      Array.from(storage.rooms.entries()).map(([key, data]) => [key, {
        name: data.name,
        wing: data.wing,
        drawerCount: data.drawerCount,
      }])
    ),
    totalDrawers: storage.drawers.size,
  }
}

/**
 * 列出所有 Wings
 */
export function listWings(): { name: string; drawerCount: number }[] {
  return Array.from(storage.wings.values()).map(w => ({
    name: w.name,
    drawerCount: w.drawerCount,
  }))
}

/**
 * 列出 Wing 下的 Rooms
 */
export function listRooms(wing?: string): { name: string; wing: string; drawerCount: number }[] {
  const rooms: { name: string; wing: string; drawerCount: number }[] = []

  for (const [key, data] of storage.rooms) {
    if (!wing || data.wing === wing) {
      rooms.push({
        name: data.name,
        wing: data.wing,
        drawerCount: data.drawerCount,
      })
    }
  }

  return rooms
}

// ============================================================================
// Duplicate Detection (重复检测)
// ============================================================================

/**
 * 检查重复
 */
export function checkDuplicate(content: string, threshold = 0.9): { isDuplicate: boolean; matches: SearchResult[] } {
  const results = searchDrawers({
    query: content.slice(0, 200), // 用前200字符
    limit: 5,
    threshold: threshold,
  })

  return {
    isDuplicate: results.length > 0,
    matches: results,
  }
}

// ============================================================================
// Graph Stats (图统计)
// ============================================================================

/**
 * 图统计
 */
export function getGraphStats(): {
  totalDrawers: number
  tunnelRooms: number
  wingCounts: Record<string, number>
  topRooms: { room: string; count: number }[]
} {
  // 统计跨 Wing 的 Room (Tunnels)
  const roomWings = new Map<string, Set<string>>()
  for (const drawer of storage.drawers.values()) {
    if (!roomWings.has(drawer.room)) {
      roomWings.set(drawer.room, new Set())
    }
    roomWings.get(drawer.room)!.add(drawer.wing)
  }

  const tunnelRooms = Array.from(roomWings.entries())
    .filter(([_, wings]) => wings.size >= 2)
    .length

  // Wing 计数
  const wingCounts: Record<string, number> = {}
  for (const drawer of storage.drawers.values()) {
    wingCounts[drawer.wing] = (wingCounts[drawer.wing] || 0) + 1
  }

  // Top Rooms
  const roomCounts = new Map<string, number>()
  for (const drawer of storage.drawers.values()) {
    roomCounts.set(drawer.room, (roomCounts.get(drawer.room) || 0) + 1)
  }

  const topRooms = Array.from(roomCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([room, count]) => ({ room, count }))

  return {
    totalDrawers: storage.drawers.size,
    tunnelRooms,
    wingCounts,
    topRooms,
  }
}

// ============================================================================
// Export
// ============================================================================

export const Palace = {
  addDrawer,
  addDrawerBulk,
  getDrawer,
  deleteDrawer,
  getAllDrawers,
  getDrawersByWing,
  getDrawersByRoom,
  searchDrawers,
  getTaxonomy,
  listWings,
  listRooms,
  checkDuplicate,
  getGraphStats,
}

export default Palace
