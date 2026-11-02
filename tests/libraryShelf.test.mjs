import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../app/components/LibraryPanel.tsx', import.meta.url)),
  'utf8',
);

test('备份、维护与示例恢复入口已从台本库移除', () => {
  for (const removed of ['libraryMaintenanceMenu', 'libraryExportBackup', 'libraryImportBackup', 'onExportBackup', 'onImportBackup', 'onResetStarterBooks', 'application/json']) {
    assert.equal(source.includes(removed), false, `LibraryPanel must not contain ${removed}`);
  }
});

test('台本库：网格容器（无书架背景、无分隔线）', () => {
  assert.ok(source.includes('data-testid="apple-books-shelf"'), 'apple-books-shelf testid required');
  const shelf = source.slice(source.indexOf('data-testid="apple-books-shelf"'));
  const shelfTag = shelf.slice(0, shelf.indexOf('>'));
  for (const cls of ['grid-cols-2', 'sm:grid-cols-3', 'md:grid-cols-4', 'lg:grid-cols-5']) {
    assert.ok(shelfTag.includes(cls), `shelf grid must include ${cls}`);
  }
  for (const gone of ['shelf-row-divider', 'book-silk-band', 'book-leather', 'book-3d-spine-groove', 'book-cover-color-band']) {
    assert.equal(source.includes(gone), false, `leather shelf leftover ${gone} must be gone`);
  }
});

test('台本库：竖排排版封面（明朝体标题、分类底色、底边阅读进度）', () => {
  assert.ok(source.includes('data-testid="script-book-cover"'), 'script-book-cover testid required');
  assert.ok(source.includes('aspect-[3/4.2]'), 'cover keeps the 3 / 4.2 book ratio');
  assert.ok(source.includes('vertical-rl'), 'title is set vertically');
  assert.ok(source.includes('var(--font-mincho)'), 'cover title uses the Mincho face');
  for (const colour of ['#26324A', '#4B5D3A', '#9A4A28', '#5B3550', '#3D4450']) {
    assert.ok(source.includes(colour), `cover theme colour ${colour} required`);
  }
  assert.ok(source.includes('role="progressbar"'), 'reading progress bar required');
  assert.ok(source.includes('book.format'), 'format (TXT/SRT/DOCX) shown in meta');
  assert.ok(source.includes('IconStarFill'), 'favourite shown with the SVG star icon');
  assert.ok(source.includes('var(--spring-bouncy)'), 'cover press / lift springs back');
});

test('台本库：玻璃工具条与右键/长按菜单', () => {
  assert.ok(source.includes('<LiquidSelector'), 'categories use the liquid selector');
  assert.ok(source.includes('<GlassPopover'), 'sort / new / book actions use glass popovers');
  assert.ok(source.includes('onOpenInReader(book)'), 'cover opens the script in the reader');
  assert.ok(source.includes('onOpenInEditor('), 'menu can open the script in the editor');
  assert.ok(source.includes('onDeleteBook(deleteTarget.bookId)'), 'menu can delete the book (after confirmation)');
  assert.ok(source.includes('confirmDeleteId'), 'two-step delete confirmation state required');
  assert.ok(source.includes('data-testid="book-delete-dialog"'), 'delete confirmation dialog required');
  assert.ok(source.includes('data-testid="book-settings-gear-btn"'), 'info & category entry required');
  assert.ok(source.includes('data-testid="book-meta-modal"'), 'book-meta-modal required');
  assert.ok(source.includes('event.stopPropagation()'), 'menu actions must not also open the book');
  assert.equal(source.includes('★'), false, 'no star glyph; use SVG star');
  assert.equal(source.includes('☆'), false, 'no outline star glyph; use SVG star');
});

test('LibraryPanel.tsx 不含任何 Extended_Pictographic emoji', () => {
  const emojis = [...source.matchAll(/\p{Extended_Pictographic}/gu)].map(match => match[0]);
  assert.deepEqual(emojis, [], `expected zero emojis, found: ${emojis.join(' ')}`);
  // Star / arrow glyphs must be replaced by monoline SVG icons too.
  assert.equal(source.includes('★'), false, 'no star glyph; use SVG star');
  assert.equal(source.includes('☆'), false, 'no outline star glyph; use SVG star');
});

test('台本库：Pixiv 导入沿用原封面，信息与分类可自定义封面', () => {
  for (const id of ['pixiv-import-toggle-btn', 'pixiv-url-input', 'pixiv-import-submit-btn', 'book-meta-modal', 'book-settings-gear-btn']) {
    assert.ok(source.includes(`"${id}"`), `${id} required`);
  }
  assert.ok(source.includes('book.coverUrl'), 'cover image shown when the book has one (Pixiv imports carry it)');
  assert.ok(source.includes('coverUrl: infoDraft.coverUrl'), 'info & category saves a custom cover');
  assert.ok(source.includes('t.libraryChooseCover') && source.includes('t.libraryDefaultCover'), 'choose / reset cover controls');
  for (const removed of ['description', 'coverTheme']) {
    assert.equal(source.includes(removed), false, `LibraryPanel must not contain ${removed}`);
  }
});

const pageSource = `${readFileSync(
  fileURLToPath(new URL('../app/page.tsx', import.meta.url)),
  'utf8',
)}\n${readFileSync(
  fileURLToPath(new URL('../app/components/SettingsMenu.tsx', import.meta.url)),
  'utf8',
)}`;


test('设置菜单包含自动/浅色/深色外观切换', () => {
  assert.ok(pageSource.includes('testId="dark-mode-toggle"'), 'dark-mode-toggle required');
  for (const key of ["value: 'auto'", "value: 'light'", "value: 'dark'"]) assert.ok(pageSource.includes(key), key);
});

test('移动端玻璃 Tab 栏与底部弹出面板', () => {
  const mobileNavSource = readFileSync(
    fileURLToPath(new URL('../app/components/MobileNavBar.tsx', import.meta.url)),
    'utf8',
  );
  const modalSource = readFileSync(
    fileURLToPath(new URL('../app/components/Modal.tsx', import.meta.url)),
    'utf8',
  );
  assert.ok(mobileNavSource.includes('data-testid="mobile-nav-bar"'), 'MobileNavBar must include mobile-nav-bar testid');
  assert.ok(mobileNavSource.includes('className={`glass'), 'MobileNavBar must use the glass material');
  assert.ok(mobileNavSource.includes('safe-area-inset-bottom'), 'MobileNavBar must respect safe-area-inset-bottom');
  assert.ok(modalSource.includes('max-sm:rounded-t-[34px]'), 'Modal must render as bottom sheet on mobile screens');
  assert.ok(modalSource.includes('max-sm:translate-y-full'), 'bottom sheet slides up from the bottom');
  assert.ok(modalSource.includes('sm:hidden'), 'Modal must include mobile-only bottom sheet grabber pill');
});

test('查找卡关闭时完全滑出安全区，不在屏幕底部露边', () => {
  const lookupSource = readFileSync(
    fileURLToPath(new URL('../app/components/LookupCard.tsx', import.meta.url)),
    'utf8',
  );
  const offset = lookupSource.match(/translate-y-\[calc\(100%\+(\d+)px\)\]/);
  assert.ok(offset, 'closed lookup card must translate by its own height plus an offset');
  // The card rests at `bottom: max(8px, env(safe-area-inset-bottom))`, so the
  // closed offset must clear that inset; 24px (iPad) left a 4px sliver visible.
  assert.ok(Number(offset[1]) >= 40, `closed offset ${offset[1]}px must clear the safe-area inset`);
});

test('批处理与弹窗：新设计系统、无 emoji', () => {
  for (const file of ['BatchProcessingPanel.tsx', 'ExportProgressModal.tsx', 'BatchDoneModal.tsx', 'GlossaryModal.tsx', 'LearnedReadingsModal.tsx']) {
    const componentSource = readFileSync(fileURLToPath(new URL(`../app/components/${file}`, import.meta.url)), 'utf8');
    assert.ok(/var\(--(label|surface|fill)/.test(componentSource) || /\bbtn\b/.test(componentSource), `${file} must use the design tokens`);
    const emojis = [...componentSource.matchAll(/\p{Extended_Pictographic}/gu)].map(match => match[0]);
    assert.deepEqual(emojis, [], `${file} expected zero emojis, found: ${emojis.join(' ')}`);
  }
  const batch = readFileSync(fileURLToPath(new URL('../app/components/BatchProcessingPanel.tsx', import.meta.url)), 'utf8');
  for (const removed of ['batchSaveMode', 'alsoSaveToLibrary', 'setBatchTargetFormat', 'clearBatchFiles']) {
    assert.equal(batch.includes(removed), false, `batch page must not contain ${removed}`);
  }
  assert.ok(batch.includes('processBatchQueue(format)'), 'export all picks the format');
});

test('深色模式与回弹防白边', () => {
  const globalsSource = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');
  const layoutSource = readFileSync(fileURLToPath(new URL('../app/layout.tsx', import.meta.url)), 'utf8');
  const sceneDelegateSource = readFileSync(fileURLToPath(new URL('../ios/App/App/SceneDelegate.swift', import.meta.url)), 'utf8');
  assert.match(globalsSource, /html\.dark,\s*\n\[data-theme="dark"\] \{[\s\S]*?--surface: #1C1C1E/, 'dark tokens defined');
  assert.match(globalsSource, /overscroll-behavior:\s*none/, 'globals.css should prevent rubber-band white edge exposure');
  assert.doesNotMatch(layoutSource, /<body[^>]*bg-zinc-50/, 'app/layout.tsx <body> must not have bg-zinc-50');
  assert.match(sceneDelegateSource, /underPageBackgroundColor/, 'SceneDelegate.swift should set WKWebView underPageBackgroundColor');
});
