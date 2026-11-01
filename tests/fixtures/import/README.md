# 真实导入语料

把用户提供的真实 PDF / EPUB 样本放在本目录（可以是子目录），`tests/importCorpus.test.mjs`
会自动逐个导入并检查：

- 解析不抛错，标题非空；
- 正文没有 NUL 字符，且至少 100 个非空白字符；
- 章节目录的 `startLine` 单调不减、`level` 在 0–2 之间；
- PDF 的 `pageStarts` 单调不减，`pageLabels` 长度与页数一致；
- 不出现无法分类的告警。

## 约定

- 只放**文字版**样本。扫描版 PDF 会被拒绝（设计决定，不做 OCR）；加密样本请放到
  `unsupported/` 子目录，或用 `*.encrypted.*` 命名，测试会跳过。
- 文件名建议保留来源，例如 `新潮文庫-sample.pdf`、`角川-epub3.epub`。
- 样本只用于本地回归，是否入库由维护者决定；大文件不要提交进 Git。
- Node 环境没有 canvas，所以真实 PDF 的封面渲染与插图编码在这里以 null 替身跳过；
  封面/插图仍需在浏览器（Chromium 99 冒烟）里人工确认。
- 没有样本时测试自动跳过，不会让 CI 变红。

## 运行

```bash
node --test tests/importCorpus.test.mjs
```
