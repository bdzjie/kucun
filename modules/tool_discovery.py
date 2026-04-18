#!/usr/bin/env python3
"""
tool_discovery.py — AST-based Tool Self-Discovery for OpenClaw

Inspired by Hermes Agent's AST-based tool discovery.
Uses Python's built-in AST module to scan tool files and find registerTool() calls.

Usage:
    python tool_discovery.py scan [--dir modules] [--output discovered_tools.json]
    python tool_discovery.py manifest [--tools tools/]

Discovery Pattern:
    Tool files call registerTool({...}) or registry.register({...}) at module import time.

Output:
    discovered_tools.json — manifest of all discovered tools
"""

import ast
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
from dataclasses import dataclass, asdict


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def cli():
    import argparse

    parser = argparse.ArgumentParser(description="Tool Self-Discovery")
    sub = parser.add_subparsers(dest="cmd")

    scan = sub.add_parser("scan", help="Scan directory for tool files")
    scan.add_argument("--dir", default=".", help="Directory to scan")
    scan.add_argument("--output", default="discovered_tools.json", help="Output file")
    scan.add_argument("--recursive", action="store_true", help="Recursive scan")
    scan.add_argument("--verbose", action="store_true", help="Verbose output")

    manifest = sub.add_parser("manifest", help="Show tool manifest from file")
    manifest.add_argument("--tools", default="discovered_tools.json", help="Tools manifest file")

    check = sub.add_parser("check", help="Check tool file syntax")
    check.add_argument("file", help="File to check")

    args = parser.parse_args()

    if args.cmd == "scan":
        discovered = scan_directory(args.dir, recursive=args.recursive, verbose=args.verbose)
        output_manifest(discovered, args.output)
        print(f"Discovered {len(discovered['tools'])} tools → {args.output}")

    elif args.cmd == "manifest":
        show_manifest(args.tools)

    elif args.cmd == "check":
        check_file(args.file)

    else:
        parser.print_help()


# ─────────────────────────────────────────────────────────────────────────────
# Tool Discovery
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class DiscoveredTool:
    name: str
    description: str
    category: str
    risk_level: str
    toolset: str
    parameters_schema: Dict[str, Any]
    source_file: str
    source_line: int
    tool_id: str = ""

    def __post_init__(self):
        if not self.tool_id:
            import hashlib
            self.tool_id = hashlib.sha256(
                f"{self.source_file}:{self.name}".encode()
            ).hexdigest()[:16]


class ToolVisitor(ast.NodeVisitor):
    """
    AST visitor for Python tool files.
    Finds register_tool() or registry.register() calls in Python.
    """

    def __init__(self, filename: str):
        self.filename = filename
        self.tools: List[DiscoveredTool] = []

    def visit_Call(self, node: ast.Call):
        if self._is_register_call(node):
            tool = self._extract_tool(node)
            if tool:
                tool.source_file = self.filename
                tool.source_line = getattr(node, 'lineno', 0) or 0
                self.tools.append(tool)
        self.generic_visit(node)

    def _is_register_call(self, node: ast.Call) -> bool:
        if isinstance(node.func, ast.Attribute):
            if node.func.attr == "register":
                if isinstance(node.func.value, ast.Name):
                    if node.func.value.id in ("registry", "tools", "self"):
                        return True
        if isinstance(node.func, ast.Name):
            if node.func.id in ("register_tool", "registerTool", "register"):
                return True
        return False

    def _extract_tool(self, node: ast.Call) -> Optional[DiscoveredTool]:
        if not node.args:
            return None
        arg = node.args[0]
        if isinstance(arg, ast.Dict):
            return self._extract_from_dict(arg)
        return None

    def _extract_from_dict(self, obj: ast.Dict) -> Optional[DiscoveredTool]:
        fields = {}
        for key, value in zip(obj.keys, obj.values):
            if key is None:
                continue
            k = key.value if isinstance(key, ast.Constant) else str(key)
            v = self._extract_value(value)
            if v is not None:
                fields[k] = v
        return DiscoveredTool(
            name=fields.get("name", "Unknown"),
            description=fields.get("description", ""),
            category=fields.get("category", "other"),
            risk_level=fields.get("riskLevel", "medium"),
            toolset=fields.get("toolset", ""),
            parameters_schema=fields.get("parameters", {}),
            source_file=self.filename,
            source_line=0,
        )

    def _extract_value(self, node: ast.AST) -> Any:
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Dict):
            return {
                k.value if isinstance(k, ast.Constant) else str(k): self._extract_value(v)
                for k, v in zip(node.keys, node.values)
                if k is not None
            }
        if isinstance(node, ast.List):
            return [self._extract_value(elt) for elt in node.elts]
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            if isinstance(node.operand, ast.Constant):
                return -node.operand.value
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Mult)):
            left = self._extract_value(node.left)
            right = self._extract_value(node.right)
            if left is not None and right is not None:
                if isinstance(node.op, ast.Add):
                    return left + right
                if isinstance(node.op, ast.Mult):
                    return left * right
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Regex extraction for TypeScript/JavaScript
# ─────────────────────────────────────────────────────────────────────────────

def extract_block_by_brace(content: str, start: int) -> tuple:
    """Extract a JSON-like block using brace counting.
    Skips string content to avoid counting braces inside strings.
    Returns (block_text, end_position).
    """
    depth = 0
    in_string = False
    string_char = None
    i = start

    while i < len(content):
        c = content[i]

        if in_string:
            if c == '\\' and i + 1 < len(content):
                i += 2
                continue
            if c == string_char:
                in_string = False
        else:
            if c in ('"', "'", '`'):
                in_string = True
                string_char = c
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    return content[start:i+1], i + 1

        i += 1

    return content[start:i], i


def extract_nested_field(block: str, field: str) -> tuple:
    """Extract a field value that may contain nested braces/brackets."""
    field_pattern = rf'{re.escape(field)}\s*:\s*'
    m = re.search(field_pattern, block)
    if not m:
        return None, 0

    value_start = m.end()
    if value_start >= len(block):
        return None, m.start()

    first_char = block[value_start]

    if first_char in ('"', "'"):
        quote = first_char
        j = value_start + 1
        while j < len(block):
            if block[j] == '\\' and j + 1 < len(block):
                j += 2
                continue
            if block[j] == quote:
                return block[value_start+1:j], m.start()
            j += 1
        return None, m.start()

    if first_char == '{':
        value, _ = extract_block_by_brace(block, value_start)
        return value, m.start()

    if first_char == '[':
        depth = 0
        j = value_start
        while j < len(block):
            if block[j] in ('"', "'", '`'):
                quote = block[j]
                j += 1
                while j < len(block):
                    if block[j] == '\\' and j + 1 < len(block):
                        j += 2
                        continue
                    if block[j] == quote:
                        break
                    j += 1
            elif block[j] == '[':
                depth += 1
            elif block[j] == ']':
                if depth == 0:
                    return block[value_start:j+1], m.start()
                depth -= 1
            j += 1
        return None, m.start()

    if first_char.isalnum() or first_char in ('-', 'T', 'f', 'n'):
        m2 = re.match(r'([a-zA-Z0-9_\-\.]+)', block[value_start:])
        if m2:
            return m2.group(1), m.start()

    return None, m.start()


def remove_comments(content: str) -> str:
    """Remove single-line and multi-line comments from TypeScript/JavaScript content."""
    # Remove multi-line comments /* ... */
    content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
    # Remove single-line comments // ...
    lines = []
    for line in content.split('\n'):
        # Find // that's not inside a string
        in_string = False
        string_char = None
        for i, c in enumerate(line):
            if in_string:
                if c == '\\' and i + 1 < len(line):
                    continue
                if c == string_char:
                    in_string = False
            elif c in ('"', "'", '`'):
                in_string = True
                string_char = c
            elif c == '/' and i + 1 < len(line) and line[i+1] == '/':
                line = line[:i]
                break
        lines.append(line)
    return '\n'.join(lines)


def extract_with_regex(content: str, filename: str) -> List[DiscoveredTool]:
    """
    Regex-based extraction for registerTool({...}) and registry.register({...}) calls.
    Uses brace-counting to handle deeply nested TypeScript object literals.
    """
    tools = []
    # Strip comments to avoid false positives from doc examples
    content = remove_comments(content)

    # Find all registerTool({ or registry.register({ calls
    for match in re.finditer(r'(?:registry\.register|registerTool)\s*\(\s*\{', content):
        start = match.end() - 1  # Position of opening {
        block, end_pos = extract_block_by_brace(content, start)
        tool = _parse_ts_block(block, filename, start)
        if tool:
            tools.append(tool)

    return tools


def _parse_ts_block(block: str, filename: str, offset: int) -> Optional[DiscoveredTool]:
    """Parse a TypeScript registerTool({...}) block."""
    name, _ = extract_nested_field(block, "name")
    desc, _ = extract_nested_field(block, "description")
    cat, _ = extract_nested_field(block, "category")
    risk, _ = extract_nested_field(block, "riskLevel")
    ts, _ = extract_nested_field(block, "toolset")
    params, _ = extract_nested_field(block, "parameters")

    if not name:
        return None

    parameters_schema = {}
    if params:
        try:
            clean = params.strip()
            if clean.startswith('{'):
                parameters_schema = json.loads(clean)
            else:
                parameters_schema = {"raw": clean[:200]}
        except json.JSONDecodeError:
            parameters_schema = {"raw": params[:200]}

    return DiscoveredTool(
        name=name,
        description=desc or "",
        category=cat or "other",
        risk_level=risk or "medium",
        toolset=ts or "",
        parameters_schema=parameters_schema,
        source_file=filename,
        source_line=0,
    )


# ─────────────────────────────────────────────────────────────────────────────
# File Scanning
# ─────────────────────────────────────────────────────────────────────────────

SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", "env",
    "dist", "build", ".next", "coverage", ".mempalace", ".openclaw",
    ".ruff_cache", ".mypy_cache", ".pytest_cache", ".cache", ".tox", ".nox",
}

SKIP_FILES = {
    "__init__.py", "__main__.py", "setup.py", "conftest.py",
}

INCLUDE_EXTENSIONS = {".js", ".ts", ".jsx", ".tsx", ".mjs", ".mts", ".py"}


def is_tool_file(filepath: str) -> bool:
    """Check if file likely contains tool definitions."""
    ext = Path(filepath).suffix.lower()
    if ext not in INCLUDE_EXTENSIONS:
        return False

    name = Path(filepath).name.lower()
    if name in SKIP_FILES:
        return False

    try:
        content = Path(filepath).read_text(encoding="utf-8", errors="replace")
        if any(kw in content for kw in (
            "registerTool", "registry.register", "createDefaultTools",
            "ToolRegistry", "register_tool", "def tool_"
        )):
            return True
    except OSError:
        pass

    return False


def scan_file(filepath: str) -> List[DiscoveredTool]:
    """Scan a single file for tool definitions."""
    tools = []

    try:
        content = Path(filepath).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []

    if filepath.endswith(".py"):
        try:
            tree = ast.parse(content, filename=filepath)
            visitor = ToolVisitor(filepath)
            visitor.visit(tree)
            tools.extend(visitor.tools)
        except SyntaxError:
            tools.extend(extract_with_regex(content, filepath))
    else:
        # JavaScript/TypeScript — use regex
        tools.extend(extract_with_regex(content, filepath))

    return tools


def scan_directory(
    directory: str,
    recursive: bool = True,
    verbose: bool = False
) -> Dict[str, Any]:
    """Scan a directory for tool definitions."""
    tools: List[DiscoveredTool] = []
    scanned_files: List[str] = []
    errors: List[Dict[str, str]] = []

    dir_path = Path(directory).expanduser().resolve()

    for root, dirs, files in os.walk(dir_path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]

        for filename in files:
            filepath = os.path.join(root, filename)

            if not is_tool_file(filepath):
                continue

            if verbose:
                print(f"  Scanning: {filepath}")

            scanned_files.append(filepath)

            try:
                file_tools = scan_file(filepath)
                tools.extend(file_tools)
            except Exception as e:
                errors.append({"file": filepath, "error": str(e)})

    # Deduplicate by tool_id
    seen = set()
    unique_tools = []
    for tool in tools:
        if tool.tool_id not in seen:
            seen.add(tool.tool_id)
            unique_tools.append(asdict(tool))

    # Group statistics
    by_category: Dict[str, int] = {}
    by_toolset: Dict[str, int] = {}

    for tool in unique_tools:
        cat = tool["category"]
        by_category[cat] = by_category.get(cat, 0) + 1
        ts = tool.get("toolset") or "none"
        by_toolset[ts] = by_toolset.get(ts, 0) + 1

    return {
        "scanned_at": datetime.now().isoformat(),
        "directory": str(dir_path),
        "scanned_files": len(scanned_files),
        "tools": unique_tools,
        "total_tools": len(unique_tools),
        "by_category": by_category,
        "by_toolset": by_toolset,
        "statistics": {
            "files_scanned": len(scanned_files),
            "tools_found": len(unique_tools),
            "errors": len(errors),
        },
        "errors": errors[:20],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Output
# ─────────────────────────────────────────────────────────────────────────────

def output_manifest(data: Dict[str, Any], output_path: str):
    """Write discovery results to JSON file."""
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )


def show_manifest(tools_path: str):
    """Display a tool manifest."""
    path = Path(tools_path)
    if not path.exists():
        print(f"Manifest not found: {tools_path}")
        return

    data = json.loads(path.read_text(encoding="utf-8"))

    print(f"\n{'='*60}")
    print(f"  Tool Manifest — {data['scanned_at']}")
    print(f"  Directory: {data['directory']}")
    print(f"  Files scanned: {data['statistics']['files_scanned']}")
    print(f"  Tools found: {data['total_tools']}")
    print(f"{'='*60}\n")

    print("By Category:")
    for cat, count in sorted(data["by_category"].items()):
        print(f"  {cat:15} {count}")

    print("\nBy Toolset:")
    for ts, count in sorted(data["by_toolset"].items()):
        print(f"  {ts:15} {count}")

    print("\nTools:")
    for tool in data["tools"]:
        print(f"  [{tool['category']:12}] {tool['name']}")
        if tool.get("description"):
            print(f"      {tool['description'][:60]}...")


def check_file(filepath: str):
    """Check a single file for tool definitions."""
    if not Path(filepath).exists():
        print(f"File not found: {filepath}")
        return

    tools = scan_file(filepath)
    print(f"Found {len(tools)} tools in {filepath}:")
    for tool in tools:
        print(f"  - {tool.name} ({tool.category})")
        print(f"    {tool.description[:60]}")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    cli()
