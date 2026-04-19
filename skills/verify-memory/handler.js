/**
 * verify-memory skill handler
 * Verifies palace drawer watermark using Python module.
 */

const PYTHON = 'C:/Users/Administrator/AppData/Local/Programs/Python/Python312/python.exe';
const WM_MODULE = 'C:/Users/Administrator/.openclaw/workspace/modules/memory_watermark.py';
const PALACE_FILE = 'C:/Users/Administrator/.openclaw/memory/palace_state.json';

export default async function verifyMemoryHandler(event) {
  let input = '';
  if (event.type === 'message' && event.context?.content) {
    input = event.context.content;
  } else if (event.message?.content) {
    input = event.message.content;
  }

  // Parse: /verify-memory <drawer_id>
  const match = input.match(/^\/verify-memory\s+(\S+)$/i);
  if (!match) {
    return {
      handled: true,
      skill: 'verify-memory',
      response: `Usage: /verify-memory <drawer_id>\n\nExamples:\n  /verify-memory drawer_1745060000_abc\n  /verify-memory drawer_xxx_yyy\n\nVerifies if a palace memory drawer has a valid statistical watermark.`,
    };
  }

  const drawerId = match[1].trim();

  // Load palace state
  let palace;
  try {
    const { readFileSync, existsSync } = await import('node:fs');
    if (!existsSync(PALACE_FILE)) {
      return { handled: true, skill: 'verify-memory', response: 'Palace memory not found.' };
    }
    const raw = readFileSync(PALACE_FILE, 'utf8');
    palace = JSON.parse(raw);
  } catch (e) {
    return { handled: true, skill: 'verify-memory', response: `Failed to load palace: ${e.message}` };
  }

  // Find drawer
  const drawers = palace.drawers || [];
  const drawer = drawers.find(d => d.id === drawerId);

  if (!drawer) {
    const similar = drawers
      .filter(d => d.id.includes(drawerId.slice(-6)))
      .slice(0, 3)
      .map(d => d.id);
    return {
      handled: true,
      skill: 'verify-memory',
      response: `Drawer not found: ${drawerId}\n\nSimilar: ${similar.join(', ') || 'none'}`,
    };
  }

  // Check if drawer has watermark metadata
  const wmMeta = drawer.metadata?.watermark;
  if (!wmMeta?.watermark_seed) {
    return {
      handled: true,
      skill: 'verify-memory',
      response: `Drawer ${drawerId} has no watermark metadata.\n\nDrawer info:\n  Wing: ${drawer.wing}\n  Room: ${drawer.room}\n  Hall: ${drawer.hall}\n  Added: ${new Date(drawer.addedAt).toLocaleString('zh-CN')}\n  Content: ${(drawer.content || '').slice(0, 100)}...`,
    };
  }

  const seed = wmMeta.watermark_seed;

  // Run watermark verification via Python
  try {
    const { execFileSync } = await import('node:child_process');

    const result = execFileSync(PYTHON, [WM_MODULE, 'verify', seed, drawer.content], {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 256 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    const v = JSON.parse(result.trim());

    const verdictIcon = v.verdict === 'authentic' ? '✅'
      : v.verdict === 'modified' ? '⚠️'
      : '❓';

    const lines = [
      `=== Memory Watermark Verification ===`,
      `Drawer: ${drawerId}`,
      `Seed: ${v.seed}`,
      ``,
      `${verdictIcon} Verdict: **${v.verdict.toUpperCase()}** (confidence: ${(v.confidence * 100).toFixed(0)}%)`,
      ``,
      `Matched rare words: ${v.matched_words?.join(', ') || 'none'}`,
      `Expected marks: ${v.total_checked}`,
      ``,
      `Drawer info:`,
      `  Wing: ${drawer.wing} | Room: ${drawer.room} | Hall: ${drawer.hall}`,
      `  Added: ${new Date(drawer.addedAt).toLocaleString('zh-CN')}`,
      `  Content: ${(drawer.content || '').slice(0, 80)}...`,
    ];

    return {
      handled: true,
      skill: 'verify-memory',
      response: lines.join('\n'),
      drawerId,
      verdict: v.verdict,
      confidence: v.confidence,
      matchedWords: v.matched_words,
    };
  } catch (e) {
    return {
      handled: true,
      skill: 'verify-memory',
      response: `Verification failed: ${e.message}`,
      error: e.message,
    };
  }
}
