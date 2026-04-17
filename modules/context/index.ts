/**
 * Context Module - Index
 */

export * from './types'
export * from './manager'

// Quick usage
import { ContextManager, defaultContextManager } from './manager'

export const context = defaultContextManager

export default ContextManager
