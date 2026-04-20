# agent-browser Commands Reference

## Navigation

```bash
agent-browser open <url>                    # Navigate to URL
agent-browser get url                       # Current URL
agent-browser get title                     # Page title
```

## Snapshot

```bash
agent-browser snapshot                       # Accessibility tree
agent-browser snapshot -i                    # Interactive (more detail)
```

## Element Interaction

```bash
agent-browser fill @eN <text>              # Clear and fill
agent-browser type @eN <text>              # Append text
agent-browser click @eN                    # Click
agent-browser press <key>                  # e.g., Enter, Escape, Tab
```

## Semantic Locators (AI-Friendly)

```bash
# By ARIA role
agent-browser find role button click --name "Search"
agent-browser find role link click --name "Sign in"

# By text content
agent-browser find text "Sign In" click
agent-browser find text "Learn more" --name "a"

# By label
agent-browser find label "Search" fill "query"
agent-browser find label "Email" type "user@example.com"

# Nth element
agent-browser find nth 2 "a" text
agent-browser find nth 1 "button" click
```

## Waiting

```bash
agent-browser wait @eN                        # Wait for element
agent-browser wait --load networkidle          # Wait for network idle
agent-browser wait --load domcontentloaded
agent-browser wait --text "Results"            # Wait for text
agent-browser wait --url "**/search?q=*"       # URL pattern (glob)
agent-browser wait --fn "document.readyState === 'complete'"
```

## Network Control

```bash
# Mock API response
agent-browser network route "**/api/**" --body '{"error": "mocked"}'
agent-browser network route "**/api/**" --status 500 --body '{"error":"Server Error"}'

# Block request
agent-browser network route "**/analytics/**" --abort
agent-browser network route "**/ads/**" --abort

# View requests
agent-browser network requests --filter api
agent-browser network requests --filter xhr
```

## Multi-Tab

```bash
agent-browser tab new --label search https://www.bing.com
agent-browser tab new --label docs https://docs.example.com
agent-browser tab search              # Switch to tab
agent-browser tab docs
agent-browser tab new <url>           # Unlabeled tab
```

## Batch Execution

```bash
agent-browser batch \
  "open https://www.bing.com" \
  "snapshot -i" \
  "fill @e1 AI agents" \
  "press Enter" \
  "wait --load networkidle" \
  "screenshot results.png" \
  "close"
```

## Screenshot

```bash
agent-browser screenshot result.png
agent-browser screenshot --full-page page.png
```

## Extraction

```bash
agent-browser get text @eN           # Text of element
agent-browser get html @eN            # Inner HTML
agent-browser get attribute @eN href   # Specific attribute
```

## Examples

### Complete Search Workflow (Bing)

```bash
agent-browser open https://www.bing.com
agent-browser snapshot -i              # Find search box ref (usually @e1)
agent-browser fill @e1 "OpenClaw browser automation"
agent-browser press Enter
agent-browser wait --load networkidle
agent-browser snapshot
# Extract results...
agent-browser close
```

### Form Fill

```bash
agent-browser open https://example.com/login
agent-browser snapshot -i
agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3               # Submit button
agent-browser wait --url "**/dashboard"
agent-browser screenshot dashboard.png
```

### Extract Search Results

```bash
agent-browser open https://www.bing.com
agent-browser fill @e1 "weather Shanghai"
agent-browser press Enter
agent-browser wait --load networkidle
agent-browser snapshot
# Results are in the accessibility tree as links with @eN refs
# Extract: agent-browser get text @e5
#          agent-browser get attribute @e5 href
```

### Multi-Step Workflow

```bash
agent-browser batch \
  "open https://github.com" \
  "snapshot" \
  "find role link click --name Sign in" \
  "wait --url '**/login**'" \
  "fill @e1 your-email" \
  "fill @e2 your-password" \
  "click @e3" \
  "wait --url '**/dashboard**'" \
  "screenshot logged-in.png"
```
