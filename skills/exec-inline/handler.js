/**
 * exec-inline skill handler
 * Runs inline JavaScript via `node -e "..."` — no temp file needed.
 */

export default async function execInlineHandler(event) {
  // Extract input
  let input = '';
  if (event.type === 'message' && event.context?.content) {
    input = event.context.content;
  } else if (event.message?.content) {
    input = event.message.content;
  }

  // Parse: /eval <code> or /js <code>
  const match = input.match(/^\/(?:eval|js)\s+(.+)$/is);
  if (!match) {
    return {
      handled: true,
      skill: 'exec-inline',
      response: `Usage: /eval <javascript_expression>\n\nExamples:\n  /eval 2+2\n  /eval [1,2,3].map(x => x*2)\n  /eval JSON.parse('{"a":1}')\n\nFor multi-line scripts, use: /exec <script_path>`,
    };
  }

  const code = match[1].trim();
  const preview = code.length > 60 ? code.slice(0, 60) + '...' : code;

  try {
    const { execFileSync } = await import('node:child_process');

    // Escape double quotes in the code for shell safety
    const escaped = code.replace(/"/g, '\\"');

    const result = execFileSync('node', ['-e', `"${escaped}"`], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 256 * 1024,
    });

    const output = result.trim();

    return {
      handled: true,
      skill: 'exec-inline',
      response: output
        ? `> ${preview}\n${output}`
        : `> ${preview}\n(undefined)`,
      code,
      output,
    };
  } catch (e) {
    const stderr = e.stderr?.trim() || e.message;
    const exitCode = e.status;

    // Node.js errors often contain the actual error message
    let errorMsg = stderr;
    if (stderr.includes('SyntaxError') || stderr.includes('ReferenceError') ||
        stderr.includes('TypeError') || stderr.includes('Error')) {
      // Extract the meaningful part
      const lines = stderr.split('\n');
      const errorLine = lines.find(l =>
        l.includes('SyntaxError') || l.includes('ReferenceError') ||
        l.includes('TypeError') || l.includes('Error:'));
      errorMsg = errorLine || stderr;
    }

    return {
      handled: true,
      skill: 'exec-inline',
      response: `> ${preview}\n${errorMsg}\n\nExit code: ${exitCode}`,
      code,
      error: errorMsg,
      exitCode,
    };
  }
}
