export type Locale = 'zh-CN' | 'en';

export interface Translations {
  // Navigation & Header
  appTitle: string;
  scriptMode: string;
  editorTab: string;
  batchTab: string;
  openSidebar: string;
  closeSidebar: string;
  languageLabel: string;

  // Sidebar
  sidebarTitle: string;
  sidebarEditor: string;
  sidebarBatch: string;
  sidebarDeps: string;
  donateAuthor: string;
  supportAuthorTitle: string;
  supportAuthorDesc: string;

  // Banner
  bannerTitle: string;
  bannerSubtitle: string;

  // Options Bar
  rubyModeLabel: string;
  properNounGlossary: string;
  hiragana: string;
  katakana: string;
  romaji: string;
  typographySettings: string;
  bodyFontSize: string;
  rubyFontSize: string;
  lineSpacing: string;

  // Dictionary Status
  dictReady: string;
  dictDegraded: string;
  dictLoading: string;
  dictErrorAlert: string;
  reloadDict: string;

  // Editor Pane
  scriptTitleLabel: string;
  scriptTitlePlaceholder: string;
  importTextButton: string;
  importTextTitle: string;
  clearButton: string;
  inputPlaceholder: string;
  readingScriptProgress: string;

  // Preview Pane
  previewTitle: string;
  linesCount: string;
  previewTip: string;
  annotatingProgress: string;
  annotationComplete: string;
  fallbackModeNote: string;
  annotationFailed: string;
  reviewFailed: string;
  autoSource: string;
  glossarySource: string;
  learnedSource: string;
  originalSource: string;
  manualSource: string;
  needsReviewBadge: string;
  readingRecordsLoading: string;
  learnedContextsBadge: string;
  resetScriptCorrections: string;
  missingReadingsAlert: string;
  suppressedReadingsNote: string;
  prevPage: string;
  nextPage: string;
  previewPageInfo: string;

  // Export Bar
  singleExportTitle: string;
  singleExportDesc: string;
  exportTxt: string;
  exportSrt: string;
  exportDocx: string;
  exportButtonLabel: string;

  // Batch Panel
  batchTitle: string;
  batchDesc: string;
  targetExportFormat: string;
  dragDropPrompt: string;
  dragDropSupport: string;
  selectFiles: string;
  pendingQueue: string;
  clearQueue: string;
  waiting: string;
  processing: string;
  success: string;
  failed: string;
  startBatchProcessing: string;
  batchProcessingInProgress: string;

  // Modals
  // Dependencies Modal
  depModalTitle: string;
  depModalDesc: string;
  depStatusReady: string;
  depStatusError: string;
  depStatusChecking: string;
  depRecheck: string;
  done: string;
  confirm: string;
  cancel: string;
  save: string;
  delete: string;

  // Export Progress Modal
  exportModalProcessing: string;
  exportModalCancelled: string;
  exportModalFailed: string;
  exportModalDownload: string;
  exportModalDone: string;
  generatingProgress: string;
  generatingFile: string;
  waitingForSave: string;
  fileSaved: string;
  downloadHandedOver: string;
  saveCancelled: string;

  // Batch Done Modal
  batchDoneTitle: string;
  totalFiles: string;
  successExport: string;
  cancelledSave: string;
  exportedFilesLabel: string;
  batchDoneNotice: string;

  // Ruby Correction Modal
  rubyModalTitle: string;
  currentCharLabel: string;
  currentRubyLabel: string;
  noRuby: string;
  contextSentenceLabel: string;
  rubyRangeLabel: string;
  extendLeft: string;
  extendRight: string;
  shrinkRange: string;
  rubyRangeTip: string;
  frequentCandidates: string;
  addToGlossaryCheckbox: string;
  customRubyInputLabel: string;
  customRubyInputPlaceholder: string;
  clearRubyButton: string;
  saveAndNextButton: string;

  // Learned Readings Modal
  learnedModalTitle: string;
  learnedModalDesc: string;
  noLearnedRecords: string;
  contextPrefix: string;

  // Glossary Modal
  glossaryModalTitle: string;
  glossaryModalDesc: string;
  importGlossaryButton: string;
  exportGlossaryButton: string;
  editEntryLegend: string;
  addEntryLegend: string;
  sourceTextLabel: string;
  sourceTextPlaceholder: string;
  readingLabel: string;
  readingPlaceholder: string;
  readingFormatLabel: string;
  romajiFormatOption: string;
  saveEntryButton: string;
  cancelEditButton: string;
  searchEntryLabel: string;
  searchEntryPlaceholder: string;
  entryCountSummary: string;
  editButton: string;
  deleteButton: string;
  glossaryUpdatedNotice: string;
  glossaryImportInvalid: string;
  glossaryImportSuccess: string;
  glossaryImportFailed: string;
  glossaryExportSuccess: string;
  glossaryExportCancelled: string;
  glossaryExportFailed: string;

  // Navigation: library, reader, mobile
  libraryTab: string;
  readerTab: string;
  sidebarLibrary: string;
  sidebarReader: string;
  mobileNavEditor: string;
  mobileNavLibrary: string;
  mobileNavReader: string;
  mobileNavBatch: string;
  saveToLibraryButton: string;
  savedToLibraryNotice: string;
  openInReaderButton: string;
  saveToLibrary: string;
  openInReader: string;
  savedToLibraryToast: string;
  untitledScript: string;

  // Library Panel
  libraryTitle: string;
  libraryDesc: string;
  librarySearchPlaceholder: string;
  libraryCategoryAll: string;
  libraryCategoryScript: string;
  libraryCategoryNovel: string;
  libraryCategorySubtitle: string;
  libraryCategoryOther: string;
  libraryFilterFavorites: string;
  libraryImportBook: string;
  libraryNewBook: string;
  libraryExportBackup: string;
  libraryImportBackup: string;
  libraryEmptyState: string;
  libraryBookChapters: string;
  libraryBookLines: string;
  libraryBookProgress: string;
  libraryContinueReading: string;
  libraryStartReading: string;
  libraryEditInStudio: string;
  libraryDeleteBookConfirm: string;
  libraryDeleteBookTitle: string;
  libraryMoreActions: string;
  libraryAddFavorite: string;
  libraryRemoveFavorite: string;
  libraryBookAuthorPlaceholder: string;
  libraryBackupImportedNotice: string;
  libraryBackupExportedNotice: string;
  libraryResetStarterBooks: string;
  libraryMaintenanceMenu: string;
  libraryResetFilters: string;
  libraryBackupImportFailedNotice: string;

  // Batch save modes
  batchSaveModeLabel: string;
  batchSaveModeZip: string;
  batchSaveModeFolder: string;
  batchSaveModeDirect: string;
  batchAlsoSaveLibrary: string;

  // Writing direction & preview typeface
  writingModeLabel: string;
  writingModeHorizontal: string;
  writingModeVertical: string;
  fontGothic: string;
  fontMincho: string;

  // Reader Panel
  readerEmptyTitle: string;
  readerEmptyDesc: string;
  readerGoToLibrary: string;
  readerGoToEditor: string;
  readerBackToLibrary: string;
  readerTocButton: string;
  readerBookmarksButton: string;
  readerSearchButton: string;
  readerSearchPlaceholder: string;
  readerSearchNoResults: string;
  readerSearchResultsCount: string;
  readerThemeLabel: string;
  readerThemeLight: string;
  readerThemeSepia: string;
  readerThemeMint: string;
  readerThemeDark: string;
  readerRubyVisibilityLabel: string;
  readerRubyVisibilityAll: string;
  readerRubyVisibilityTouch: string;
  readerRubyVisibilityReview: string;
  readerRubyVisibilityNone: string;
  readerFontFamilyLabel: string;
  readerFontSans: string;
  readerFontSerif: string;
  readerTtsPlayChapter: string;
  readerTtsStop: string;
  readerTtsSpeed: string;
  readerAddBookmark: string;
  readerRemoveBookmark: string;
  readerNoBookmarks: string;
  readerPrevChapter: string;
  readerNextChapter: string;
  readerChapterProgress: string;
  readerTouchRevealHint: string;
  editorLinkedBookTooltip: string;
  editorUnlinkLabel: string;
  editorUnlinkToast: string;

  // Reader extra controls
  readerLineNumbers: string;
  readerLineNumbersShow: string;
  readerLineNumbersHide: string;
  readerTextAlign: string;
  readerAlignLeft: string;
  readerAlignCenter: string;
  readerRubyColor: string;
  readerRubyColorDefault: string;
  readerRubyColorCustom: string;
  readerEnterFullscreen: string;
  readerExitFullscreen: string;
  readerFullscreenHint: string;

  // Dark mode
  navDarkModeToggle: string;
  settingsTitle: string;
  batchAddFiles: string;
  batchExportAll: string;
  batchStatusDone: string;
  batchStatusQueued: string;
  batchStatusFailed: string;
  batchRemove: string;
  batchEmptyTitle: string;
  batchEmptyBody: string;
  libraryRead: string;
  libraryOpenInEditor: string;
  libraryInfoAndCategory: string;
  libraryCoverLabel: string;
  libraryChooseCover: string;
  libraryDefaultCover: string;
  libraryDelete: string;
  libraryEmptyTitle: string;
  libraryEmptyBody: string;
  libraryFilteredEmptyTitle: string;
  libraryFilteredEmptyBody: string;
  libraryUnread: string;
  libraryNewShort: string;
  libraryCategoryLabel: string;
  librarySortLabel: string;
  scopeOccurrence: string;
  scopeDocument: string;
  scopeRemember: string;
  customRubyPlaceholder: string;
  applyButton: string;
  rubySheetTitle: string;
  typographyShort: string;
  importShort: string;
  previewShort: string;
  themeAuto: string;
  chooseFile: string;
  importFromLibrary: string;
  tapKanjiHint: string;
  sourceLabel: string;
  charsUnit: string;
  statAuto: string;
  statGlossary: string;
  statManual: string;
  rubyLabel: string;
  fontLabel: string;
  fontSizeLabel: string;
  showRubyLabel: string;
  fontMinchoShort: string;
  fontGothicShort: string;
  dictLoadFailed: string;
  dictErrorTitle: string;
  dictErrorBody: string;
  retry: string;
  learnedReadingsMenu: string;
  libraryEmptyPick: string;
  writingModeShort: string;
  appearanceLabel: string;
  themeLight: string;
  themeDark: string;
  dictDiagnose: string;

  // Pixiv Import
  libPixivImportBtn: string;
  libPixivInputPlaceholder: string;
  libPixivFetchBtn: string;
  libPixivFetching: string;
  libPixivImportSuccess: string;
  toolsFreeQuota: string;
  toolsPaid: string;
  toolsModelSummary: string;
  toolsRedetect: string;
  toolsModelSummaryNoKey: string;
  toolsProbeOk: string;
  toolsProbeKey: string;
  toolsProbeLimit: string;
  toolsProbeMissing: string;
  toolsProbeAccount: string;
  toolsProbeLanguage: string;
  toolsSiliconflowVerify: string;
  toolsProbeTimeout: string;
  toolsProbeOther: string;
  toolsDirect: string;
  toolsProxy: string;
  toolsGetKey: string;
  toolsKeyPlaceholder: string;
  toolsPickModel: string;
  toolsFree: string;
  toolsModelsFailed: string;
  toolsTest: string;
  toolsBadKey: string;
  toolsTesting: string;
  toolsTestOk: string;
  toolsTestFail: string;
  toolsLoginOpenRouter: string;
  toolsLoggedIn: string;
  toolsLoginFailed: string;
  readerToc: string;
  readerChapterOf: string;
  readerChapterPercent: string;
  importingFile: string;
  importDone: string;
  importChapters: string;
  importImages: string;
  importRubies: string;
  importFailed: string;
  importRead: string;
  importOk: string;
  lookupDialog: string;
  lookupQuery: string;
  lookupNotFound: string;
  lookupCopy: string;
  lookupCopied: string;
  lookupPreparing: string;
  lookupFailed: string;
  bilingualLabel: string;
  pretranslateTitle: string;
  pretranslateStart: string;
  pretranslatePause: string;
  pretranslateResume: string;
  pretranslateRunning: string;
  pretranslateIdle: string;
  pretranslateDone: string;
  pretranslateDoneDetail: string;
  pretranslateFailed: string;
  translationLineFailed: string;
  translationRetry: string;
  engineMicrosoft: string;
  engineLlm: string;
  toolsTitle: string;
  toolsMenuDetail: string;
  toolsEngine: string;
  toolsEngineMicrosoft: string;
  toolsEngineLlm: string;
  toolsMsNote: string;
  toolsLlmUrl: string;
  toolsLlmModel: string;
  toolsLlmKey: string;
  toolsLlmNote: string;
  toolsTarget: string;
  toolsDicts: string;
  toolsDictBuiltin: string;
  toolsDictImported: string;
  toolsDictCount: string;
  toolsImportDict: string;
  toolsImportingDict: string;
  toolsDictOrderNote: string;
  toolsDeleteDict: string;
  toolsDone: string;
  libraryImportFormats: string;
  libPixivImportError: string;

  // Book Metadata Gear Modal
  libEditMetaAction: string;
  libEditMetaTitle: string;
  libMetaBookTitle: string;
  libMetaAuthor: string;
  libMetaAuthorPlaceholder: string;
  libMetaDescription: string;
  libMetaDescriptionPlaceholder: string;
  libMetaCover: string;
  libMetaCoverUrlPlaceholder: string;
  libMetaCoverUpload: string;
  libMetaCoverClear: string;
  libMetaTheme: string;
  libMetaSave: string;
  libMetaCancel: string;

  // Library sort modes
  librarySortRecent: string;
  librarySortUpdated: string;
  librarySortTitle: string;

  // Workbench & Diagnostics UI strings
  depKuromojiName: string;
  depCorrectionStorageName: string;
  depCorrectionStorageReadyDesc: string;
  rubyColorLabel: string;
  resetTypographyDefaults: string;
  mobileViewModeLabel: string;
  mobileViewInputOnly: string;
  mobileViewPreviewOnly: string;
  mobileViewSplit: string;
  defaultScriptTitle: string;
  rubyCountPrefix: string;
  nextReviewItem: string;
  previewTotalPrefix: string;
  suppressedRubyTitle: string;

  // Feedback & update
  feedbackSection: string;
  feedbackUploadLog: string;
  feedbackSubmitIssue: string;
  feedbackJoinQq: string;
  qqCopied: string;
  updateCheck: string;
  updateChecking: string;
  updateUpToDate: string;
  updateAvailable: string;
  updateDownloading: string;
  updateReady: string;
  updateReadyDesktop: string;
  updateFailed: string;
  updateMeteredHint: string;
  updateOpenReleases: string;
  updateCurrentVersion: string;
  feedbackTitleLog: string;
  feedbackTitleText: string;
  feedbackModeLog: string;
  feedbackModeText: string;
  feedbackLogIntro: string;
  feedbackNoteLabel: string;
  feedbackIssueTitleLabel: string;
  feedbackIssueBodyLabel: string;
  feedbackContactLabel: string;
  feedbackAttachLog: string;
  feedbackLogPreview: string;
  feedbackLogEntries: string;
  feedbackLogLoading: string;
  feedbackPrivacy: string;
  feedbackConsent: string;
  feedbackSend: string;
  feedbackSending: string;
  feedbackSuccess: string;
  feedbackViewIssue: string;
  feedbackErrRateLimited: string;
  feedbackErrTooLarge: string;
  feedbackErrInvalid: string;
  feedbackErrNetwork: string;
  feedbackErrServer: string;
  feedbackRetry: string;
}

export const translations: Record<Locale, Translations> = {
  'zh-CN': {
    appTitle: '浮く',
    scriptMode: '台本模式',
    editorTab: '台本编辑器',
    batchTab: '批量处理中心',
    openSidebar: '打开侧边栏',
    closeSidebar: '关闭侧边栏',
    languageLabel: '语言 / Language',

    sidebarTitle: '浮く',
    sidebarEditor: '台本在线编辑器',
    sidebarBatch: '批量文件处理中心',
    sidebarDeps: '依赖诊断与修复',
    donateAuthor: '打赏作者',
    supportAuthorTitle: '支持作者',
    supportAuthorDesc: '为作者集齐芝士碎片',

    bannerTitle: '日语假名配音台本处理系统',
    bannerSubtitle: '专业高信息密度工作台 • 默认小四字体 (16px) • 高精度上下文消歧注音',

    rubyModeLabel: '注音模式:',
    properNounGlossary: '专名词典',
    hiragana: '平假名',
    katakana: '片假名',
    romaji: '罗马音',
    typographySettings: '排版设置 ▾',
    bodyFontSize: '正文字号:',
    rubyFontSize: '假名字号:',
    lineSpacing: '行间距:',

    dictReady: '离线词典与上下文规则已启用',
    dictDegraded: '基础词表（未加载离线词典）',
    dictLoading: '正在加载离线词典...',
    dictErrorAlert: '离线词典加载失败，当前基础词表可能漏注或误注。请重新加载词典后检查读音。',
    reloadDict: '重新加载',

    scriptTitleLabel: '台本标题:',
    scriptTitlePlaceholder: '输入台本标题（用于 Word 导出标题）',
    importTextButton: '导入文本',
    importTextTitle: '导入 .txt, .srt 或 .docx 文件，将自动将标题设置为文件名',
    clearButton: '清空',
    inputPlaceholder: '请输入日语台本或点击上方「导入文本」...',
    readingScriptProgress: '正在读取台本…',

    previewTitle: '实时假名注音与排版预览',
    linesCount: '行',
    previewTip: '点击汉字修改读音；可扩展标注范围，设置词组整体注音。已有 Word 注音会保留。',
    annotatingProgress: '正在注音',
    annotationComplete: '注音已完成，可校对和导出',
    fallbackModeNote: '当前使用分块兼容模式',
    annotationFailed: '注音失败：',
    reviewFailed: '复核跳转失败：',
    autoSource: '自动',
    glossarySource: '专名词典',
    learnedSource: '语境学习',
    originalSource: '源文件',
    manualSource: '人工确认',
    needsReviewBadge: '待复核',
    readingRecordsLoading: '正在读取校对记录...',
    learnedContextsBadge: '已学语境',
    resetScriptCorrections: '重置此台本校对',
    missingReadingsAlert: '处汉字缺少读音，可点击补充。',
    suppressedReadingsNote: '包含人工选择不注音的文字，不计入缺失读音。',
    prevPage: '上一页',
    nextPage: '下一页',
    previewPageInfo: '预览第',

    singleExportTitle: '单文件导出',
    singleExportDesc: '导出以「{title}」命名的 Word (.docx)、SRT 字幕与 TXT 文本',
    exportTxt: '导出 TXT',
    exportSrt: '导出 SRT',
    exportDocx: '导出 Word (.docx)',
    exportButtonLabel: '导出',

    batchTitle: '台本批量注音与导出',
    batchDesc: '拖拽或选择多个台本文件（支持 .txt, .srt, .docx），系统将根据各自文件名自动生成 Word 标题并注音导出。',
    targetExportFormat: '目标导出格式：',
    dragDropPrompt: '将台本文件拖拽至此处，或点击下方按钮选择',
    dragDropSupport: '支持格式：.txt / .srt / .docx（批量注音时以原文件名作为 Word 标题）',
    selectFiles: '选择文件...',
    pendingQueue: '待处理队列',
    clearQueue: '清空列表',
    waiting: '等待中',
    processing: '注音处理中',
    success: '已成功',
    failed: '失败',
    startBatchProcessing: '开始批量处理并自动保存',
    batchProcessingInProgress: '正在处理队列...',

    depModalTitle: '本地核心组件诊断',
    depModalDesc: '检查当前实际使用的离线词典和校对记录存储状态',
    depStatusReady: '正常',
    depStatusError: '异常',
    depStatusChecking: '检查中...',
    depRecheck: '重新检查',
    done: '完成',
    confirm: '确定',
    cancel: '取消',
    save: '保存修改',
    delete: '删除',

    exportModalProcessing: '正在导出台本',
    exportModalCancelled: '已取消保存',
    exportModalFailed: '导出失败',
    exportModalDownload: '已发起下载',
    exportModalDone: '导出完成',
    generatingProgress: '生成进度',
    generatingFile: '正在生成 {format} 文件...',
    waitingForSave: '请选择保存位置并等待写入完成...',
    fileSaved: '文件已保存。',
    downloadHandedOver: '已交给浏览器下载，请在下载列表中确认结果。',
    saveCancelled: '已取消保存，可以关闭后重新导出。',

    batchDoneTitle: '批量处理完成',
    totalFiles: '总文件数',
    successExport: '成功导出',
    cancelledSave: '取消保存',
    exportedFilesLabel: '已导出文件：',
    batchDoneNotice: '已完成 {count} 个文件的保存或下载请求；浏览器下载请在下载列表中确认。',

    rubyModalTitle: '假名标注与多音字校对',
    currentCharLabel: '当前标注文字',
    currentRubyLabel: '当前注音',
    noRuby: '(无注音)',
    contextSentenceLabel: '所在短句：',
    rubyRangeLabel: '标注范围（词组共享一组居中注音）：',
    extendLeft: '向左扩展',
    extendRight: '向右扩展',
    shrinkRange: '缩小范围',
    rubyRangeTip: '例如选择「二」后向右扩展至「二人」，输入「ふたり」并保存。修改按台本 ID 保存，改标题不会丢失；仅应用于相同原文行。',
    frequentCandidates: '前后文常见候选读音（点击直接套用）：',
    addToGlossaryCheckbox: '加入专名词典，应用于所有台本的同名文字',
    customRubyInputLabel: '自定义注音 (平假名/片假名/罗马音)：',
    customRubyInputPlaceholder: '输入该语境下的准确假名...',
    clearRubyButton: '清除所选文字注音',
    saveAndNextButton: '保存并下一处',

    learnedModalTitle: '本台本语境已学读音',
    learnedModalDesc: '在复核时确认的读音会自动学习所在短句语境。同一台本中处于相同前后文的词语将自动应用，无需重复复核。',
    noLearnedRecords: '暂无已学语境记录',
    contextPrefix: '语境：',

    glossaryModalTitle: '专名词典',
    glossaryModalDesc: '人名、地名和作品专名在所有台本中复用。按原文精确匹配，长词优先；Word 原注音和单处人工校对优先于词典。',
    importGlossaryButton: '导入词典',
    exportGlossaryButton: '导出词典',
    editEntryLegend: '编辑条目',
    addEntryLegend: '添加条目',
    sourceTextLabel: '原文',
    sourceTextPlaceholder: '例如：小日向',
    readingLabel: '读音',
    readingPlaceholder: '例如：こひなた',
    readingFormatLabel: '读音格式',
    romajiFormatOption: '罗马音（其他模式也保留原样）',
    saveEntryButton: '保存条目',
    cancelEditButton: '取消编辑',
    searchEntryLabel: '查找条目',
    searchEntryPlaceholder: '按原文或读音搜索',
    entryCountSummary: '共 {total} 个条目，当前匹配 {visible} 个。',
    editButton: '编辑',
    deleteButton: '删除',
    glossaryUpdatedNotice: '词典已更新，将应用于所有台本。',
    glossaryImportInvalid: '请导入本工具导出的专名词典 JSON',
    glossaryImportSuccess: '导入 {count} 个条目；同名条目保留当前读音。',
    glossaryImportFailed: '导入失败：',
    glossaryExportSuccess: '词典已导出。',
    glossaryExportCancelled: '已取消导出。',
    glossaryExportFailed: '导出失败：',

    libraryTab: '台本库',
    readerTab: '阅读器',
    sidebarLibrary: '台本库',
    sidebarReader: '振假名阅读器',
    mobileNavEditor: '工作台',
    mobileNavLibrary: '台本库',
    mobileNavReader: '阅读器',
    mobileNavBatch: '批处理',
    saveToLibraryButton: '存入台本库',
    savedToLibraryNotice: '已存入台本库，可随时继续阅读或编辑。',
    openInReaderButton: '在阅读器打开',
    saveToLibrary: '存入台本库',
    openInReader: '在阅读器打开',
    savedToLibraryToast: '已存入台本库',
    untitledScript: '未命名台本',

    libraryTitle: '台本库',
    libraryDesc: '把台本、轻小说和字幕收进台本库。支持分类检索、阅读进度、收藏，以及整库 JSON 备份。',
    librarySearchPlaceholder: '搜索台本名、作者或正文片段…',
    libraryCategoryAll: '全部',
    libraryCategoryScript: '台本',
    libraryCategoryNovel: '小说',
    libraryCategorySubtitle: '字幕',
    libraryCategoryOther: '其他',
    libraryFilterFavorites: '只看收藏',
    libraryImportBook: '导入文件',
    libraryNewBook: '新建 / 粘贴',
    libraryExportBackup: '导出台本库',
    libraryImportBackup: '导入台本库',
    libraryEmptyState: '没有符合条件的台本。导入文件、粘贴正文，或恢复示例台本。',
    libraryBookChapters: '{count} 章',
    libraryBookLines: '{count} 行',
    libraryBookProgress: '已读 {percent}%',
    libraryContinueReading: '继续阅读',
    libraryStartReading: '开始阅读',
    libraryEditInStudio: '在工作台编辑',
    libraryDeleteBookConfirm: '确定从台本库删除「{title}」？此操作不可撤销。',
    libraryDeleteBookTitle: '删除台本',
    libraryMoreActions: '更多操作',
    libraryAddFavorite: '加入收藏',
    libraryRemoveFavorite: '取消收藏',
    libraryBookAuthorPlaceholder: '作者（可选）',
    libraryBackupImportedNotice: '台本库备份已导入并合并。',
    libraryBackupExportedNotice: '台本库备份已导出。',
    libraryResetStarterBooks: '恢复示例台本',
    libraryMaintenanceMenu: '备份与维护',
    libraryResetFilters: '清除搜索并重置筛选',
    libraryBackupImportFailedNotice: '备份导入失败：文件格式不正确或已损坏。',

    batchSaveModeLabel: '保存方式',
    batchSaveModeZip: '合并打包 ZIP（一键保存）',
    batchSaveModeFolder: '选择文件夹一键直存',
    batchSaveModeDirect: '浏览器直接下载',
    batchAlsoSaveLibrary: '同时存入台本库',

    writingModeLabel: '排版方向',
    writingModeHorizontal: '横向排版',
    writingModeVertical: '竖向排版',
    fontGothic: 'ゴシック体',
    fontMincho: '明朝体',

    readerEmptyTitle: '还没有打开的台本',
    readerEmptyDesc: '从台本库选一部台本开始沉浸阅读，或先在工作台导入台本再存入台本库。',
    readerGoToLibrary: '去台本库',
    readerGoToEditor: '去工作台',
    readerBackToLibrary: '返回台本库',
    readerTocButton: '目录',
    readerBookmarksButton: '书签',
    readerSearchButton: '搜索',
    readerSearchPlaceholder: '搜索正文或假名…',
    readerSearchNoResults: '未找到匹配的内容，换个关键词试试。',
    readerSearchResultsCount: '{count} 条匹配',
    readerThemeLabel: '阅读主题',
    readerThemeLight: '纯白',
    readerThemeSepia: '羊皮纸',
    readerThemeMint: '豆沙绿',
    readerThemeDark: '夜间',
    readerRubyVisibilityLabel: '注音显示',
    readerRubyVisibilityAll: '全部显示',
    readerRubyVisibilityTouch: '点按显示',
    readerRubyVisibilityReview: '仅重难点',
    readerRubyVisibilityNone: '隐藏注音',
    readerFontFamilyLabel: '正文字体',
    readerFontSans: 'ゴシック体',
    readerFontSerif: '明朝体',
    readerTtsPlayChapter: '朗读本章',
    readerTtsStop: '停止朗读',
    readerTtsSpeed: '语速',
    readerAddBookmark: '加书签',
    readerRemoveBookmark: '取消书签',
    readerNoBookmarks: '还没有书签。在任一行右侧点星标即可收藏。',
    readerPrevChapter: '上一章',
    readerNextChapter: '下一章',
    readerChapterProgress: '第 {current} / {total} 章',
    readerTouchRevealHint: '点按或悬停词组可显示假名；再点已展开的词组可修改读音。',
    editorLinkedBookTooltip: '已链接到台本库，保存时会更新此台本',
    editorUnlinkLabel: '取消关联（另存为新台本）',
    editorUnlinkToast: '已取消关联，保存将创建新台本',

    // Reader extra controls
    readerLineNumbers: '行号标记',
    readerLineNumbersShow: '显示',
    readerLineNumbersHide: '隐藏',
    readerTextAlign: '水平对齐',
    readerAlignLeft: '靠左',
    readerAlignCenter: '居中',
    readerRubyColor: '注音颜色',
    readerRubyColorDefault: '默认',
    readerRubyColorCustom: '自定义',
    readerEnterFullscreen: '全屏',
    readerExitFullscreen: '退出全屏',
    readerFullscreenHint: '单击空白处呼出四角控制栏',

    // Dark mode
    navDarkModeToggle: '切换日间/黑夜模式',
    settingsTitle: '设置',
    batchAddFiles: '添加文件',
    batchExportAll: '全部导出',
    batchStatusDone: '完成',
    batchStatusQueued: '排队中',
    batchStatusFailed: '无法读取',
    batchRemove: '移除',
    batchEmptyTitle: '还没有文件',
    batchEmptyBody: '添加 TXT、DOCX、SRT、EPUB 或 PDF 文件，一次注音并导出。',
    libraryRead: '阅读',
    libraryOpenInEditor: '在工作台打开',
    libraryInfoAndCategory: '信息与分类',
    libraryCoverLabel: '封面',
    libraryChooseCover: '选择图片',
    libraryDefaultCover: '使用默认封面',
    libraryDelete: '删除',
    libraryEmptyTitle: '还没有台本',
    libraryEmptyBody: '导入 TXT、DOCX、SRT、EPUB 或 PDF，也可以粘贴 Pixiv 链接。',
    libraryFilteredEmptyTitle: '这个分类里没有作品',
    libraryFilteredEmptyBody: '换个分类，或者取消“只看收藏”。',
    libraryUnread: '未读',
    libraryNewShort: '新建',
    libraryCategoryLabel: '分类',
    librarySortLabel: '排序',
    scopeOccurrence: '仅此处',
    scopeDocument: '全文同词',
    scopeRemember: '记住',
    customRubyPlaceholder: '自定义读音',
    applyButton: '应用',
    rubySheetTitle: '修改读音',
    typographyShort: '排版',
    importShort: '导入',
    previewShort: '注音预览',
    themeAuto: '自动',
    chooseFile: '选择文件',
    importFromLibrary: '从台本库导入',
    tapKanjiHint: '点汉字可改读音',
    sourceLabel: '原文',
    charsUnit: '字',
    statAuto: '自动',
    statGlossary: '专名',
    statManual: '人工',
    rubyLabel: '注音',
    fontLabel: '字体',
    fontSizeLabel: '字号',
    showRubyLabel: '显示注音',
    fontMinchoShort: '明朝',
    fontGothicShort: '黑体',
    dictLoadFailed: '词典加载失败 · 重试',
    dictErrorTitle: '词典没有加载成功',
    dictErrorBody: '原文已保留。检查存储空间后重试，或先导出不带注音的版本。',
    retry: '重试',
    learnedReadingsMenu: '学到的读音',
    libraryEmptyPick: '台本库里还没有作品',
    writingModeShort: '排版方向',
    appearanceLabel: '外观',
    themeLight: '浅色',
    themeDark: '深色',
    dictDiagnose: '诊断',

    // Pixiv Import
    libPixivImportBtn: 'Pixiv 导入',
    libPixivInputPlaceholder: '粘贴 Pixiv 小说链接或 ID，如 https://www.pixiv.net/novel/show.php?id=20200345',
    libPixivFetchBtn: '导入台本',
    libPixivFetching: '正在获取...',
    libPixivImportSuccess: '已从 Pixiv 导入',
    toolsFreeQuota: '免费额度',
    toolsPaid: '付费',
    toolsModelSummary: '{total} 个模型 · {free} 个免费 · {ok} 个可用',
    toolsRedetect: '重新检测',
    toolsModelSummaryNoKey: '{total} 个模型 · {free} 个免费 · 填入 Key 后检测可用性',
    toolsProbeOk: '✓ 可用',
    toolsProbeKey: 'Key 无效',
    toolsProbeLimit: '限流',
    toolsProbeMissing: '不存在',
    toolsProbeAccount: '账户受限',
    toolsProbeLanguage: '翻译不了',
    toolsSiliconflowVerify: '这是硅基流动拒绝了整个账号（免费模型也一样），不是模型的问题。请在硅基流动控制台检查：账户余额是否为负（欠费会停用所有模型，包括免费模型，充值到不为负即可恢复）、是否已实名认证、这个 Key 是否属于该账号。',
    toolsProbeTimeout: '超时',
    toolsProbeOther: '不可用',
    toolsDirect: '国内直连',
    toolsProxy: '国内可能需要代理',
    toolsGetKey: '获取 Key ↗',
    toolsKeyPlaceholder: '粘贴 Key',
    toolsPickModel: '选择模型',
    toolsFree: '免费',
    toolsModelsFailed: '读取模型列表失败：{error}',
    toolsTest: '测试连接',
    toolsBadKey: 'Key 无效或没有权限',
    toolsTesting: '正在测试…',
    toolsTestOk: '✓ 可以使用 ·「こんにちは。」→「{text}」',
    toolsTestFail: '不能使用：{error}',
    toolsLoginOpenRouter: '用 OpenRouter 账号登录',
    toolsLoggedIn: '✓ 已登录 OpenRouter，Key 已保存',
    toolsLoginFailed: 'OpenRouter 登录失败：{error}',
    readerToc: '目录',
    readerChapterOf: '第 {current} / {total} 章',
    readerChapterPercent: '第 {current} / {total} 章 · {percent}%',
    importingFile: '正在导入 {name}',
    importDone: '已导入《{title}》',
    importChapters: '{count} 章',
    importImages: '{count} 张插图',
    importRubies: '自带注音 {count} 处',
    importFailed: '无法导入 {name}',
    importRead: '阅读',
    importOk: '知道了',
    lookupDialog: '查词',
    lookupQuery: '查询',
    lookupNotFound: '词典里没有找到这个词。可以长按选中更长或更短的一段再查。',
    lookupCopy: '复制',
    lookupCopied: '已复制',
    lookupPreparing: '正在准备词典 {percent}%',
    lookupFailed: '查词失败：{error}',
    bilingualLabel: '对照翻译',
    pretranslateTitle: '整本翻译',
    pretranslateStart: '开始',
    pretranslatePause: '暂停',
    pretranslateResume: '继续',
    pretranslateRunning: '正在后台翻译 · {percent}%',
    pretranslateIdle: '已译 {done} / {total} 句',
    pretranslateDone: '已完成',
    pretranslateDoneDetail: '{total} 句全部译好，离线也能看对照',
    pretranslateFailed: '翻译中断：{error}',
    translationLineFailed: '这一句没有翻译成功',
    translationRetry: '重试',
    engineMicrosoft: '微软翻译',
    engineLlm: '大模型',
    toolsTitle: '翻译与查词',
    toolsMenuDetail: '{engine} · {count} 部词典',
    toolsEngine: '翻译引擎',
    toolsEngineMicrosoft: '微软翻译（免费）',
    toolsEngineLlm: '大模型 API',
    toolsMsNote: '无需注册，国内可直接使用。译文按句缓存在本机，再次打开不重复请求。',
    toolsLlmUrl: '接口地址',
    toolsLlmModel: '模型',
    toolsLlmKey: 'API Key',
    toolsLlmNote: 'Key 只保存在本机，翻译请求由本机直接发给该平台。',
    toolsTarget: '译文语言',
    toolsDicts: '查词词典',
    toolsDictBuiltin: '内置 · {count} · {license}',
    toolsDictImported: '已导入 · {count}',
    toolsDictCount: '{count} 万条',
    toolsImportDict: '导入 Yomitan 词典（.zip）',
    toolsImportingDict: '正在导入词典 {percent}%',
    toolsDictOrderNote: '多部词典按此顺序依次显示，可拖动排序。',
    toolsDeleteDict: '删除词典',
    toolsDone: '完成',
    libraryImportFormats: 'TXT · DOCX · SRT · EPUB · PDF',
    libPixivImportError: 'Pixiv 导入失败',

    // Book Metadata Gear Modal
    libEditMetaAction: '自定义封面与简介',
    libEditMetaTitle: '自定义台本信息',
    libMetaBookTitle: '台本标题',
    libMetaAuthor: '作者（留空则不显示）',
    libMetaAuthorPlaceholder: '输入作者名，留空默认不显示',
    libMetaDescription: '台本简介',
    libMetaDescriptionPlaceholder: '输入台本简介、背景或注意事项...',
    libMetaCover: '封面图片',
    libMetaCoverUrlPlaceholder: '粘贴封面图片 URL 或上传本地图片...',
    libMetaCoverUpload: '上传本地图片',
    libMetaCoverClear: '恢复默认书封',
    libMetaTheme: '书封配色',
    libMetaSave: '保存设置',
    libMetaCancel: '取消',

    librarySortRecent: '最近打开',
    librarySortUpdated: '最近更新',
    librarySortTitle: '按标题',

    depKuromojiName: 'Kuromoji 离线词典',
    depCorrectionStorageName: '校对记录存储',
    depCorrectionStorageReadyDesc: '校对记录已读取；修改后自动保存',
    rubyColorLabel: '假名颜色',
    resetTypographyDefaults: '恢复默认',
    mobileViewModeLabel: '视图模式',
    mobileViewInputOnly: '仅看输入',
    mobileViewPreviewOnly: '仅看预览',
    mobileViewSplit: '上下同屏',
    defaultScriptTitle: '日语假名配音台本',
    rubyCountPrefix: '注音',
    nextReviewItem: '下一处',
    previewTotalPrefix: '共',
    suppressedRubyTitle: '主动不注音',

    // Feedback & update
    feedbackSection: '反馈与更新',
    feedbackUploadLog: '上传报错日志',
    feedbackSubmitIssue: '提交问题',
    feedbackJoinQq: '加入 QQ 群',
    qqCopied: '群号已复制',
    updateCheck: '检查更新',
    updateChecking: '检查中…',
    updateUpToDate: '已是最新',
    updateAvailable: '发现新版本 v{version}',
    updateDownloading: '下载中 {percent}%',
    updateReady: '已下载，点击安装',
    updateReadyDesktop: '已下载，点击重启更新',
    updateFailed: '检查失败，点击重试',
    updateMeteredHint: '当前为移动网络，点击下载',
    updateOpenReleases: '前往下载页',
    updateCurrentVersion: '当前版本 v{version}',
    feedbackTitleLog: '上传报错日志',
    feedbackTitleText: '提交问题',
    feedbackModeLog: '日志',
    feedbackModeText: '文字',
    feedbackLogIntro: '将把应用版本、设备信息和最近的错误记录发送给开发者，不包含台本文字。',
    feedbackNoteLabel: '补充说明（选填）',
    feedbackIssueTitleLabel: '标题',
    feedbackIssueBodyLabel: '问题描述',
    feedbackContactLabel: '联系方式（选填，QQ 或邮箱）',
    feedbackAttachLog: '同时附带技术日志',
    feedbackLogPreview: '日志预览',
    feedbackLogEntries: '{count} 条记录',
    feedbackLogLoading: '正在收集日志…',
    feedbackPrivacy: '提交内容会公开发布到 GitHub issue，请勿填写隐私信息。日志已隐去台本文字，仅含版本、设备与错误信息。',
    feedbackConsent: '我已了解并同意公开提交',
    feedbackSend: '发送',
    feedbackSending: '发送中…',
    feedbackSuccess: '已提交，编号 #{number}',
    feedbackViewIssue: '查看 issue',
    feedbackErrRateLimited: '提交太频繁，请稍后再试',
    feedbackErrTooLarge: '内容过大，请精简后重试',
    feedbackErrInvalid: '内容不符合要求，请检查后重试',
    feedbackErrNetwork: '网络不可用，请检查网络后重试',
    feedbackErrServer: '服务器暂时不可用，请稍后再试',
    feedbackRetry: '重试',
  },
  'en': {
    appTitle: 'Uku Furigana',
    scriptMode: 'Script Mode',
    editorTab: 'Script Editor',
    batchTab: 'Batch Center',
    openSidebar: 'Open sidebar',
    closeSidebar: 'Close sidebar',
    languageLabel: 'Language / 语言',

    sidebarTitle: 'Uku Furigana',
    sidebarEditor: 'Online Script Editor',
    sidebarBatch: 'Batch File Processing',
    sidebarDeps: 'Diagnostics & Repair',
    donateAuthor: 'Support Author',
    supportAuthorTitle: 'Support Author',
    supportAuthorDesc: 'Collect cheese slices for the creator',

    bannerTitle: 'Japanese Furigana Dubbing Workbench',
    bannerSubtitle: 'High-density workbench • 16px standard font • Context-aware reading disambiguation',

    rubyModeLabel: 'Ruby Type:',
    properNounGlossary: 'Glossary',
    hiragana: 'Hiragana',
    katakana: 'Katakana',
    romaji: 'Romaji',
    typographySettings: 'Typography ▾',
    bodyFontSize: 'Font Size:',
    rubyFontSize: 'Ruby Size:',
    lineSpacing: 'Line Spacing:',

    dictReady: 'Offline dictionary and context rules active',
    dictDegraded: 'Basic lexicon (offline dictionary not loaded)',
    dictLoading: 'Loading offline dictionary...',
    dictErrorAlert: 'Failed to load offline dictionary. Missing or fallback readings may occur. Please reload dictionary.',
    reloadDict: 'Reload',

    scriptTitleLabel: 'Title:',
    scriptTitlePlaceholder: 'Script title (used as Word document title)',
    importTextButton: 'Import File',
    importTextTitle: 'Import .txt, .srt or .docx file (sets document title from filename)',
    clearButton: 'Clear',
    inputPlaceholder: 'Enter Japanese script text or click "Import File" above...',
    readingScriptProgress: 'Reading script file...',

    previewTitle: 'Live Furigana & Typesetting Preview',
    linesCount: 'lines',
    previewTip: 'Click Kanji to adjust readings or expand compound bounds. Preserves original Word ruby.',
    annotatingProgress: 'Annotating',
    annotationComplete: 'Annotation complete. Ready for review and export.',
    fallbackModeNote: 'Running in chunked compatibility mode',
    annotationFailed: 'Annotation error: ',
    reviewFailed: 'Review jump failed: ',
    autoSource: 'Auto',
    glossarySource: 'Glossary',
    learnedSource: 'Learned',
    originalSource: 'Original',
    manualSource: 'Manual',
    needsReviewBadge: 'Review',
    readingRecordsLoading: 'Loading corrections database...',
    learnedContextsBadge: 'Learned Contexts',
    resetScriptCorrections: 'Reset script corrections',
    missingReadingsAlert: ' kanji lack readings. Click to provide annotations.',
    suppressedReadingsNote: 'Includes tokens manually chosen without ruby.',
    prevPage: 'Prev Page',
    nextPage: 'Next Page',
    previewPageInfo: 'Preview lines',

    singleExportTitle: 'Single File Export',
    singleExportDesc: 'Export "{title}" to Word (.docx), SRT subtitles or plain TXT',
    exportTxt: 'Export TXT',
    exportSrt: 'Export SRT',
    exportDocx: 'Export Word (.docx)',
    exportButtonLabel: 'Export',

    batchTitle: 'Batch Furigana Processing',
    batchDesc: 'Drop or select multiple script files (.txt, .srt, .docx) to batch annotate and export using filenames as titles.',
    targetExportFormat: 'Target Format:',
    dragDropPrompt: 'Drag & drop script files here, or click to browse',
    dragDropSupport: 'Supported: .txt / .srt / .docx (uses file name as Word title)',
    selectFiles: 'Select Files...',
    pendingQueue: 'Pending Queue',
    clearQueue: 'Clear Queue',
    waiting: 'Pending',
    processing: 'Processing',
    success: 'Done',
    failed: 'Failed',
    startBatchProcessing: 'Start Batch & Auto-Save',
    batchProcessingInProgress: 'Processing Queue...',

    depModalTitle: 'Core Component Diagnostics',
    depModalDesc: 'Inspect the status of offline dictionary and persistent correction storage',
    depStatusReady: 'Ready',
    depStatusError: 'Error',
    depStatusChecking: 'Checking...',
    depRecheck: 'Re-check',
    done: 'Done',
    confirm: 'OK',
    cancel: 'Cancel',
    save: 'Save Changes',
    delete: 'Delete',

    exportModalProcessing: 'Exporting Script',
    exportModalCancelled: 'Save Cancelled',
    exportModalFailed: 'Export Failed',
    exportModalDownload: 'Download Started',
    exportModalDone: 'Export Complete',
    generatingProgress: 'Progress',
    generatingFile: 'Generating {format} file...',
    waitingForSave: 'Please choose destination and wait for writing to finish...',
    fileSaved: 'File saved successfully.',
    downloadHandedOver: 'Passed to browser downloads. Check your browser download tray.',
    saveCancelled: 'File save was cancelled. You can reopen and export anytime.',

    batchDoneTitle: 'Batch Processing Finished',
    totalFiles: 'Total Files',
    successExport: 'Exported',
    cancelledSave: 'Cancelled',
    exportedFilesLabel: 'Exported Files:',
    batchDoneNotice: 'Completed {count} file save or download requests. Please check browser downloads if prompted.',

    rubyModalTitle: 'Furigana & Reading Review',
    currentCharLabel: 'Selected Text',
    currentRubyLabel: 'Current Ruby',
    noRuby: '(No ruby)',
    contextSentenceLabel: 'Context Clause:',
    rubyRangeLabel: 'Span (Tokens share centered ruby):',
    extendLeft: 'Extend Left',
    extendRight: 'Extend Right',
    shrinkRange: 'Shrink',
    rubyRangeTip: 'e.g. Select "二" then extend right to "二人", input "ふたり" and save. Saved by script ID.',
    frequentCandidates: 'Context candidates (click to apply):',
    addToGlossaryCheckbox: 'Add to Glossary (applies globally across all scripts)',
    customRubyInputLabel: 'Custom Reading (Hiragana / Katakana / Romaji):',
    customRubyInputPlaceholder: 'Type precise reading in this context...',
    clearRubyButton: 'Remove ruby for selection',
    saveAndNextButton: 'Save & Next',

    learnedModalTitle: 'Script Learned Context Readings',
    learnedModalDesc: 'Confirmed readings in review will memorize clause contexts and apply to matching sentences in this script automatically.',
    noLearnedRecords: 'No learned context records for this script.',
    contextPrefix: 'Context: ',

    glossaryModalTitle: 'Proper Noun Glossary',
    glossaryModalDesc: 'Names, places, and series terminology shared across all scripts. Literal longest match first; Word original and manual single edits take priority.',
    importGlossaryButton: 'Import Glossary',
    exportGlossaryButton: 'Export Glossary',
    editEntryLegend: 'Edit Entry',
    addEntryLegend: 'Add Entry',
    sourceTextLabel: 'Original Text',
    sourceTextPlaceholder: 'e.g. 小日向',
    readingLabel: 'Reading',
    readingPlaceholder: 'e.g. こひなた',
    readingFormatLabel: 'Format',
    romajiFormatOption: 'Romaji (retained verbatim in other modes)',
    saveEntryButton: 'Save Entry',
    cancelEditButton: 'Cancel Edit',
    searchEntryLabel: 'Search Entries',
    searchEntryPlaceholder: 'Search by text or reading',
    entryCountSummary: '{total} entries total, {visible} matching.',
    editButton: 'Edit',
    deleteButton: 'Delete',
    glossaryUpdatedNotice: 'Glossary updated and applied globally.',
    glossaryImportInvalid: 'Please import a valid Glossary JSON generated by this tool.',
    glossaryImportSuccess: 'Imported {count} entries; preserved existing readings on collision.',
    glossaryImportFailed: 'Import failed: ',
    glossaryExportSuccess: 'Glossary exported.',
    glossaryExportCancelled: 'Export cancelled.',
    glossaryExportFailed: 'Export failed: ',

    libraryTab: 'Script Library',
    readerTab: 'Reader',
    sidebarLibrary: 'Script Library',
    sidebarReader: 'Furigana Reader',
    mobileNavEditor: 'Studio',
    mobileNavLibrary: 'Script Library',
    mobileNavReader: 'Reader',
    mobileNavBatch: 'Batch',
    saveToLibraryButton: 'Save to Script Library',
    savedToLibraryNotice: 'Saved to the Script Library. You can keep reading or editing anytime.',
    openInReaderButton: 'Open in Reader',
    saveToLibrary: 'Save to Script Library',
    openInReader: 'Open in Reader',
    savedToLibraryToast: 'Saved to Script Library',
    untitledScript: 'Untitled Script',

    libraryTitle: 'Script Library',
    libraryDesc: 'Keep scripts, light novels, and subtitles on one shelf. Search by category, track progress, star favorites, and back up the whole library as JSON.',
    librarySearchPlaceholder: 'Search script title, author, or a snippet…',
    libraryCategoryAll: 'All',
    libraryCategoryScript: 'Scripts',
    libraryCategoryNovel: 'Novels',
    libraryCategorySubtitle: 'Subtitles',
    libraryCategoryOther: 'Other',
    libraryFilterFavorites: 'Favorites only',
    libraryImportBook: 'Import file',
    libraryNewBook: 'New / paste',
    libraryExportBackup: 'Export Script Library',
    libraryImportBackup: 'Import Script Library',
    libraryEmptyState: 'No matching scripts. Import a file, paste text, or restore the starter scripts.',
    libraryBookChapters: '{count} chapters',
    libraryBookLines: '{count} lines',
    libraryBookProgress: '{percent}% read',
    libraryContinueReading: 'Continue',
    libraryStartReading: 'Start reading',
    libraryEditInStudio: 'Edit in Studio',
    libraryDeleteBookConfirm: 'Delete “{title}” from the Script Library? This cannot be undone.',
    libraryDeleteBookTitle: 'Delete Script',
    libraryMoreActions: 'More actions',
    libraryAddFavorite: 'Add to Favorites',
    libraryRemoveFavorite: 'Remove from Favorites',
    libraryBookAuthorPlaceholder: 'Author (optional)',
    libraryBackupImportedNotice: 'Script Library backup imported and merged.',
    libraryBackupExportedNotice: 'Script Library backup exported.',
    libraryResetStarterBooks: 'Restore starter scripts',
    libraryMaintenanceMenu: 'Backup & maintenance',
    libraryResetFilters: 'Clear search & reset filters',
    libraryBackupImportFailedNotice: 'Backup import failed: the file is invalid or corrupted.',

    batchSaveModeLabel: 'Save Mode',
    batchSaveModeZip: 'Bundle as ZIP (One-Click)',
    batchSaveModeFolder: 'Save All to Folder',
    batchSaveModeDirect: 'Direct Download',
    batchAlsoSaveLibrary: 'Also Save to Script Library',

    writingModeLabel: 'Direction',
    writingModeHorizontal: 'Horizontal',
    writingModeVertical: 'Vertical (縦書き)',
    fontGothic: 'Gothic (Sans)',
    fontMincho: 'Mincho (Serif)',

    readerEmptyTitle: 'No script open',
    readerEmptyDesc: 'Pick a script from the Script Library, or import one in the studio and save it to the shelf.',
    readerGoToLibrary: 'Go to Script Library',
    readerGoToEditor: 'Go to Studio',
    readerBackToLibrary: 'Back to Script Library',
    readerTocButton: 'Contents',
    readerBookmarksButton: 'Bookmarks',
    readerSearchButton: 'Search',
    readerSearchPlaceholder: 'Search the text or readings…',
    readerSearchNoResults: 'No matching lines found — try a different keyword.',
    readerSearchResultsCount: '{count} matching lines',
    readerThemeLabel: 'Theme',
    readerThemeLight: 'Light',
    readerThemeSepia: 'Sepia',
    readerThemeMint: 'Mint',
    readerThemeDark: 'Night',
    readerRubyVisibilityLabel: 'Ruby',
    readerRubyVisibilityAll: 'Show all',
    readerRubyVisibilityTouch: 'Tap to reveal',
    readerRubyVisibilityReview: 'Hard words only',
    readerRubyVisibilityNone: 'Hide ruby',
    readerFontFamilyLabel: 'Typeface',
    readerFontSans: 'Gothic',
    readerFontSerif: 'Mincho',
    readerTtsPlayChapter: 'Read chapter',
    readerTtsStop: 'Stop reading',
    readerTtsSpeed: 'Speed',
    readerAddBookmark: 'Add bookmark',
    readerRemoveBookmark: 'Remove bookmark',
    readerNoBookmarks: 'No bookmarks yet. Star any line to save it.',
    readerPrevChapter: 'Previous chapter',
    readerNextChapter: 'Next chapter',
    readerChapterProgress: 'Chapter {current} / {total}',
    readerTouchRevealHint: 'Tap or hover a word to reveal its reading. Tap an open word again to correct it.',
    editorLinkedBookTooltip: 'Linked to the Script Library; saving updates this script',
    editorUnlinkLabel: 'Unlink (save as new script)',
    editorUnlinkToast: 'Unlinked; saving will create a new script',

    // Reader extra controls
    readerLineNumbers: 'Line Numbers',
    readerLineNumbersShow: 'Show',
    readerLineNumbersHide: 'Hide',
    readerTextAlign: 'Text Align',
    readerAlignLeft: 'Left',
    readerAlignCenter: 'Center',
    readerRubyColor: 'Furigana Color',
    readerRubyColorDefault: 'Default',
    readerRubyColorCustom: 'Custom',
    readerEnterFullscreen: 'Fullscreen',
    readerExitFullscreen: 'Exit Fullscreen',
    readerFullscreenHint: 'Tap blank canvas to toggle 4-corner controls',

    // Dark mode
    navDarkModeToggle: 'Toggle Light/Dark Mode',
    settingsTitle: 'Settings',
    batchAddFiles: 'Add Files',
    batchExportAll: 'Export All',
    batchStatusDone: 'Done',
    batchStatusQueued: 'Queued',
    batchStatusFailed: 'Failed',
    batchRemove: 'Remove',
    batchEmptyTitle: 'No files yet',
    batchEmptyBody: 'Add TXT, DOCX, SRT, EPUB or PDF files to annotate and export them together.',
    libraryRead: 'Read',
    libraryOpenInEditor: 'Open in Workbench',
    libraryInfoAndCategory: 'Info & Category',
    libraryCoverLabel: 'Cover',
    libraryChooseCover: 'Choose Image',
    libraryDefaultCover: 'Use Default Cover',
    libraryDelete: 'Delete',
    libraryEmptyTitle: 'No scripts yet',
    libraryEmptyBody: 'Import TXT, DOCX, SRT, EPUB or PDF, or paste a Pixiv link.',
    libraryFilteredEmptyTitle: 'Nothing in this category',
    libraryFilteredEmptyBody: 'Try another category, or turn off favourites only.',
    libraryUnread: 'Unread',
    libraryNewShort: 'New',
    libraryCategoryLabel: 'Category',
    librarySortLabel: 'Sort',
    scopeOccurrence: 'This one',
    scopeDocument: 'All in script',
    scopeRemember: 'Remember',
    customRubyPlaceholder: 'Custom reading',
    applyButton: 'Apply',
    rubySheetTitle: 'Change Reading',
    typographyShort: 'Type',
    importShort: 'Import',
    previewShort: 'Ruby Preview',
    themeAuto: 'Auto',
    chooseFile: 'Choose File',
    importFromLibrary: 'From Library',
    tapKanjiHint: 'Tap a kanji to change its reading',
    sourceLabel: 'Source',
    charsUnit: 'chars',
    statAuto: 'Auto',
    statGlossary: 'Glossary',
    statManual: 'Manual',
    rubyLabel: 'Ruby',
    fontLabel: 'Font',
    fontSizeLabel: 'Size',
    showRubyLabel: 'Show Ruby',
    fontMinchoShort: 'Mincho',
    fontGothicShort: 'Gothic',
    dictLoadFailed: 'Dictionary failed · Retry',
    dictErrorTitle: 'The dictionary did not load',
    dictErrorBody: 'Your text is kept. Check storage and retry, or export without ruby for now.',
    retry: 'Retry',
    learnedReadingsMenu: 'Learned Readings',
    libraryEmptyPick: 'The library is empty',
    writingModeShort: 'Direction',
    appearanceLabel: 'Appearance',
    themeLight: 'Light',
    themeDark: 'Dark',
    dictDiagnose: 'Diagnose',

    // Pixiv Import
    libPixivImportBtn: 'Import Pixiv',
    libPixivInputPlaceholder: 'Paste Pixiv novel URL or ID, e.g. https://www.pixiv.net/novel/show.php?id=20200345',
    libPixivFetchBtn: 'Import',
    libPixivFetching: 'Fetching...',
    libPixivImportSuccess: 'Imported from Pixiv',
    toolsFreeQuota: 'free tier',
    toolsPaid: 'paid',
    toolsModelSummary: '{total} models · {free} free · {ok} working',
    toolsRedetect: 'Check again',
    toolsModelSummaryNoKey: '{total} models · {free} free · add a key to check which work',
    toolsProbeOk: '✓ works',
    toolsProbeKey: 'bad key',
    toolsProbeLimit: 'rate-limited',
    toolsProbeMissing: 'not found',
    toolsProbeAccount: 'account restricted',
    toolsProbeLanguage: 'does not translate',
    toolsSiliconflowVerify: 'SiliconFlow is refusing the whole account (free models too), not this model. In the SiliconFlow console check: a negative balance (an overdue account loses every model, free ones included, until topped back to zero or more), real-name verification, and that this key belongs to that account.',
    toolsProbeTimeout: 'timed out',
    toolsProbeOther: 'unavailable',
    toolsDirect: 'Works in mainland China',
    toolsProxy: 'May need a proxy in mainland China',
    toolsGetKey: 'Get a key ↗',
    toolsKeyPlaceholder: 'Paste the key',
    toolsPickModel: 'Choose a model',
    toolsFree: 'free',
    toolsModelsFailed: 'Could not load models: {error}',
    toolsTest: 'Test',
    toolsBadKey: 'invalid key or no access',
    toolsTesting: 'Testing…',
    toolsTestOk: '✓ Works · “こんにちは。” → “{text}”',
    toolsTestFail: 'Not working: {error}',
    toolsLoginOpenRouter: 'Sign in with OpenRouter',
    toolsLoggedIn: '✓ Signed in to OpenRouter, key saved',
    toolsLoginFailed: 'OpenRouter sign-in failed: {error}',
    readerToc: 'Contents',
    readerChapterOf: 'Ch. {current} / {total}',
    readerChapterPercent: 'Ch. {current} / {total} · {percent}%',
    importingFile: 'Importing {name}',
    importDone: 'Imported “{title}”',
    importChapters: '{count} chapters',
    importImages: '{count} illustrations',
    importRubies: '{count} built-in readings',
    importFailed: 'Couldn’t import {name}',
    importRead: 'Read',
    importOk: 'OK',
    lookupDialog: 'Look up',
    lookupQuery: 'Looking up',
    lookupNotFound: 'Not found in the dictionaries. Long-press to select a longer or shorter piece and try again.',
    lookupCopy: 'Copy',
    lookupCopied: 'Copied',
    lookupPreparing: 'Preparing the dictionary {percent}%',
    lookupFailed: 'Lookup failed: {error}',
    bilingualLabel: 'Bilingual',
    pretranslateTitle: 'Translate whole book',
    pretranslateStart: 'Start',
    pretranslatePause: 'Pause',
    pretranslateResume: 'Resume',
    pretranslateRunning: 'Translating in the background · {percent}%',
    pretranslateIdle: '{done} / {total} sentences translated',
    pretranslateDone: 'Done',
    pretranslateDoneDetail: 'All {total} sentences are translated and work offline',
    pretranslateFailed: 'Translation stopped: {error}',
    translationLineFailed: 'This sentence wasn’t translated',
    translationRetry: 'Retry',
    engineMicrosoft: 'Microsoft',
    engineLlm: 'LLM',
    toolsTitle: 'Translation & Lookup',
    toolsMenuDetail: '{engine} · {count} dictionaries',
    toolsEngine: 'Translation engine',
    toolsEngineMicrosoft: 'Microsoft (free)',
    toolsEngineLlm: 'LLM API',
    toolsMsNote: 'No sign-up needed. Translations are cached on this device per sentence, so nothing is requested twice.',
    toolsLlmUrl: 'Endpoint',
    toolsLlmModel: 'Model',
    toolsLlmKey: 'API key',
    toolsLlmNote: 'The key stays on this device; translations go straight from here to the platform.',
    toolsTarget: 'Translate into',
    toolsDicts: 'Dictionaries',
    toolsDictBuiltin: 'Built-in · {count} · {license}',
    toolsDictImported: 'Imported · {count}',
    toolsDictCount: '{count}k entries',
    toolsImportDict: 'Import a Yomitan dictionary (.zip)',
    toolsImportingDict: 'Importing dictionary {percent}%',
    toolsDictOrderNote: 'Results follow this order; drag to reorder.',
    toolsDeleteDict: 'Delete dictionary',
    toolsDone: 'Done',
    libraryImportFormats: 'TXT · DOCX · SRT · EPUB · PDF',
    libPixivImportError: 'Pixiv import failed',

    // Book Metadata Gear Modal
    libEditMetaAction: 'Customize Cover & Info',
    libEditMetaTitle: 'Customize Script Info',
    libMetaBookTitle: 'Script Title',
    libMetaAuthor: 'Author (leave blank to hide)',
    libMetaAuthorPlaceholder: 'Enter author name (hidden if blank)',
    libMetaDescription: 'Synopsis / Description',
    libMetaDescriptionPlaceholder: 'Enter script synopsis or notes...',
    libMetaCover: 'Cover Image',
    libMetaCoverUrlPlaceholder: 'Paste image URL or upload local image...',
    libMetaCoverUpload: 'Upload Image',
    libMetaCoverClear: 'Reset Cover',
    libMetaTheme: 'Cover Theme',
    libMetaSave: 'Save Changes',
    libMetaCancel: 'Cancel',

    librarySortRecent: 'Recent',
    librarySortUpdated: 'Updated',
    librarySortTitle: 'Title',

    depKuromojiName: 'Kuromoji Offline Lexicon',
    depCorrectionStorageName: 'Correction Storage',
    depCorrectionStorageReadyDesc: 'Corrections loaded; automatically saved on edit',
    rubyColorLabel: 'Ruby Color',
    resetTypographyDefaults: 'Reset Defaults',
    mobileViewModeLabel: 'Mobile View',
    mobileViewInputOnly: 'Input',
    mobileViewPreviewOnly: 'Preview',
    mobileViewSplit: 'Split',
    defaultScriptTitle: 'Japanese Furigana Script',
    rubyCountPrefix: 'Ruby',
    nextReviewItem: 'Next',
    previewTotalPrefix: 'total',
    suppressedRubyTitle: 'No Ruby',

    // Feedback & update
    feedbackSection: 'Feedback & Updates',
    feedbackUploadLog: 'Upload Error Log',
    feedbackSubmitIssue: 'Report an Issue',
    feedbackJoinQq: 'Join QQ Group',
    qqCopied: 'Group number copied',
    updateCheck: 'Check for Updates',
    updateChecking: 'Checking…',
    updateUpToDate: 'Up to date',
    updateAvailable: 'Version v{version} available',
    updateDownloading: 'Downloading {percent}%',
    updateReady: 'Downloaded — tap to install',
    updateReadyDesktop: 'Downloaded — tap to restart',
    updateFailed: 'Check failed — tap to retry',
    updateMeteredHint: 'On mobile data — tap to download',
    updateOpenReleases: 'Open download page',
    updateCurrentVersion: 'Current version v{version}',
    feedbackTitleLog: 'Upload Error Log',
    feedbackTitleText: 'Report an Issue',
    feedbackModeLog: 'Log',
    feedbackModeText: 'Text',
    feedbackLogIntro: 'Sends the app version, device info and recent errors to the developer. Script text is never included.',
    feedbackNoteLabel: 'Notes (optional)',
    feedbackIssueTitleLabel: 'Title',
    feedbackIssueBodyLabel: 'Description',
    feedbackContactLabel: 'Contact (optional, QQ or email)',
    feedbackAttachLog: 'Attach technical log',
    feedbackLogPreview: 'Log preview',
    feedbackLogEntries: '{count} entries',
    feedbackLogLoading: 'Collecting logs…',
    feedbackPrivacy: 'Your submission is published publicly as a GitHub issue, so please leave out anything private. The log has script text redacted and only contains version, device and error details.',
    feedbackConsent: 'I understand this will be published publicly',
    feedbackSend: 'Send',
    feedbackSending: 'Sending…',
    feedbackSuccess: 'Submitted as #{number}',
    feedbackViewIssue: 'View issue',
    feedbackErrRateLimited: 'Too many submissions — please try again later',
    feedbackErrTooLarge: 'Content is too large — please trim it and retry',
    feedbackErrInvalid: 'Content was rejected — please check it and retry',
    feedbackErrNetwork: 'Network unavailable — check your connection and retry',
    feedbackErrServer: 'Server is temporarily unavailable — please try again later',
    feedbackRetry: 'Retry',
  },
};
