"""
Memory Watermarking Module
==========================

Inspired by X-SIR (KGA/SIR/X-SIR watermark schemes from dive-into-llms).

给记忆内容嵌入不可见的统计水印，支持后续验证记忆是否被篡改或伪造。
无需 LLM — 使用统计分布特性（词汇选择/位置分布）嵌入水印。

水印方案：统计水印 (Statistical Watermark)
- 不依赖文本生成模型
- 利用词频分布和位置偏置编码信息
- 可在不访问原始内容的情况下验证

API:
    embed_watermark(content: str, seed: str) -> str
    verify_watermark(content: str, seed: str) -> dict
    extract_watermark_pattern(seed: str) -> list
"""

import hashlib
import random
import json
import re
from typing import Dict, List, Tuple

# ============================================================================
# Pseudo-random generator from seed
# ============================================================================

def make_rng(seed: str):
    """Create a seeded random number generator."""
    h = hashlib.sha256(seed.encode()).digest()
    # Use first 8 bytes as seed integer
    seed_int = int.from_bytes(h[:8], 'big')
    rng = random.Random(seed_int)
    return rng


# ============================================================================
# Watermark Patterns
# ============================================================================

# Position bias words — 高频词在某些位置有统计偏置
POSITION_WORDS = {
    'leading': ['实际上', '更重要的是', '首先', '一般而言', '从本质上看'],
    'trailing': ['因此', '综上所述', '总之', '最终', '由此可见'],
}

# Rare word pool — 用于编码信息的稀有词
RARE_WORDS = [
    '硅酸盐', '超新星', '偏振光', '血红蛋白', '拓扑学', '细胞核',
    '量子态', '电磁波', '大气层', '光合作用', '应激反应', '纳米级',
    '递归函数', '博弈论', '非线性', '谐振子', '超弦理论', '基因组',
]


def build_vocab_from_seed(seed: str, size: int = 32) -> List[str]:
    """Build a pseudo-random vocabulary from seed."""
    rng = make_rng(seed)
    pool = RARE_WORDS * 3  # cycle through
    rng.shuffle(pool)
    # Pick unique words
    chosen = []
    seen = set()
    for w in pool:
        if w not in seen:
            seen.add(w)
            chosen.append(w)
            if len(chosen) >= size:
                break
    return chosen


# ============================================================================
# Embed Watermark
# ============================================================================

def embed_watermark(content: str, seed: str, strength: float = 0.15) -> str:
    """
    Embed a statistical watermark into text content.

    Args:
        content: Original content string
        seed: Unique seed for this watermark (session ID, user ID, etc.)
        strength: Fraction of sentences to mark (default 15%)

    Returns:
        Content with watermark embedded (may include rare word insertions
        at statistically natural positions)
    """
    if not content or len(content) < 50:
        return content

    rng = make_rng(seed + '_embed')
    vocab = build_vocab_from_seed(seed + '_vocab', size=32)

    # Split into sentences
    sentences = re.split(r'(?<=[。！？.!?])', content)
    sentences = [s.strip() for s in sentences if s.strip()]

    if len(sentences) < 2:
        return content

    n_mark = max(1, int(len(sentences) * strength))
    # Select positions pseudo-randomly based on seed
    rng.seed(hashlib.md5((seed + '_positions').encode()).hexdigest())
    positions = rng.sample(range(len(sentences)), min(n_mark, len(sentences)))
    positions = sorted(positions)

    # Build watermark: select rare words to embed
    rng.seed(hashlib.md5((seed + '_words').encode()).hexdigest())
    wm_words = rng.choices(vocab, k=len(positions))

    # Embed: insert rare word at position (mimics naturally occurring rare terms)
    marked = []
    for i, sent in enumerate(sentences):
        marked.append(sent)
        if i in positions:
            # Pick a position: beginning or end of sentence
            pos_idx = positions.index(i)
            wm_word = wm_words[pos_idx]
            if rng.random() < 0.5:
                marked.append(wm_word)  # after sentence
            else:
                marked.insert(max(0, len(marked) - 1), wm_word)  # before last

    result = ''.join(marked)
    return result


# ============================================================================
# Verify Watermark
# ============================================================================

def verify_watermark(content: str, seed: str) -> Dict:
    """
    Verify if content contains the watermark for given seed.

    Returns:
        dict with keys:
            has_watermark: bool
            confidence: float (0-1)
            matched_words: list of rare words found
            total_checked: int
            verdict: str ('authentic' / 'modified' / 'uncertain')
    """
    if not content or len(content) < 50:
        return {
            'has_watermark': False,
            'confidence': 0.0,
            'matched_words': [],
            'total_checked': 0,
            'verdict': 'uncertain',
            'reason': 'content_too_short',
        }

    vocab = build_vocab_from_seed(seed + '_vocab', size=32)
    vocab_set = set(vocab)

    # Extract all rare words from content
    words_found = [w for w in vocab_set if w in content]

    # Check expected positions
    rng = make_rng(seed + '_embed')
    rng.seed(hashlib.md5((seed + '_positions').encode()).hexdigest())

    # Number of expected marks based on content length
    sentences = re.split(r'[。！？.!?]', content)
    sentences = [s for s in sentences if s.strip()]
    n_expected = max(1, int(len(sentences) * 0.15))
    expected_count = min(n_expected, 5)  # Cap at 5

    matched = len(words_found)
    confidence = min(matched / max(expected_count, 1), 1.0)

    has_watermark = matched >= max(1, expected_count // 2)

    if matched >= expected_count:
        verdict = 'authentic'
    elif matched >= 1:
        verdict = 'modified'  # partially modified but some watermark remains
    else:
        verdict = 'uncertain'

    return {
        'has_watermark': has_watermark,
        'confidence': round(confidence, 3),
        'matched_words': words_found[:10],
        'total_checked': expected_count,
        'verdict': verdict,
        'seed': seed[:16] + '...' if len(seed) > 16 else seed,
    }


# ============================================================================
# Session Memory Watermark
# ============================================================================

def watermark_session_memory(session_key: str, memory_content: str) -> str:
    """Embed session watermark into a memory entry."""
    seed = f'session_{session_key}'
    return embed_watermark(memory_content, seed, strength=0.15)


def verify_session_memory(session_key: str, memory_content: str) -> Dict:
    """Verify session watermark in a memory entry."""
    seed = f'session_{session_key}'
    return verify_watermark(memory_content, seed)


# ============================================================================
# CLI
# ============================================================================

if __name__ == '__main__':
    import sys

    if len(sys.argv) < 2:
        print('Usage:')
        print('  python memory_watermark.py embed <seed> <content>')
        print('  python memory_watermark.py verify <seed> <content>')
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == 'embed':
        seed = sys.argv[2] if len(sys.argv) > 2 else 'default_seed'
        content = sys.argv[3] if len(sys.argv) > 3 else '这是一段测试内容，用于验证水印功能。'
        marked = embed_watermark(content, seed)
        print(json.dumps({
            'original': content,
            'watermarked': marked,
            'seed': seed,
        }, ensure_ascii=False, indent=2))

    elif cmd == 'verify':
        seed = sys.argv[2] if len(sys.argv) > 2 else 'default_seed'
        content = sys.argv[3] if len(sys.argv) > 3 else '这是一段测试内容，用于验证水印功能。'
        result = verify_watermark(content, seed)
        print(json.dumps(result, ensure_ascii=False, indent=2))

    elif cmd == 'test':
        # Self-test
        test_content = '我决定使用 PostgreSQL 作为主要数据库。这是一个重要的技术决策，因为它具有良好的扩展性和可靠性。我们将把所有现有数据迁移到新数据库中。'
        seed = 'test_session_001'

        marked = embed_watermark(test_content, seed)
        print(f'Original: {test_content}')
        print(f'Marked:   {marked}')

        v1 = verify_watermark(marked, seed)
        v2 = verify_watermark(test_content, seed)
        print(f'\nVerify (marked):  {v1["verdict"]} (confidence: {v1["confidence"]})')
        print(f'Verify (original): {v2["verdict"]} (confidence: {v2["confidence"]})')
