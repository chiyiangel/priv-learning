import sys, json
from playwright.sync_api import sync_playwright
url = sys.argv[1] if len(sys.argv)>1 else 'http://localhost:8765/sfm/triangulation/'
shots = sys.argv[2] if len(sys.argv)>2 else '/tmp/shots'
import os; os.makedirs(shots, exist_ok=True)
errs=[]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width':1400,'height':900})
    pg.on('console', lambda m: errs.append(('console.'+m.type, m.text)) if m.type in ('error','warning') else None)
    pg.on('pageerror', lambda e: errs.append(('pageerror', str(e))))
    pg.on('requestfailed', lambda r: errs.append(('reqfail', r.url)))
    pg.goto(url, wait_until='networkidle')
    pg.evaluate('window.__loadAll && window.__loadAll()')
    pg.wait_for_timeout(2500)
    for i in range(1,9):
        el = pg.query_selector(f'#ch{i}')
        if el:
            el.scroll_into_view_if_needed(); pg.wait_for_timeout(500)
            el.screenshot(path=f'{shots}/ch{i}.png')
    print('errors:', json.dumps(errs, ensure_ascii=False, indent=1))
    b.close()
