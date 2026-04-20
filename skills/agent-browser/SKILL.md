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

## Overview

Native Rust CLI for browser automation. Fast, cross-platform, and AI-friendly through its
accessibility tree with stable `@eN` refs instead of fragile CSS selectors.

## When to Use

- Navigating to URLs and taking screenshots
- Filling forms and clicking buttons
- Extracting content from web pages (text, HTML, attributes)
- Searching the web via Bing, Baidu, or other search engines
- Waiting for page elements or conditions
- Network request interception/mocking
- Browser testing and verification
- Any task requiring a real browser

**Requires:** `agent-browser` installed (`npm install -g agent-browser`) and Chrome
downloaded (`agent-browser install`).

## Domestically Accessible Search Engines (China)

Since Google is not accessible in mainland China, use these alternatives:

| Search Engine | URL | Notes |
|---------------|-----|-------|
| **Bing** | https://www.bing.com | Microsoft, clean results, recommended |
| **Baidu** | https://www.baidu.com | Chinese language search |
| **DuckDuckGo** | https://duckduckgo.com | Privacy-focused, international |
| **Yandex** | https://yandex.com | Russian, good for international |

## Core Concept: Accessibility Tree with Refs

Instead of fragile CSS selectors, agent-browser uses accessibility tree refs:

```
snapshot output:
[1] "Search" (textbox) @e1
[2] "Bing" (button) @e2
[3] "Sign in" (link) @e3

Use @e1 to reference the search box:
agent-browser fill @e1 "search query"
agent-browser press Enter
```

## Process

### 1. Open and Snapshot

```bash
# Navigate to URL (use Bing for search)
agent-browser open https://www.bing.com

# Get accessibility tree with refs
agent-browser snapshot

# Get interactive snapshot
agent-browser snapshot -i
```

### 2. Search Example (Bing)

```bash
# Open Bing
agent-browser open https://www.bing.com

# Get snapshot to find search box
agent-browser snapshot

# Fill and search (use @e1 from snapshot output)
agent-browser fill @e1 "your search query"
agent-browser press Enter

# Wait for results
agent-browser wait --load networkidle

# Get results
agent-browser snapshot
```

### 3. Interact with Elements

```bash
# Click by ref (preferred)
agent-browser click @e2

# Fill by ref (clears and types)
agent-browser fill @e3 "password123"

# Type by ref (appends)
agent-browser type @e3 "more text"

# Press key
agent-browser press Enter
```

### 4. Verify and Extract

```bash
# Get text content
agent-browser get text @e1

# Get page title
agent-browser get title

# Get current URL
agent-browser get url

# Take screenshot
agent-browser screenshot result.png
```

### 5. Semantic Locators (AI-Friendly)

When you don't have a ref, use semantic locators:

```bash
# By ARIA role
agent-browser find role button click --name "Search"

# By text content
agent-browser find text "Sign In" click

# By label
agent-browser find label "Search" fill "query"

# Nth element
agent-browser find nth 2 "a" text
```

### 6. Wait for Conditions

```bash
# Wait for element
agent-browser wait @e1

# Wait for text
agent-browser wait --text "Results"

# Wait for URL pattern
agent-browser wait --url "**/search?q=*"

# Wait for JS condition
agent-browser wait --fn "document.readyState === 'complete'"
```

### 7. Batch Execution (Faster)

Execute multiple commands in one invocation:

```bash
agent-browser batch "open https://www.bing.com" "snapshot -i" "fill @e1 AI agents" "press Enter" "wait --load networkidle" "screenshot results.png"
```

### 8. Network Control

```bash
# Mock API response
agent-browser network route "**/api/**" --body '{"error": "mocked"}'

# Block request
agent-browser network route "**/analytics/**" --abort

# View requests
agent-browser network requests --filter api
```

### 9. Multi-Tab Workflow

```bash
# Open search in new tab
agent-browser tab new --label search https://www.bing.com

# Switch to search tab
agent-browser tab search

# Open another site
agent-browser tab new --label docs https://docs.example.com

# Switch between tabs
agent-browser tab search
agent-browser tab docs
```

## Common Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "CSS selectors work fine" | CSS selectors break when page structure changes. Refs are stable within a session. |
| "I'll use coordinates" | Coordinates fail on different screen sizes. Use semantic locators instead. |
| "Screenshot is enough" | Accessibility tree (`snapshot`) is parseable text. Screenshots are just images. |
| "I don't need to wait" | Pages load asynchronously. Always wait for elements explicitly. |
| "One browser instance is fine" | Use `tab new` for multi-page workflows; don't close and reopen. |

## Red Flags

- Using CSS selectors when refs are available
- Hardcoded coordinates (e.g., `click 100 200`)
- Not waiting for elements before interacting
- Forgetting to `close` the browser when done
- Taking screenshots without also getting the accessibility tree
- Mixing selector strategies (@eN, CSS, text) inconsistently

## Verification

After any browser automation task:

- [ ] Browser is closed (`agent-browser close`)
- [ ] Screenshots saved with descriptive names
- [ ] Any important content extracted to memory/file
- [ ] Navigation worked as expected (check URL)
- [ ] No dialogs left open (alert/confirm)

## Error Recovery

```bash
# Check if Chrome is installed
agent-browser install --status

# Force reinstall Chrome
agent-browser install

# Close stuck browser
agent-browser close --all

# View console errors
agent-browser console

# Get CDP URL for debugging
agent-browser get cdp-url
```

## Windows Configuration

On Windows, if Chrome is not found automatically, create `~/.agent-browser/config.toml`:

```toml
executable_path = "C:\\Users\\<USER>\\.agent-browser\\browsers\\chrome-<VERSION>\\chrome-win64\\chrome.exe"
```

Or use the `--executable-path` flag:

```bash
agent-browser --executable-path "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" open https://www.bing.com
```

**Auto-connect** to a running Chrome instance:

```bash
agent-browser --auto-connect open https://www.bing.com
```
