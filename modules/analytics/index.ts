/**
 * Analytics Module - Index
 */

export * from './types'
export * from './analytics'

// Quick usage
import { AnalyticsManager, globalAnalytics, track, feature, getFeatureValue, trackToolUse, trackApiRequest } from './analytics'

export const analytics = globalAnalytics

export default AnalyticsManager
