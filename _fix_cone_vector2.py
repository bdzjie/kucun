"""Fix cone_vector.py — address all 4 issues"""
p = r'C:\Users\Administrator\.openclaw\workspace\modules\memory\cone_vector.py'
with open(p, encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
i = 0
while i < len(lines):
    l = lines[i]

    # Fix 1: __init__ dim default (line with "dim: int = 512")
    if i < len(lines) - 1 and 'dim: int = 512' in l and 'def __init__' in lines[i-1] if i > 0 else False:
        new_lines.append('    def __init__(self, dim: Optional[int] = None):\n')
        i += 1
        continue

    # Fix 2: vectorizer property — remove max_features=self.dim
    if l.strip().startswith('self._vectorizer = TfidfVectorizer(max_features=self.dim)'):
        new_lines.append('            # No max_features cap — vocabulary determined from training data\n')
        new_lines.append('            self._vectorizer = TfidfVectorizer()\n')
        i += 1
        continue

    # Fix 3: fit() — add self._dim after fit
    if l.strip() == 'self.vectorizer.fit(all_texts)' and i + 1 < len(lines) and 'self.fitted = True' in lines[i+1]:
        new_lines.append('        self.vectorizer.fit(all_texts)\n')
        new_lines.append('        # Record actual vocabulary size (the true vector dimension)\n')
        new_lines.append('        self._dim = len(self.vectorizer.vocabulary_)\n')
        i += 1  # skip the old self.fitted = True line (will be handled below)
        continue

    # Fix 4: _query_vector — use self._dim or actual vocab
    if 'vocab_size = len(self.vectorizer.vocabulary_)' in l and 'self.dim' in l:
        new_lines.append("        # Use actual vocabulary size; _dim is set after fit()\n")
        new_lines.append("        actual_dim = len(self.vectorizer.vocabulary_) if hasattr(self.vectorizer, 'vocabulary_') else (self._dim or 512)\n")
        i += 1
        continue
    if 'self.vectorizer.n_features_in_ = vocab_size' in l:
        new_lines.append("            self.vectorizer.n_features_in_ = actual_dim\n")
        i += 1
        continue

    # Fix 5: load() — remove max_features=self.dim from TfidfVectorizer reconstruction
    if 'TfidfVectorizer(max_features=self.dim)' in l:
        new_lines.append('            v = TfidfVectorizer()\n')
        i += 1
        continue
    if l.strip() == 'self._vectorizer = v' and i >= 2 and 'v.idf_ = idf_arr' in lines[i-1]:
        new_lines.append('            self._vectorizer = v\n')
        new_lines.append('            self._dim = len(v.vocabulary_)  # record actual dimension after reload\n')
        i += 1
        continue

    # Fix 6: save() — add _dim to saved data
    if 'train_texts=json.dumps(self._train_texts)' in l and 'np.savez' in ''.join(lines[max(0,i-5):i]):
        # Insert _dim before train_texts
        new_lines.append("            _dim=self._dim,\n")
        new_lines.append(l)  # keep the original line
        i += 1
        continue

    new_lines.append(l)
    i += 1

with open(p, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print('Done')
# Verify syntax
import py_compile
try:
    py_compile.compile(p, doraise=True)
    print('Syntax OK')
except py_compile.PyCompileError as e:
    print(f'Syntax error: {e}')