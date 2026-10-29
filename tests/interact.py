from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    errs=[]
    pg = b.new_page(viewport={'width':1280,'height':1000})
    pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8765/sfm/triangulation/', wait_until='networkidle')
    pg.evaluate('window.__loadAll()'); pg.wait_for_timeout(1500)
    # ch3: hover on image 1
    cv = pg.query_selector_all('#ch3 canvas')[0]; cv.scroll_into_view_if_needed()
    bb = cv.bounding_box()
    before = pg.inner_text('#ch3 .readout')
    pg.mouse.move(bb['x']+bb['width']*0.35, bb['y']+bb['height']*0.4); pg.wait_for_timeout(200)
    after = pg.inner_text('#ch3 .readout'); print('ch3 readout changed:', before!=after); print(after.splitlines()[0]); print(after.splitlines()[-1])
    pg.mouse.click(bb['x']+bb['width']*0.35, bb['y']+bb['height']*0.4)
    pg.mouse.move(bb['x']+bb['width']*0.6, bb['y']+bb['height']*0.6); pg.wait_for_timeout(100)
    print('locked still:', pg.inner_text('#ch3 .readout').splitlines()[0])
    # ch2: drag the 3D ball. find ball screen pos by screenshot? use slider instead and verify readout
    pg.query_selector('#ch2').scroll_into_view_if_needed()
    print(pg.inner_text('#ch2 .readout'))
    # try dragging in the 3D canvas: scan for ball by trying drag from the known center-ish point
    c3 = pg.query_selector('#ch2 .v3 canvas'); b3 = c3.bounding_box()
    r0 = pg.inner_text('#ch2 .readout')
    import itertools
    moved=False
    for fx in [0.5, 0.45, 0.4, 0.55, 0.35]:
        for fy in [0.5, 0.45, 0.4, 0.55, 0.6, 0.35]:
            x,y = b3['x']+b3['width']*fx, b3['y']+b3['height']*fy
            pg.mouse.move(x,y); pg.mouse.down(); pg.mouse.move(x+40,y+10, steps=5); pg.mouse.up(); pg.wait_for_timeout(50)
            if pg.inner_text('#ch2 .readout')!=r0: moved=True; break
        if moved: break
    print('ch2 drag moved point:', moved, '|', pg.inner_text('#ch2 .readout').splitlines()[0])
    # ch4 slider -> RANSAC reruns
    s = pg.query_selector_all('#ch4 input[type=range]')[1]; s.scroll_into_view_if_needed()
    s.evaluate("e => { e.value = 50; e.dispatchEvent(new Event('input')); }"); pg.wait_for_timeout(1500)
    print('ch4 stats:', pg.inner_text('#ch4 .stats').replace('\n',' | '))
    # quiz
    pg.query_selector('#ch8 .quiz .opt').scroll_into_view_if_needed()
    pg.click('#ch8 .quiz .q:nth-child(1) .opt:nth-child(3)'); print('quiz fb:', pg.inner_text('#ch8 .quiz .q:nth-child(1) .fb')[:30])
    # toc
    print('toc links', pg.eval_on_selector_all('#toc a','els=>els.length'))
    print('errors', errs)
    # mobile
    m = b.new_page(viewport={'width':390,'height':844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    m.goto('http://localhost:8765/sfm/triangulation/', wait_until='networkidle'); m.evaluate('window.__loadAll()'); m.wait_for_timeout(2500)
    print('mobile scrollWidth', m.evaluate('document.documentElement.scrollWidth'), 'innerWidth', m.evaluate('innerWidth'))
    for sel,name in [('#ch3 .widget','m3'),('#ch6 .widget','m6')]:
        e = m.query_selector(sel); e.scroll_into_view_if_needed(); e.screenshot(path=f'/tmp/shots/{name}.png')
    h = m.goto('http://localhost:8765/', wait_until='networkidle'); m.screenshot(path='/tmp/shots/home.png', full_page=True)
    b.close()
