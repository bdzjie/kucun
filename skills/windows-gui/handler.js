/**
 * windows-gui skill handler
 * Wraps PyAutoGUI for Windows GUI automation
 * Takes slash commands like: /windows-gui click 100 200
 */

export default async function windowsGuiHandler(event) {
  // Extract input
  let input = '';
  if (event.type === 'message' && event.context?.content) {
    input = event.context.content;
  } else if (event.message?.content) {
    input = event.message.content;
  }

  // Parse: /windows-gui <action> [args...]
  const match = input.match(/^\/windows-gui\s+(\w+)(?:\s+(.+))?$/i);
  if (!match) {
    return {
      handled: true,
      skill: 'windows-gui',
      response: `Usage: /windows-gui <action> [args...]\n\nActions:\n  click <x> <y>     — click at coordinates\n  dblclick <x> <y>  — double click\n  rightclick <x> <y> — right click\n  move <x> <y>     — move mouse\n  type <text>       — type text\n  press <key>      — press key (Win+r, Enter, Ctrl+c, etc.)\n  screenshot        — take screenshot\n  locate <image>   — locate image on screen\n  position         — get current mouse position\n  sleep <sec>      — pause\n\nExample: /windows-gui click 100 200`,
    };
  }

  const [, action, argsStr] = match;
  const actionLower = action.toLowerCase();
  const args = argsStr ? argsStr.trim() : '';

  // Build Python script based on action
  let pyCode = '';
  let resultPrefix = '';

  switch (actionLower) {
    case 'click': {
      const [x, y] = args.split(/\s+/).map(Number);
      if (isNaN(x) || isNaN(y)) {
        return { handled: true, skill: 'windows-gui', response: 'Usage: /windows-gui click <x> <y>' };
      }
      pyCode = `import pyautogui; pyautogui.click(${x}, ${y}); print(f"Clicked at ({x}, {y})")`;
      resultPrefix = `Clicked at (${x}, ${y})`;
      break;
    }

    case 'dblclick': {
      const [x, y] = args.split(/\s+/).map(Number);
      if (isNaN(x) || isNaN(y)) {
        return { handled: true, skill: 'windows-gui', response: 'Usage: /windows-gui dblclick <x> <y>' };
      }
      pyCode = `import pyautogui; pyautogui.doubleClick(${x}, ${y}); print(f"Double-clicked at ({x}, {y})")`;
      resultPrefix = `Double-clicked at (${x}, ${y})`;
      break;
    }

    case 'rightclick': {
      const [x, y] = args.split(/\s+/).map(Number);
      if (isNaN(x) || isNaN(y)) {
        return { handled: true, skill: 'windows-gui', response: 'Usage: /windows-gui rightclick <x> <y>' };
      }
      pyCode = `import pyautogui; pyautogui.rightClick(${x}, ${y}); print(f"Right-clicked at ({x}, {y})")`;
      resultPrefix = `Right-clicked at (${x}, ${y})`;
      break;
    }

    case 'move': {
      const [x, y] = args.split(/\s+/).map(Number);
      if (isNaN(x) || isNaN(y)) {
        return { handled: true, skill: 'windows-gui', response: 'Usage: /windows-gui move <x> <y>' };
      }
      pyCode = `import pyautogui; pyautogui.moveTo(${x}, ${y}); print(f"Moved to ({x}, {y})")`;
      resultPrefix = `Moved to (${x}, ${y})`;
      break;
    }

    case 'type': {
      if (!args) {
        return { handled: true, skill: 'windows-gui', response: 'Usage: /windows-gui type <text>' };
      }
      // Escape quotes
      const escaped = args.replace(/"/g, '\\"');
      pyCode = `import pyautogui; pyautogui.write("${escaped}", interval=0.05); print(f"Typed: ${args}")`;
      resultPrefix = `Typed: ${args}`;
      break;
    }

    case 'press': {
      if (!args) {
        return { handled: true, skill: 'windows-gui', response: 'Usage: /windows-gui press <key>' };
      }
      const key = args.trim();
      pyCode = `import pyautogui; pyautogui.press('${key}'); print(f"Pressed: ${key}")`;
      resultPrefix = `Pressed: ${key}`;
      break;
    }

    case 'screenshot': {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const outPath = `C:/Users/Administrator/Desktop/screenshot_${timestamp}.png`;
      pyCode = `import pyautogui; pyautogui.screenshot('${outPath}'); print(f"Saved: ${outPath}")`;
      resultPrefix = `Screenshot saved`;
      break;
    }

    case 'position': {
      pyCode = `import pyautogui; x, y = pyautogui.position(); print(f"Mouse at: ({x}, {y})")`;
      resultPrefix = 'Mouse position';
      break;
    }

    case 'locate': {
      if (!args) {
        return { handled: true, skill: 'windows-gui', response: 'Usage: /windows-gui locate <image_path>' };
      }
      const imgPath = args.trim().replace(/\\/g, '/');
      pyCode = `import pyautogui; loc = pyautogui.locateOnScreen('${imgPath}'); print('Found:', loc) if loc else print('Not found')`;
      resultPrefix = 'Image locate result';
      break;
    }

    case 'sleep': {
      const sec = parseFloat(args);
      if (isNaN(sec)) {
        return { handled: true, skill: 'windows-gui', response: 'Usage: /windows-gui sleep <seconds>' };
      }
      pyCode = `import time; time.sleep(${sec}); print(f"Slept for {sec} seconds")`;
      resultPrefix = `Slept for ${sec}s`;
      break;
    }

    case 'hotkey': {
      if (!args) {
        return { handled: true, skill: 'windows-gui', response: 'Usage: /windows-gui hotkey <key1> <key2> ...' };
      }
      const keys = args.split(/\s+/).map(k => `'${k}'`).join(', ');
      pyCode = `import pyautogui; pyautogui.hotkey(${keys}); print("Hotkey pressed: ${args}")`;
      resultPrefix = `Hotkey: ${args}`;
      break;
    }

    case 'scroll': {
      const amt = parseInt(args);
      if (isNaN(amt)) {
        return { handled: true, skill: 'windows-gui', response: 'Usage: /windows-gui scroll <amount>' };
      }
      pyCode = `import pyautogui; pyautogui.scroll(${amt}); print(f"Scrolled {amt}")`;
      resultPrefix = `Scrolled ${amt}`;
      break;
    }

    default:
      return {
        handled: true,
        skill: 'windows-gui',
        response: `Unknown action: ${action}\n\nValid actions: click, dblclick, rightclick, move, type, press, screenshot, locate, position, sleep, hotkey, scroll`,
      };
  }

  // Execute via Python
  try {
    const { execFileSync } = await import('node:child_process');
    const PYTHON = 'C:/Users/Administrator/AppData/Local/Programs/Python/Python312/python.exe';
    const result = execFileSync(PYTHON, ['-c', pyCode], {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });

    return {
      handled: true,
      skill: 'windows-gui',
      response: result.trim() || resultPrefix,
      action,
      args,
    };
  } catch (e) {
    return {
      handled: true,
      skill: 'windows-gui',
      response: `GUI action failed: ${e.message}`,
    };
  }
}
