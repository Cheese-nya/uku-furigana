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
