---
name: exec-inline
description: "Execute inline JavaScript/Node.js code snippets directly without temp files. Use /eval <code> or /js <code>. Examples: /eval 2+2 /eval Array.from({length:5},(_,i)=>i*i) /js process.version"
user-invocable: true
metadata:
  openclaw:
    command-dispatch: tool
    command-tool: Bash
    command-arg-mode: raw
---

# exec-inline — Inline Code Execution

## Description

Executes inline JavaScript/Node.js code directly via `node -e "..."` without creating temporary files. Fast, zero-overhead execution for short snippets.

## Usage

**Slash command**: `/eval <javascript>` or `/js <javascript>`

Examples:
- `/eval 2+2`
- `/eval Array.from({length:5},(_,i)=>i*i)`
- `/eval Buffer.from('aGVsbG8=','base64').toString()`
- `/js process.version`
- `/eval JSON.stringify({name:'Q仔',role:'assistant'},null,2)`

## Supported Languages

| Language | Command | Example |
|----------|---------|---------|
| JavaScript (Node) | `/eval` or `/js` | `/eval Math.random()` |

## Features

- No temp file creation — runs directly via `node -e`
- Result printed as formatted output
- Error output captured and displayed
- Supports most Node.js built-ins: Buffer, JSON, Math, Array, Object, etc.

## Limitations

- Single expression or statement only
- No multi-line code (use `/exec` for scripts)
- No require() or module imports (use `/exec` for modules)
- No file system or network access (use `/exec` for those)

## Examples

```
/eval 1+1
/eval 'hello'.toUpperCase()
/eval [1,2,3,4,5].filter(x => x % 2 === 0)
```
