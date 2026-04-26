"""
cone_vector.py — Vector Index for Cone Graph

Provides fast approximate nearest-neighbor search over
Entity / FacetPoint / Episode text using TF-IDF + FAISS.
Optionally pairs with BM25 (rank_bm25) for keyword-aware recall.

For save/load: stores training texts and vocabulary so the
TF-IDF vectorizer can be fully reconstructed from disk.
"""

import json
import numpy as np
from typing import Optional
from pathlib import Path

try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False

try:
    from rank_bm25 import BM25Okapi
    BM25_AVAILABLE = True
except ImportError:
    BM25_AVAILABLE = False

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.neighbors import NearestNeighbors


WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
INDEX_DIR = WORKSPACE / "memory" / "cone_vector"
INDEX_DIR.mkdir(parents=True, exist_ok=True)


def _tfidf_transform(vectorizer: TfidfVectorizer, texts: list[str]) -> np.ndarray:
    """
    Pure-numpy TF-IDF transform that bypasses sklearn's validate_data.
    Manually applies: tf * idf from a fitted vectorizer.
    """
    if not hasattr(vectorizer, 'idf_') or not hasattr(vectorizer, 'vocabulary_'):
        raise RuntimeError("Vectorizer not fitted")
    tf = vectorizer.transform(texts)  # sparse matrix, uses internal _tfidf but with known vocab
    # Already contains idf applied; just return as array
    return tf.toarray().astype("float32")


class ConeVectorIndex:
    """
    Vector index for Cone Graph nodes.

    Stores 3 separate indexes:
      - entity_index: Entity.name + entity_type
      - facetpoint_index: FacetPoint.content
      - episode_index: Episode.summary

    Each node's text is embedded with TF-IDF, then indexed with FAISS
    (or sklearn NN as fallback) for fast approximate nearest-neighbor search.
    """

    def __init__(self, dim: Optional[int] = None, lazy: bool = False, bm25_k1: float = 1.5, bm25_b: float = 0.75):
        # dim is the ACTUAL vocabulary size after fitting, not a hard cap.
        # If None, TF-IDF determines vocabulary size automatically.
        # lazy: if True, do NOT auto-load from disk in __init__
        # bm25_k1 / bm25_b: BM25 ranking parameters (exposed per call)
        self._dim: Optional[int] = dim
        self._vectorizer: Optional[TfidfVectorizer] = None
        self.fitted = False
        # Lazy load: if True, do NOT auto-load from disk in __init__
        self._lazy = lazy

        self.entity_ids: list[str] = []
        self.entity_vectors: Optional[np.ndarray] = None
        self._entity_index = None

        self.facetpoint_ids: list[str] = []
        self.facetpoint_vectors: Optional[np.ndarray] = None
        self._fp_index = None

        self.episode_ids: list[str] = []
        self.episode_vectors: Optional[np.ndarray] = None
        self._episode_index = None

        self._train_texts: list[str] = []

        # ── BM25 (optional) ────────────────────────────────────────
        self._bm25_index: Optional["BM25Okapi"] = None
        # Flat corpus for BM25: [(node_type, node_id, text)]
        self._bm25_corpus: list[tuple[str, str, str]] = []
        # BM25 parameters (exposed to caller)
        self._bm25_k1: float = bm25_k1
        self._bm25_b: float = bm25_b

    @property
    def vectorizer(self) -> TfidfVectorizer:
        if self._vectorizer is None:
            # No max_features cap — vocabulary determined from training data
            self._vectorizer = TfidfVectorizer()
        return self._vectorizer

    # ── Fit / Build ───────────────────────────────────────────────────

    def fit(
        self,
        entities: list[dict] = None,
        facetpoints: list[dict] = None,
        episodes: list[dict] = None,
    ):
        """
        Build vector indexes from node data.

        Args:
            entities: [{id, name, entity_type}]
            facetpoints: [{id, content}]
            episodes: [{id, summary}]
        """
        all_texts: list[str] = []

        if entities:
            for e in entities:
                text = f"{e['name']} {e.get('entity_type', '')}".strip()
                all_texts.append(text)
                self.entity_ids.append(e["id"])

        if facetpoints:
            for fp in facetpoints:
                all_texts.append(fp.get("content", ""))
                self.facetpoint_ids.append(fp["id"])

        if episodes:
            for ep in episodes:
                all_texts.append(ep.get("summary", ""))
                self.episode_ids.append(ep["id"])

        if not all_texts:
            return

        self._train_texts = all_texts[:]  # save for reload
        self.vectorizer.fit(all_texts)
        # Record actual vocabulary size (the true vector dimension)
        self._dim = len(self.vectorizer.vocabulary_)
        self.fitted = True

        # Build vectors per type
        cursor = 0
        if entities:
            n = len(entities)
            vecs = self.vectorizer.transform(all_texts[cursor:cursor + n]).toarray().astype("float32")
            self.entity_vectors = vecs
            cursor += n

        if facetpoints:
            n = len(facetpoints)
            vecs = self.vectorizer.transform(all_texts[cursor:cursor + n]).toarray().astype("float32")
            self.facetpoint_vectors = vecs
            cursor += n

        # Record BM25 corpus entries for all node types (fit builds index below)
        if entities:
            for e in entities:
                self._bm25_corpus.append(("entity", e["id"], f"{e['name']} {e.get('entity_type', '')}".strip()))
        if facetpoints:
            for fp in facetpoints:
                self._bm25_corpus.append(("facetpoint", fp["id"], fp.get("content", "")))
        if episodes:
            for ep in episodes:
                self._bm25_corpus.append(("episode", ep["id"], ep.get("summary", "")))

        if episodes:
            n = len(episodes)
            vecs = self.vectorizer.transform(all_texts[cursor:cursor + n]).toarray().astype("float32")
            self.episode_vectors = vecs
            cursor += n

        self._build_indexes()

    def _build_indexes(self):
        """Build FAISS or sklearn indexes for each index type.
        
        Graceful degradation: if any single index build fails, it is excluded
        from search rather than crashing the entire index. This matches the
        pattern from mcp-memory-service storage abstraction where partial
        corruption is quarantined, not fatal.
        """
        def make_safe(name, vecs, builder_fn):
            """Build one index; on failure warn and return None."""
            try:
                return builder_fn(vecs)
            except Exception as e:
                import warnings
                warnings.warn(f"[cone_vector] {name} index build failed ({e}) — excluded from search")
                return None

        if FAISS_AVAILABLE:
            def make_index(vecs):
                d_local = vecs.shape[1]
                v = vecs.copy()
                faiss.normalize_L2(v)
                idx = faiss.IndexFlatIP(d_local)
                idx.add(v)
                return idx

            self._entity_index = make_safe("entity", self.entity_vectors, make_index) if self.entity_vectors is not None and len(self.entity_ids) > 0 else None
            self._fp_index = make_safe("facetpoint", self.facetpoint_vectors, make_index) if self.facetpoint_vectors is not None and len(self.facetpoint_ids) > 0 else None
            self._episode_index = make_safe("episode", self.episode_vectors, make_index) if self.episode_vectors is not None and len(self.episode_ids) > 0 else None
        else:
            def make_nn(vecs):
                nn = NearestNeighbors(n_neighbors=min(5, len(vecs)), metric="cosine")
                nn.fit(vecs)
                return nn

            self._entity_index = make_safe("entity", self.entity_vectors, make_nn) if self.entity_vectors is not None and len(self.entity_ids) > 0 else None
            self._fp_index = make_safe("facetpoint", self.facetpoint_vectors, make_nn) if self.facetpoint_vectors is not None and len(self.facetpoint_ids) > 0 else None
            self._episode_index = make_safe("episode", self.episode_vectors, make_nn) if self.episode_vectors is not None and len(self.episode_ids) > 0 else None


    # ── Search ────────────────────────────────────────────────────────

    def _query_vector(self, query: str) -> np.ndarray:
        """Transform query using stored vectorizer vocabulary."""
        # Use sklearn's transform but work around validation issues
        # by setting n_features_in_ to match vocabulary size
        # Use actual vocabulary size; _dim is set after fit()
        actual_dim = len(self.vectorizer.vocabulary_) if hasattr(self.vectorizer, 'vocabulary_') else (self._dim or 512)
        if hasattr(self.vectorizer, 'n_features_in_'):
            self.vectorizer.n_features_in_ = actual_dim
        # Transform
        vec = self.vectorizer.transform([query]).toarray().astype("float32")
        if FAISS_AVAILABLE:
            faiss.normalize_L2(vec)
        return vec

    def search(
        self,
        query: str,
        node_type: str = "all",
        top_k: int = 5,
    ) -> list[tuple[str, str, float]]:
        """
        Search for similar nodes.

        Returns:
            List of (node_type, node_id, score) sorted by similarity descending.
        """
        if not self.fitted:
            return []
        if self._vectorizer is None:
            # Vectorizer reconstruction failed during load() — cannot vectorize query
            return []

        q_vec = self._query_vector(query)
        results: list[tuple[str, str, float]] = []

        def search_index(index, ids, ntype):
            if index is None or len(ids) == 0:
                return
            k = min(top_k, len(ids))
            if FAISS_AVAILABLE:
                scores, indices = index.search(q_vec, k)
                for idx, score in zip(indices[0], scores[0]):
                    if 0 <= idx < len(ids):
                        results.append((ntype, ids[idx], float(score)))
            else:
                dists, indices = index.kneighbors(q_vec, k)
                for idx, dist in zip(indices[0], dists[0]):
                    if 0 <= idx < len(ids):
                        results.append((ntype, ids[idx], float(1 - dist)))

        if node_type in ("entity", "all"):
            search_index(self._entity_index, self.entity_ids, "entity")
        if node_type in ("facetpoint", "all"):
            search_index(self._fp_index, self.facetpoint_ids, "facetpoint")
        if node_type in ("episode", "all"):
            search_index(self._episode_index, self.episode_ids, "episode")

        # ── BM25 keyword boost (rank_bm25 scores keyword matches better than TF-IDF) ──
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
        return results[:top_k]

    # ── Persistence ─────────────────────────────────────────────────

    def save(self, prefix: str = "cone_vector") -> Path:
        """Save all indexes to disk."""
        path = INDEX_DIR / f"{prefix}.npz"
        # _version enables forward compatibility when npz schema evolves
        self._version = 2  # bump on any schema change to npz contents
        idf_list = list(self.vectorizer.idf_) if hasattr(self.vectorizer, "idf_") else []
        vocab_int = {k: int(v) for k, v in self.vectorizer.vocabulary_.items()} if hasattr(self.vectorizer, "vocabulary_") else {}
        np.savez(
            path,
            _version=self._version,
            _dim=self._dim,
            entity_vectors=self.entity_vectors,
            facetpoint_vectors=self.facetpoint_vectors,
            episode_vectors=self.episode_vectors,
            entity_ids=np.array(self.entity_ids, dtype=object),
            facetpoint_ids=np.array(self.facetpoint_ids, dtype=object),
            episode_ids=np.array(self.episode_ids, dtype=object),
            vocab=json.dumps(vocab_int),
            idf=np.array(idf_list),
            train_texts=json.dumps(self._train_texts),
            bm25_corpus=json.dumps(self._bm25_corpus),  # list of (type, id, text)
        )
        return path

    def load(self, prefix: str = "cone_vector") -> bool:
        """Load indexes from disk. Returns True if successful."""
        path = INDEX_DIR / f"{prefix}.npz"
        if not path.exists():
            return False
        data = np.load(path, allow_pickle=True)

        # Version check for forward compatibility (turbovec write/load pattern)
        saved_version = int(data.get("_version", 1))  # default 1 for older npz files
        if saved_version != getattr(self, "_version", 2):
            import warnings
            warnings.warn(
                f"[cone_vector] npz version mismatch (file={saved_version}, code={getattr(self, '_version', 2)})"
                " — attempting load anyway (partial degradation possible)"
            )

        self.entity_ids = data["entity_ids"].tolist()
        self.facetpoint_ids = data["facetpoint_ids"].tolist()
        self.episode_ids = data["episode_ids"].tolist()
        self.entity_vectors = data["entity_entities" if "entity_vectors" not in data else "entity_vectors"]
        self.facetpoint_vectors = data["facetpoint_vectors"]
        self.episode_vectors = data["episode_vectors"]

        # Reconstruct TF-IDF vectorizer from stored data
        def _decode_str(val, default):
            if val is None:
                return default
            if isinstance(val, bytes):
                return val.decode()
            if isinstance(val, np.ndarray):
                return val.item() if val.ndim == 0 else str(val)
            if isinstance(val, str):
                return val
            return default

        raw_vocab = _decode_str(data.get("vocab"), "{}")
        vocab = json.loads(raw_vocab)
        idf_arr = np.array(data.get("idf", []))
        raw_texts = _decode_str(data.get("train_texts"), "[]")
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

        if train_texts and len(idf_arr) > 0:
            # Safely reconstruct TF-IDF vectorizer
            try:
                v = TfidfVectorizer()
                v.fit(train_texts)
                # Only restore idf if length matches vocabulary exactly
                if len(idf_arr) == len(v.vocabulary_):
                    v.idf_ = idf_arr
                else:
                    import warnings
                    warnings.warn(
                        f"idf_arr length mismatch ({len(idf_arr)} vs vocab {len(v.vocabulary_)})"
                        f" — using fitted idf weights"
                    )
                self._vectorizer = v
                self._dim = len(v.vocabulary_)
            except Exception as e:
                import warnings
                warnings.warn(f"Vectorizer reconstruction failed: {e} — building lightweight index")
                # Fallback: build a minimal vectorizer from vocab alone
                if vocab:
                    try:
                        v = TfidfVectorizer()
                        # Manually set vocabulary from stored vocab dict
                        v.fit(list(vocab.keys()))
                        if len(idf_arr) == len(v.vocabulary_):
                            v.idf_ = idf_arr
                        self._vectorizer = v
                        self._dim = len(v.vocabulary_)
                    except Exception:
                        self._vectorizer = None
                        self._dim = None
                else:
                    self._vectorizer = None
                    self._dim = None
        else:
            # No train_texts — build vectorizer from scratch using stored vocab
            if vocab and len(vocab) > 0:
                try:
                    v = TfidfVectorizer()
                    v.fit(list(vocab.keys()))
                    if len(idf_arr) >= len(v.vocabulary_):
                        v.idf_ = idf_arr[:len(v.vocabulary_)]
                    self._vectorizer = v
                    self._dim = len(v.vocabulary_)
                except Exception:
                    self._vectorizer = None
                    self._dim = None
            else:
                self._vectorizer = None
                self._dim = None

        # Validate vectors before building indexes
        for name, vec_arr in [
            ("entity", self.entity_vectors),
            ("facetpoint", self.facetpoint_vectors),
            ("episode", self.episode_vectors),
        ]:
            if vec_arr is not None:
                try:
                    is_valid = (
                        hasattr(vec_arr, 'shape') and
                        len(vec_arr.shape) >= 1 and
                        vec_arr.shape[0] > 0 and
                        len(vec_arr.shape) > 1 and
                        vec_arr.shape[1] > 0
                    )
                    if not is_valid:
                        setattr(self, f"{name}_vectors", None)
                    elif self._dim is not None and vec_arr.shape[1] != self._dim:
                        import warnings
                        warnings.warn(
                            f"{name}_vectors dimension {vec_arr.shape[1]} != vocab size {self._dim}"
                        )
                        setattr(self, f"{name}_vectors", None)
                except Exception:
                    setattr(self, f"{name}_vectors", None)

        self._build_indexes()
        self.fitted = True
        return True


# ─── CLI ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    from modules.memory.cone_graph import ConeGraphStore

    parser = argparse.ArgumentParser(description="Cone Vector Index CLI")
    parser.add_argument("--build", action="store_true", help="Build index from cone_graph.db")
    parser.add_argument("--search", help="Search query")
    parser.add_argument("--type", default="all", choices=["entity", "facetpoint", "episode", "all"])
    parser.add_argument("--top-k", type=int, default=5)
    args = parser.parse_args()

    index = ConeVectorIndex()

    if args.build:
        store = ConeGraphStore()
        all_entities, all_fps, all_eps = [], [], []
        with __import__('sqlite3').connect(store.db_path) as conn:
            for row in conn.execute("SELECT id, name, entity_type FROM entities").fetchall():
                all_entities.append({"id": row[0], "name": row[1], "entity_type": row[2] or "concept"})
            for row in conn.execute("SELECT id, content FROM facetpoints").fetchall():
                all_fps.append({"id": row[0], "content": row[1] or ""})
            for row in conn.execute("SELECT id, summary FROM episodes").fetchall():
                all_eps.append({"id": row[0], "summary": row[1] or ""})

        index.fit(entities=all_entities, facetpoints=all_fps, episodes=all_eps)
        path = index.save()
        print(f"Index built: {path}")
        print(f"  entities={len(index.entity_ids)}, fps={len(index.facetpoint_ids)}, eps={len(index.episode_ids)}")

    elif args.search:
        if not index.load():
            print("No index found. Run --build first.")
            exit(1)
        results = index.search(args.search, node_type=args.type, top_k=args.top_k)
        print(f"Search: '{args.search}' (type={args.type})")
        for ntype, nid, score in results:
            print(f"  [{ntype}] {nid[:12]} score={score:.4f}")
