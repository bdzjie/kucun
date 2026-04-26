"""Fix cone_vector.py — _build_indexes indentation, BM25 k1/b, BM25 corpus fill"""
p = r'C:\Users\Administrator\.openclaw\workspace\modules\memory\cone_vector.py'
with open(p, encoding='utf-8') as f:
    content = f.read()

# Fix 1: Fix indentation-warapped _build_indexes assignments (FAISS side)
content = content.replace(
    "self._entity_index = make_safe(\"entity\", self.entity_vectors, make_index)                 if self.entity_vectors is not None and len(self.entity_ids) > 0 else None",
    "self._entity_index = make_safe(\"entity\", self.entity_vectors, make_index) if self.entity_vectors is not None and len(self.entity_ids) > 0 else None"
)
content = content.replace(
    "self._fp_index = make_safe(\"facetpoint\", self.facetpoint_vectors, make_index)                 if self.facetpoint_vectors is not None and len(self.facetpoint_ids) > 0 else None",
    "self._fp_index = make_safe(\"facetpoint\", self.facetpoint_vectors, make_index) if self.facetpoint_vectors is not None and len(self.facetpoint_ids) > 0 else None"
)
content = content.replace(
    "self._episode_index = make_safe(\"episode\", self.episode_vectors, make_index)                 if self.episode_vectors is not None and len(self.episode_ids) > 0 else None",
    "self._episode_index = make_safe(\"episode\", self.episode_vectors, make_index) if self.episode_vectors is not None and len(self.episode_ids) > 0 else None"
)

# Fix 2: sklearn NN side
content = content.replace(
    "self._entity_index = make_safe(\"entity\", self.entity_vectors, make_nn)                 if self.entity_vectors is not None and len(self.entity_ids) > 0 else None",
    "self._entity_index = make_safe(\"entity\", self.entity_vectors, make_nn) if self.entity_vectors is not None and len(self.entity_ids) > 0 else None"
)
content = content.replace(
    "self._fp_index = make_safe(\"facetpoint\", self.facetpoint_vectors, make_nn)                 if self.facetpoint_vectors is not None and len(self.facetpoint_ids) > 0 else None",
    "self._fp_index = make_safe(\"facetpoint\", self.facetpoint_vectors, make_nn) if self.facetpoint_vectors is not None and len(self.facetpoint_ids) > 0 else None"
)
content = content.replace(
    "self._episode_index = make_safe(\"episode\", self.episode_vectors, make_nn)                 if self.episode_vectors is not None and len(self.episode_ids) > 0 else None",
    "self._episode_index = make_safe(\"episode\", self.episode_vectors, make_nn) if self.episode_vectors is not None and len(self.episode_ids) > 0 else None"
)

# Fix 3: Update BM25Okapi calls to use k1/b params
content = content.replace(
    "self._bm25_index = BM25Okapi(texts_only)",
    "self._bm25_index = BM25Okapi(texts_only, k1=self._bm25_k1, b=self._bm25_b)"
)

with open(p, 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed')

import py_compile
try:
    py_compile.compile(p, doraise=True)
    print('Syntax OK')
except py_compile.PyCompileError as e:
    print(f'Syntax error: {e}')