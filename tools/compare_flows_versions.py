import subprocess
import re

commits = ['8c53a981', '60d43485^', '60d43485', '19ba487d^', 'HEAD']

for c in commits:
    print(f"\n==================== COMMIT: {c} ====================")
    try:
        html = subprocess.check_output(['git', 'show', f'{c}:docs/flows.html'], text=True, encoding='utf-8', errors='replace')
        print("Panels & Canvases in flows.html:")
        for m in re.finditer(r'<canvas[^>]+id=[\"\']([^\"\']+)[\"\']|<div[^>]+(?:class=[\"\'][^\"\']*panel[^\"\']*[\"\'][^>]*id=[\"\']([^\"\']+)[\"\']|id=[\"\']([^\"\']+)[\"\'][^>]*class=[\"\'][^\"\']*panel)|<!--\s*(Section\s*[0-9][^>]*?)-->', html, re.IGNORECASE):
            print("  ", m.group(0).strip())
    except Exception as e:
        print("  Error:", e)
