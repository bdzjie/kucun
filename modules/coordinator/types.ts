/**
 * Coordinator Module - Type Definitions
 * 多 Agent 协调模块 - 基于 Claude Code 任务系统设计
 */

// ============================================================================
// Agent Types
// ============================================================================

export type AgentType = 
  | 'local'       // 本地 Bun 进程
  | 'remote'      // 远程 API
  | 'subagent'    // 子 Agent（Fork）
  | 'coordinator' // 协调者

export type AgentStatus = 
  | 'idle'       // 空闲
  | 'running'    // 运行中
  | 'waiting'    // 等待中
  | 'completed'  // 已完成
  | 'failed'     // 失败
  | 'cancelled'  // 已取消

// ============================================================================
// Agent Definition
// ============================================================================

export interface AgentConfig {
  id: string
  name: string
  type: AgentType
  model?: string
  tools?: string[]  // 工具名称列表
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
}

export interface Agent {
  id: string
  name: string
  type: AgentType
  status: AgentStatus
  config: AgentConfig
  createdAt: number
  updatedAt: number
  
  run(input: unknown): Promise<AgentResult>
  stop(): void
}

export interface AgentResult {
  success: boolean
  output?: unknown
  error?: string
  duration?: number
  steps?: AgentStep[]
}

export interface AgentStep {
  id: string
  tool?: string
  input?: unknown
  output?: unknown
  timestamp: number
}

// ============================================================================
// Task Types
// ============================================================================

export type TaskType =
  | 'local'        // 本地任务
  | 'background'   // 后台任务
  | 'suspended'    // 暂停恢复
  | 'dream'        // 规划任务
  | 'queue'        // 队列任务

export type TaskStatus =
  | 'pending'    // 等待中
  | 'running'    // 运行中
  | 'waiting'    // 等待资源
  | 'completed'  // 已完成
  | 'failed'     // 失败
  | 'cancelled'  // 已取消

// ============================================================================
// Task Definition
// ============================================================================

export interface Task {
  id: string
  type: TaskType
  status: TaskStatus
  agentId?: string
  parentTaskId?: string
  input: unknown
  output?: unknown
  error?: string
  priority: number
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
  retryCount: number
  maxRetries: number
}

// ============================================================================
// Resource Management
// ============================================================================

export interface Resources {
  maxConcurrentTasks: number
  maxMemory: number
  maxTokens: number
}

export interface ResourceUsage {
  used: number
  available: number
  percent: number
}

// ============================================================================
// Coordinator Events
// ============================================================================

export type CoordinatorEventType =
  | 'agent_registered'
  | 'agent_unregistered'
  | 'task_created'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'task_cancelled'
  | 'resource_warning'
  | 'resource_exceeded'

export interface CoordinatorEvent {
  type: CoordinatorEventType
  timestamp: number
  data: Record<string, unknown>
}

// ============================================================================
// Coordination Strategy
// ============================================================================

export type CoordinationStrategy =
  | 'sequential'   // 顺序执行
  | 'parallel'     // 并行执行
  | 'hierarchical' // 层级协调
  | 'swarm'        // 蜂群协调

// ============================================================================
// Default Config
// ============================================================================

export const DEFAULT_RESOURCES: Resources = {
  maxConcurrentTasks: 5,
  maxMemory: 512 * 1024 * 1024, // 512MB
  maxTokens: 150_000,
}

export const DEFAULT_TASK_CONFIG = {
  maxRetries: 3,
  defaultPriority: 0,
  taskTimeout: 300000, // 5 minutes
}
