# 阅读笔记生成器

`/notes/` 下的页面由 Markdown 源生成，生成后的 HTML 直接提交（站点本身仍然无构建步骤）。

```bash
pip install markdown          # 唯一依赖
python3 tools/notes/build.py  # 重新生成 notes/spirula-sfm/
```

- 章节源文件：`tools/notes/src/NN-slug.md`。文件头是 `key: value` 元信息，`tldr:` 之后到 `---` 为止是“本章要点”，其后是正文。
- 提示框：`::: note|tip|warn|unv 标题` … `:::`；公式：`$...$`（行内）、`$$...$$`（独立行）。
- 方法卡片占位符 `@@CARDS g1@@` 等，数据来自 `data.json`；`[[path#L12|label]]` 会展开成固定到某个提交的 GitHub 链接（见 `build.py`）。
- 新增一章：加一个 `src/NN-slug.md`，在 `build.py` 的 `SLUGS` 里登记。
- 样式 `assets/notes.css`、脚本 `assets/notes.js`（目录滚动高亮、进度条、KaTeX 渲染）与课程页的 `style.css` 互相独立。
