/**
 * In-app release notes ("更新内容"). Shown only from Settings — never as a popup.
 * Bullets are short, user-facing sentences: what changed for the reader, not the commit log.
 * Newest first; `RELEASE_NOTES[0].version` is the version the yellow dot keys on.
 */
export interface ReleaseNote {
  version: string;
  /** ISO date, e.g. "2026-10-26". */
  date: string;
  items: Record<'zh-CN' | 'en', string[]>;
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '1.8.2',
    date: '2026-11-06',
    items: {
      'zh-CN': [
        '阅读器字号上限从 26 px 提升到 40 px，可在 14–40 px 之间调整；横排、竖排和双语对照都生效，调整时当前阅读行保持不动。工作台与导出仍保持 26 px 上限。',
        '网页版词典加载明显加快：注音词典改为 Brotli 压缩，点词词典的日中/日英分片并发下载；不支持 Brotli 的浏览器会自动回退到 gzip。',
        '注音词典会缓存在浏览器中，刷新或重新打开页面不再重复下载和解压那份约 100 MB 的数据。',
        '点词词典升级改为原子替换：下载或校验失败时旧词典仍可继续查询，不会留下半套词典；同时移除了会在慢网络下反复重启下载的 60 秒超时。',
      ],
      en: [
        'Reader type now goes up to 40 px (adjustable from 14–40 px) in horizontal, vertical and bilingual reading, and the current line stays in place while resizing. The editor and exports keep their 26 px limit.',
        'Web dictionary loading is much faster: the tokenizer dictionary is Brotli-compressed and the ja–zh/ja–en shards download concurrently, with an automatic gzip fallback for browsers without Brotli support.',
        'The tokenizer dictionary is cached in the browser, so a reload no longer downloads and unpacks the same ~100 MB again.',
        'Point-dictionary upgrades now install atomically: if a download or check fails, the previous dictionary stays usable instead of leaving half an install. The 60-second timeout that restarted slow downloads is gone.',
      ],
    },
  },
  {
    version: '1.8.1',
    date: '2026-11-02',
    items: {
      'zh-CN': [
        '菜单、右键菜单与设置面板的底色固定下来：压在深色书封上不再跟着背景一起变暗，文字始终看得清。',
        '手机端底部 Tab 栏与阅读器底部的进度条不再让书封和正文透上来；Tab 选中项在浅色底上改为灰色胶囊。',
        '面板内的次要说明文字加深到 WCAG AA 对比度（深色封面背景上 5:1 以上）。',
      ],
      en: [
        'Menu, context-menu and settings panels now keep a fixed fill, so they no longer darken along with a dark book cover and their labels stay readable.',
        'The phone tab bar and the reader\'s bottom progress bar no longer let covers or page text show through, and the selected tab uses a grey capsule on a light bar.',
        'Secondary text inside panels is darkened to WCAG AA contrast (5:1 and above over a dark cover).',
      ],
    },
  },
  {
    version: '1.8.0',
    date: '2026-11-01',
    items: {
      'zh-CN': [
        '导入单个 PDF 或 EPUB 时先预览：可以改书名、作者、分类、文件夹和出版信息，确认章节、字数与图片数量后再入库。',
        '批量导入多个文件：正常的文件自动处理，只有重复、扫描版、加密或解析失败时才停下来询问；解析可随时取消，加密 PDF 输错密码可以重试。',
        '重复的书可以选「合并导入」，更新内容的同时保留文件夹、分类和阅读进度；也可以保留两份。',
        'PDF 插图提取修复：测试的 366 页竖排小说里 23 张插图全部保留，包括没有文字层的纯图片页；导入时生成的封面会真正保存，不再退回默认封面。',
        'PDF 书签指向同一页时不再丢章节；横排书名页与竖排正文不再粘在一起；文件名里的下载站标签会从书名去掉。',
        '阅读器底部的「原书页码」现在包含纯图片页，跳章时立即更新；导入失败的提示也更具体（扫描版、DRM、损坏、密码、内存不足）。',
      ],
      en: [
        'Preview a PDF or EPUB before it enters the library: edit the title, author, category, folder and publication details, and check chapters, character count and images first.',
        'Import several files at once: normal files run automatically and the queue stops only for duplicates, scanned PDFs, encrypted files or parse failures. Parsing can be cancelled, and a wrong PDF password can be retried.',
        'Merge a duplicate import to refresh its content while keeping the folder, category and reading progress — or keep both copies.',
        'PDF illustrations are now extracted completely, including image-only pages with no text layer, and the cover generated during import is actually saved instead of falling back to the default cover.',
        'PDF bookmarks that point two chapters at the same page no longer drop one; a horizontal title page no longer glues its author line to vertical body text; download-site tags are stripped from file-name titles.',
        'The reader\'s source-page label now includes image-only pages and updates immediately when jumping chapters, and import failures explain scanned PDFs, DRM, corrupt files, wrong passwords and out-of-memory separately.',
      ],
    },
  },
  {
    version: '1.7.4',
    date: '2026-10-31',
    items: {
      'zh-CN': [
        '修复部分竖排轻小说与文库本 PDF 导入后假名、标点缺失或注音失败的问题：使用 Type3 字形与 /ActualText 标记的 PDF 现在能完整还原正文。',
        '修复竖排 PDF 中原书自带的小号注音混入正文汉字、旋转的省略号与破折号脱离所在竖列，以及行内数字被误删的问题。',
        '优化安卓无扩展名文件导入时的书名提取与特殊字符文本清理。',
      ],
      en: [
        'Fixed vertical light-novel and bunkobon PDFs losing kana and punctuation or failing annotation when text is stored in Type3 glyphs and /ActualText spans.',
        'Prevented small source ruby in vertical PDFs from merging into base kanji, kept rotated ellipses and dashes inside their columns, and preserved inline numbers.',
        'Cleaned up Android content:// placeholder titles and hardened control-character sanitization across importers.',
      ],
    },
  },
  {
    version: '1.7.3',
    date: '2026-10-30',
    items: {
      'zh-CN': [
        '修复部分横排 PDF 导入后一行一个字的问题：被拆成单个字符的文字会重新拼回整行，两端对齐的宽字距也不会再被拆开。',
        '行数较少的横排页面不再被误判成竖排、读起来顺序错乱。',
      ],
      en: [
        'Fixed some horizontal PDFs importing one character per line: runs split into single glyphs are rejoined, and the wide spacing of justified text no longer breaks a line apart.',
        'Short horizontal pages are no longer mistaken for vertical columns and read out of order.',
      ],
    },
  },
  {
    version: '1.7.2',
    date: '2026-10-30',
    items: {
      'zh-CN': [
        '修复导入竖排（縦書き）PDF 后正文变成一行一个字的问题：竖排文字现在会按从右到左的列重新拼成段落。',
        '竖排 PDF 里的空列和段首缩进现在也能正确分段。',
      ],
      en: [
        'Fixed vertical (tategaki) PDFs importing one character per line: the columns are now rebuilt and read right to left into paragraphs.',
        'Blank columns and indented first lines in a vertical PDF now start new paragraphs.',
      ],
    },
  },
  {
    version: '1.7.1',
    date: '2026-10-29',
    items: {
      'zh-CN': [
        '修复安卓上从文件管理器选择 PDF 后注音失败、阅读器空白的问题：没有扩展名的文件也能按内容识别为 PDF、EPUB 或 DOCX。',
        'PDF 文本层里的无效字符不再让整篇注音失败；连续的 emoji 或生僻字后面的文字不再丢失。',
        '注音没有完成时，阅读器显示原文并说明原因，不再是空白页。',
        '注音颜色更深、字号略大，手机上更容易看清。',
      ],
      en: [
        'Fixed PDFs picked from the Android file manager failing to annotate and leaving the reader blank: files without an extension are now recognised as PDF, EPUB or DOCX by their content.',
        'Invalid characters in a PDF text layer no longer make the whole annotation fail, and text after a run of emoji or rare kanji is no longer lost.',
        'When annotation does not finish, the reader shows the plain text and says why instead of a blank page.',
        'Furigana is darker and slightly larger, easier to read on a phone.',
      ],
    },
  },
  {
    version: '1.7.0',
    date: '2026-10-28',
    items: {
      'zh-CN': [
        '台本库新增文件夹：可以新建、重命名、删除，把书移进不同文件夹（比如严肃文学和轻小说）。',
        '在某个文件夹里导入文件、导入 Pixiv 或新建书，会直接放进当前文件夹；删除文件夹不会删书。',
        '备份导出和导入会带上文件夹和书的归属。',
        'EPUB 导入更干净：外字保留在句子里，着重点、页码标记和隐藏文字不再混入正文，目录页被跳过，脚注接在章节之后。',
        '目录之前的扉页等内容现在会单独成章，不再读不到。',
      ],
      en: [
        'The library now has folders: create, rename and delete them, and move books between them (for example literature and light novels).',
        'Importing a file, a Pixiv novel or a new book while a folder is open puts it straight into that folder; deleting a folder keeps its books.',
        'Library backups now include folders and which folder each book is in.',
        'Cleaner EPUB import: gaiji stay inside the sentence, emphasis dots, page markers and hidden text no longer leak into the text, contents pages are skipped, and footnotes follow their chapter.',
        'Front matter before the first table-of-contents entry now gets its own chapter instead of being unreachable.',
      ],
    },
  },
  {
    version: '1.6.0',
    date: '2026-10-26',
    items: {
      'zh-CN': [
        '批处理：可以从台本库多选书目，一次加入队列。',
        '批量导出新增 EPUB 和 PDF，导出的文件带注音。',
        '从 PDF 导入的书，导出时保持原 PDF 的纸张、横排竖排和字号。',
        '设置里新增「更新内容」，每个版本改了什么都能随时回看。',
      ],
      en: [
        'Batch: pick several books from the library and queue them in one go.',
        'Batch export now also writes EPUB and PDF, furigana included.',
        'Books imported from PDF keep the original paper size, writing direction and font size when exported.',
        'Settings now has release notes, so you can read back what changed in every version.',
      ],
    },
  },
  {
    version: '1.5.5',
    date: '2026-10-25',
    items: {
      'zh-CN': [
        '设备连不上 pixiv 时（例如未开代理），会自动通过中转服务器导入。',
        'pixiv 导入失败时显示具体原因，不再只说网络错误。',
      ],
      en: [
        'When pixiv cannot be reached directly (for example without a proxy), imports go through the relay server automatically.',
        'A failed pixiv import now shows the actual reason instead of a generic network error.',
      ],
    },
  },
  {
    version: '1.5.4',
    date: '2026-10-25',
    items: {
      'zh-CN': [
        '修复在鸿蒙 4 等旧版系统内核的 WebView 上，界面动画导致的崩溃。',
        '应用出错时显示自己的错误页，可以重新加载，也可以直接上传报错日志。',
        '对照翻译逐批显示：第一批更小、回来得快，屏幕上的句子优先翻译。',
      ],
      en: [
        'Fixed crashes caused by interface animations on older WebViews such as HarmonyOS 4.',
        'Errors now open the built-in error page, with a reload button and a one-tap log upload.',
        'Parallel translation now appears batch by batch, so the first lines show up much sooner.',
      ],
    },
  },
];
