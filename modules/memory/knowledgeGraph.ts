/**
 * KnowledgeGraph - 时态知识图谱
 * ===============================
 *
 * 灵感来自 MemPalace 的 Temporal KG
 * 使用 SQLite 本地存储，支持时间窗查询
 *
 * 与 Neo4j/Zep 等云服务的区别:
 * - 完全本地，无需订阅
 * - SQLite 存储
 * - Temporal validity (valid_from / valid_to)
 */

import * as crypto from 'crypto'
import {
  Entity,
  Triple,
  KGStats,
  EntityType,
  EntityEntry,
  DisambiguationResult,
  TemporalQuery,
} from './types'

// ============================================================================
// In-Memory Storage (可替换为 SQLite)
// ============================================================================

interface KGStorage {
  entities: Map<string, Entity>
  triples: Map<string, Triple>
}

const kgStorage: KGStorage = {
  entities: new Map(),
  triples: new Map(),
}

// ============================================================================
// Entity Operations
// ============================================================================

/**
 * 生成 Entity ID
 */
function generateEntityId(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/'/g, '')
}

/**
 * 添加实体
 */
export function addEntity(
  name: string,
  type: EntityType = 'unknown',
  properties?: Record<string, unknown>
): Entity {
  const id = generateEntityId(name)

  const entity: Entity = {
    id,
    name,
    type,
    properties,
    createdAt: new Date(),
  }

  kgStorage.entities.set(id, entity)
  return entity
}

/**
 * 获取实体
 */
export function getEntity(name: string): Entity | undefined {
  return kgStorage.entities.get(generateEntityId(name))
}

/**
 * 获取所有实体
 */
export function getAllEntities(): Entity[] {
  return Array.from(kgStorage.entities.values())
}

/**
 * 实体是否存在
 */
export function hasEntity(name: string): boolean {
  return kgStorage.entities.has(generateEntityId(name))
}

// ============================================================================
// Triple Operations (关系三元组)
// ============================================================================

/**
 * 添加三元组
 */
export function addTriple(
  subject: string,
  predicate: string,
  obj: string,
  options: {
    validFrom?: Date
    validTo?: Date
    confidence?: number
    sourceCloset?: string
    sourceFile?: string
  } = {}
): Triple {
  const subId = generateEntityId(subject)
  const objId = generateEntityId(obj)
  const pred = predicate.toLowerCase().replace(/\s+/g, '_')

  // 自动创建不存在的实体
  if (!kgStorage.entities.has(subId)) {
    addEntity(subject, 'unknown')
  }
  if (!kgStorage.entities.has(objId)) {
    addEntity(obj, 'unknown')
  }

  // 检查是否已存在相同的有效三元组
  const existing = Array.from(kgStorage.triples.values()).find(
    t =>
      t.subject === subId &&
      t.predicate === pred &&
      t.object === objId &&
      !t.validTo
  )

  if (existing) {
    return existing // 已存在且有效
  }

  const tripleId = `t_${subId}_${pred}_${objId}_${crypto
    .createHash('sha256')
    .update(Date.now().toString())
    .digest('hex')
    .slice(0, 12)}`

  const triple: Triple = {
    id: tripleId,
    subject: subId,
    predicate: pred,
    object: objId,
    validFrom: options.validFrom,
    validTo: options.validTo,
    confidence: options.confidence ?? 1.0,
    sourceCloset: options.sourceCloset,
    sourceFile: options.sourceFile,
    extractedAt: new Date(),
  }

  kgStorage.triples.set(tripleId, triple)
  return triple
}

/**
 * 使三元组失效 (设置 valid_to)
 */
export function invalidateTriple(
  subject: string,
  predicate: string,
  obj: string,
  ended?: Date
): boolean {
  const subId = generateEntityId(subject)
  const objId = generateEntityId(obj)
  const pred = predicate.toLowerCase().replace(/\s+/g, '_')
  const endedDate = ended ?? new Date()

  let found = false
  for (const triple of kgStorage.triples.values()) {
    if (
      triple.subject === subId &&
      triple.predicate === pred &&
      triple.object === objId &&
      !triple.validTo
    ) {
      triple.validTo = endedDate
      found = true
    }
  }

  return found
}

/**
 * 查询实体的关系
 */
export function queryEntity(
  name: string,
  options: {
    asOf?: Date
    direction?: 'outgoing' | 'incoming' | 'both'
  } = {}
): Array<{
  direction: 'outgoing' | 'incoming'
  subject: string
  predicate: string
  object: string
  validFrom?: Date
  validTo?: Date
  confidence: number
  current: boolean
}> {
  const eid = generateEntityId(name)
  const asOf = options.asOf ?? new Date()
  const direction = options.direction ?? 'both'

  const results: Array<{
    direction: 'outgoing' | 'incoming'
    subject: string
    predicate: string
    object: string
    validFrom?: Date
    validTo?: Date
    confidence: number
    current: boolean
  }> = []

  const isValidAt = (triple: Triple): boolean => {
    if (triple.validFrom && triple.validFrom > asOf) return false
    if (triple.validTo && triple.validTo < asOf) return false
    return true
  }

  if (direction === 'outgoing' || direction === 'both') {
    for (const triple of kgStorage.triples.values()) {
      if (triple.subject === eid && isValidAt(triple)) {
        const objEntity = kgStorage.entities.get(triple.object)
        results.push({
          direction: 'outgoing',
          subject: name,
          predicate: triple.predicate,
          object: objEntity?.name ?? triple.object,
          validFrom: triple.validFrom,
          validTo: triple.validTo,
          confidence: triple.confidence,
          current: !triple.validTo,
        })
      }
    }
  }

  if (direction === 'incoming' || direction === 'both') {
    for (const triple of kgStorage.triples.values()) {
      if (triple.object === eid && isValidAt(triple)) {
        const subEntity = kgStorage.entities.get(triple.subject)
        results.push({
          direction: 'incoming',
          subject: subEntity?.name ?? triple.subject,
          predicate: triple.predicate,
          object: name,
          validFrom: triple.validFrom,
          validTo: triple.validTo,
          confidence: triple.confidence,
          current: !triple.validTo,
        })
      }
    }
  }

  return results
}

/**
 * 按关系类型查询
 */
export function queryRelationship(
  predicate: string,
  asOf?: Date
): Array<{
  subject: string
  predicate: string
  object: string
  validFrom?: Date
  validTo?: Date
  current: boolean
}> {
  const pred = predicate.toLowerCase().replace(/\s+/g, '_')
  const checkDate = asOf ?? new Date()

  const results: Array<{
    subject: string
    predicate: string
    object: string
    validFrom?: Date
    validTo?: Date
    current: boolean
  }> = []

  for (const triple of kgStorage.triples.values()) {
    if (triple.predicate === pred) {
      if (triple.validFrom && triple.validFrom > checkDate) continue
      if (triple.validTo && triple.validTo < checkDate) continue

      const subEntity = kgStorage.entities.get(triple.subject)
      const objEntity = kgStorage.entities.get(triple.object)

      results.push({
        subject: subEntity?.name ?? triple.subject,
        predicate: triple.predicate,
        object: objEntity?.name ?? triple.object,
        validFrom: triple.validFrom,
        validTo: triple.validTo,
        current: !triple.validTo,
      })
    }
  }

  return results
}

/**
 * 时间线查询
 */
export function timeline(
  entityName?: string
): Array<{
  subject: string
  predicate: string
  object: string
  validFrom?: Date
  validTo?: Date
  current: boolean
}> {
  const results: Array<{
    subject: string
    predicate: string
    object: string
    validFrom?: Date
    validTo?: Date
    current: boolean
  }> = []

  let triples: Triple[]

  if (entityName) {
    const eid = generateEntityId(entityName)
    triples = Array.from(kgStorage.triples.values()).filter(
      t => t.subject === eid || t.object === eid
    )
  } else {
    triples = Array.from(kgStorage.triples.values())
  }

  // 按 validFrom 排序
  triples.sort((a, b) => {
    if (!a.validFrom && !b.validFrom) return 0
    if (!a.validFrom) return 1
    if (!b.validFrom) return -1
    return a.validFrom.getTime() - b.validFrom.getTime()
  })

  for (const triple of triples.slice(0, 100)) {
    const subEntity = kgStorage.entities.get(triple.subject)
    const objEntity = kgStorage.entities.get(triple.object)

    results.push({
      subject: subEntity?.name ?? triple.subject,
      predicate: triple.predicate,
      object: objEntity?.name ?? triple.object,
      validFrom: triple.validFrom,
      validTo: triple.validTo,
      current: !triple.validTo,
    })
  }

  return results
}

// ============================================================================
// Stats
// ============================================================================

/**
 * 获取 KG 统计
 */
export function getKGStats(): KGStats {
  const now = new Date()
  let currentFacts = 0
  let expiredFacts = 0

  for (const triple of kgStorage.triples.values()) {
    if (triple.validTo) {
      expiredFacts++
    } else {
      currentFacts++
    }
  }

  const predicates = new Set<string>()
  for (const triple of kgStorage.triples.values()) {
    predicates.add(triple.predicate)
  }

  return {
    entities: kgStorage.entities.size,
    triples: kgStorage.triples.size,
    currentFacts,
    expiredFacts,
    relationshipTypes: Array.from(predicates),
  }
}

// ============================================================================
// Entity Registry (实体注册表)
// ============================================================================

interface RegistryEntry {
  entry: EntityEntry
  aliases: Set<string>
}

const entityRegistry = new Map<string, RegistryEntry>()

// 常见易混淆词
const COMMON_ENGLISH_WORDS = new Set([
  'ever', 'grace', 'will', 'bill', 'mark', 'april', 'may', 'june', 'joy',
  'hope', 'faith', 'chance', 'chase', 'hunter', 'dash', 'flash', 'star',
  'sky', 'river', 'brook', 'lane', 'art', 'clay', 'gil', 'nat', 'max',
  'rex', 'ray', 'jay', 'rose', 'violet', 'lily', 'ivy', 'ash', 'reed', 'sage',
])

// 名字上下文模式
const PERSON_CONTEXT_PATTERNS = [
  /\bsaid\b/, /\btold\b/, /\basked\b/, /\blaughed\b/, /\bsmiled\b/,
  /\bwas\b/, /\bis\b/, /\bcalled\b/, /\bwith\s+\w+\b/,
  /\b's\b/, /\bhey\s+\w+/,
]

/**
 * 注册实体
 */
export function registerEntity(entry: EntityEntry): void {
  const id = generateEntityId(entry.name)

  entityRegistry.set(id, {
    entry,
    aliases: new Set(entry.aliases ?? []),
  })

  // 同时添加到 KG
  addEntity(entry.name, entry.type, entry.properties)
}

/**
 * 查找实体
 */
export function lookupEntity(name: string): EntityEntry | undefined {
  const id = generateEntityId(name)
  return entityRegistry.get(id)?.entry
}

/**
 * 检测实体类型
 */
export function detectEntity(
  name: string,
  context?: string
): DisambiguationResult {
  const id = generateEntityId(name)

  // 1. 已在注册表中
  if (entityRegistry.has(id)) {
    const entry = entityRegistry.get(id)!.entry
    return {
      isEntity: true,
      type: entry.type,
      confidence: entry.confidence,
      source: entry.source,
    }
  }

  // 2. 常见英文词 (需要上下文)
  if (COMMON_ENGLISH_WORDS.has(name.toLowerCase())) {
    if (!context) {
      return {
        isEntity: false,
        requiresContext: true,
      }
    }

    // 检查上下文
    for (const pattern of PERSON_CONTEXT_PATTERNS) {
      if (pattern.test(context)) {
        return {
          isEntity: true,
          type: 'person',
          confidence: 0.6,
          source: 'learned',
          requiresContext: false,
        }
      }
    }

    return {
      isEntity: false,
      requiresContext: false,
    }
  }

  // 3. 首字母大写，可能是名字
  if (/^[A-Z][a-z]+$/.test(name)) {
    return {
      isEntity: true,
      type: 'person',
      confidence: 0.7,
      source: 'learned',
    }
  }

  // 4. 全大写或下划线分隔，可能是项目/概念
  if (/^[A-Z_]+$/.test(name) || /^[a-z_]+_[a-z_]+$/.test(name)) {
    return {
      isEntity: true,
      type: 'concept',
      confidence: 0.8,
      source: 'learned',
    }
  }

  // 5. 默认未知
  return {
    isEntity: false,
    requiresContext: false,
  }
}

/**
 * 批量注册实体
 */
export function registerEntities(entries: EntityEntry[]): void {
  for (const entry of entries) {
    registerEntity(entry)
  }
}

/**
 * 从已知事实种子 KG
 */
export function seedFromFacts(facts: Record<string, { name: string; type: EntityType; properties?: Record<string, unknown> }[]>): void {
  for (const [entityName, entityFacts] of Object.entries(facts)) {
    const type = entityFacts[0]?.type ?? 'unknown'
    const properties = entityFacts[0]?.properties

    registerEntity({
      name: entityName,
      type,
      confidence: 1.0,
      source: 'onboarding',
      properties,
    })

    // 添加三元组
    for (const fact of entityFacts) {
      if (fact.name !== entityName) {
        addTriple(entityName, 'related_to', fact.name, { confidence: 0.9 })
      }
    }
  }
}

// ============================================================================
// Predefined Relationship Types
// ============================================================================

export const RELATIONSHIP_TYPES = {
  WORKS_ON: 'works_on',
  ASSIGNED_TO: 'assigned_to',
  COMPLETED: 'completed',
  DECIDED: 'decided',
  PREFERS: 'prefers',
  LOVES: 'loves',
  CHILD_OF: 'child_of',
  PART_OF: 'part_of',
  RELATED_TO: 'related_to',
  LOCATED_AT: 'located_at',
  CREATED: 'created',
  UPDATED: 'updated',
  SOLVED: 'solved',
  CAUSED: 'caused',
}

// ============================================================================
// Export
// ============================================================================

export const KnowledgeGraph = {
  // Entity
  addEntity,
  getEntity,
  getAllEntities,
  hasEntity,
  // Triple
  addTriple,
  invalidateTriple,
  queryEntity,
  queryRelationship,
  timeline,
  // Stats
  getKGStats,
  // Registry
  registerEntity,
  lookupEntity,
  detectEntity,
  registerEntities,
  seedFromFacts,
  // Constants
  RELATIONSHIP_TYPES,
}

export default KnowledgeGraph
