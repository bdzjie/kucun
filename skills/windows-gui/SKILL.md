---
name: windows-gui
description: "Control Windows desktop via PyAutoGUI automation. Use this to click, type, scroll, take screenshots, and automate GUI tasks. Examples: /windows-gui click 100 200 /windows-gui type 你好 /windows-gui screenshot /windows-gui press Win+R calc.exe"
user-invocable: true
metadata:
  openclaw:
    command-dispatch: tool
    command-tool: Bash
    command-arg-mode: raw
---  triggers:
    - /windows gui


# windows-gui — Windows GUI Automation

## Description

Controls the Windows desktop using PyAutoGUI. Execute GUI automation commands via natural language or explicit action syntax.

## Prerequisites

- PyAutoGUI must be installed: `pip install pyautogui`
- For screenshot feature: `pip install pyscreeze`

## Usage

**Slash command**: `/windows-gui <action> [args]`

### Available Actions

| Action | Description | Example |
|--------|-------------|---------|
| `click` | Click at coordinates or image | `/windows-gui click 100 200` |
| `dblclick` | Double click | `/windows-gui dblclick 100 200` |
| `rightclick` | Right click | `/windows-gui rightclick 100 200` |
| `move` | Move mouse to coordinates | `/windows-gui move 500 500` |
| `type` | Type text | `/windows-gui type Hello World` |
| `press` | Press a key | `/windows-gui press Win+r` |
| | | `/windows-gui press Enter` |
| | | `/windows-gui press Ctrl+c` |
| `screenshot` | Take screenshot | `/windows-gui screenshot` |
| `sleep` | Pause for seconds | `/windows-gui sleep 2` |
| `position` | Get current mouse position | `/windows-gui position` |
| `locate` | Locate image on screen | `/windows-gui locate button.png` |

## Key Names for `press`

- `Win`, `Enter`, `Tab`, `Escape`, `Space`
- `Ctrl`, `Alt`, `Shift`, `Win`
- `Up`, `Down`, `Left`, `Right`
- `Home`, `End`, `PageUp`, `PageDown`
- `F1`–`F12`
- Combos: `Ctrl+c`, `Ctrl+v`, `Alt+F4`, `Win+d`

## Safety

- Mouse movement is PAUSE by default (set `pyautogui.PAUSE = 0` to disable)
- FAILSAFE: move mouse to corner to abort
- Takes screenshot before dangerous operations

## Examples

```
/windows-gui click 100 100
/windows-gui type Hello World
/windows-gui press Win+r
/windows-gui press Ctrl+c
/windows-gui screenshot
/windows-gui locate chrome.png
/windows-gui sleep 1
/windows-gui move 500 500
/windows-gui rightclick
```

## Notes

- Coordinates are absolute screen coordinates (0,0 = top-left)
- Use `/windows-gui position` to find current mouse position
- Image locate requires a screenshot image file path
- Most actions return confirmation or result
