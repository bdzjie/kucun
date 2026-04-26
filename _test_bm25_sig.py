from rank_bm25 import BM25Okapi
import inspect
import sys
print('Python:', sys.executable)
print('Signature:', inspect.signature(BM25Okapi.__init__))
# Test if k1/b are accepted
try:
    bm25 = BM25Okapi(['a b c', 'b c d'], k1=1.5, b=0.75)
    print('k1/b params accepted')
except TypeError as e:
    print('TypeError:', e)
