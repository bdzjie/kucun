---
name: windows-gui-workflow
description: "Run multi-step Windows GUI automation workflows. Examples: /gui-workflow open-calculator /gui-workflow open-explorer /gui-workflow screenshot /gui-workflow run <json_path>"
user-invocable: true
metadata:
  openclaw:
    command-dispatch: tool
    command-tool: Bash
    command-arg-mode: raw
---  triggers:
    - /windows gui workflow


# windows-gui-workflow — Multi-Step GUI Automation

## Description

Runs predefined multi-step GUI workflows using PyAutoGUI. Each workflow is a sequence of actions (click, type, press, screenshot, etc.) executed in order with delays.

## Available Workflows

| Name | Description |
|------|-------------|
| `open-calculator` | Presses Win+R, types "calc", presses Enter |
| `open-explorer` | Presses Win+R, types "explorer", presses Enter |
| `show-desktop` | Presses Win+D to show desktop |
| `screenshot` | Takes a screenshot and saves to Desktop |

## Usage

**Slash command**: `/gui-workflow <workflow-name>`

Examples:
- `/gui-workflow open-calculator`
- `/gui-workflow show-desktop`
- `/gui-workflow screenshot`

## Custom Workflow

Run a custom workflow from a JSON file:
- `/gui-workflow run C:/path/to/workflow.json`

Workflow JSON format:
```json
{
  "name": "My Workflow",
  "steps": [
    { "action": "press", "args": ["Win", "r"], "delay": 0.5 },
    { "action": "type", "args": ["notepad"], "delay": 0.3 },
    { "action": "press", "args": ["Enter"], "delay": 1.0 },
    { "action": "type", "args": ["Hello World"], "delay": 0.5 },
    { "action": "screenshot", "delay": 0 }
  ]
}
```

## Supported Actions

| Action | Args | Description |
|--------|------|-------------|
| `click` | `[x, y]` | Click at coordinates |
| `dblclick` | `[x, y]` | Double click |
| `rightclick` | `[x, y]` | Right click |
| `move` | `[x, y]` | Move mouse to position |
| `type` | `["text"]` | Type text |
| `press` | `["key"]` | Press single key |
| `hotkey` | `["key1", "key2"]` | Press key combination |
| `scroll` | `[amount]` | Scroll up (+) or down (-) |
| `screenshot` | (none) | Save screenshot to Desktop |
| `position` | (none) | Get current mouse position |
| `sleep` | `[seconds]` | Pause |

## Safety

- FAILSAFE enabled: move mouse to screen corner to abort
- Each step has configurable delay
- Use `position` action to find coordinates first
