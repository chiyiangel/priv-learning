import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    errs=[]
    pg = b.new_page(viewport={'width':1280,'height':1000}, device_scale_factor=1)
    pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8765/sfm/triangulation/', wait_until='networkidle')
    pg.evaluate('window.__loadAll()'); pg.wait_for_timeout(2000)
    def shot(sel, name):
        el = pg.query_selector(sel); el.scroll_into_view_if_needed(); pg.wait_for_timeout(400)
        pg.evaluate("document.querySelector('.topbar').style.display='none'")
        el.screenshot(path=f'/tmp/shots/{name}.png')
        pg.evaluate("document.querySelector('.topbar').style.display=''")
    ws = pg.query_selector_all('.widget')
    # ch5 default
    shot('#ch5 .widget','w5a')
    # ch5 preset
    pg.click('text=预设：小基线 + 大噪声'); pg.wait_for_timeout(600); shot('#ch5 .widget','w5b')
    # ch6: click next several times
    for i in range(6): pg.click('#ch6 button:has-text("下一步")'); pg.wait_for_timeout(300)
    shot('#ch6 .widget','w6a')
    for i in range(8): pg.click('#ch6 button:has-text("下一步")'); pg.wait_for_timeout(200)
    shot('#ch6 .widget','w6b')
    # ch7 run
    pg.click('#ch7 button:has-text("运行至收敛")'); pg.wait_for_timeout(9000); shot('#ch7 .widget','w7')
    # ch8 run experiments
    for tab in ['① 纯旋转','② 平面场景','③ 误匹配']:
        pg.click(f'#ch8 button:has-text("{tab}")'); pg.click('#ch8 button:has-text("运行实验")'); pg.wait_for_timeout(9000); shot('#ch8 .widget', 'w8_'+tab[0])
    # ch4 slider change
    shot('#ch4 .widget','w4')
    shot('#ch3 .widget','w3')
    print('errors', errs)
    b.close()
