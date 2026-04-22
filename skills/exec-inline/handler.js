/**
 * exec-inline skill handler
 * Runs inline JavaScript via `node -e "..."` — no temp file needed.
 *
 * Depth-aware timeout and buffer:
 *   fast   → 3000ms / 256KB   (simple expressions, quick feedback)
 *   normal → 8000ms / 256KB   (standard scripts)
 *   deep   → 20000ms / 1MB    (complex multi-line scripts)
 *
 * SkillContext passed via event.skillContext or event.context.skillContext
 */

const DEPTH_TIMEOUTS = {
  fast:   3000,
  normal:  8000,
  deep:   20000,
}

const DEPTH_MAX_BUFFER = {
  fast:   256 * 1024,
  normal:  256 * 1024,
  deep:   1024 * 1024,
}

export default async function execInlineHandler(event) {
  // ─── SkillContext: depth-aware config ─────────────────────────
  const skillContext = event?.skillContext ?? event?.context?.skillContext ?? {}
  const depth = skillContext.depth ?? 'normal'
  const timeout = DEPTH_TIMEOUTS[depth] ?? DEPTH_TIMEOUTS.normal
  const maxBuffer = DEPTH_MAX_BUFFER[depth] ?? DEPTH_MAX_BUFFER.normal

  // ─── Extract input ─────────────────────────────────────────────
  let input = ''
  if (event.type === 'message' && event.context?.content) {
    input = event.context.content
  } else if (event.message?.content) {
    input = event.message.content
  }

  // Parse: /eval <code> or /js <code>
  const match = input.match(/^\/(?:eval|js)\s+(.+)$/is)
  if (!match) {
    return {
      handled: true,
      skill: 'exec-inline',
      response: `Usage: /eval <javascript_expression>\n\nExamples:\n  /eval 2+2\n  /eval [1,2,3].map(x => x*2)\n  /eval JSON.parse('{"a":1}')\n\nFor multi-line scripts, use: /exec <script_path>`,
    }
  }

  const code = match[1].trim()
  const preview = code.length > 60 ? code.slice(0, 60) + '...' : code

  try {
    const { execFileSync } = await import('node:child_process')

    // Escape double quotes in the code for shell safety
    const escaped = code.replace(/"/g, '\\"')

    const result = execFileSync('node', ['-e', `"${escaped}"`], {
      encoding: 'utf8',
      timeout,
      maxBuffer,
    })

    const output = result.trim()

    return {
      handled: true,
      skill: 'exec-inline',
      response: output
        ? `> ${preview}\n${output}`
        : `> ${preview}\n(undefined)`,
      code,
      output,
      depth,
    }
  } catch (e) {
    const stderr = e.stderr?.trim() || e.message
    const exitCode = e.status

    // Node.js errors often contain the actual error message
    let errorMsg = stderr
    if (stderr.includes('SyntaxError') || stderr.includes('ReferenceError') ||
        stderr.includes('TypeError') || stderr.includes('Error')) {
      const lines = stderr.split('\n')
      const errorLine = lines.find(l =>
        l.includes('SyntaxError') || l.includes('ReferenceError') ||
        l.includes('TypeError') || l.includes('Error:'))
      errorMsg = errorLine || stderr
    }

    return {
      handled: true,
      skill: 'exec-inline',
      response: `> ${preview}\n${errorMsg}\n\nExit code: ${exitCode}`,
      code,
      error: errorMsg,
      exitCode,
      depth,
    }
  }
}
