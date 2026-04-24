"""
coreference.py — Lightweight Coreference Resolution for Memory Ingestion

Resolves pronouns (he/she/it/这个/该公司 etc.) into concrete antecedents
BEFORE indexing — so the graph stores actual names, not pronouns.

Algorithm: sliding window + entity table lookup (no heavy NLP required).
"""

import re
from typing import Optional
from modules.memory.cone_graph import Entity


# Pronoun patterns by language
PRONOUNS = {
    "en": {
        "he": r"\bhe\b", "she": r"\bshe\b", "it": r"\bit\b",
        "his": r"\bhis\b", "her": r"\bher\b", "its": r"\bits\b",
        "him": r"\bhim\b", "them": r"\bthem\b", "they": r"\bthey\b",
        "this": r"\bthis\b", "that": r"\bthat\b",
    },
    "zh": {
        "he_she_it": r"\b([他她它])\b",
        "his_her_its": r"\b([他的她的它的])\b",
        "this_that": r"\b([这那][个件]?)\b",
        "demonstrative": r"\b(该公司|该产品|该服务|该项目|该决策)\b",
    }
}

# Entity type keywords for resolution hints
ENTITY_TYPE_KEYWORDS = {
    "person": ["person", "人", "先生", "女士", "经理", "工程师", "同事", "老板", "员工"],
    "org": ["company", "公司", "企业", "集团", "组织", "团队", "部门"],
    "tool": ["tool", "工具", "系统", "平台", "软件", "产品"],
    "project": ["project", "项目", "计划", "方案"],
}


def detect_entity_type(entity: Entity) -> str:
    """Guess entity type from name and metadata."""
    name = entity.name.lower()
    meta_str = str(entity.metadata).lower()
    combined = f"{name} {meta_str}"

    for e_type, keywords in ENTITY_TYPE_KEYWORDS.items():
        if any(kw in combined for kw in keywords):
            return e_type
    return entity.entity_type or "concept"


def resolve_coreference(
    text: str,
    entities: list[Entity],
    lang: str = "auto"
) -> str:
    """
    Replace pronouns with resolved entity names in text.

    Args:
        text: Raw input text (e.g. "She said she wasn't told about the change")
        entities: List of known Entity objects from this session
        lang: "en" / "zh" / "auto"

    Returns:
        Text with pronouns resolved to entity names.
        e.g. "Maria said Maria wasn't told about the deadline change"

    Algorithm:
      1. Build entity name lookup (case-insensitive)
      2. For each pronoun in text, find most recent potential antecedent
      3. Replace pronoun with entity name
    """
    if not text or not entities:
        return text

    # Auto-detect language
    if lang == "auto":
        has_chinese = bool(re.search(r"[\u4e00-\u9fff]", text))
        lang = "zh" if has_chinese else "en"

    # Build entity name → canonical name map (case-insensitive)
    entity_map: dict[str, Entity] = {}
    for ent in entities:
        entity_map[ent.name.lower()] = ent
        entity_map[ent.id.lower()] = ent

    result = text

    if lang == "zh":
        result = _resolve_chinese(result, entities, entity_map)
    else:
        result = _resolve_english(result, entities, entity_map)

    return result


def _resolve_english(text: str, entities: list[Entity], entity_map: dict) -> str:
    """Resolve English pronouns."""
    # Build name variants (first name, last name)
    name_variants: dict[str, Entity] = {}
    for ent in entities:
        name_variants[ent.name.lower()] = ent
        # Also index by id
        name_variants[ent.id.lower()] = ent

    def replace_pronoun(match):
        pronoun = match.group(0).lower()
        # Find most recent entity that matches the pronoun's gender/nature
        # For now: simple lookup - find entity by type hint stored in metadata
        for name_lower, ent in name_variants.items():
            # Check if entity type matches expected pronoun type
            if ent.entity_type == "person" and pronoun in ("he", "she", "him", "her", "his"):
                return ent.name
            if ent.entity_type in ("concept", "tool", "project") and pronoun in ("it", "its"):
                return ent.name
            if ent.entity_type in ("org", "team") and pronoun in ("they", "them", "their"):
                return ent.name
        return match.group(0)  # no change

    # Replace pronouns with context-aware resolution
    for pronoun in PRONOUNS["en"]:
        pattern = PRONOUNS["en"][pronoun]
        # Use a more sophisticated approach: find last mention before pronoun
        result_parts = []
        last_pos = 0

        for match in re.finditer(pattern, text, re.IGNORECASE):
            # Look at text before this match for entity mentions
            prefix = text[last_pos:match.start()]
            # Simple heuristic: find the most recent named entity in prefix
            resolved = _find_antecedent(prefix, entities, pronoun)
            result_parts.append(text[last_pos:match.start()])
            result_parts.append(resolved if resolved else match.group(0))
            last_pos = match.end()

        result_parts.append(text[last_pos:])
        text = "".join(result_parts)

    return text


def _resolve_chinese(text: str, entities: list[Entity], entity_map: dict) -> str:
    """Resolve Chinese pronouns and demonstratives."""
    # Sort entities by name length (prefer longer/more specific names)
    sorted_entities = sorted(entities, key=lambda e: len(e.name), reverse=True)

    def replace_demonstrative(match):
        demo = match.group(0)
        # e.g. "该公司" → find company entity
        demo_map = {
            "公司": "org", "产品": "tool", "服务": "tool",
            "项目": "project", "决策": "concept"
        }
        for suffix, e_type in demo_map.items():
            if suffix in demo:
                for ent in sorted_entities:
                    if ent.entity_type == e_type or e_type == "concept":
                        return ent.name
        return demo

    # Resolve demonstrative phrases first
    for pattern in PRONOUNS["zh"]["demonstrative"]:
        text = re.sub(pattern, _make_replacer(replace_demonstrative), text)

    # Resolve third-person pronouns (他/她/它)
    def replace_pronoun_zh(match):
        pronoun = match.group(0)
        # Find person/org/entity entities
        if pronoun in ("他", "她", "它"):
            entity_type = {"他": "person", "她": "person", "它": "concept"}.get(pronoun, "concept")
            for ent in sorted_entities:
                if ent.entity_type == entity_type or entity_type == "concept":
                    # Return the appropriate possessive form
                    if pronoun == "他":
                        return f"{ent.name}的" if match.group(0) == "他的" else ent.name
                    elif pronoun == "她":
                        return f"{ent.name}的" if match.group(0) == "她的" else ent.name
                    else:
                        return f"{ent.name}的" if match.group(0) == "它的" else ent.name
        return pronoun

    text = re.sub(r"\b[他她它]的?\b", replace_pronoun_zh, text)

    return text


def _find_antecedent(prefix: str, entities: list[Entity], pronoun: str) -> Optional[str]:
    """Find the most likely antecedent entity for a pronoun in the prefix text."""
    if not prefix or not entities:
        return None

    # Sort by mention order (last mention = most likely)
    # Simple: find last entity name that appears in prefix
    sorted_entities = sorted(entities, key=lambda e: len(e.name), reverse=True)

    for ent in sorted_entities:
        if ent.name.lower() in prefix.lower():
            # Check gender agreement
            if pronoun in ("he", "him", "his") and ent.entity_type == "person":
                return ent.name
            if pronoun in ("she", "her", "hers") and ent.entity_type == "person":
                return ent.name
            if pronoun in ("it", "its") and ent.entity_type in ("tool", "project", "concept"):
                return ent.name
            if pronoun in ("they", "them", "their") and ent.entity_type in ("org", "team"):
                return ent.name

    return None


def build_entity_table(session_texts: list[str]) -> list[Entity]:
    """
    Build an entity table from a list of texts (e.g. conversation turns).
    Uses simple NER-like pattern matching.

    Returns list of Entity objects detected.
    """
    entities: list[Entity] = []
    seen_names: set[str] = set()

    # Pattern: "Name (role)" or capitalized words that look like names
    name_pattern = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:先生|女士|经理|工程师|负责人|总监|顾问)\b")
    # Chinese name pattern
    zh_name_pattern = re.compile(r"\b([A-Z][a-z·]+(?: [A-Z][a-z·]+)*)\b")

    for text in session_texts:
        for match in name_pattern.finditer(text):
            name = match.group(1).strip()
            if name not in seen_names:
                seen_names.add(name)
                entities.append(Entity(name=name, entity_type="person"))

        for match in zh_name_pattern.finditer(text):
            name = match.group(1).strip()
            if len(name) >= 2 and name not in seen_names and not any(c.isdigit() for c in name):
                seen_names.add(name)
                entities.append(Entity(name=name, entity_type="person"))

    return entities


# ─── CLI ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Coreference Resolution CLI")
    parser.add_argument("--text", required=True, help="Input text")
    parser.add_argument("--names", nargs="*", default=[], help="Known entity names (space separated)")
    parser.add_argument("--types", nargs="*", default=[], help="Entity types for each name")
    args = parser.parse_args()

    entities = []
    types = args.types if len(args.types) == len(args.names) else ["person"] * len(args.names)
    for name, e_type in zip(args.names, types):
        entities.append(Entity(name=name, entity_type=e_type))

    resolved = resolve_coreference(args.text, entities)
    print(f"Input:  {args.text}")
    print(f"Output: {resolved}")
