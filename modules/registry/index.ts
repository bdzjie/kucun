/**
 * Registry Module - Index
 */

export * from './types'
export * from './registry'

// Quick usage
import { ToolRegistry, globalToolRegistry, registerTool, getTool, executeTool, listTools } from './registry'

export const tools = globalToolRegistry

export default ToolRegistry
