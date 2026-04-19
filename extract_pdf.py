import pdfplumber
import io
import sys

# Suppress FontBBox warnings to stderr
import warnings
warnings.filterwarnings('ignore')

pdf_path = r'D:\WECHAT~1.PDF'
output_path = r'C:\Users\Administrator\.openclaw\workspace\wechat_t0_prompt.txt'

all_text = []
with pdfplumber.open(pdf_path) as pdf:
    sys.stderr.write(f'Pages: {len(pdf.pages)}\n')
    for i, page in enumerate(pdf.pages):
        text = page.extract_text()
        if text:
            all_text.append(f'=== Page {i+1} ===\n{text}')

result = '\n\n'.join(all_text)
with open(output_path, 'w', encoding='utf-8') as f:
    f.write(result)

sys.stderr.write(f'Extracted: {len(result)} chars to {output_path}\n')
