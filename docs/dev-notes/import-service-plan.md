# PDF / EPUB 完整导入服务设计（v1）

日期：2026-10-31
状态：P0 + P1 代码、单测与 Chromium 99 主路径完成；1 本 366 页真实 PDF 已验收，移动端冒烟与大文件压测待验收
目标：把现有「能读」的 PDF/EPUB 导入器升级为「还原原书 + 可服务化」的完整导入服务。

## 0. 用户已定决策

| 议题 | 决定 |
| --- | --- |
| 范围 | 保真 + 服务化，不做 OCR |
| 扫描版 PDF | 保持拒绝，给出明确原因 |
| 固定版式 EPUB / 图像 PDF | 只做文字书；固定版式 EPUB 按图片页顺序导入为插图，不做整页阅读器；扫描/图像 PDF 拒绝 |
| 单本导入交互 | 解析后先预览确认（封面/书名/作者/分类/目录/统计/告警），可改元数据、选文件夹 |
| 批量导入交互 | 正常文件直接入库；只有重复书、加密/损坏、零文字等异常才暂停确认 |
| PDF 封面/插图 | 封面渲染第 1 页；正文大图按页序提取并插入对应位置 |
| PDF 页眉页脚/脚注 | 保守清理：跨页重复短行 + 纯页码；页底脚注保留原位 |
| 目录/页码 | 多级目录层级 + 每行对应原书页码 |
| 元数据 | 补齐 language / publisher / publishedAt / series / seriesIndex / identifier |
| 无目录切章 | 自动切章（EPUB 按 h1–h3，PDF 按字号/间距/章标题模式） |
| 文件规模 | 不设硬上限；预检提示 + 进度 + 取消 + OOM 兜底 |
| 验收语料 | 用户提供真实 PDF/EPUB 样本 |

## 1. 现状审计

### 1.1 已有能力

PDF（`app/utils/pdfImporter.ts`）
- pdf.js 文本层提取，横排折行重拼、两端对齐宽字距、逐字 item 合并。
- 竖排（tategaki）按列重建：逐字 item、整列 item、Type3 `/ActualText`、MarkedContent。
- 康熙部首/兼容汉字折叠、竖排标点还原、无效字符清洗。
- 段落重建（缩进、行距、段末标点、竖排空列）。
- 顶层 outline → 章节；扫描版阈值拦截；元数据 title/author。
- 首屏页面尺寸、横竖排、字号 → `pdfLayout` 供批量导出复刻。

EPUB（`app/utils/epubImporter.ts`）
- ZIP/container/OPF 解析，EPUB2 NCX + EPUB3 nav 目录。
- 书名/作者/封面；插图提取、去重、原位图片行；封面页跳过。
- 原书 `<ruby>` → `RubyOverride`；外字/颜文字内联；着重点排除。
- 脚注内容延后到章末；目录页/隐藏元素/页 break 跳过；字体混淆放行，DRM 拒绝。
- 标题兜底（每个 spine 文件第一个 h1–h3）。

服务层
- 格式识别：扩展名 / MIME / 魔数（Android `content://` 无扩展名）。
- 书库按文本指纹 upsert；封面缩放；插图存 IndexedDB。
- 批量队列：进度状态、失败继续、最终汇总。

### 1.2 缺口

| 层 | 缺口 |
| --- | --- |
| PDF 还原 | 无封面、无正文插图、无页眉页脚清理、无脚注处理、目录仅顶层、无原书页码、密码 PDF 直接失败、无目录时不切章 |
| EPUB 还原 | 元数据仅书名/作者；无 guide 封面回退；目录层级丢失；无目录时每文件只取第一个标题；CSS 类隐藏未处理；固定版式无提示 |
| 服务化 | 单本导入无真实进度/取消；批量遇错中断（书库）；解析主线程无分片让出；重复书静默合并；无导入预览/元数据编辑；错误无分类 |
| 数据模型 | `BookChapter` 无层级/页码；`BookItem` 无语言/出版社/日期/书系/标识符；无行→页映射 |
| 验证 | 仅构造样本；无真实商业排版语料；无大文件/取消/加密 PDF 测试 |

## 2. 总体架构

```
文件 → 预检(format/size) → 解析器(PDF/EPUB/DOCX/文本)
     → ImportedBook + warnings + progress/cancel
     → 归一化(ParsedBookFile → 预览数据 / 统计 / 重复检测)
     → 单本：预览确认；批量：异常才确认
     → 入库(元数据/章节/页码/封面) + 插图存 IndexedDB
     → 结果汇总 / 失败重试
```

模块职责：

| 模块 | 职责 |
| --- | --- |
| `app/utils/bookAssets.ts` | 共享导入类型、告警、进度、选项、错误基类 |
| `app/utils/importErrors.ts` | 错误码、`ImportError`、错误映射 |
| `app/utils/pdfImporter.ts` | PDF 文本/目录/页码/页眉页脚/自动切章/封面/插图 |
| `app/utils/pdfImageExtractor.ts` | pdf.js operator list → 图片对象 → PNG/JPEG（可注入编码器） |
| `app/utils/epubImporter.ts` | EPUB 元数据/目录层级/封面回退/隐藏内容/切章/插图 |
| `app/utils/bookImport.ts` | 格式识别、解析路由、选项透传、错误归一化 |
| `app/utils/importPreview.ts` | 统计、告警文案键、重复检测、章节摘要（纯函数，可测） |
| `app/components/ImportPreviewModal.tsx` | 单本预览/元数据编辑/重复决策/密码输入 |
| `app/hooks/useImportQueue.ts` | 导入队列、进度、取消、异常暂停、失败重试 |
| `app/utils/libraryDatabase.ts` | schema 扩展、校验、章节层级/页码、元数据 |
| `app/components/TocCard.tsx` | 目录层级缩进、页码显示 |
| `app/components/ReaderPanel.tsx` | 当前行→原书页码显示 |

## 3. 共享类型

### 3.1 ImportedBook 扩展

```ts
export interface ImportedChapter {
  title: string;
  startLine: number;
  level?: number;   // 0 = 顶层，最多 2
  page?: number;    // 1-based 原书页码
}

export interface ImportWarning {
  code: ImportWarningCode;
  count?: number;
  detail?: string;
}

export interface ImportedBook {
  title: string;
  author: string;
  text: string;
  overrides: RubyOverride[];
  chapters: ImportedChapter[];
  images: ImportedBookImage[];
  pdfLayout?: PdfLayout;
  cover?: { mime: string; data: Uint8Array };
  description?: string;
  language?: string;
  publisher?: string;
  publishedAt?: string;
  series?: string;
  seriesIndex?: string;
  identifier?: string;
  pageStarts?: number[];   // 索引 = page-1；值 = 该页首个正文行；无正文为 -1
  pageLabels?: string[];   // 原书页码标签（i, ii, 1…），可选
  warnings: ImportWarning[];
}
```

`ImportWarningCode`：
`auto-chapters` / `running-heads-removed` / `footnotes-inline` / `fixed-layout` / `missing-cover` / `images-skipped` / `low-text` / `unknown-image-format`。

密码、扫描版属于错误码（见 3.3），不是告警。

### 3.2 进度与取消

```ts
export type ImportStage = 'reading' | 'text' | 'images' | 'chapters' | 'cover' | 'done';

export interface ImportProgress {
  stage: ImportStage;
  current: number;
  total?: number;
}

export interface ImportOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
  password?: string;
  /** 测试注入：渲染 PDF 封面。默认用 DOM canvas。 */
  renderCover?: (page: PdfPageLike) => Promise<{ mime: string; data: Uint8Array } | null>;
  /** 测试注入：编码 PDF 图片。默认用 DOM canvas。 */
  encodeImage?: (image: PdfImageData) => Promise<{ mime: string; data: Uint8Array } | null>;
}
```

取消使用本地辅助函数检查 `signal.aborted` 并抛 `DOMException('Aborted', 'AbortError')`，不依赖 Chrome 100 的 `throwIfAborted`。

### 3.3 错误分类

```ts
export type ImportErrorCode =
  | 'password-required' | 'password-wrong' | 'drm-protected' | 'scanned-pdf'
  | 'empty-book' | 'corrupt-file' | 'unsupported-format'
  | 'out-of-memory' | 'io-error' | 'cancelled' | 'unknown';

export class ImportError extends Error {
  code: ImportErrorCode;
  detail?: string;
  retryable: boolean;
}
```

- `ScannedPdfError extends ImportError`（code `scanned-pdf`），保持现有测试/调用兼容。
- pdf.js `PasswordException`（code 1/2）→ `password-required` / `password-wrong`。
- EPUB encryption.xml 中非字体混淆算法 → `drm-protected`；缺 container/OPF/正文 → `corrupt-file` / `empty-book`。
- `RangeError`/内存分配失败 → `out-of-memory`。
- 解析器不再直接抛中文句子给 UI；UI 按 code 取 i18n 文案，`detail` 仅写日志。

### 3.4 书库 schema（增量，保持 LIBRARY_VERSION=2）

`BookChapter` 增加：

```ts
level?: number;  // 0–2
page?: number;   // 1-based 原书页码
```

`BookItem` 增加：

```ts
description?: string;      // 已有
language?: string;
publisher?: string;
publishedAt?: string;
series?: string;
seriesIndex?: string;
identifier?: string;
pageStarts?: number[];     // PDF 行→页映射
pageLabels?: string[];
```

兼容策略：全部字段可选；旧书库校验时缺省即忽略，不需要版本迁移。`toBookChapters` 保留 `level`/`page`；同一 `startLine` 的父子目录项保留父项（先到先得）。`pageStarts` 校验：整数且忽略 `-1` 后单调不减，否则整体丢弃。

`UpsertBookInput` 增加 `allowDuplicate?: boolean`：为 `true` 时跳过按指纹找已有书，用于「保留两份」。

## 4. PDF 管线

### 4.1 加载与密码

- `defaultLoadPdf(data, options)` 把 `password` 传给 `getDocument`。
- 捕获 `PasswordException` → `ImportError`；UI 弹密码框，用户提交后带 `password` 重新解析。
- 密码错误重试次数不限，用户可取消。

### 4.2 文本层 → 视觉行（保留现有）

现有横排/竖排重建、ActualText、标点折叠、清洗逻辑不动；只增加每页 `pageSize` 记录与进度回调。

### 4.3 页眉页脚保守清理

在视觉行阶段、竖排重建之前执行：

1. 每页取首/末 6% 高度带内的短行（≤40 字）。
2. 归一化 key：数字（含全角）→ `#`，去空白。
3. 同一 key 出现在 ≥3 页且 ≥总页数 20% → 删除所有实例。
4. 行高必须 ≤ 正文字高 0.95，避免误删正文重复句。
5. 纯页码沿用现有 `PAGE_NUMBER_RE`。
6. 记录删除数量 → `running-heads-removed` 告警。

### 4.4 段落与自动切章（无 outline 兜底）

- 现有段落规则保留。
- 标题候选：
  - 行高 ≥ 正文字高 1.3，长度 ≤ 40，且位于页首或前有 ≥1.5 行距空白；或
  - 匹配 `/^(第[0-9０-９一二三四五六七八九十百千]+[章話節篇部]|序章|終章|プロローグ|エピローグ|あとがき|後書き|Chapter\b)/`。
- 至少 2 个候选才启用；否则全书一章。
- 层级：章标题模式命中 → 0（即使字号与正文相同）；否则字号 ≥1.6 正文 = 0，≥1.3 = 1；最多 2。
- 命中标题时强制另起段落，记录段落索引 → `startLine`。
- 发 `auto-chapters` 告警，预览显示数量。

### 4.5 目录层级与页码

- `getOutline()` 递归（`items` 子项），保留深度，最多 2。
- 每个 outline 目标解析到页 → 该页首个段落索引。
- 同一 `startLine` 只保留第一个（父项）。
- `chapter.page = pageIndex + 1`。
- `pageStarts[pageIndex]`：该页任一视觉行所属的第一个输出段落；无正文页 `-1`。
- `pageLabels`：`doc.getPageLabels?.()` 有则保存。
- 预览和阅读器显示 `原书 p.X`；阅读器按 `pageStarts` 二分查找当前行页码。

### 4.6 封面

- 仅第 1 页，viewport scale 取 `min(2, 600 / max(width,height))`（至少 300px 长边）。
- `page.render({canvasContext, viewport, intent: 'print'}).promise` → canvas → JPEG 0.85。
  print intent 让 pdf.js 用微任务而不是 rAF 调度；封面不需要屏幕专用批注，且能避免后台/嵌入
  WebView 中 rAF 停住导致导入卡在「生成封面」。
- 测试通过 `options.renderCover` 注入；loader 无 `render` 时跳过并发 `missing-cover` 告警。
- 封面页若同时提取到覆盖 ≥80% 页面的大图，跳过该图，避免重复。

### 4.7 正文插图

- 新模块 `pdfImageExtractor.ts`：
  - `page.getOperatorList()`，遍历 `OPS.paintImageXObject` / `paintJpegXObject` / `paintInlineImageXObject`。
  - 跳过 `paintImageMaskXObject`（模板遮罩）。
  - 解析对象：`page.objs.get(id)` 或 `page.commonObjs.get(id)`；inline 用 args[0]。
  - 支持 `{kind:1|2|3,width,height,data}`、ImageBitmap、canvas/image。
  - 过滤：显示面积 < 页面 5% 或宽高都 < 64px 的图跳过（外字/装饰）。
  - 覆盖 ≥85% 页面且该页正文 >100 字时跳过（扫描底图/水印）。
  - 以字节 FNV 哈希去重。
  - 编码：默认 canvas；长边限 1600px；有 alpha 用 PNG，否则 JPEG 0.85。
  - 每张处理完释放 canvas；逐张 `await` 让出事件循环。
- 定位：图片按页 + y 排序；插入到该页第一个 `y < 图片 y` 的段落之前；没有则插到该页最后一段之后。图片行使用现有 `imageLine(id)`。
- 章节 `startLine` 需要加上插入在它之前的图片行数；实现时以段落级偏移表统一换算。
- 图片 id `img-1…`，与 EPUB 共用 `ImportedBookImage` 结构；入库走现有 `putBookAssets`。

### 4.8 元数据

- `getMetadata().info`：Title / Author / Subject → description / Keywords / CreationDate（PDF `D:YYYYMMDD…` → `YYYY-MM-DD`）。
- XMP（`metadata.metadata`）：`dc:language`、`dc:publisher`、`dc:date`、`dc:identifier`、`dc:description`，仅在 info 缺失时兜底。
- 标题是文件路径/占位符时继续回退文件名。

## 5. EPUB 管线

### 5.1 容器与 DRM

- 缺 `container.xml` / rootfile / OPF / body → `corrupt-file`。
- encryption.xml：字体混淆两种算法放行；其他算法 → `drm-protected`，文案区分「受 DRM 保护」。
- 空正文 → `empty-book`。

### 5.2 元数据

从 OPF 读取：
- `dc:title`（首个非空）
- `dc:creator`（首个；多作者暂不合并）
- `dc:language`
- `dc:publisher`
- `dc:date`（原样字符串，ISO 优先）
- `dc:identifier`（package `unique-identifier` 指向的 item，否则第一个）
- `dc:description`（textContent，折叠空白）
- 书系：
  - EPUB3 `meta property="belongs-to-collection"` + `collection-type=series` + `group-position`
  - EPUB2 `meta name="calibre:series"` / `calibre:series_index`
- 封面回退：`properties="cover-image"` → `meta name="cover"` → guide `<reference type="cover">`（XHTML 内取第一张 img/image）。

### 5.3 正文

- 现有 ruby/gaiji/脚注/目录页跳过逻辑保留。
- 隐藏内容扩展：
  - `hidden`、inline `display:none`、`visibility:hidden`、`epub:type=pagebreak`（已有）。
  - 收集 manifest 中 `text/css` 文件与文档内 `<style>`：正则提取 `.class` 选择器带 `display:none` / `visibility:hidden`，文档内命中 class 即跳过。误判风险低。
- `aria-hidden="true"` 不处理（可能只是读屏隐藏）。
- 固定版式检测：OPF `meta property="rendition:layout"` = `pre-paginated` → `fixed-layout` 告警，按当前 DOM 顺序导入（图片页成为插图行）。

### 5.4 目录层级与切章

- nav：递归 `ol > li`，`<a>` 本身 + 子 `ol` 深度；最多 2。
- NCX：递归 `navPoint`，深度；最多 2。
- 同一 `startLine` 保留第一个（父项）。
- 无目录兜底：收集每个 spine 文档内所有 `h1/h2/h3`，level = tag-1；每个标题都成为章节起点，不再只取第一个。
- 若仍无标题 → 全书一章。
- 发 `auto-chapters` 告警。

### 5.5 插图与封面

- 现有图片提取、去重、原位图片行保留。
- 封面页跳过逻辑保留；guide 回退找到封面后同样跳过。
- 缺失封面 → `missing-cover` 告警（不阻塞）。
- 图片 alt 仅在外字场景使用；普通插图 alt 暂不写入正文（figcaption 已是正文行）。

## 6. 导入服务层

### 6.1 解析 API

```ts
parseBookFile(file: File, options?: ImportOptions): Promise<ParsedBookFile>
```

`ParsedBookFile` 增加 `warnings` 与元数据字段；`format`/`category` 不变。

### 6.2 队列状态机

```
pending → parsing → (review?) → importing → done
                 ↘ failed (可重试)
                 ↘ cancelled
```

- 单文件：`parsing → review → importing → done`，预览始终显示。
- 多文件：`parsing` 后判断是否异常；正常直接 `importing`，异常进 `review` 暂停。
- 异常判定：
  - 文本指纹命中已有书（重复）
  - 解析失败（加密/DRM/损坏/空书/扫描版）
  - 警告含 `auto-chapters` 且章节数 > 0？不，这是正常兜底，不暂停
  - 警告含 `fixed-layout`、`missing-cover`、`images-skipped` → 只在最终汇总提示，不暂停
- 解析失败：打开错误步骤，可重试 / 跳过 / 取消；跳过则继续下一本。最终汇总 `成功 N / 失败 M / 跳过 K`，提供「重试失败项」。
- 取消：当前解析中止 → cancelled，剩余项一并标记 cancelled，不再逐个询问。

### 6.3 重复书

- 以文本指纹为准（与 `upsertBook` 一致）。
- 预览横幅：`书库已有《X》`。
- 三个动作：
  - **合并**：沿用已有 `bookId`，用新解析结果更新元数据/章节/注音/插图/页码，保留阅读进度、书签、批注；插图先删后写。
  - **保留两份**：`upsertBook({ allowDuplicate: true })` 新建 `bookId`；标题沿用解析结果，用户可在预览里改成 `（2）` 等以区分。
  - **取消**：跳过该文件。
- 同标题不同指纹不自动判重，只在预览里提示。

### 6.4 进度与取消

- PDF：`reading` 0→1；`text` 每页；`images` 每张；`chapters`；`cover`。
- EPUB：`reading` container/OPF；`text` 每个 spine 文档；`images` 每张；`chapters`。
- 每 N 页/每张图检查 `signal.aborted`；`await` 本身已让出事件循环，无需专用 Worker。
- 进度显示：toast 文案 + 细进度条/百分比；批量队列项显示各自进度。

### 6.5 预览数据

纯函数 `buildImportPreview(file, parsed, { duplicate, folders, folderId })` 返回：
- 文件名/大小/格式
- 封面 Blob（或 null，由模态创建 object URL）
- 标题/作者/分类/文件夹初值
- 统计：字数、行数、章节数、插图数、原书注音数、页数（PDF）
- 章节前 8 项（带层级）
- 文本前 3 行
- 告警列表（code + count，UI 翻译）
- 重复书信息

## 7. UI 流程

### 7.1 单本预览

`ImportPreviewModal`：
- 左/上：封面预览；右/下：可编辑字段（书名、作者、分类、文件夹）。
- 统计 chips；告警区；目录预览；正文样例。
- 重复横幅 + 合并/保留两份/取消。
- 底部：取消 / 导入。
- 密码状态：解析阶段抛 `password-required` 时，先显示密码输入（同一模态的第二步），提交后重试解析。

### 7.2 批量

- 队列面板或 toast 显示 `第 i/N 本 · 文件名 · 阶段`。
- 正常书无感入库；异常书暂停并打开同一个预览模态，确认后继续。
- 最终 toast：`已导入 8 本 · 失败 1 本 · 跳过 1 本`，detail 列失败文件名；action「重试失败项」。

### 7.3 阅读器

- `TocCard` 按 `chapter.level` 缩进（每级 12px），层级最多 2。
- 章节条目右侧显示 `p.X`（有 `page` 时）。
- 阅读器 HUD/capsule 显示当前行对应原书页码（有 `pageStarts` 时），使用 `pageLabels` 优先。

## 8. 性能与兼容

- 不设硬上限；预检 >100MB 或 >1000 页时在预览/队列中提示「文件较大，导入可能较慢」，不阻止。
- 解析按页/按 spine 文档串行，`await` 让出主线程；不新增 Web Worker（EPUB 需要 DOMParser，Chrome 99 下 worker 不可用；PDF.js 自身已在 worker）。
- 内存：逐页释放 page proxy；图片逐张编码并释放 canvas；ArrayBuffer 在解析结束后可被 GC。
- Chrome 99 / HarmonyOS WebView：应用代码不使用 `AbortSignal.throwIfAborted`、`Promise.withResolvers`、`Set` 新方法、`structuredClone`、OffscreenCanvas；canvas/render 均走 DOM。pdf.js 6 自身依赖 `Promise.withResolvers`（Chrome 119+）、原生 `ReadableStream` 异步迭代（Chrome 124+）与 `ArrayBuffer.transferToFixedLength`（Chrome 114+），主线程由 `app/utils/pdfjsCompat.ts`、worker 由 `scripts/vendor-assets.mjs` 在首次导入前注入 shim。
- 大图编码失败（OOM）→ 跳过并告警 `images-skipped`；整体 OOM → `out-of-memory`。
- 桌面 pywebview/WebView2、iOS WKWebView、Android Capacitor 同一路径。

## 9. 测试与验收

### 9.1 四门禁

每个阶段结束跑：`npx tsc --noEmit`、`npm test`、`npm run lint`、`npm run build`，报告明确通过/失败数。

### 9.2 单元/集成测试

PDF：
- 加密文件：抛 `PasswordException` → `password-required`；带密码成功。
- 页眉页脚：跨 5 页重复短行被删；正文重复句不删；页码仍删。
- 自动切章：无 outline 时按字号/章模式切分；仅 1 个候选时全书一章。
- 目录层级：嵌套 outline 保留 level/page；同 startLine 保留父项。
- `pageStarts`：多页映射、无正文页 -1、单调性。
- 封面/插图：注入 `renderCover`/`encodeImage`，验证调用、过滤、去重、插入位置、章节 startLine 偏移。
- 元数据：PDF 日期解析、XMP 兜底。

EPUB：
- 元数据：language/publisher/date/series/identifier/description。
- 封面：guide 回退。
- 目录层级：嵌套 nav 与 NCX 深度。
- 切章兜底：一个文件内多个 h1–h3 全部成为章节。
- CSS 隐藏：`.hidden{display:none}` 内容不进入正文。
- 固定版式：告警。
- DRM：非字体算法 → `drm-protected`。

服务层：
- 队列正常/异常/失败/取消状态机；批量继续与重试。
- 重复：合并保留进度；保留两份生成新 bookId。
- 预览统计与告警。
- 元数据/页码/章节层级在 `validateBook` 往返后不丢。

### 9.3 真实语料

用户提供样本放 `tests/fixtures/import/`（不提交版权文件；目录只提交 README）。`tests/importCorpus.test.mjs` 在目录为空时 skip；有文件时对每本检查：
- 无 NUL；正文至少 100 个非空白字符
- 章节 `startLine` 单调不减、`level` 0–2、PDF 章节页码递增
- PDF `pageStarts` 合法且与 `pageLabels` 等长
- 告警码都在已知集合内
- 输出一份覆盖报告（字符数/章节/子级/插图/页数/告警），供人工比对原书。

Node 没有 canvas：真实 PDF 的封面渲染与插图编码在语料测试里以 null 替身跳过，封面/插图仍由浏览器冒烟覆盖。加密/扫描版样本放 `unsupported/` 子目录排除。

### 9.4 E2E / 兼容

- headless Chrome：单本预览→导入→阅读器页码；批量 2 正常 + 1 重复；取消导入；密码 PDF。
- Chromium 99（HarmonyOS 等价）：构建 `out/` 后跑导入主路径，确认无新 API 崩溃。
- 移动端 375px：预览模态、进度、密码框布局。

## 10. 分阶段实施

### P0 基础与服务化（先做）

1. 共享类型、`ImportError`、进度/取消选项。
2. 书库 schema：章节 level/page、元数据、pageStarts/pageLabels、allowDuplicate、校验。
3. PDF：密码、页眉页脚、自动切章、嵌套目录、pageStarts、元数据。
4. EPUB：元数据、嵌套目录、全标题切章、guide 封面、CSS 隐藏、固定版式告警。
5. 队列：进度/取消/批量继续/失败重试/重复决策。
6. 预览模态 + i18n + 阅读器目录层级/页码。
7. 单元测试、四门禁。

### P1 还原度（随后）

8. PDF 封面渲染 + 插图提取/定位/去重/章节偏移。
9. PDF 大文件性能、OOM 兜底、进度细化。
10. 真实语料回归测试与报告。
11. E2E 与 Chromium 99 冒烟。

### P2 打磨

12. 脚注增强（PDF 脚注识别、EPUB noteref 链接）——仅在设计确认后做，默认保守保留。
13. 更多 EPUB 固定版式/媒体覆盖（不做整页渲染，只补告警与图片顺序）。
14. 导入历史/报告导出、字体/语言细节。

## 11. 风险与开放问题

- **P1 图片提取**依赖 pdf.js 内部 `page.objs`/`operator list`；不同 PDF 图片编码差异大。以「大图 >6% 面积」为保守边界，失败只告警不阻塞。
- **自动切章**是启发式，可能误切；预览展示且阅读器仍可按行定位，风险可控。
- **页眉页脚**误删风险通过「跨 ≥3 页 + 边带 + 小字号 + 短行」限制；预览报告删除数。
- **元数据字段**为增量可选，旧库不迁移；备份导入导出需验证不丢字段。
- **真实语料**未到位前，商业排版长尾无法最终验收；语料目录与报告机制先就绪。
- **无硬上限**下移动端可能 OOM；UI 必须给出可恢复错误，不能白屏。

## 12. 验收口径

完成 P0+P1 后：
- 单本 PDF/EPUB 导入必出预览；可改元数据、选文件夹、处理重复。
- PDF 有封面、页码映射、多级目录、页眉页脚清理；EPUB 有完整常用元数据、多级目录、guide 封面、CSS 隐藏。
- 批量导入正常书无感，异常书暂停；失败不中断；可重试。
- 所有导入错误有明确分类与可操作文案。
- 四门禁全绿；真实语料报告无 NUL、章节/注音/插图统计合理；Chromium 99 主路径通过。

## 13. 实施记录（2026-11-01）

- 四门禁：`tsc --noEmit` 通过；`npm test` 565 项（564 通过、1 项真实语料测试因目录为空 skip）；
  `npm run lint` 0 error（仅 2 条既有 warning）；`npm run build` 通过。
- 浏览器手动冒烟（开发预览，现代 Chromium）：
  - EPUB：单本导入弹出预览（封面缺失/自动切章告警、目录、正文样例）→ 导入 → 书库出现 → 阅读器打开。
  - 同书再次导入出现重复横幅 → 合并导入成功，书库未新增副本。
  - PDF：封面渲染、185 字/2 章/2 页、目录 `p.1`/`p.2`、正文英文换行空格与标题独立成段 → 导入 →
    阅读器 HUD 显示「原书 p.1」。
- 冒烟中发现并修复：PDF 封面 `page.render` 的 rAF 调度在预览环境停住；改用 print intent 后
  封面 1–2 秒完成。英文换行在句号/右括号后缺空格、标题与正文粘连，一并修复并加单测。
- Chromium 99 自动化冒烟（Puppeteer + Chromium 961656，静态 `out/`）：EPUB 预览→导入→书库出现；
  PDF 预览（渲染封面、`p.1`、2 页）→导入→阅读器 HUD「原书 p.1」全部通过，无 pageerror。
  期间发现并修复三个 Chrome 99 缺失 API：`Promise.withResolvers`（pdf.js 主包与 worker）、
  原生 `ReadableStream` 异步迭代（`getTextContent` 直接报 `is not async iterable`）、
  `ArrayBuffer.transferToFixedLength`（worker 编译字体失败，导致先做插图提取时后续封面 render
  永久挂起）。两个 shim 在 `app/utils/pdfjsCompat.ts`，worker 版在 `scripts/vendor-assets.mjs`。
### 13.1 真实 PDF 语料（366 页轻小说，2026-11-01）

- 语料：`ようこそ実力至上主義の教室へ2`（366 页，letter，竖排正文 + 横排扉页/版权页）。
  导入结果：144,701 字、4,009 行、10 章、23 张插图、366 页映射；浏览器实际渲染 23/23 张图。
- 发现并修复：
  - **封面只显示在预览、没有保存**：`importEditToUpsertInput` 的 options 没有 `coverUrl`，
    调用方的展开属性绕过 TS 多余属性检查后被静默丢弃。补上透传与单测，书库封面恢复为 PDF 第 1 页。
  - pdf.js 6 图片对象是 `{ bitmap }` 包装、没有 `data`/`kind`；编码器改为直接 `drawImage(bitmap)`。
  - bitmap 没有原始像素，旧去重按尺寸误合并了 5 张同尺寸插图；无 `data` 时禁用去重（19→23 张）。
  - `page.objs.get(name)` 在 worker 尚未解码时抛异常；改为回调等待，避免静默丢图。
  - 横排扉页的作者行被拼进竖排版权页首列（跨页且方向变化仍续段）；方向变化现在强制分段。
  - PDF 自带书签把 `contents` 与 `佐倉愛里の独白` 指向同一页，`toBookChapters` 去重后少一章；
    导入时在书签位置附近查找同名短标题行（允许 ○ 等装饰），恢复为 10 章。
  - 只有图片的页原先没有 `pageStarts`，HUD 在开头显示空白；现在映射到该页首张图片行。
  - 阅读器点「上一章/下一章/目录」只更新进度、不更新 `currentLine`，HUD 停留在旧页码；已同步。
  - 文件名尾部的下载站标签（`(z-library.sk, 1lib.sk, z-lib.sk)`）不再进入书名。
  - 合并导入的预览沿用既有书籍的文件夹与分类，并在新文件缺字段时填入既有元数据，
    避免为刷新插图而重导入时清空用户编辑过的作者/简介等。
- 待办：用户真实语料（放 `tests/fixtures/import/`）、移动端 375px 布局、大文件/OOM 压测、
  批量异常路径与密码 PDF 的自动化 E2E（单本主路径已通过）。
