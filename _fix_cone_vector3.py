"""Fix cone_vector.py load() robustness — handle corrupt/missing npz data"""
p = r'C:\Users\Administrator\.openclaw\workspace\modules\memory\cone_vector.py'
with open(p, encoding='utf-8') as f:
    content = f.read()

# Find and replace the load() method body with robust version
old_load = """        if train_texts and len(idf_arr) > 0:
            # Fit a fresh vectorizer on training texts, then restore stored idf
            v = TfidfVectorizer()
            v.fit(train_texts)
            v.idf_ = idf_arr
            self._vectorizer = v
            self._dim = len(v.vocabulary_)  # record actual dimension after reload

        self._build_indexes()
        self.fitted = True
        return True"""

new_load = """        if train_texts and len(idf_arr) > 0:
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
            if vec_arr is not None and len(vec_arr) > 0:
                actual_dim = vec_arr.shape[1] if len(vec_arr.shape) > 1 else 0
                if self._dim is not None and actual_dim != self._dim:
                    import warnings
                    warnings.warn(
                        f"{name}_vectors dimension {actual_dim} != vocab size {self._dim}"
                        f" — will rebuild vectors from stored text if available"
                    )
                    setattr(self, f"{name}_vectors", None)

        self._build_indexes()
        self.fitted = True
        return True"""

if old_load in content:
    content = content.replace(old_load, new_load)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(content)
    print('Patched load() successfully')
else:
    print('Could not find target block')
    # Show what's around the old load area
    idx = content.find('if train_texts and len(idf_arr) > 0:')
    if idx >= 0:
        print('Context around target:')
        print(repr(content[idx:idx+400]))

import py_compile
try:
    py_compile.compile(p, doraise=True)
    print('Syntax OK')
except py_compile.PyCompileError as e:
    print(f'Syntax error: {e}')