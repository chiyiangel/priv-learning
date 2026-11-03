import re, json, html, os, sys, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
import markdown

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = ROOT + '/notes/spirula-sfm'
BASE = '/notes/spirula-sfm/'
SLUGS = ['ba-gpu', 'intrinsics', 'data-prep', 'survey-general', 'survey-360', 'spirula-gap', 'hilti', 'projects']
DATA = json.load(open('data.json'))
SERIES = 'Spirula · SfM 学习笔记'

ICON = ("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%277%27 fill=%27%230d1117%27/%3E%3Ccircle cx=%2716%27 cy=%2716%27 r=%276%27 fill=%27%235cc8ff%27/%3E%3C/svg%3E")

def esc(s): return html.escape(s, quote=True)
def escc(s): return re.sub(r'`([^`]+)`', r'<code>\1</code>', esc(s))

# ---------- 公式保护 ----------
def protect_math(text, store):
    def keep(m, disp):
        store.append((m.group(1), disp)); return '@@M%d@@' % (len(store) - 1)
    text = re.sub(r'\$\$(.+?)\$\$', lambda m: keep(m, True), text, flags=re.S)
    text = re.sub(r'(?<![\\$\w])\$([^$\n]+?)\$(?!\d)', lambda m: keep(m, False), text)
    return text
def restore_math(h, store):
    def rep(m):
        src, disp = store[int(m.group(1))]
        return ('<div class="eq">$$%s$$</div>' % esc(src)) if disp else ('\\(%s\\)' % esc(src))
    h = re.sub(r'<p>@@M(\d+)@@</p>', lambda m: rep(m) if store[int(m.group(1))][1] else m.group(0), h)
    return re.sub(r'@@M(\d+)@@', rep, h)

# ---------- 提示框 ----------
KIND = {'note': '要点', 'tip': '建议', 'warn': '注意', 'unv': '未核实'}
def callouts(text):
    out = []
    for line in text.split('\n'):
        m = re.match(r'^:::\s*(note|tip|warn|unv)\s*(.*)$', line)
        if m:
            k, t = m.group(1), m.group(2).strip() or KIND[m.group(1)]
            out.append('<div class="callout %s" markdown="1">\n<p class="ct">%s</p>\n' % (k, esc(t)))
        elif line.strip() == ':::':
            out.append('\n</div>')
        else:
            out.append(line)
    return '\n'.join(out)

# ---------- 方法卡片 ----------
def tag_html(t):
    if t == '是': return '<span class="tag t360">360 / 鱼眼</span>'
    if t == '部分': return '<span class="tag tpart">部分适用</span>'
    return '<span class="tag">通用</span>'
def link_html(k, h):
    lic = esc(k)
    return '%s<br><a href="%s" target="_blank" rel="noopener">%s</a>' % (lic, esc(h), esc(re.sub(r'^https?://', '', h)[:70]))
def cards(key):
    out = []
    for e in DATA['D']:
        if e['c'] != key: continue
        r = ''
        if e.get('r'):
            rr = e['r']
            if rr.startswith('【推断】'):
                r = '<div class="infer"><b>推断</b>%s</div>' % escc(rr[4:])
            else:
                r = '<div class="infer plain"><b>备注</b>%s</div>' % escc(rr)
        out.append(
            '<article class="m"><h4>%s <span class="yr">%s</span> %s</h4><p class="one">%s</p><p>%s</p>'
            '<dl><dt>验证</dt><dd>%s</dd><dt>报告增益</dt><dd>%s</dd><dt>代码 / 许可</dt><dd>%s</dd></dl>%s</article>'
            % (esc(e['n']), e['y'], tag_html(e['t']), escc(e['s']), escc(e['m']), escc(e['d']), escc(e['g']), link_html(e['k'], e['h']), r))
    return '\n'.join(out)

def md_table(cols, rows):
    f = lambda s: str(s).replace('|', '\\|').replace('\n', ' ')
    return '\n'.join(['| ' + ' | '.join(cols) + ' |', '|' + '---|' * len(cols)] + ['| ' + ' | '.join(f(c) for c in r) + ' |' for r in rows])
def sd_table():
    rows = [[x['name'], x['cam'], x['gt'], x['note'] , '[打开](%s)' % x['href']] for x in DATA['SD']]
    return md_table(['数据集', '相机', '真值', '规模与特点', '链接'], rows)
def practice_table():
    rows = [[x['p'], x['what'], x['basis'], x['gain'], x['cost']] for x in DATA['PRACTICE']]
    return md_table(['序', '做法', '依据', '预期收益（推断）', '工作量（推断）'], rows)
def bench_table():
    rows = [[x['name'], x['use'], x['who'], '[打开](%s)' % x['href']] for x in DATA['BENCH']]
    return md_table(['基准', '用途', '文献中出现于', '链接'], rows)

# ---------- 章节读取 ----------
def load(slug):
    raw = open('src/%02d-%s.md' % (SLUGS.index(slug) + 1, slug), encoding='utf-8').read()
    head, body = raw.split('\n---\n', 1)
    meta, cur, tl = {}, None, []
    for line in head.split('\n'):
        if line.startswith('tldr:'): cur = 'tldr'; continue
        if cur == 'tldr': tl.append(line); continue
        k, _, v = line.partition(':'); meta[k.strip()] = v.strip()
    meta['tldr'] = '\n'.join(tl).strip()
    return meta, body

REPO = 'https://github.com/harry7557558/spirula-studio'
COMMIT = '3137944db872f718e58891736f5f17285488d641'
def gh_links(text):
    def rep(m):
        path, line, label = m.group(1), m.group(2), m.group(3)
        lab = label or (path.split('/')[-1] + (':' + line if line else ''))
        return '[`%s`](%s/blob/%s/%s%s)' % (lab, REPO, COMMIT, path, ('#L' + line) if line else '')
    return re.sub(r'\[\[([^\]|#]+?)(?:#L(\d+))?(?:\|([^\]]+))?\]\]', rep, text)

def render_md(text, toc=True):
    store = []
    text = gh_links(text)
    text = text.replace('{{SD_TABLE}}', sd_table()).replace('{{BENCH_TABLE}}', bench_table()).replace('{{PRACTICE_TABLE}}', practice_table())
    text = protect_math(text, store)
    text = callouts(text)
    counter = [0]
    def slug(v, sep):
        counter[0] += 1; return 's%d' % counter[0]
    md = markdown.Markdown(extensions=['tables', 'fenced_code', 'md_in_html', 'sane_lists', 'attr_list', 'toc'],
                           extension_configs={'toc': {'slugify': slug, 'toc_depth': '2-3'}})
    h = md.convert(text)
    h = re.sub(r'<p>@@CARDS (\w+)@@</p>', lambda m: cards(m.group(1)), h)
    h = h.replace('<table>', '<div class="tw"><table>').replace('</table>', '</table></div>')
    h = restore_math(h, store)
    # 外链新窗口
    h = re.sub(r'<a href="(https?://[^"]+)"', r'<a href="\1" target="_blank" rel="noopener"', h)
    return h, md.toc_tokens

def flat_toc(tokens):
    out = []
    for t in tokens:
        out.append((2, t['id'], t['name']))
        for c in t.get('children', []):
            out.append((3, c['id'], c['name']))
    return out

HEAD = '''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>%(title)s</title>
<meta name="description" content="%(desc)s">
<link rel="icon" href="%(icon)s">
<link rel="stylesheet" href="/assets/notes.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
<script defer src="/assets/notes.js"></script>
</head>
<body>
<div class="progress"></div>
'''
def navbar(cur, chapters):
    items = ''.join('<a%s href="%s%s/"><em>%d</em>%s</a>' % (' class="on"' if i == cur else '', BASE, SLUGS[i], i + 1, esc(chapters[i][0]['title'])) for i in range(len(SLUGS)))
    home = '<a%s href="%s">总目录</a>' % (' class="on"' if cur is None else '', BASE)
    return ('<header class="nbar"><div class="in"><a class="brand" href="/">Learning<b>.</b></a><span class="sep">/</span>'
            '<a class="series" href="%s">%s</a><span class="sp"></span>'
            '<details><summary>章节 ▾</summary><nav class="menu">%s%s</nav></details></div></header>\n') % (BASE, SERIES, home, items)
FOOT = '<footer class="nf">Learning · %s · 内容整理自 2026 年 10–11 月关于 spirula-studio / SfM / 3DGS 的技术问答与两份调研；凡标注「推断」「未核实」的内容请勿当作定论。</footer>\n</body>\n</html>\n'

def main():
    chapters = [load(s) for s in SLUGS]
    if os.path.exists(OUT): shutil.rmtree(OUT)
    os.makedirs(OUT)
    for i, s in enumerate(SLUGS):
        meta, body = chapters[i]
        h, toc = render_md(body)
        tl, _ = render_md(meta['tldr'])
        items = flat_toc(toc)
        side = ''.join('<a class="l%d" href="#%s">%s</a>' % (lv, id_, esc(re.sub(r'<[^>]+>', '', n))) for lv, id_, n in items)
        prev = ('<a href="%s%s/"><small>← 上一章</small>%d　%s</a>' % (BASE, SLUGS[i - 1], i, esc(chapters[i - 1][0]['title']))) if i > 0 else '<a class="none"></a>'
        nxt = ('<a class="next" href="%s%s/"><small>下一章 →</small>%d　%s</a>' % (BASE, SLUGS[i + 1], i + 2, esc(chapters[i + 1][0]['title']))) if i < len(SLUGS) - 1 else '<a class="next" href="%s"><small>回到</small>总目录</a>' % BASE
        page = HEAD % dict(title='%s · %s' % (esc(meta['title']), SERIES), desc=esc(meta['sub']), icon=ICON)
        page += navbar(i, chapters)
        page += '<div class="nb-layout">\n<aside class="side"><div class="h">本章目录</div>%s</aside>\n<article>\n' % side
        page += '<details class="toc-m"><summary>本章目录 ▾</summary><div class="side-in">%s</div></details>\n' % side
        page += '<p class="eyebrow">第 %d 章 / 共 %d 章</p>\n<h1>%s</h1>\n<p class="meta">%s</p>\n' % (i + 1, len(SLUGS), esc(meta['title']), esc(meta.get('meta', '')))
        page += '<div class="tldr"><p class="ct">本章要点</p>%s</div>\n' % tl
        page += h
        page += '\n<nav class="pn">%s%s</nav>\n</article>\n</div>\n' % (prev, nxt)
        page += FOOT % esc(SERIES)
        os.makedirs(OUT + '/' + s)
        open(OUT + '/' + s + '/index.html', 'w', encoding='utf-8').write(page)
    # 索引页
    idx = HEAD % dict(title='%s · Learning' % SERIES, desc='spirula-studio 的 BA、数据准备、位姿精度调研、代码对照与评测数据集：按主题整理的中文阅读笔记。', icon=ICON)
    idx += navbar(None, chapters)
    idx += open('src/index-head.html', encoding='utf-8').read()
    idx += '<div class="chlist">\n'
    for i, s in enumerate(SLUGS):
        m = chapters[i][0]
        tags = ''.join('<span class="tag">%s</span>' % esc(k) for k in m.get('kw', '').split('|') if k)
        idx += '<a class="chcard" href="%s%s/"><div class="no">%02d</div><div><h3>%s</h3><p>%s</p><div class="kw">%s</div></div></a>\n' % (BASE, s, i + 1, esc(m['title']), esc(m['sub']), tags)
    idx += '</div>\n'
    idx += open('src/index-tail.html', encoding='utf-8').read()
    idx += FOOT % esc(SERIES)
    open(OUT + '/index.html', 'w', encoding='utf-8').write(idx)
    print('built', len(SLUGS), 'chapters')
if __name__ == '__main__': main()
