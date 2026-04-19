"""
Windows GUI Workflow Executor
=============================

Multi-step GUI automation workflows stored as JSON.
Each step is a PyAutoGUI command with optional delays.

Usage:
    python windows_gui_workflow.py <workflow.json>

Workflow format:
{
  "name": "Open Calculator",
  "steps": [
    { "action": "press", "args": ["Win", "r"], "delay": 0.5 },
    { "action": "type", "args": ["calc"], "delay": 0.3 },
    { "action": "press", "args": ["Enter"], "delay": 1.0 },
    { "action": "click", "args": [100, 100], "delay": 0.2 }
  ]
}
"""

import sys
import json
import time
import pyautogui

pyautogui.FAILSAFE = True  # Move to corner to abort
pyautogui.PAUSE = 0.1      # 100ms between actions


def run_step(step):
    action = step.get('action', '').lower()
    args = step.get('args', [])
    delay = step.get('delay', 0.3)

    if action == 'click':
        x, y = args[0], args[1]
        pyautogui.click(x, y)
        print(f"  Clicked ({x}, {y})")

    elif action == 'dblclick':
        x, y = args[0], args[1]
        pyautogui.doubleClick(x, y)
        print(f"  Double-clicked ({x}, {y})")

    elif action == 'rightclick':
        x, y = args[0], args[1]
        pyautogui.rightClick(x, y)
        print(f"  Right-clicked ({x}, {y})")

    elif action == 'move':
        x, y = args[0], args[1]
        pyautogui.moveTo(x, y)
        print(f"  Moved to ({x}, {y})")

    elif action == 'type':
        text = args[0] if args else ''
        pyautogui.write(text, interval=0.05)
        print(f"  Typed: {text}")

    elif action == 'press':
        key = args[0] if args else ''
        pyautogui.press(key)
        print(f"  Pressed: {key}")

    elif action == 'hotkey':
        pyautogui.hotkey(*args)
        print(f"  Hotkey: {'+'.join(args)}")

    elif action == 'scroll':
        amt = args[0] if args else 0
        pyautogui.scroll(amt)
        print(f"  Scrolled: {amt}")

    elif action == 'screenshot':
        import datetime
        ts = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        path = f"C:/Users/Administrator/Desktop/gui_screenshot_{ts}.png"
        pyautogui.screenshot(path)
        print(f"  Screenshot: {path}")

    elif action == 'sleep':
        t = float(args[0]) if args else 1.0
        print(f"  Sleep {t}s...")
        time.sleep(t)

    elif action == 'position':
        x, y = pyautogui.position()
        print(f"  Position: ({x}, {y})")
        return {'x': x, 'y': y}

    else:
        print(f"  Unknown action: {action}")

    if delay > 0:
        time.sleep(delay)

    return {'action': action, 'success': True}


def run_workflow(workflow):
    name = workflow.get('name', 'Unnamed Workflow')
    steps = workflow.get('steps', [])

    print(f"\n=== Running: {name} ===")
    print(f"Steps: {len(steps)}\n")

    results = []
    for i, step in enumerate(steps, 1):
        print(f"[{i}/{len(steps)}]", end=' ')
        result = run_step(step)
        results.append(result)

    print(f"\n=== Done: {name} ===")
    return results


if __name__ == '__main__':
    if len(sys.argv) < 2:
        # Built-in demo workflows
        workflows = {
            'calc': {
                'name': 'Open Calculator',
                'steps': [
                    {'action': 'press', 'args': ['win', 'r'], 'delay': 0.5},
                    {'action': 'type', 'args': ['calc'], 'delay': 0.3},
                    {'action': 'press', 'args': ['enter'], 'delay': 1.5},
                    {'action': 'screenshot', 'delay': 0},
                ]
            },
            'desktop': {
                'name': 'Show Desktop',
                'steps': [
                    {'action': 'press', 'args': ['win', 'd'], 'delay': 0.3},
                    {'action': 'screenshot', 'delay': 0},
                ]
            },
            'explorer': {
                'name': 'Open File Explorer',
                'steps': [
                    {'action': 'press', 'args': ['win', 'r'], 'delay': 0.4},
                    {'action': 'type', 'args': ['explorer'], 'delay': 0.3},
                    {'action': 'press', 'args': ['enter'], 'delay': 1.0},
                    {'action': 'screenshot', 'delay': 0},
                ]
            },
        }

        print("Available workflows: calc, desktop, explorer")
        print("Usage: python windows_gui_workflow.py <workflow.json>")

        # Run demo
        import json
        wf = workflows['desktop']
        run_workflow(wf)
        print(json.dumps({'status': 'ok', 'workflow': wf['name']}))

    else:
        import json
        wf_path = sys.argv[1]
        with open(wf_path, 'r', encoding='utf-8') as f:
            workflow = json.load(f)
        run_workflow(workflow)
        print(json.dumps({'status': 'ok', 'workflow': workflow.get('name')}))
