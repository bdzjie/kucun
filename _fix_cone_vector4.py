"""Patch _build_indexes with graceful degradation"""
p = r'C:\Users\Administrator\.openclaw\workspace\modules\memory\cone_vector.py'
with open(p, encoding='utf-8') as f:
    content = f.read()

old = """    def _build_indexes(self):
        \"\"\"Build FAISS or sklearn indexes for each index type.\"\"\"
        if FAISS_AVAILABLE:
            def make_index(vecs):
                d_local = vecs.shape[1]
                v = vecs.copy()
                faiss.normalize_L2(v)
                idx = faiss.IndexFlatIP(d_local)
                idx.add(v)
                return idx

            if self.entity_vectors is not None and len(self.entity_ids) > 0:
                self._entity_index = make_index(self.entity_vectors)
            if self.facetpoint_vectors is not None and len(self.facetpoint_ids) > 0:
                self._fp_index = make_index(self.facetpoint_vectors)
            if self.episode_vectors is not None and len(self.episode_ids) > 0:
                self._episode_index = make_index(self.episode_vectors)
        else:
            def make_nn(vecs):
                nn = NearestNeighbors(n_neighbors=min(5, len(vecs)), metric="cosine")
                nn.fit(vecs)
                return nn

            if self.entity_vectors is not None and len(self.entity_ids) > 0:
                self._entity_index = make_nn(self.entity_vectors)
            if self.facetpoint_vectors is not None and len(self.facetpoint_ids) > 0:
                self._fp_index = make_nn(self.facetpoint_vectors)
            if self.episode_vectors is not None and len(self.episode_ids) > 0:
                self._episode_index = make_nn(self.episode_vectors)"""

new = """    def _build_indexes(self):
        \"\"\"Build FAISS or sklearn indexes for each index type.
        
        Graceful degradation: if any single index build fails, it is excluded
        from search rather than crashing the entire index. This matches the
        pattern from mcp-memory-service storage abstraction where partial
        corruption is quarantined, not fatal.
        \"\"\"
        def make_safe(name, vecs, builder_fn):
            \"\"\"Build one index; on failure warn and return None.\"\"\"
            try:
                return builder_fn(vecs)
            except Exception as e:
                import warnings
                warnings.warn(f"[cone_vector] {name} index build failed ({e}) — excluded from search\")
                return None

        if FAISS_AVAILABLE:
            def make_index(vecs):
                d_local = vecs.shape[1]
                v = vecs.copy()
                faiss.normalize_L2(v)
                idx = faiss.IndexFlatIP(d_local)
                idx.add(v)
                return idx

            self._entity_index = make_safe("entity", self.entity_vectors, make_index) \
                if self.entity_vectors is not None and len(self.entity_ids) > 0 else None
            self._fp_index = make_safe("facetpoint", self.facetpoint_vectors, make_index) \
                if self.facetpoint_vectors is not None and len(self.facetpoint_ids) > 0 else None
            self._episode_index = make_safe("episode", self.episode_vectors, make_index) \
                if self.episode_vectors is not None and len(self.episode_ids) > 0 else None
        else:
            def make_nn(vecs):
                nn = NearestNeighbors(n_neighbors=min(5, len(vecs)), metric="cosine")
                nn.fit(vecs)
                return nn

            self._entity_index = make_safe("entity", self.entity_vectors, make_nn) \
                if self.entity_vectors is not None and len(self.entity_ids) > 0 else None
            self._fp_index = make_safe("facetpoint", self.facetpoint_vectors, make_nn) \
                if self.facetpoint_vectors is not None and len(self.facetpoint_ids) > 0 else None
            self._episode_index = make_safe("episode", self.episode_vectors, make_nn) \
                if self.episode_vectors is not None and len(self.episode_ids) > 0 else None"""

if old in content:
    content = content.replace(old, new)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(content)
    print('Patched _build_indexes OK')
else:
    print('Block not found')
    idx = content.find('def _build_indexes(self):')
    print(repr(content[idx:idx+600]))

import py_compile
try:
    py_compile.compile(p, doraise=True)
    print('Syntax OK')
except py_compile.PyCompileError as e:
    print(f'Syntax error: {e}')