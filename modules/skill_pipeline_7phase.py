"""
skill_pipeline_7phase.py — CLI-Anything Inspired 7-Phase Skill Pipeline
======================================================================

将CLI-Anything的7阶段管道理念融入OpenClaw技能创建流程。

7阶段:
  Phase 1: Analyze    — 分析源码/API/用户行为，映射能力
  Phase 2: Design    — 设计命令分组、状态模型、输出格式
  Phase 3: Implement — 生成 handler.js + SKILL.md + references/
  Phase 4: Plan      — 创建 TEST.md（单元+E2E测试计划）
  Phase 5: Test      — 编写 pytest/playwright 测试
  Phase 6: Document  — 更新SKILL.md + references/
  Phase 7: Publish  — 注册到 skill registry + (可选)发布

Usage:
  from modules.skill_pipeline_7phase import SkillPipeline7Phase, run_7phase_creation
  result = run_7phase_creation('my-skill', description='...')
"""

import os
import re
import json
import hashlib
import asyncio
from datetime import datetime
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field, asdict
from pathlib import Path

# ============================================================================
# Config
# ============================================================================

WORKSPACE = r'C:\Users\Administrator\.openclaw\workspace'
SKILLS_DIR = os.path.join(WORKSPACE, 'skills')
STATE_DIR = os.path.expanduser('~/.openclaw')
REGISTRY_FILE = os.path.join(STATE_DIR, 'memory', 'skill_registry.json')
PIPELINE_LOG = os.path.join(STATE_DIR, 'memory', 'skill_pipeline_log.jsonl')

MAX_SKILL_SIZE = 15_000
FORBIDDEN_NAMES = {
    'system', 'kernel', 'root', 'admin', 'sudo', 'password', 'secret',
    'eval', 'exec', 'exec-inline', 'windows-gui', 'windows-gui-workflow',
    'memory-hook', 'hooks', 'scripts', 'modules', '__pycache__',
}


# ============================================================================
# Types
# ============================================================================

@dataclass
class PhaseResult:
    phase: str
    status: str  # 'success' | 'skipped' | 'failed'
    output: Any = None
    errors: List[str] = field(default_factory=list)
    duration_ms: int = 0
    artifacts: Dict[str, str] = field(default_factory=dict)

    def to_dict(self):
        return asdict(self)


@dataclass
class Capability:
    name: str
    description: str
    input_schema: Dict[str, str]  # param -> type
    output_format: str  # 'json' | 'text' | 'markdown'
    complexity: str  # 'low' | 'medium' | 'high'
    examples: List[str] = field(default_factory=list)


@dataclass
class CommandGroup:
    name: str
    description: str
    commands: List[Dict[str, str]]  # [{name, description, example}]


@dataclass
class SkillDesign:
    skill_name: str
    description: str
    trigger_patterns: List[str]
    capabilities: List[Capability]
    command_groups: List[CommandGroup]
    state_model: Dict[str, Any]  # persistent state keys
    output_format: str  # 'json' | 'markdown' | 'text'
    references: List[str]  # planned reference files


# ============================================================================
# Phase Implementations
# ============================================================================

def run_phase_analyze(skill_name: str, description: str, context: Dict) -> PhaseResult:
    """
    Phase 1: Analyze
    - 分析需求描述
    - 检测用户行为模式（从memories.jsonl）
    - 识别所需能力（capabilities）
    - 映射到命令分组（command groups）
    """
    import time
    t0 = time.time()
    errors = []
    artifacts = {}

    capabilities = []
    command_groups = []

    # 从描述中提取关键词
    desc_lower = description.lower()
    words = re.findall(r'[\w\u4e00-\u9fff]{3,}', desc_lower)

    # 能力识别启发式
    capability_map = {
        ('search', 'find', '查询', '搜索'): ('search', 'Search/query capabilities', 'medium', ['query', 'filters']),
        ('analyze', 'analysis', '分析'): ('analyze', 'Analysis capabilities', 'high', ['data', 'options']),
        ('execute', 'run', '执行', '运行'): ('execute', 'Execution capabilities', 'medium', ['command', 'params']),
        ('fetch', 'get', '获取', '拉取'): ('fetch', 'Data fetching', 'low', ['endpoint', 'params']),
        ('write', 'create', '生成', '写入'): ('write', 'Creation/generation', 'medium', ['content', 'path']),
        ('read', 'load', '读取', '加载'): ('read', 'Reading/loading', 'low', ['path', 'format']),
        ('transform', 'convert', '转换', '格式化'): ('transform', 'Data transformation', 'medium', ['input', 'format']),
        ('schedule', 'cron', '定时'): ('schedule', 'Scheduling capabilities', 'medium', ['cron', 'task']),
        ('notify', 'alert', '通知', '提醒'): ('notify', 'Notification capabilities', 'low', ['message', 'channel']),
    }

    found_caps = set()
    for keywords, (cap_id, cap_desc, complexity, examples) in capability_map.items():
        if any(kw in words for kw in keywords):
            if cap_id not in found_caps:
                capabilities.append(Capability(
                    name=cap_id,
                    description=cap_desc,
                    input_schema={'input': 'string', 'options': 'object'},
                    output_format='json',
                    complexity=complexity,
                    examples=examples,
                ))
                found_caps.add(cap_id)

    if not capabilities:
        # 默认能力
        capabilities.append(Capability(
            name='default',
            description='Default skill execution',
            input_schema={'input': 'string'},
            output_format='json',
            complexity='medium',
            examples=[],
        ))

    # 命令分组启发式
    if found_caps:
        for cap in capabilities:
            command_groups.append(CommandGroup(
                name=cap.name,
                description=cap.description,
                commands=[
                    {
                        'name': f'{cap.name}',
                        'description': f'Execute {cap.name}',
                        'example': f'/{skill_name} {cap.name} <input>',
                    }
                ],
            ))

    design = SkillDesign(
        skill_name=skill_name,
        description=description,
        trigger_patterns=[f'/{skill_name}', skill_name],
        capabilities=capabilities,
        command_groups=command_groups,
        state_model={},
        output_format='json',
        references=[],
    )

    artifacts['design'] = asdict(design)
    artifacts['capabilities_count'] = str(len(capabilities))
    artifacts['command_groups_count'] = str(len(command_groups))

    duration_ms = int((time.time() - t0) * 1000)
    return PhaseResult(
        phase='phase1_analyze',
        status='success',
        output=design,
        errors=errors,
        duration_ms=duration_ms,
        artifacts=artifacts,
    )


def run_phase_design(skill_name: str, design: SkillDesign, context: Dict) -> PhaseResult:
    """
    Phase 2: Design
    - 设计命令分组和接口
    - 定义状态模型
    - 选择输出格式
    - 规划reference文件
    """
    import time
    t0 = time.time()
    errors = []
    artifacts = {}

    # 设计触发词
    trigger_patterns = design.trigger_patterns.copy()
    # 从描述中生成更多触发词
    words = re.findall(r'[\w\u4e00-\u9fff]{3,}', design.description)
    for w in words[:5]:
        if len(w) >= 3:
            trigger_patterns.append(w)

    # 规划references
    references = []
    if len(design.capabilities) > 3:
        references.append('references/capabilities.md')
    if len(design.command_groups) > 2:
        references.append('references/commands.md')
    references.append('references/troubleshooting.md')

    # 更新design
    design.trigger_patterns = list(set(trigger_patterns))
    design.references = references

    artifacts['trigger_patterns'] = json.dumps(design.trigger_patterns, ensure_ascii=False)
    artifacts['references_plan'] = json.dumps(references, ensure_ascii=False)
    artifacts['command_groups_count'] = str(len(design.command_groups))

    duration_ms = int((time.time() - t0) * 1000)
    return PhaseResult(
        phase='phase2_design',
        status='success',
        output=design,
        errors=errors,
        duration_ms=duration_ms,
        artifacts=artifacts,
    )


def run_phase_implement(skill_name: str, design: SkillDesign, context: Dict) -> PhaseResult:
    """
    Phase 3: Implement
    - 生成 handler.js
    - 生成 SKILL.md (progressive disclosure)
    - 创建目录结构
    """
    import time
    t0 = time.time()
    errors = []
    artifacts = {}

    skill_path = os.path.join(SKILLS_DIR, skill_name)
    os.makedirs(skill_path, exist_ok=True)
    os.makedirs(os.path.join(skill_path, 'references'), exist_ok=True)

    # 生成 handler.js — 预构建各部分，避免嵌套f-string问题
    commands_json = json.dumps([
        {'name': cg.name, 'description': cg.description}
        for cg in design.command_groups
    ], ensure_ascii=False, indent=2)

    capabilities_json = json.dumps([
        {'name': c.name, 'description': c.description, 'complexity': c.complexity}
        for c in design.capabilities
    ], ensure_ascii=False, indent=2)

    # 预构建 handler.js 各部分
    _cap_lines = '\n'.join(f' *   - {c.name}: {c.description}' for c in design.capabilities)
    _case_lines = '\n'.join(
        f"        case '{cg.name}':\n            result = await handle_{cg.name}(params, event);\n            break;"
        for cg in design.command_groups
    )
    _cap_handlers = '\n\n'.join(
        f"async function handle_{c.name}(params, event) {{\n    return {{\n        status: 'ok',\n        command: '{c.name}',\n        input: params._raw || '',\n        message: `[{c.name}] executed successfully`,\n    }};\n}}"
        for c in design.capabilities
    )

    handler_js = (
        f'/**\n'
        f' * {skill_name}/handler.js\n'
        f' * Auto-generated by 7-Phase Skill Pipeline\n'
        f' * Generated: {datetime.now().isoformat()}\n'
        f' *\n'
        f' * Capabilities ({len(design.capabilities)}):\n'
        f'{_cap_lines}\n'
        f' *\n'
        f' * Command Groups: {len(design.command_groups)}\n'
        f' */\n\n'
        f"export default async function handler(event) {{\n"
        f"    const skillName = '{skill_name}';\n"
        f'    const startTime = Date.now();\n\n'
        f'    let input = "";\n'
        f"    let command = 'default';\n"
        f'    let params = {{}};\n\n'
        f'    if (event?.context?.content) {{\n'
        f'        input = event.context.content;\n'
        f'    }} else if (event?.message?.content) {{\n'
        f'        input = event.message.content;\n'
        f'    }} else if (typeof event === "string") {{\n'
        f'        input = event;\n'
        f'    }}\n\n'
        f"    const parts = input.trim().split(/\\\\s+/);\n"
        f'    if (parts.length > 1 && !parts[0].startsWith("/")) {{\n'
        f'        command = parts[0];\n'
        f'        params._raw = parts.slice(1).join(" ");\n'
        f'    }}\n\n'
        f'    const commands = commands_json;\n\n'
        f'    let result;\n'
        f'    switch (command) {{\n'
        f'{_case_lines}\n'
        f'        default:\n'
        f'            result = await handle_default(params, event);\n'
        f'    }}\n\n'
        f'    return {{\n'
        f'        handled: true,\n'
        f'        skill: skillName,\n'
        f'        command,\n'
        f'        result,\n'
        f'        duration_ms: Date.now() - startTime,\n'
        f'        timestamp: new Date().toISOString(),\n'
        f'    }};\n'
        f'}}\n\n'
        f'// ─── Capability Handlers ────────────────────────────────────────────────────\n\n'
        f'{_cap_handlers}\n\n'
        f'async function handle_default(params, event) {{\n'
        f'    return {{\n'
        f'        status: "ok",\n'
        f'        message: "Skill executed. Use a subcommand for specific actions.",\n'
        f'        available_commands: commands_json,\n'
        f'    }};\n'
        f'}}\n\n'
        f'// ─── State Management ────────────────────────────────────────────────────────\n\n'
        f'const state = {{}};\n\n'
        f'export function getState(key, defaultValue = null) {{\n'
        f'    return state[key] !== undefined ? state[key] : defaultValue;\n'
        f'}}\n\n'
        f'export function setState(key, value) {{\n'
        f'    state[key] = value;\n'
        f'}}\n\n'
        f'export function clearState() {{\n'
        f'    Object.keys(state).forEach(k => delete state[k]);\n'
        f'}}\n'
    )

    # 生成 SKILL.md
    triggers_md = '\n'.join(f'- {t}' for t in design.trigger_patterns[:8])
    cap_list_md = '\n'.join(f'  - {c.name}: {c.description} ({c.complexity})' for c in design.capabilities)
    cmd_table_md = '\n'.join(f'| `/{skill_name} {cg.name}` | {cg.description} |' for cg in design.command_groups)
    cap_bullets_md = '\n'.join(f'- **{c.name}** ({c.complexity}): {c.description}' for c in design.capabilities)

    skill_md = (
        f'---\n'
        f'name: {skill_name}\n'
        f'description: >\n'
        f'  {design.description}\n'
        f'triggers:\n'
        f'{triggers_md}\n'
        f'capabilities:\n'
        f'{cap_list_md}\n'
        f'output_format: {design.output_format}\n'
        f'generated_by: 7phase-pipeline\n'
        f'---\n\n'
        f'# {skill_name}\n\n'
        f'{design.description}\n\n'
        f'## Quick Start\n\n'
        f'`/{skill_name} <command> [args]`\n\n'
        f'## Commands\n\n'
        f'| Command | Description |\n'
        f'|---------|-------------|\n'
        f'{cmd_table_md}\n\n'
        f'## Capabilities\n\n'
        f'{cap_bullets_md}\n\n'
        f'## State\n\n'
        f'This skill maintains lightweight state in memory during execution.\n'
        f'No persistent storage is required for basic operation.\n\n'
        f'## References\n\n'
        f'For detailed guides, see:\n'
        f'- `references/capabilities.md` — Full capability reference\n'
        f'- `references/commands.md` — Command reference\n'
        f'- `references/troubleshooting.md` — Common issues\n\n'
        f'> ⚠️ This SKILL.md uses **progressive disclosure**. Detailed docs are in `references/` — only load them when needed.\n'
    )

    # 生成 references/capabilities.md
    _cap_ref_sections = []
    for i, c in enumerate(design.capabilities):
        _ex_list = '\n'.join(f'- `{ex}`' for ex in c.examples)
        _cap_ref_sections.append(
            f'## {i+1}. {c.name}\n\n'
            f'**Complexity:** {c.complexity}\n\n'
            f'**Description:** {c.description}\n\n'
            f'**Input Schema:**\n'
            f'```json\n'
            f'{json.dumps(c.input_schema, indent=2, ensure_ascii=False)}\n'
            f'```\n\n'
            f'**Output Format:** {c.output_format}\n\n'
            f'**Examples:**\n'
            f'{_ex_list}\n'
        )
    _cap_ref_body = '\n\n'.join(_cap_ref_sections)
    capabilities_ref = (
        f'# {skill_name} — Capabilities Reference\n\n'
        f'## Overview\n\n'
        f'This skill has {len(design.capabilities)} capability(ies):\n\n'
        f'{_cap_ref_body}\n\n'
        f'## Capability Map\n\n'
        f'```json\n'
        f'{capabilities_json}\n'
        f'```\n'
    )

    # 生成 references/commands.md
    _cg_blocks = []
    for cg in design.command_groups:
        _cmd_lines = []
        for cmd in cg.commands:
            _cmd_lines.append(
                f'- `{cmd["name"]}`: {cmd["description"]}\n'
                f'  Example: `{cmd["example"]}`'
            )
        _cg_blocks.append(
            f'### {cg.name}\n\n'
            f'{cg.description}\n\n'
            f'**Commands:**\n'
            + '\n'.join(_cmd_lines)
        )
    _all_cg = '\n\n'.join(_cg_blocks)
    commands_ref = (
        f'# {skill_name} — Command Reference\n\n'
        f'## Command Groups\n\n'
        f'{_all_cg}\n\n'
        f'## Command Routing Logic\n\n'
        f'```javascript\n'
        f'// Parse command from input:\n'
        f'// /{skill_name} <command> [args]\n'
        f"const parts = input.trim().split(/\\\\s+/);\n"
        f"const command = parts[0] || 'default';\n"
        f"const params = {{ _raw: parts.slice(1).join(' ') }};\n"
        f'```\n'
    )

    # 生成 references/troubleshooting.md
    troubleshooting_ref = (
        f'# {skill_name} — Troubleshooting\n\n'
        f'## Common Issues\n\n'
        f'### Command not recognized\n'
        f"- Check that you're using the correct command name\n"
        f'- Run `/{skill_name} help` to see available commands\n\n'
        f'### No output returned\n'
        f'- Ensure the skill has necessary permissions\n'
        f'- Check the handler.js for errors in browser console\n\n'
        f'### State not persisting\n'
        f'- State is in-memory only and resets between invocations\n'
        f'- For persistent state, use memory files or a database\n\n'
        f'## Debug Mode\n\n'
        f'Add `--debug` flag to any command:\n'
        f'```\n'
        f'/{skill_name} <command> --debug\n'
        f'```\n\n'
        f'## Getting Help\n\n'
        f'Run without arguments or with `help`:\n'
        f'```\n'
        f'/{skill_name} help\n'
        f'```\n'
    )

    # 写入文件
    with open(os.path.join(skill_path, 'handler.js'), 'w', encoding='utf-8') as f:
        f.write(handler_js)

    with open(os.path.join(skill_path, 'SKILL.md'), 'w', encoding='utf-8') as f:
        f.write(skill_md)

    with open(os.path.join(skill_path, 'references', 'capabilities.md'), 'w', encoding='utf-8') as f:
        f.write(capabilities_ref)

    with open(os.path.join(skill_path, 'references', 'commands.md'), 'w', encoding='utf-8') as f:
        f.write(commands_ref)

    with open(os.path.join(skill_path, 'references', 'troubleshooting.md'), 'w', encoding='utf-8') as f:
        f.write(troubleshooting_ref)

    artifacts['handler_js'] = f'{skill_path}/handler.js'
    artifacts['skill_md'] = f'{skill_path}/SKILL.md'
    artifacts['references'] = f'{skill_path}/references/'

    duration_ms = int((time.time() - t0) * 1000)
    return PhaseResult(
        phase='phase3_implement',
        status='success',
        output=design,
        errors=errors,
        duration_ms=duration_ms,
        artifacts=artifacts,
    )



def run_phase_plan_tests(skill_name: str, design: SkillDesign, context: Dict) -> PhaseResult:
    """
    Phase 4: Plan Tests
    - 创建 TEST.md 测试计划
    - 规划单元测试和E2E测试
    """
    import time
    t0 = time.time()
    errors = []
    artifacts = {}

    skill_path = os.path.join(SKILLS_DIR, skill_name)
    test_md = f"""# {skill_name} — Test Plan

> Generated by 7-Phase Skill Pipeline | {datetime.now().isoformat()}

## Test Overview

- **Unit Tests**: pytest (Python) + Jest (JS handler)
- **E2E Tests**: Playwright (browser-based skills)
- **Coverage Target**: 80%+ statements

## Unit Tests

### Test File: `tests/unit/test_{skill_name}.py`

```python
import pytest
import sys
sys.path.insert(0, '{skill_path}')
# from handler import handler  # if handler has testable functions

class Test{skill_name.replace('-', '_').title().replace('_', '')}:
    '''Unit tests for {skill_name}'''

    def test_trigger_matching(self):
        '''Test that triggers correctly match input'''
        pass

    def test_command_routing(self):
        '''Test command routing to correct handlers'''
        pass
"""

    # 写入测试计划
    os.makedirs(os.path.join(skill_path, 'tests', 'unit'), exist_ok=True)
    os.makedirs(os.path.join(skill_path, 'tests', 'e2e'), exist_ok=True)

    with open(os.path.join(skill_path, 'TEST.md'), 'w', encoding='utf-8') as f:
        f.write(test_md)

    with open(os.path.join(skill_path, 'tests', 'unit', '__init__.py'), 'w', encoding='utf-8') as f:
        f.write('')

    artifacts['test_plan'] = f'{skill_path}/TEST.md'
    artifacts['test_dirs'] = f'{skill_path}/tests/{{unit,e2e}}/'

    duration_ms = int((time.time() - t0) * 1000)
    return PhaseResult(
        phase='phase4_plan_tests',
        status='success',
        output=None,
        errors=errors,
        duration_ms=duration_ms,
        artifacts=artifacts,
    )


def run_phase_write_tests(skill_name: str, design: SkillDesign, context: Dict) -> PhaseResult:
    """
    Phase 5: Write Tests
    - Generate pytest test files
    - Generate playwright E2E specs
    """
    import time
    t0 = time.time()
    errors = []
    artifacts = {}

    skill_path = os.path.join(SKILLS_DIR, skill_name)

    # Pre-build command test methods
    _cmd_lines = []
    for cg in design.command_groups:
        _cmd_lines.append('    def test_command_' + cg.name + '(self):')
        _cmd_lines.append('        DOCSTRINGTest ' + cg.name + ' command routingDOCSTRING')
        _cmd_lines.append('        pass')
    _cmd_test_str = '\n'.join(_cmd_lines)

    # Pre-build capability test methods
    _cap_lines = []
    for c in design.capabilities:
        _cap_lines.append('    def test_capability_' + c.name + '(self):')
        _cap_lines.append('        DOCSTRINGTest ' + c.name + ' capabilityDOCSTRING')
        _cap_lines.append("        assert '" + c.name + "' in [json_dumps for c in design.capabilities]")
    _cap_test_str = '\n'.join(_cap_lines)

    # Build pytest content
    # Use string concatenation to avoid all quote issues
    pytest_lines = [
        '"""',
        'tests/unit/test_TEMPLATE_SKILL.py',
        'Unit tests for TEMPLATE_SKILL',
        '"""',
        '',
        'import pytest',
        'import json',
        'import sys',
        'from pathlib import Path',
        '',
        '# Add skill path: TEMPLATE_SKILL',
        "skill_path = Path(__file__).parent.parent.parent / 'TEMPLATE_SKILL'",
        'sys.path.insert(0, str(skill_path))',
        '',
        '',
        'class TestTriggerMatching:',
        '    DOCSTRINGTest trigger pattern matchingDOCSTRING',
        '',
        '    def test_primary_trigger(self):',
        '        DOCSTRINGPrimary trigger should matchDOCSTRING',
        '        triggers = JSON_DUMPS_PLACEHOLDER',
        '        assert any("TEMPLATE_SKILLVAR" in t for t in triggers)',
        '',
        '    def test_empty_input_handled(self):',
        '        DOCSTRINGEmpty input should be handled gracefullyDOCSTRING',
        '        pass',
        '',
        '',
        'class TestCommandRouting:',
        '    DOCSTRINGTest command routingDOCSTRING',
        '',
        '_CMD_TEST_STR_PLACEHOLDER',
        '',
        '    def test_unknown_command(self):',
        '        DOCSTRINGUnknown command should return error or helpDOCSTRING',
        '        pass',
        '',
        '',
        'class TestCapabilities:',
        '    DOCSTRINGTest individual capabilitiesDOCSTRING',
        '',
        '_CAP_TEST_STR_PLACEHOLDER',
        '',
        '',
        'class TestOutputFormat:',
        '    DOCSTRINGTest output format complianceDOCSTRING',
        '',
        '    def test_json_output(self):',
        '        DOCSTRINGOutput should be valid JSONDOCSTRING',
        '        pass',
        '',
        '    def test_required_fields(self):',
        '        DOCSTRINGOutput should contain required fieldsDOCSTRING',
        '        pass',
        '',
        '',
        "if __name__ == '__main__':",
        '    pytest.main([__file__, "-v"])',
    ]
    
    # Substitute placeholders
    import json as _json
    _trigger_dumps = _json.dumps(design.trigger_patterns[:5])
    pytest_content = '\n'.join(pytest_lines)
    pytest_content = pytest_content.replace('TEMPLATE_SKILL', skill_name)
    pytest_content = pytest_content.replace('TEMPLATE_SKILLVAR', "{{'skill_name'}}")
    pytest_content = pytest_content.replace('JSON_DUMPS_PLACEHOLDER', _trigger_dumps)
    pytest_content = pytest_content.replace('_CMD_TEST_STR_PLACEHOLDER', _cmd_test_str)
    pytest_content = pytest_content.replace('_CAP_TEST_STR_PLACEHOLDER', _cap_test_str)
    pytest_content = pytest_content.replace('DOCSTRING', '"""')
    pytest_content = pytest_content.replace('json_dumps', '{json.dumps(c.name) for c in design.capabilities}')

    # Playwright E2E spec
    _pw = (
        "import { test, expect } from '@playwright/test';\n\n"
        "test.describe('" + skill_name + "', () => {\n"
        "    test.beforeEach(async ({ page }) => {\n"
        "        await page.goto('/');\n"
        "    });\n\n"
        "    test('skill responds to trigger', async ({ page }) => {\n"
        "        await page.fill('input[placeholder*=\"message\"], textarea', '/" + skill_name + "');\n"
        "        await page.press('input[placeholder*=\"message\"], textarea', 'Enter');\n"
        "        await expect(page.locator('.message, .response')).toBeVisible({ timeout: 10000 });\n"
        "    });\n"
        "});"
    )

    # conftest.py
    _cf = (
        '"""\n'
        'tests/conftest.py\n'
        'Shared pytest fixtures for ' + skill_name + ' tests\n'
        '"""\n\n'
        'import pytest\n'
        'import sys\n'
        'from pathlib import Path\n\n'
        '# Add skill to path: ' + skill_name + '\n'
        "skill_path = Path(__file__).parent.parent / '" + skill_name + "'\n"
        'sys.path.insert(0, str(skill_path))\n\n'
        '@pytest.fixture\n'
        'def skill_path():\n'
        "    return Path(__file__).parent.parent / '" + skill_name + "'\n\n"
        '@pytest.fixture\n'
        'def sample_input():\n'
        "    return {'context': {'content': '/" + skill_name + "'}, 'message': {'content': '/" + skill_name + "'}}\n"
    )

    os.makedirs(os.path.join(skill_path, 'tests', 'unit'), exist_ok=True)
    os.makedirs(os.path.join(skill_path, 'tests', 'e2e'), exist_ok=True)

    with open(os.path.join(skill_path, 'tests', 'unit', 'test_' + skill_name + '.py'), 'w', encoding='utf-8') as f:
        f.write(pytest_content)

    with open(os.path.join(skill_path, 'tests', 'e2e', skill_name + '.spec.ts'), 'w', encoding='utf-8') as f:
        f.write(_pw)

    with open(os.path.join(skill_path, 'tests', 'conftest.py'), 'w', encoding='utf-8') as f:
        f.write(_cf)

    pyproject_content = (
        '[tool.pytest.ini_options]\n'
        'testpaths = ["tests/unit"]\n'
        'python_files = ["test_*.py"]\n'
        'python_classes = ["Test*"]\n'
        'python_functions = ["test_*"]\n'
        'addopts = "-v --tb=short"\n\n'
        '[tool.coverage.run]\n'
        'source = ["' + skill_name + '"]\n'
        'branch = true\n\n'
        '[tool.coverage.report]\n'
        'exclude_lines = ["pragma: no cover", "def __repr__", "raise NotImplementedError"]'
    )

    with open(os.path.join(skill_path, 'pyproject.toml'), 'w', encoding='utf-8') as f:
        f.write(pyproject_content)

    artifacts['pytest_tests'] = skill_path + '/tests/unit/test_' + skill_name + '.py'
    artifacts['playwright_tests'] = skill_path + '/tests/e2e/' + skill_name + '.spec.ts'
    artifacts['conftest'] = skill_path + '/tests/conftest.py'
    artifacts['pyproject'] = skill_path + '/pyproject.toml'

    duration_ms = int((time.time() - t0) * 1000)
    return PhaseResult(
        phase='phase5_write_tests',
        status='success',
        output=None,
        errors=errors,
        duration_ms=duration_ms,
        artifacts=artifacts,
    )



def run_phase_document(skill_name: str, design: SkillDesign, context: Dict) -> PhaseResult:
    """
    Phase 6: Document
    - 更新 SKILL.md with actual test results
    - 更新 references/
    """
    import time
    t0 = time.time()
    errors = []

    # Update SKILL.md to mark it as documented
    skill_path = os.path.join(SKILLS_DIR, skill_name)
    skill_md_path = os.path.join(skill_path, 'SKILL.md')

    if os.path.exists(skill_md_path):
        with open(skill_md_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # Add testing section
        testing_section = f"""

---

## Testing

- **Test Plan**: `TEST.md`
- **Unit Tests**: `tests/unit/test_{skill_name}.py`
- **E2E Tests**: `tests/e2e/{skill_name}.spec.ts`
- **Run**: `pytest tests/unit/` or `npx playwright test`

## Changelog

| Date | Version | Change |
|------|---------|--------|
| {datetime.now().strftime('%Y-%m-%d')} | 0.1.0 | Initial implementation |

Generated by **7-Phase Skill Pipeline** (inspired by CLI-Anything)
"""

        if '## Testing' not in content:
            content += testing_section

        with open(skill_md_path, 'w', encoding='utf-8') as f:
            f.write(content)

    duration_ms = int((time.time() - t0) * 1000)
    return PhaseResult(
        phase='phase6_document',
        status='success',
        output=None,
        errors=errors,
        duration_ms=duration_ms,
        artifacts={},
    )


def run_phase_publish(skill_name: str, design: SkillDesign, context: Dict) -> PhaseResult:
    """
    Phase 7: Publish
    - 注册到 skill registry
    - 记录pipeline执行日志
    """
    import time
    t0 = time.time()
    errors = []

    # Register to skill registry
    registry = {}
    if os.path.exists(REGISTRY_FILE):
        try:
            with open(REGISTRY_FILE, 'r', encoding='utf-8') as f:
                registry = json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            registry = {}

    if 'skills' not in registry:
        registry['skills'] = {}

    registry['skills'][skill_name] = {
        'name': skill_name,
        'description': design.description,
        'triggerPatterns': design.trigger_patterns[:8],
        'capabilities': [c.name for c in design.capabilities],
        'commandGroups': len(design.command_groups),
        'outputFormat': design.output_format,
        'createdAt': datetime.now().isoformat(),
        'pipelineVersion': '1.0',
        'pipeline': '7phase',
    }

    os.makedirs(os.path.dirname(REGISTRY_FILE), exist_ok=True)
    with open(REGISTRY_FILE, 'w', encoding='utf-8') as f:
        json.dump(registry, f, indent=2, ensure_ascii=False)

    # Log pipeline execution
    pipeline_log_entry = {
        'skill_name': skill_name,
        'timestamp': datetime.now().isoformat(),
        'phases': context.get('phase_results', []),
        'design': asdict(design),
    }

    os.makedirs(os.path.dirname(PIPELINE_LOG), exist_ok=True)
    with open(PIPELINE_LOG, 'a', encoding='utf-8') as f:
        f.write(json.dumps(pipeline_log_entry, ensure_ascii=False) + '\n')

    duration_ms = int((time.time() - t0) * 1000)
    return PhaseResult(
        phase='phase7_publish',
        status='success',
        output={'registry_updated': True, 'log_written': True},
        errors=errors,
        duration_ms=duration_ms,
        artifacts={'registry': REGISTRY_FILE, 'log': PIPELINE_LOG},
    )


# ============================================================================
# Main 7-Phase Pipeline Runner
# ============================================================================

def run_7phase_creation(skill_name: str, description: str, context: Dict = None) -> Dict:
    """
    Execute the full 7-phase skill creation pipeline.

    Returns:
        Dict with:
          - skill_name, status, phases (list of PhaseResult),
          - total_duration_ms, artifacts
    """
    if context is None:
        context = {}

    # Validate name
    if skill_name.lower() in FORBIDDEN_NAMES:
        return {'status': 'failed', 'error': f'Forbidden skill name: {skill_name}'}
    if not re.match(r'^[a-zA-Z0-9_-]+$', skill_name):
        return {'status': 'failed', 'error': f'Invalid characters in skill name: {skill_name}'}

    # Check already exists
    skill_path = os.path.join(SKILLS_DIR, skill_name)
    if os.path.exists(skill_path):
        return {'status': 'skipped', 'error': f'Skill already exists: {skill_name}'}

    os.makedirs(SKILLS_DIR, exist_ok=True)

    phase_results = []
    design = None

    # Phase 1: Analyze
    r1 = run_phase_analyze(skill_name, description, context)
    phase_results.append(r1.to_dict())
    design = r1.output
    if r1.status == 'failed':
        return {'status': 'failed', 'phases': phase_results, 'error': 'Phase 1 failed'}

    # Phase 2: Design
    r2 = run_phase_design(skill_name, design, context)
    phase_results.append(r2.to_dict())
    design = r2.output
    if r2.status == 'failed':
        return {'status': 'failed', 'phases': phase_results, 'error': 'Phase 2 failed'}

    # Phase 3: Implement
    r3 = run_phase_implement(skill_name, design, context)
    phase_results.append(r3.to_dict())
    if r3.status == 'failed':
        return {'status': 'failed', 'phases': phase_results, 'error': 'Phase 3 failed'}

    # Phase 4: Plan Tests
    r4 = run_phase_plan_tests(skill_name, design, context)
    phase_results.append(r4.to_dict())
    # Phase 4 failures are non-critical, continue

    # Phase 5: Write Tests
    r5 = run_phase_write_tests(skill_name, design, context)
    phase_results.append(r5.to_dict())
    # Phase 5 failures are non-critical, continue

    # Phase 6: Document
    r6 = run_phase_document(skill_name, design, context)
    phase_results.append(r6.to_dict())

    # Phase 7: Publish
    context['phase_results'] = phase_results
    r7 = run_phase_publish(skill_name, design, context)
    phase_results.append(r7.to_dict())

    total_duration = sum(r.duration_ms for r in [r1, r2, r3, r4, r5, r6, r7])

    # Collect all artifacts
    all_artifacts = {}
    for r in [r1, r2, r3, r4, r5, r6, r7]:
        all_artifacts.update(r.artifacts)

    return {
        'status': 'success',
        'skill_name': skill_name,
        'phases': phase_results,
        'total_duration_ms': total_duration,
        'artifacts': all_artifacts,
        'design': asdict(design) if design else None,
    }


if __name__ == '__main__':
    import sys
    if len(sys.argv) < 3:
        print('Usage: python skill_pipeline_7phase.py <skill_name> <description>')
        sys.exit(1)

    skill_name = sys.argv[1]
    description = ' '.join(sys.argv[2:])

    result = run_7phase_creation(skill_name, description)
    print(json.dumps(result, ensure_ascii=False, indent=2))
