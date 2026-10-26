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
