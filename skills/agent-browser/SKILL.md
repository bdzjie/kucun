---
name: agent-browser
description: >
  Browser automation via agent-browser CLI (Vercel Labs, Rust). Use when you need to
  navigate, screenshot, fill forms, click elements, or extract content from web pages.
  Requires Chrome installed via `agent-browser install`.
triggers:
  - "/browser"
  - "open a website"
  - "fill a form"
  - "take a screenshot"
  - "scrape a page"
  - "click a button"
  - "extract text from page"
  - "search for"
---

# agent-browser — Browser Automation CLI

Native Rust CLI with stable `@eN` accessibility tree refs. Fast, AI-friendly.

## Core Concept

```
snapshot output:
[1] "Search" (textbox) @e1   ← stable ref
[2] "Bing" (button) @e2
[3] "Sign in" (link) @e3

agent-browser fill @e1 "query"   ← use @eN, never CSS selectors
```

## Quick Start

```bash
agent-browser open https://www.bing.com
agent-browser snapshot                    # get refs
agent-browser fill @e1 "search query"   # fill by ref
agent-browser press Enter
agent-browser screenshot result.png
agent-browser close
```

## 中国搜索引掣

| 引擎 | URL |
|------|-----|
| Bing | https://www.bing.com |
| 百度 | https://www.baidu.com |
| DuckDuckGo | https://duckduckgo.com |

## 5 Core Commands

| Command | Purpose |
|---------|---------|
| `open <url>` | Navigate |
| `snapshot` | Get accessibility tree with @eN refs |
| `fill @eN <text>` | Fill by ref (clears first) |
| `click @eN` | Click by ref |
| `screenshot <path>` | Capture |

## Selector Priority

1. **@eN ref** — from snapshot output (stable)
2. **Semantic** — `find role button --name "Submit"`
3. **Text** — `find text "Sign In"`
4. **Never CSS** — breaks on page changes

## Red Flags

- CSS selectors when @eN available
- Hardcoded coordinates (e.g., `click 100 200`)
- No wait before interaction
- Forgetting to `close`
- Screenshot without accessibility tree

## Quick Reference

```bash
agent-browser open <url>
agent-browser snapshot [-i]
agent-browser fill @eN <text>
agent-browser type @eN <text>      # append
agent-browser click @eN
agent-browser press <key>
agent-browser wait @eN | --load | --text | --url | --fn
agent-browser get title | url | text @eN
agent-browser screenshot <path>
agent-browser batch "cmd1" "cmd2" ...
agent-browser tab new --label <name> <url>
agent-browser tab <name>
agent-browser network route|requests
agent-browser close [--all]
agent-browser install [--status]
```

## Verification

- [ ] Browser closed
- [ ] Screenshots named descriptively
- [ ] Content extracted to file/memory
- [ ] URL matches expected
- [ ] No open dialogs

## Error Recovery

```bash
agent-browser install --status
agent-browser close --all
agent-browser console           # view errors
agent-browser get cdp-url
```

## References

- `references/commands.md` — All commands with examples
- `references/windows-config.md` — Windows setup + config.toml

## Progressive Disclosure

Long content → `references/commands.md`
