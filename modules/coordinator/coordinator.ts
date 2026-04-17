/**
 * Coordinator Module - Agent Coordinator
 * 多 Agent 协调器
 */

import { EventEmitter } from '../eventEmitter'
import type {
  Agent,
  AgentConfig,
  AgentResult,
  AgentStatus,
  AgentType,
  Task,
  TaskType,
  TaskStatus,
  Resources,
  ResourceUsage,
  CoordinatorEvent,
  CoordinationStrategy,
} from './types'
import { DEFAULT_RESOURCES, DEFAULT_TASK_CONFIG } from './types'

// ============================================================================
// Local Agent Implementation
// ============================================================================

/**
 * 本地 Agent
 */
class LocalAgent implements Agent {
  id: string
  name: string
  type: AgentType = 'local'
  status: AgentStatus = 'idle'
  config: AgentConfig
  createdAt: number
  updatedAt: number

  constructor(config: AgentConfig) {
    this.id = config.id
    this.name = config.name
    this.config = config
    this.createdAt = Date.now()
    this.updatedAt = Date.now()
  }

  async run(input: unknown): Promise<AgentResult> {
    this.status = 'running'
    this.updatedAt = Date.now()
    const startTime = Date.now()

    try {
      // 模拟 Agent 执行
      // 实际实现会调用 AI 模型
      await new Promise(resolve => setTimeout(resolve, 100))

      const result: AgentResult = {
        success: true,
        output: `Processed by ${this.name}: ${JSON.stringify(input)}`,
        duration: Date.now() - startTime,
      }

      this.status = 'completed'
      this.updatedAt = Date.now()
      return result
    } catch (error) {
      this.status = 'failed'
      this.updatedAt = Date.now()
      return {
        success: false,
        error: String(error),
        duration: Date.now() - startTime,
      }
    }
  }

  stop(): void {
    this.status = 'idle'
    this.updatedAt = Date.now()
  }
}

// ============================================================================
// Task Queue (Priority Queue)
// ============================================================================

class TaskQueue {
  private items: Task[] = []

  enqueue(task: Task): void {
    this.items.push(task)
    this.items.sort((a, b) => b.priority - a.priority)
  }

  dequeue(): Task | undefined {
    return this.items.shift()
  }

  peek(): Task | undefined {
    return this.items[0]
  }

  size(): number {
    return this.items.length
  }

  remove(taskId: string): boolean {
    const index = this.items.findIndex(t => t.id === taskId)
    if (index !== -1) {
      this.items.splice(index, 1)
      return true
    }
    return false
  }

  isEmpty(): boolean {
    return this.items.length === 0
  }

  toArray(): Task[] {
    return [...this.items]
  }
}

// ============================================================================
// Coordinator
// ============================================================================

/**
 * Agent 协调器
 */
export class Coordinator extends EventEmitter {
  private agents: Map<string, Agent> = new Map()
  private tasks: Map<string, Task> = new Map()
  private taskQueue: TaskQueue = new TaskQueue()
  private resources: Resources
  private runningTasks: Set<string> = new Set()
  private completedTasks: Map<string, Task> = new Map()
  private strategy: CoordinationStrategy

  constructor(
    resources: Partial<Resources> = {},
    strategy: CoordinationStrategy = 'parallel'
  ) {
    super()
    this.resources = { ...DEFAULT_RESOURCES, ...resources }
    this.strategy = strategy
  }

  // ============================================================================
  // Agent Management
  // ============================================================================

  /**
   * 注册 Agent
   */
  registerAgent(config: AgentConfig): Agent {
    let agent: Agent

    switch (config.type) {
      case 'local':
        agent = new LocalAgent(config)
        break
      default:
        agent = new LocalAgent(config)
    }

    this.agents.set(agent.id, agent)
    this.emit('agent_registered', this.createEvent('agent_registered', { agentId: agent.id }))
    return agent
  }

  /**
   * 移除 Agent
   */
  unregisterAgent(agentId: string): boolean {
    if (this.agents.delete(agentId)) {
      this.emit('agent_unregistered', this.createEvent('agent_unregistered', { agentId }))
      return true
    }
    return false
  }

  /**
   * 获取 Agent
   */
  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId)
  }

  /**
   * 列出所有 Agent
   */
  listAgents(): Agent[] {
    return Array.from(this.agents.values())
  }

  /**
   * 列出运行中的 Agent
   */
  listRunningAgents(): Agent[] {
    return this.listAgents().filter(a => a.status === 'running')
  }

  // ============================================================================
  // Task Management
  // ============================================================================

  /**
   * 创建任务
   */
  createTask(
    type: TaskType,
    input: unknown,
    options?: {
      agentId?: string
      parentTaskId?: string
      priority?: number
      maxRetries?: number
    }
  ): Task {
    const taskId = this.generateId()
    
    const task: Task = {
      id: taskId,
      type,
      status: 'pending',
      input,
      agentId: options?.agentId,
      parentTaskId: options?.parentTaskId,
      priority: options?.priority ?? DEFAULT_TASK_CONFIG.defaultPriority,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      retryCount: 0,
      maxRetries: options?.maxRetries ?? DEFAULT_TASK_CONFIG.maxRetries,
    }

    this.tasks.set(taskId, task)
    this.taskQueue.enqueue(task)
    
    this.emit('task_created', this.createEvent('task_created', { taskId, type }))
    
    return task
  }

  /**
   * 执行任务
   */
  async executeTask(taskId: string): Promise<Task> {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    if (task.status === 'running') {
      throw new Error(`Task already running: ${taskId}`)
    }

    // 检查资源
    if (!this.canRunTask()) {
      task.status = 'waiting'
      this.emit('resource_warning', this.createEvent('resource_warning', {
        taskId,
        runningCount: this.runningTasks.size,
      }))
      return task
    }

    // 更新任务状态
    task.status = 'running'
    task.startedAt = Date.now()
    task.updatedAt = Date.now()
    this.runningTasks.add(taskId)
    
    this.emit('task_started', this.createEvent('task_started', { taskId }))

    try {
      // 获取 Agent
      const agent = task.agentId ? this.agents.get(task.agentId) : undefined

      // 执行
      let result: AgentResult
      if (agent) {
        result = await agent.run(task.input)
      } else {
        // 无 Agent，直接处理
        result = {
          success: true,
          output: task.input,
        }
      }

      // 更新任务结果
      if (result.success) {
        task.status = 'completed'
        task.output = result.output
        task.completedAt = Date.now()
        this.emit('task_completed', this.createEvent('task_completed', {
          taskId,
          duration: result.duration,
        }))
      } else {
        // 重试
        if (task.retryCount < task.maxRetries) {
          task.retryCount++
          task.status = 'pending'
          this.taskQueue.enqueue(task)
        } else {
          task.status = 'failed'
          task.error = result.error
          this.emit('task_failed', this.createEvent('task_failed', {
            taskId,
            error: result.error,
          }))
        }
      }
    } catch (error) {
      task.status = 'failed'
      task.error = String(error)
      this.emit('task_failed', this.createEvent('task_failed', { taskId, error: String(error) }))
    } finally {
      task.updatedAt = Date.now()
      this.runningTasks.delete(taskId)
      
      // 处理下一个任务
      this.processQueue()
    }

    return task
  }

  /**
   * 处理队列
   */
  private processQueue(): void {
    while (this.canRunTask() && !this.taskQueue.isEmpty()) {
      const task = this.taskQueue.peek()
      if (task && task.status === 'pending') {
        this.taskQueue.dequeue()
        void this.executeTask(task.id)
      } else {
        break
      }
    }
  }

  /**
   * 检查是否可以运行任务
   */
  private canRunTask(): boolean {
    return this.runningTasks.size < this.resources.maxConcurrentTasks
  }

  /**
   * 取消任务
   */
  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false

    if (task.status === 'running') {
      const agent = this.agents.get(task.agentId || '')
      if (agent) {
        agent.stop()
      }
    }

    task.status = 'cancelled'
    task.updatedAt = Date.now()
    this.runningTasks.delete(taskId)
    this.taskQueue.remove(taskId)
    
    this.emit('task_cancelled', this.createEvent('task_cancelled', { taskId }))
    
    return true
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId)
  }

  /**
   * 列出任务
   */
  listTasks(status?: TaskStatus): Task[] {
    const tasks = Array.from(this.tasks.values())
    if (status) {
      return tasks.filter(t => t.status === status)
    }
    return tasks
  }

  /**
   * 获取任务历史
   */
  getTaskHistory(limit?: number): Task[] {
    const completed = Array.from(this.completedTasks.values())
    completed.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
    return limit ? completed.slice(0, limit) : completed
  }

  // ============================================================================
  // Resources
  // ============================================================================

  /**
   * 获取资源使用情况
   */
  getResourceUsage(): {
    tasks: ResourceUsage
    agents: ResourceUsage
  } {
    return {
      tasks: {
        used: this.runningTasks.size,
        available: this.resources.maxConcurrentTasks,
        percent: this.runningTasks.size / this.resources.maxConcurrentTasks,
      },
      agents: {
        used: this.agents.size,
        available: this.agents.size,
        percent: 1,
      },
    }
  }

  /**
   * 更新资源
   */
  updateResources(resources: Partial<Resources>): void {
    this.resources = { ...this.resources, ...resources }
  }

  // ============================================================================
  // Coordination Strategies
  // ============================================================================

  /**
   * 设置协调策略
   */
  setStrategy(strategy: CoordinationStrategy): void {
    this.strategy = strategy
  }

  /**
   * 顺序执行多个任务
   */
  async executeSequential(taskIds: string[]): Promise<Task[]> {
    const results: Task[] = []
    for (const taskId of taskIds) {
      const task = await this.executeTask(taskId)
      results.push(task)
      if (task.status === 'failed') break
    }
    return results
  }

  /**
   * 并行执行多个任务
   */
  async executeParallel(taskIds: string[]): Promise<Task[]> {
    return Promise.all(taskIds.map(id => this.executeTask(id)))
  }

  /**
   * 创建子任务
   */
  createSubTask(
    parentTaskId: string,
    type: TaskType,
    input: unknown,
    options?: { priority?: number }
  ): Task | null {
    const parent = this.tasks.get(parentTaskId)
    if (!parent) return null

    return this.createTask(type, input, {
      parentTaskId,
      priority: options?.priority,
    })
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private createEvent(
    type: CoordinatorEvent['type'],
    data: Record<string, unknown>
  ): CoordinatorEvent {
    return { type, timestamp: Date.now(), data }
  }
}

// ============================================================================
// Default Export
// ============================================================================

export const defaultCoordinator = new Coordinator()

/**
 * 快速创建任务
 */
export function createTask(
  type: TaskType,
  input: unknown,
  options?: { agentId?: string; priority?: number }
): Task {
  return defaultCoordinator.createTask(type, input, options)
}

/**
 * 快速执行任务
 */
export async function executeTask(taskId: string): Promise<Task> {
  return defaultCoordinator.executeTask(taskId)
}

/**
 * 注册 Agent
 */
export function registerAgent(config: AgentConfig): Agent {
  return defaultCoordinator.registerAgent(config)
}
