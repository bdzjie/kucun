"""
Patch cone_vector.py with BM25 hybrid search capability.
Applies changes in-place.
"""
import re

p = r'C:\Users\Administrator\.openclaw\workspace\modules\memory\cone_vector.py'
with open(p, encoding='utf-8') as f:
    content = f.read()

# ── 1. Update module docstring ─────────────────────────────────────
old_doc = """cone_vector.py — Vector Index for Cone Graph

Provides fast approximate nearest-neighbor search over
Entity / FacetPoint / Episode text using TF-IDF + FAISS.

For save/load: stores training texts and vocabulary so the
TF-IDF vectorizer can be fully reconstructed from disk."""

new_doc = """cone_vector.py — Vector Index for Cone Graph

Provides fast approximate nearest-neighbor search over
Entity / FacetPoint / Episode text using TF-IDF + FAISS.
Optionally pairs with BM25 (rank_bm25) for keyword-aware recall.

For save/load: stores training texts and vocabulary so the
TF-IDF vectorizer can be fully reconstructed from disk."""

content = content.replace(old_doc, new_doc)

# ── 2. Add BM25 import block after FAISS import ────────────────────
faiss_block = """try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False

from sklearn"""

bm25_block = """try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False

try:
    from rank_bm25 import BM25Okapi
    BM25_AVAILABLE = True
except ImportError:
    BM25_AVAILABLE = False

from sklearn"""

content = content.replace(faiss_block, bm25_block)

# ── 3. Add _bm25_index field in __init__ ─────────────────────────────
old_init_end = """        self.episode_ids: list[str] = []
        self.episode_vectors: Optional[np.ndarray] = None
        self._episode_index = None

        self._train_texts: list[str] = []"""

new_init_end = """        self.episode_ids: list[str] = []
        self.episode_vectors: Optional[np.ndarray] = None
        self._episode_index = None

        self._train_texts: list[str] = []

        # ── BM25 (optional) ────────────────────────────────────────
        self._bm25_index: Optional["BM25Okapi"] = None
        # Flat corpus for BM25: [(node_type, node_id, text)]
        self._bm25_corpus: list[tuple[str, str, str]] = []"""

content = content.replace(old_init_end, new_init_end)

# ── 4. After vector index building in fit(), add BM25 corpus ─────────
# Find the block that builds vectors and adds BM25 after it
old_fit_vectors_end = """        if self.episode_vectors is not None and len(self.episode_ids) > 0:
            self._episode_index = make_index(self.episode_vectors)
        else:
            if self.episode_vectors is not None and len(self.episode_ids) > 0:
                self._episode_index = make_nn(self.episode_vectors)
        self.fitted = True"""

new_fit_vectors_end = """        if self.episode_vectors is not None and len(self.episode_ids) > 0:
            self._episode_index = make_index(self.episode_vectors)
        else:
            if self.episode_vectors is not None and len(self.episode_ids) > 0:
                self._episode_index = make_nn(self.episode_vectors)

        # ── Build BM25 index (optional, best for keyword + semantic hybrid) ──
        if BM25_AVAILABLE and self._bm25_corpus:
            try:
                texts_only = [t for _, _, t in self._bm25_corpus]
                self._bm25_index = BM25Okapi(texts_only)
            except Exception as e:
                import warnings
                warnings.warn(f"[cone_vector] BM25 index build failed: {e}")
                self._bm25_index = None

        self.fitted = True"""

content = content.replace(old_fit_vectors_end, new_fit_vectors_end)

# ── 5. In fit(), populate _bm25_corpus alongside vector texts ─────────
# Find where episode transform is done and add BM25 corpus entry
old_ep_transform = """        if episodes:
            n = len(episodes)
            vecs = self.vectorizer.transform(all_texts[cursor:cursor + n]).toarray().astype("float32")
            self.episode_vectors = vecs
            cursor += n"""

new_ep_transform = """        if episodes:
            n = len(episodes)
            vecs = self.vectorizer.transform(all_texts[cursor:cursor + n]).toarray().astype("float32")
            self.episode_vectors = vecs
            cursor += n
            # Record BM25 corpus entry for this episode
            for ep in episodes:
                self._bm25_corpus.append(("episode", ep["id"], ep.get("summary", "")))"""

content = content.replace(old_ep_transform, new_ep_transform)

# ── 6. Update search() to include BM25 ─────────────────────────────
# Find the search() method and add BM25 scoring before the sort
old_search_return = """        results.sort(key=lambda x: x[2], reverse=True)
        return results[:top_k]"""

new_search_return = """        # ── BM25 keyword boost (rank_bm25 scores keyword matches better than TF-IDF) ──
        if BM25_AVAILABLE and self._bm25_index and self._bm25_corpus:
            try:
                bm25_scores = self._bm25_index.get_scores(query.split())
                # Merge BM25 scores into existing results
                type_offsets = {"entity": 0, "facetpoint": len(self.entity_ids),
                                "episode": len(self.entity_ids) + len(self.facetpoint_ids)}
                for idx, (ntype, nid, existing_score) in enumerate(results):
                    offset = type_offsets.get(ntype, 0)
                    # Find position in BM25 corpus (assumes entity/facetpoint/ep ordering matches)
                    if ntype == "entity":
                        bm25_idx = self.entity_ids.index(nid) if nid in self.entity_ids else -1
                    elif ntype == "facetpoint":
                        bm25_idx = len(self.entity_ids) + (
                            self.facetpoint_ids.index(nid) if nid in self.facetpoint_ids else -1
                        )
                    else:
                        bm25_idx = len(self.entity_ids) + len(self.facetpoint_ids) + (
                            self.episode_ids.index(nid) if nid in self.episode_ids else -1
                        )
                    if 0 <= bm25_idx < len(bm25_scores):
                        # Hybrid: 0.7 * TF-IDF cosine + 0.3 * normalized BM25
                        bm25_norm = float(bm25_scores[bm25_idx]) / (max(bm25_scores) + 1e-9)
                        hybrid = 0.7 * existing_score + 0.3 * bm25_norm
                        results[idx] = (ntype, nid, hybrid)
            except Exception as e:
                import warnings
                warnings.warn(f"[cone_vector] BM25 merge failed: {e}")

        results.sort(key=lambda x: x[2], reverse=True)
        return results[:top_k]"""

content = content.replace(old_search_return, new_search_return)

# ── 7. In save(), add BM25 corpus ─────────────────────────────────────
old_npz_keys = """            train_texts=json.dumps(self._train_texts),"""

new_npz_keys = """            train_texts=json.dumps(self._train_texts),
            bm25_corpus=json.dumps(self._bm25_corpus),  # list of (type, id, text)"""

content = content.replace(old_npz_keys, new_npz_keys)

# ── 8. In load(), restore BM25 corpus ────────────────────────────────
old_load_decode = """        raw_texts = _decode_str(data.get("train_texts"), "[]")
        train_texts = json.loads(raw_texts)

        if train_texts and len(idf_arr) > 0:"""

new_load_decode = """        raw_texts = _decode_str(data.get("train_texts"), "[]")
        train_texts = json.loads(raw_texts)

        # Restore BM25 corpus (list of [type, id, text])
        raw_bm25_corpus = _decode_str(data.get("bm25_corpus"), "[]")
        bm25_corpus: list[tuple[str, str, str]] = []
        if raw_bm25_corpus:
            try:
                parsed = json.loads(raw_bm25_corpus)
                bm25_corpus = [(str(x[0]), str(x[1]), str(x[2])) for x in parsed]
            except Exception:
                pass  # corrupted — rebuild from vectorizer texts if available
        self._bm25_corpus = bm25_corpus

        if train_texts and len(idf_arr) > 0:"""

content = content.replace(old_load_decode, new_load_decode)

# ── 9. After load() vectorizer reconstruction, rebuild BM25 ───────────
old_load_end = """        self._build_indexes()
        self.fitted = True
        return True

# ── CLI ───────────────────────────────────────────────────────────────────"""

new_load_end = """        # Rebuild BM25 if corpus was restored
        if BM25_AVAILABLE and self._bm25_corpus:
            try:
                texts_only = [t for _, _, t in self._bm25_corpus]
                self._bm25_index = BM25Okapi(texts_only)
            except Exception as e:
                import warnings
                warnings.warn(f"[cone_vector] BM25 rebuild after load failed: {e}")
                self._bm25_index = None

        self._build_indexes()
        self.fitted = True
        return True

# ── CLI ───────────────────────────────────────────────────────────────────"""

content = content.replace(old_load_end, new_load_end)

# Write
with open(p, 'w', encoding='utf-8') as f:
    f.write(content)

print('BM25 patch applied')

# Syntax check
import py_compile
try:
    py_compile.compile(p, doraise=True)
    print('Syntax OK')
except py_compile.PyCompileError as e:
    print(f'Syntax error: {e}')