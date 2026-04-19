---
metadata:
  openclaw:
    version: 1.0
    type: skill
    name: exec-inline
    description: Execute inline JavaScript/Node.js without temp files
    autoCreated: false
---

# exec-inline — Inline Code Execution Skill

## Description

Runs inline JavaScript directly via `node -e` with no temp file overhead.
Designed for quick calculations, string operations, JSON manipulation, and prototyping.

## Usage

```
/eval <expression>
// or
/js <expression>
```

## Examples

- `/eval 2+2` → `4`
- `/eval JSON.stringify({a:1,b:[1,2,3]},null,2)`
- `/eval Buffer.from('aGVsbG8=','base64').toString()`

## Technical

- Uses `node -e "code"` directly (no subprocess temp file)
- 5 second timeout
- 256KB output buffer
