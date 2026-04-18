/**
 * memory_hook.mjs — OpenClaw Internal Hook for Auto-Save Memory
 * ============================================================
 *
 * Registers internal hooks for:
 *   agent:bootstrap  → Initialize memory system, load L0+L1
 *   message:preprocessed → Auto-index message to BM25
 *   session:patch   → Detect session end (title change to ended state)
 *
 * Config in openclaw.json:
 *   {
 *     "hooks": {
 *       "internal": {
 *         "enabled": true,
 *         "handlers": [
 *           {
 *             "event": "agent:bootstrap",
 *             "module": "C:/Users/Administrator/.openclaw/workspace/hooks/memory_hook.mjs",
 *             "export": "onAgentBootstrap"
 *           },
 *           {
 *             "event": "message:preprocessed",
 *             "module": "C:/Users/Administrator/.openclaw/workspace/hooks/memory_hook.mjs",
 *             "export": "onMessagePreprocessed"
 *           }
 *         ]
 *       }
 *     }
 *   }
 */

// ============================================================================
// Hook Handlers
// ============================================================================

/**
 * agent:bootstrap — Initialize memory system when agent starts.
 * Loads L0 identity and L1 essential facts into context.
 */
export async function onAgentBootstrap(event) {
  const { context } = event
  const { sessionKey, workspaceDir } = context

  console.log(`[memory_hook] agent:bootstrap session=${sessionKey} workspace=${workspaceDir}`)

  try {
    // Dynamically import memory modules
    // Note: In OpenClaw context, we can use absolute paths
    const { getLayer0 } = await import('./modules/memory/memoryStack.js')
    const { wakeUp } = await import('./modules/memory/memoryStack.js')

    // Get memory wake-up content
    const { layer0, layer1, totalTokens } = await wakeUp()

    // Inject into hook context messages for the agent to pick up
    if (event.messages) {
      event.messages.push(`[Memory L0] ${layer0.content}`)
      if (layer1.content.length > 0) {
        event.messages.push(`[Memory L1] ${layer1.content}`)
      }
      console.log(`[memory_hook] Loaded ${totalTokens} memory tokens (L0+L1)`)
    }
  } catch (error) {
    console.warn('[memory_hook] Failed to load memory on bootstrap:', error.message)
  }
}

/**
 * message:preprocessed — Auto-index each message to BM25 search.
 * Does lightweight real-time indexing without full extraction.
 */
export async function onMessagePreprocessed(event) {
  const { context } = event
  const { content, senderId, senderName, conversationId } = context

  if (!content || content.trim().length < 10) return

  try {
    const { getGlobalPalaceSearch } = await import('./modules/search/palace_search.js')

    const search = getGlobalPalaceSearch()
    const docId = `msg:${conversationId || 'unknown'}:${Date.now()}`

    search.indexDocument({
      id: docId,
      content: `[${senderName || senderId || 'unknown'}]: ${content}`,
      wing: 'wing_user',
      room: 'sessions',
      hall: 'hall_events',
      timestamp: Date.now(),
      metadata: {
        senderId,
        senderName,
        conversationId,
        sessionKey: event.sessionKey,
      },
    })

    console.log(`[memory_hook] Indexed message from ${senderName || senderId}`)
  } catch (error) {
    // Non-critical — don't fail the message pipeline
    console.warn('[memory_hook] BM25 indexing failed:', error.message)
  }
}

/**
 * session:patch — Detect session end and trigger final memory save.
 * When session.endedAt is set, save all accumulated context.
 */
export async function onSessionPatch(event) {
  const { context } = event
  const { sessionEntry, patch } = context

  // Detect session end
  const endedAt = patch?.endedAt
  if (!endedAt) return

  console.log(`[memory_hook] session:end sessionKey=${event.sessionKey}`)

  try {
    // Trigger session end save via the memory bridge
    const { getGlobalBridge } = await import('./modules/search/session_memory_bridge.js')
    const bridge = getGlobalBridge()

    if (bridge) {
      await bridge.saveSession(sessionEntry?.sessionKey || event.sessionKey)
    } else {
      console.warn('[memory_hook] No global bridge available')
    }
  } catch (error) {
    console.warn('[memory_hook] Session end save failed:', error.message)
  }
}

// ============================================================================
// Default export (required by module loader)
// ============================================================================

/**
 * Default export — called when module is first loaded.
 * Registers all internal hooks.
 */
export default async function memoryHookExtension(api) {
  console.log('[memory_hook] Loading memory hook extension...')

  try {
    // Import registerInternalHook from the plugin-sdk
    const { registerInternalHook } = await import('@openclaw/plugin-sdk/internal-hooks')

    // Register handlers
    registerInternalHook('agent:bootstrap', onAgentBootstrap)
    registerInternalHook('message:preprocessed', onMessagePreprocessed)
    registerInternalHook('session:patch', onSessionPatch)

    console.log('[memory_hook] Registered: agent:bootstrap, message:preprocessed, session:patch')
  } catch (error) {
    console.error('[memory_hook] Failed to register hooks:', error.message)
    // Don't re-throw — allow OpenClaw to continue without memory hooks
  }
}
