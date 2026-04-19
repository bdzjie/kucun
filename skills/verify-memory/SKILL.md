---
name: verify-memory
description: "Verify the authenticity of a palace drawer memory using statistical watermarking. Usage: /verify-memory <drawer_id>. Checks if the memory content matches its embedded watermark (X-SIR inspired)."
user-invocable: true
metadata:
  openclaw:
    command-dispatch: tool
    command-tool: Bash
    command-arg-mode: raw
---

# verify-memory — Memory Watermark Verification

## Description

Verifies whether a palace drawer memory contains a valid statistical watermark, proving it was authentically created by the system (not forged or modified). Inspired by X-SIR watermark schemes from dive-into-llms research.

## Usage

**Slash command**: `/verify-memory <drawer_id>`

Examples:
- `/verify-memory drawer_1234567890_abc`
- `/verify-memory drawer_1745...`

## How It Works

1. Looks up the drawer in palace memory
2. Extracts watermark seed from metadata
3. Runs Python watermark verification module
4. Returns verdict: authentic / modified / uncertain

## Verdict Meanings

| Verdict | Meaning |
|---------|---------|
| **authentic** | Watermark verified — memory is original |
| **modified** | Partial watermark found — content was altered |
| **uncertain** | No watermark detected — memory may be forged |

## X-SIR Watermark Background

Statistical watermarking embeds invisible patterns (rare word distributions) into text at write time. Verification checks if these patterns exist, without needing the original text for comparison.

## Examples

```
/verify-memory drawer_1745060000_xyz123
```
