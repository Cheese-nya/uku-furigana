import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../app/components/ReaderPanel.tsx', import.meta.url)),
  'utf8',
);

const line = readFileSync(fileURLToPath(new URL('../app/components/ReaderLine.tsx', import.meta.url)), 'utf8');

// app/page.tsx was split: its Editor view, sidebar items, library and batch logic now live in
// these files, so page-level source assertions read them all together.
const readPageSplitSource = () => [
  '../app/page.tsx',
  '../app/components/EditorWorkspace.tsx',
  '../app/components/Sidebar.tsx',
  '../app/hooks/useLibraryController.ts',
  '../app/hooks/useBatchProcessing.ts',
].map(path => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')).join('\n');

const read = path => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const typography = read('../app/components/TypographyPopover.tsx');
const settings = read('../app/components/SettingsMenu.tsx');
const editor = read('../app/components/EditorWorkspace.tsx');
const correction = read('../app/components/RubyCorrectionModal.tsx');
const mobileNav = read('../app/components/MobileNavBar.tsx');
const sidebar = read('../app/components/Sidebar.tsx');

test('阅读器：沉浸式正文 + 底部玻璃胶囊（返回、标题与进度、注音开关、Aa）', () => {
  assert.ok(source.includes('data-testid="reader-script-canvas"'));
  assert.match(source, /max-w-\[34em\]/, '34em reading column');
  assert.ok(source.includes('useGlass'), 'capsule uses the refracting glass material');
  assert.ok(source.includes('onGoToLibrary'), 'back button returns to the library');
  assert.ok(source.includes('<IconRuby'), 'ruby toggle');
  assert.ok(source.includes('<TypographyPopover'), 'Aa popover');
  assert.equal(source.includes('sticky top-0'), false, 'no sticky top header');
});

test('阅读器：下滑按累计距离隐藏胶囊，上滑/点按/到顶到底出现，隐藏时底部 2px 进度线', () => {
  assert.ok(/travel\s*>\s*24/.test(source) && /travel\s*<\s*-12/.test(source));
  assert.ok(source.includes('handleCanvasClick') && source.includes('setHudVisible(prev => !prev)'));
  assert.ok(source.includes('y >= max - 4 || y < 40'));
  assert.ok(source.includes('bottom-1 left-[22px] right-[22px]'), 'bottom progress line');
});

test('阅读器 Aa：注音方式、排版方向（竖排）、字体、字号、显示注音', () => {
  assert.ok(source.includes('writingMode={prefs.writingMode}'), 'reader passes the writing direction');
  assert.ok(source.includes('vertical-script-flow'), 'vertical writing kept');
  assert.ok(source.includes("const PREFS_KEY = 'furigana_reader_prefs_v3';"));
  assert.ok(typography.includes('reader-writing-mode-toggle'), 'writing-direction segment');
  for (const key of ['t.fontLabel', 't.fontSizeLabel', 't.showRubyLabel', 'role="switch"']) {
    assert.ok(typography.includes(key), `typography popover needs ${key}`);
  }
});

test('阅读器：样稿以外的功能已删除', () => {
  for (const removed of ['showLineNumbers', 'textAlign', 'customRubyColor', 'RUBY_COLOR_SWATCHES', 'sepia', 'mint', 'requestFullscreen',
    'reader-fullscreen-btn', 'touch_reveal', 'review_only', 'speechSynthesis', 'bookmark', 'searchHits']) {
    assert.equal(source.includes(removed), false, `ReaderPanel must not contain ${removed}`);
  }
  const emojis = source.match(/\p{Extended_Pictographic}/gu) ?? [];
  assert.deepEqual(emojis, []);
});

test('阅读器：说话人标签与正文开头去重', () => {
  assert.ok(line.includes('const speaker = line.speaker || speakerMatch?.[1];'));
  assert.ok(line.includes('text.startsWith(speaker)'));
});

test('工作台：样稿工具条 + 导出选格式（含存入台本库）+ 右上角导入（文件 / 台本库）', () => {
  assert.ok(editor.includes('data-testid="workbench-export-submit-btn"'));
  assert.ok(editor.includes('export-format-option-'));
  assert.ok(editor.includes('handleExport(format)'));
  assert.ok(editor.includes('handleSaveToLibrary()'), 'save to library lives in the export menu');
  assert.ok(editor.includes('t.importFromLibrary') && editor.includes('t.chooseFile'), 'import: choose file or from library');
  assert.ok(editor.includes('<IconMoreVertical'), 'round ⋮ settings button at top-left on phones');
  assert.ok(editor.includes('t.tapKanjiHint') && editor.includes('t.statAuto'), 'preview card header and stats');
  for (const removed of ['setPreviewWritingMode', 'rubyColor', 'setLineSpacing', 'editor-pixiv-toggle', 't.clearButton', "'split'", 'handleOpenInReader']) {
    assert.equal(editor.includes(removed), false, `EditorWorkspace must not contain ${removed}`);
  }
});

test('改读音面板：候选、自定义、仅此处/全文同词/记住、取消/应用', () => {
  for (const key of ['t.scopeOccurrence', 't.scopeDocument', 't.scopeRemember', 't.customRubyPlaceholder', 't.applyButton', 't.cancel']) {
    assert.ok(correction.includes(key), `correction sheet needs ${key}`);
  }
  for (const removed of ['restoreAutomaticRuby', 'saveAndOpenNextReview', 'resizeRubyRange']) {
    assert.equal(correction.includes(removed), false, `correction sheet must not contain ${removed}`);
  }
});

test('设置菜单：语言、外观（自动/浅色/深色）、学到的读音、专名词典、词典状态', () => {
  for (const key of ['t.languageLabel', 't.themeAuto', 't.themeLight', 't.themeDark', 't.learnedReadingsMenu', 't.properNounGlossary', 'dictionaryLabel']) {
    assert.ok(settings.includes(key), `settings menu needs ${key}`);
  }
  for (const removed of ['x.com', 'github.com', 'reward_qrcode', 'v1.2.0', 'sidebarDeps']) {
    assert.equal(settings.includes(removed), false, `settings menu must not contain ${removed}`);
  }
});

test('外壳：桌面玻璃侧栏，手机 52px 玻璃 Tab 栏（无额外按钮）', () => {
  assert.ok(sidebar.includes('data-testid="app-brand-title"'));
  assert.ok(sidebar.includes('t.settingsTitle'), 'sidebar keeps the mockup settings row');
  assert.ok(mobileNav.includes('h-[52px]') && mobileNav.includes('className={`glass') && mobileNav.includes('<LiquidSelector'));
  assert.equal(mobileNav.includes('IconGear'), false, 'no extra settings button next to the tab bar');
});

test('iPhone 竖屏锁定', () => {
  const infoPlist = read('../ios/App/App/Info.plist');
  const sceneDelegate = read('../ios/App/App/SceneDelegate.swift');
  // 4. iPhone portrait-only orientation lock
  const iphoneOrientationBlock = infoPlist.slice(
    infoPlist.indexOf('<key>UISupportedInterfaceOrientations</key>'),
    infoPlist.indexOf('<key>UISupportedInterfaceOrientations~ipad</key>'),
  );
  assert.ok(
    iphoneOrientationBlock.includes('<string>UIInterfaceOrientationPortrait</string>'),
    'iPhone must support Portrait',
  );
  assert.equal(
    iphoneOrientationBlock.includes('UIInterfaceOrientationLandscapeLeft'),
    false,
    'iPhone must not support LandscapeLeft by default',
  );
  assert.equal(
    iphoneOrientationBlock.includes('UIInterfaceOrientationLandscapeRight'),
    false,
    'iPhone must not support LandscapeRight by default',
  );
  assert.ok(
    sceneDelegate.includes('supportedInterfaceOrientations'),
    'SceneDelegate FuriganaBridgeViewController must override supportedInterfaceOrientations',
  );
});

test('上下滑动到底防黑条：Web/iOS/Android 全链路同步画布底色并禁用原生外层回弹与安全区内边距错位', () => {
  const pageSource = readFileSync(
    fileURLToPath(new URL('../app/page.tsx', import.meta.url)),
    'utf8',
  );
  const themeHookSource = readFileSync(
    fileURLToPath(new URL('../app/hooks/useThemeMode.ts', import.meta.url)),
    'utf8',
  );
  const pageAndThemeSource = `${pageSource}\n${themeHookSource}`;
  const capacitorConfigSource = readFileSync(
    fileURLToPath(new URL('../capacitor.config.ts', import.meta.url)),
    'utf8',
  );
  // Generated by `cap sync` and git-ignored, so a fresh clone does not have it yet.
  const iosCapConfigPath = fileURLToPath(new URL('../ios/App/App/capacitor.config.json', import.meta.url));
  const iosCapConfig = existsSync(iosCapConfigPath) ? JSON.parse(readFileSync(iosCapConfigPath, 'utf8')) : null;
  const sceneDelegate = readFileSync(
    fileURLToPath(new URL('../ios/App/App/SceneDelegate.swift', import.meta.url)),
    'utf8',
  );
  const mainActivity = readFileSync(
    fileURLToPath(new URL('../android/src/com/cheese/uku/MainActivity.java', import.meta.url)),
    'utf8',
  );

  // 2. iOS Capacitor configures backgroundColor & disables outer UIScrollView bounce and syncs furiganaTheme
  assert.ok(
    capacitorConfigSource.includes("backgroundColor: '#F2F2F7'"),
    'capacitor.config.ts must set ios.backgroundColor to #F2F2F7',
  );
  if (iosCapConfig) {
    assert.equal(
      iosCapConfig.ios?.backgroundColor,
      '#F2F2F7',
      'ios/App/App/capacitor.config.json must set ios.backgroundColor to #F2F2F7 (re-run cap sync)',
    );
  }
  assert.ok(
    sceneDelegate.includes('capacitorDidLoad'),
    'SceneDelegate must override capacitorDidLoad to re-apply background after CAPBridgeViewController.prepareWebView',
  );
  assert.ok(
    sceneDelegate.includes('webView.scrollView.bounces = false'),
    'SceneDelegate must disable outer WKWebView scrollView bounce',
  );
  assert.ok(
    sceneDelegate.includes('furiganaTheme'),
    'SceneDelegate must register furiganaTheme WKScriptMessageHandler to sync native window/underPage color',
  );
  assert.ok(
    pageAndThemeSource.includes('furiganaTheme'),
    'app/page.tsx / useThemeMode.ts must notify native furiganaTheme handler when theme changes',
  );

  // 3. Android MainActivity disables WebView overscroll and syncs status/navigation bar color
  assert.ok(
    mainActivity.includes('OVER_SCROLL_NEVER'),
    'Android MainActivity must disable WebView overscroll glow',
  );
  assert.ok(
    mainActivity.includes('syncTheme'),
    'Android MainActivity must expose syncTheme on AndroidBridge',
  );
});

test('复合词基字不被宽读音撑开：globals.css 全局设置 ruby-align: center', () => {
  const globalsCss = readFileSync(
    fileURLToPath(new URL('../app/globals.css', import.meta.url)),
    'utf8',
  );

  // Chrome 默认 `space-around` 会在读音比基字宽时把「約束」「教室」撑成「約 束」「教 室」。
  const rubyAlignMatches = globalsCss.match(/^ruby\s*\{[^}]*ruby-align:\s*center;[^}]*\}/gm) ?? [];
  assert.equal(
    rubyAlignMatches.length > 0,
    true,
    'app/globals.css must declare a global `ruby { ruby-align: center; }` rule',
  );
  assert.equal(
    globalsCss.includes('ruby-align: space-around'),
    false,
    'app/globals.css must not opt back into space-around ruby alignment',
  );

  // 阅读器画布与工作台预览共用同一条全局规则，无需在 .script-line 之外重复声明。
  assert.ok(
    globalsCss.includes('.script-line ruby'),
    'app/globals.css must keep the scoped .script-line ruby rule',
  );
});

test('<ruby> 永远保持行内（WebKit 对块级 ruby 会丢失或错位 <rt>）', () => {
  for (const file of ['RubyCorrectionModal.tsx', 'EditorWorkspace.tsx', 'ReaderPanel.tsx']) {
    const component = readFileSync(fileURLToPath(new URL(`../app/components/${file}`, import.meta.url)), 'utf8');
    for (const match of component.matchAll(/<ruby\b[^>]*className="([^"]*)"/g)) {
      assert.doesNotMatch(match[1], /(^|\s)(block|inline-block|flex|grid)(\s|$)/, `${file}: <ruby> must not be block-level`);
    }
  }
});
