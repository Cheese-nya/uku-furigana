'use client';

import React, { type Dispatch, type RefObject, type SetStateAction, useState } from 'react';
import { TypographyPopover } from './TypographyPopover';
import type { EditingTokenState } from './RubyCorrectionModal';
import { GlassButton, GlassCapsule } from './glass/GlassButton';
import { GlassPopover, PopoverItem, PopoverSeparator } from './glass/GlassPopover';
import { UpdateDot } from './UpdateDot';
import { LiquidSelector } from './glass/LiquidSelector';
import {
  IconBookmark,
  IconBooks,
  IconChevronLeft,
  IconDictionary,
  IconDoc,
  IconImport,
  IconMoreVertical,
  IconShare,
  IconTextFormat,
  IconWarning,
} from './glass/icons';
import type { ScriptLine } from '../utils/furigana';
import type { BookItem } from '../utils/libraryDatabase';
import type { Translations } from '../utils/i18n';

type Setter<T> = Dispatch<SetStateAction<T>>;
type RubyMode = 'hiragana' | 'katakana' | 'romaji';
type ExportFormat = 'docx' | 'srt' | 'txt';
type FontFamily = 'serif' | 'sans';

const PREVIEW_FONT_STACK: Record<FontFamily, string> = {
  serif: 'var(--font-mincho)',
  sans: '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif',
};
const PAGE_SIZE = 200;

export type RenderSettings = (anchor: HTMLElement | null, open: boolean, close: () => void, extra?: React.ReactNode) => React.ReactNode;

/** All Editor-tab state lives in app/page.tsx (so it survives tab switches); this view only renders it. */
export interface EditorWorkspaceProps {
  t: Translations;
  rubyType: RubyMode;
  setRubyType: Setter<RubyMode>;
  setEditingToken: Setter<EditingTokenState | null>;
  fontSize: number;
  setFontSize: Setter<number>;
  previewFontFamily: FontFamily;
  setPreviewFontFamily: Setter<FontFamily>;
  previewShowRuby: boolean;
  setPreviewShowRuby: Setter<boolean>;
  docTitle: string;
  setDocTitle: Setter<string>;
  rawText: string;
  setRawText: Setter<string>;
  correctionsReady: boolean;
  correctionError: string;
  advanceControllerRef: RefObject<AbortController | null>;
  setIsGlossaryOpen: Setter<boolean>;
  editorFileInputRef: RefObject<HTMLInputElement | null>;
  handleEditorFileImport: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  isImporting: boolean;
  importError: string;
  libraryBooks: BookItem[];
  onImportFromLibrary: (book: BookItem) => void;
  handleSaveToLibrary: () => Promise<void>;
  isExporting: boolean;
  handleExport: (format: ExportFormat) => Promise<void>;
  dictionaryStatus: 'loading' | 'ready' | 'degraded';
  isKuromojiLoading: boolean;
  runDependencyRepair: () => Promise<void>;
  annotatedLines: ScriptLine[];
  isAnnotating: boolean;
  annotationError: string;
  reviewCount: number;
  jumpToNextReview: () => void;
  reviewError: string;
  openTokenEditor: (lineId: string, tokenIndex: number) => void;
  previewPage: number;
  setPreviewPage: Setter<number>;
  renderSettings: RenderSettings;
  /** Yellow dot on the ⋮ button: an update is available. */
  updateDot?: boolean;
}

export function EditorWorkspace(props: EditorWorkspaceProps) {
  const {
    t, rubyType, setRubyType, setEditingToken, fontSize, setFontSize, previewFontFamily, setPreviewFontFamily,
    previewShowRuby, setPreviewShowRuby, correctionsReady, advanceControllerRef, setIsGlossaryOpen,
    editorFileInputRef, handleEditorFileImport, isImporting, importError, libraryBooks, onImportFromLibrary,
    handleSaveToLibrary, isExporting, handleExport, dictionaryStatus, isKuromojiLoading, runDependencyRepair,
    isAnnotating, annotationError, reviewCount, jumpToNextReview, renderSettings, updateDot,
  } = props;

  const [pane, setPane] = useState<'source' | 'preview'>('source');
  const [settingsAnchor, setSettingsAnchor] = useState<HTMLButtonElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [typeAnchor, setTypeAnchor] = useState<HTMLButtonElement | null>(null);
  const [typeOpen, setTypeOpen] = useState<'desktop' | 'phone' | null>(null);
  const [importAnchor, setImportAnchor] = useState<HTMLButtonElement | null>(null);
  const [importOpen, setImportOpen] = useState<'menu' | 'library' | null>(null);
  const [exportAnchor, setExportAnchor] = useState<HTMLButtonElement | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const exportDisabled = isExporting || isKuromojiLoading || isAnnotating || !!annotationError || !correctionsReady;
  const changeRubyType = (value: RubyMode) => { setEditingToken(null); setRubyType(value); };

  // Phones have no room for the ruby-mode segment or 排版 in the toolbar, so they live in the ⋮ menu.
  const phoneSettingsExtra = (
    <>
      <div className="px-2.5 pb-1.5 pt-2">
        <div className="mb-1.5 text-xs font-semibold text-[var(--label-2)]">{t.rubyLabel}</div>
        <LiquidSelector
          variant="solid"
          className="flex w-full [&>[data-opt]]:h-7 [&>[data-opt]]:flex-1 [&>[data-opt]]:px-2 [&>[data-opt]]:text-[13px]"
          role="radiogroup"
          ariaLabel={t.rubyLabel}
          value={rubyType}
          onChange={changeRubyType}
          options={[
            { value: 'hiragana', label: t.hiragana },
            { value: 'katakana', label: t.katakana },
            { value: 'romaji', label: t.romaji },
          ]}
        />
      </div>
      <PopoverItem icon={<IconTextFormat size={17} />} onClick={() => { setSettingsOpen(false); setTypeOpen('phone'); }}>{t.typographyShort}</PopoverItem>
      <PopoverSeparator />
    </>
  );

  return (
    <section className="relative flex min-h-0 flex-1 flex-col">
      {/* Floating toolbar — glass capsules over the scrolling content */}
      <div className="pointer-events-none relative z-20 mb-3 flex items-center gap-2.5 [&>*]:pointer-events-auto">
        <div className="relative md:hidden">
          <GlassButton
            ref={setSettingsAnchor}
            variant="glass"
            icon
            aria-label={t.settingsTitle}
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(open => !open)}
            className="!h-[42px] !w-[42px]"
          >
            <IconMoreVertical size={20} />
          </GlassButton>
          {updateDot && <UpdateDot className="!right-0.5 !top-0.5" />}
        </div>

        <LiquidSelector
          variant="glass"
          className="!hidden h-[42px] !p-1 md:!inline-flex"
          ariaLabel={t.rubyModeLabel}
          value={rubyType}
          onChange={changeRubyType}
          options={[
            { value: 'hiragana', label: t.hiragana },
            { value: 'katakana', label: t.katakana },
            { value: 'romaji', label: t.romaji },
          ]}
        />
        <GlassCapsule className="!hidden md:!inline-flex">
          <GlassButton disabled={!correctionsReady} onClick={() => { advanceControllerRef.current?.abort(); setIsGlossaryOpen(true); }}>
            <IconDictionary />
            <span>{t.properNounGlossary}</span>
          </GlassButton>
          <GlassButton ref={setTypeAnchor} aria-expanded={typeOpen === 'desktop'} onClick={() => setTypeOpen(open => (open ? null : 'desktop'))}>
            <IconTextFormat />
            <span>{t.typographyShort}</span>
          </GlassButton>
        </GlassCapsule>

        <div className="flex-1" />

        {(isKuromojiLoading || dictionaryStatus === 'degraded' || reviewCount > 0) && (
          <GlassCapsule>
            {isKuromojiLoading ? (
              <span className="flex h-9 items-center gap-[7px] px-3.5 text-[13px] font-semibold">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--fill)] border-t-[var(--label)]" />
                <span className="max-md:hidden">{t.dictLoading}</span>
              </span>
            ) : dictionaryStatus === 'degraded' ? (
              <GlassButton onClick={() => { void runDependencyRepair(); }} className="!text-[13px] font-semibold !text-[var(--danger)]">
                <IconWarning />
                <span className="max-md:hidden">{t.dictLoadFailed}</span>
              </GlassButton>
            ) : (
              <GlassButton onClick={jumpToNextReview} className="!text-[13px] font-semibold !text-[var(--review)]">
                <span className="tabular-nums">{t.needsReviewBadge} {reviewCount}</span>
              </GlassButton>
            )}
          </GlassCapsule>
        )}

        <GlassCapsule>
          <GlassButton
            ref={setImportAnchor}
            disabled={!correctionsReady || isImporting}
            aria-haspopup="dialog"
            aria-expanded={importOpen !== null}
            onClick={() => setImportOpen(open => (open ? null : 'menu'))}
          >
            <IconImport />
            <span>{t.importShort}</span>
          </GlassButton>
        </GlassCapsule>
        <GlassButton
          ref={setExportAnchor}
          variant="prominent"
          data-testid="workbench-export-submit-btn"
          disabled={exportDisabled}
          aria-haspopup="dialog"
          aria-expanded={exportOpen}
          onClick={() => setExportOpen(open => !open)}
          className="!h-[42px] !px-[18px]"
        >
          <IconShare />
          <span>{t.exportButtonLabel}</span>
        </GlassButton>
      </div>

      <input type="file" ref={editorFileInputRef} onChange={handleEditorFileImport} accept=".txt,.srt,.docx,.epub,.pdf" className="hidden" />

      <h1 className="mx-1 mb-3.5 mt-1.5 text-[34px] font-bold tracking-[-0.02em] md:hidden">{t.mobileNavEditor}</h1>
      <div className="mb-3 md:hidden">
        <LiquidSelector
          variant="solid"
          ariaLabel={t.mobileViewModeLabel}
          value={pane}
          onChange={setPane}
          options={[
            { value: 'source', label: t.sourceLabel },
            { value: 'preview', label: t.previewShort },
          ]}
        />
      </div>

      {isImporting && <p role="status" className="mb-3 text-xs text-[var(--label-2)]">{t.readingScriptProgress}</p>}
      {importError && <p role="alert" className="mb-3 text-xs font-medium text-[var(--danger)]">{importError}</p>}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2">
        <SourceCard {...props} hidden={pane !== 'source'} />
        <PreviewCard {...props} hidden={pane !== 'preview'} />
      </div>

      {renderSettings(settingsAnchor, settingsOpen, () => setSettingsOpen(false), phoneSettingsExtra)}

      <TypographyPopover
        open={typeOpen !== null}
        onClose={() => setTypeOpen(null)}
        anchor={typeOpen === 'phone' ? settingsAnchor : typeAnchor}
        fontFamily={previewFontFamily}
        onFontFamilyChange={setPreviewFontFamily}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        showRuby={previewShowRuby}
        onShowRubyChange={setPreviewShowRuby}
        t={t}
      />

      <GlassPopover open={importOpen !== null} onClose={() => setImportOpen(null)} anchor={importAnchor} ariaLabel={t.importTextButton}>
        {importOpen === 'library' ? (
          <>
            <PopoverItem icon={<IconChevronLeft size={17} />} onClick={() => setImportOpen('menu')}>{t.importFromLibrary}</PopoverItem>
            <PopoverSeparator />
            <div className="max-h-[50vh] overflow-y-auto">
              {libraryBooks.length === 0 && <p className="px-3 py-2 text-xs text-[var(--label-2)]">{t.libraryEmptyPick}</p>}
              {libraryBooks.map(book => (
                <PopoverItem key={book.bookId} icon={<IconDoc size={17} />} onClick={() => { setImportOpen(null); onImportFromLibrary(book); }}>
                  {book.title}
                </PopoverItem>
              ))}
            </div>
          </>
        ) : (
          <>
            <PopoverItem icon={<IconImport size={17} />} detail="TXT · DOCX · SRT" onClick={() => { setImportOpen(null); editorFileInputRef.current?.click(); }}>
              {t.chooseFile}
            </PopoverItem>
            <PopoverItem icon={<IconBooks size={17} />} onClick={() => setImportOpen('library')}>{t.importFromLibrary}</PopoverItem>
          </>
        )}
      </GlassPopover>

      <GlassPopover open={exportOpen} onClose={() => setExportOpen(false)} anchor={exportAnchor} ariaLabel={t.exportButtonLabel}>
        {(['txt', 'srt', 'docx'] as const).map(format => (
          <PopoverItem
            key={format}
            data-testid={`export-format-option-${format}`}
            icon={<IconDoc size={17} />}
            onClick={() => { setExportOpen(false); void handleExport(format); }}
          >
            .{format.toUpperCase()}
          </PopoverItem>
        ))}
        <PopoverSeparator />
        <PopoverItem icon={<IconBookmark size={17} />} onClick={() => { setExportOpen(false); void handleSaveToLibrary(); }}>{t.saveToLibrary}</PopoverItem>
      </GlassPopover>
    </section>
  );
}

const CARD = 'flex min-h-0 flex-col overflow-hidden rounded-[18px] bg-[var(--surface)] shadow-[var(--card-shadow)]';

function SourceCard({ t, hidden, docTitle, setDocTitle, rawText, setRawText, setEditingToken, correctionsReady, isImporting }: EditorWorkspaceProps & { hidden: boolean }) {
  const lineCount = rawText ? rawText.split('\n').length : 0;
  const characterCount = rawText.replace(/\s/g, '').length;
  return (
    <div className={`${CARD} ${hidden ? 'max-md:hidden' : ''}`}>
      <div className="flex items-baseline gap-2.5 px-5 pt-4">
        <span className="text-xs font-semibold tracking-[0.02em] text-[var(--label-2)]">{t.sourceLabel}</span>
        <span className="text-xs tabular-nums text-[var(--label-3)]">{lineCount} {t.linesCount} · {characterCount} {t.charsUnit}</span>
      </div>
      <input
        type="text"
        value={docTitle}
        disabled={!correctionsReady || isImporting}
        onChange={event => setDocTitle(event.target.value)}
        placeholder={t.scriptTitlePlaceholder}
        className="w-full border-0 bg-transparent px-5 pb-2.5 pt-1.5 text-[22px] font-bold tracking-[-0.01em] text-[var(--label)] outline-none placeholder:text-[var(--label-3)] disabled:opacity-50"
      />
      <textarea
        value={rawText}
        spellCheck={false}
        disabled={!correctionsReady || isImporting}
        onChange={event => { setEditingToken(null); setRawText(event.target.value); }}
        placeholder={t.inputPlaceholder}
        className="min-h-0 w-full flex-1 resize-none overflow-y-auto overscroll-contain border-0 bg-transparent px-5 pb-5 pt-1 text-base leading-[1.95] text-[var(--label)] outline-none placeholder:text-[var(--label-3)] disabled:opacity-50"
      />
    </div>
  );
}

function PreviewCard({
  t, hidden, annotatedLines, isAnnotating, isKuromojiLoading, dictionaryStatus, annotationError, reviewError, correctionError,
  reviewCount, jumpToNextReview, openTokenEditor, previewPage, setPreviewPage, fontSize, previewFontFamily, previewShowRuby,
  runDependencyRepair,
}: EditorWorkspaceProps & { hidden: boolean }) {
  const previewStart = Math.min(previewPage * PAGE_SIZE, Math.max(0, Math.floor((annotatedLines.length - 1) / PAGE_SIZE) * PAGE_SIZE));
  const counts = annotatedLines.reduce(
    (acc, line) => {
      for (const token of line.tokens) {
        if (!token.ruby) continue;
        if (token.readingSource === 'glossary') acc.glossary += 1;
        else if (token.readingSource === 'manual') acc.manual += 1;
        else acc.auto += 1;
      }
      return acc;
    },
    { auto: 0, glossary: 0, manual: 0 },
  );
  const failed = dictionaryStatus === 'degraded' || Boolean(annotationError || reviewError || correctionError);
  const loading = !failed && (isKuromojiLoading || isAnnotating);

  return (
    <div className={`${CARD} ${hidden ? 'max-md:hidden' : ''}`}>
      <div className="flex items-baseline gap-2.5 px-5 pt-4">
        <span className="text-xs font-semibold tracking-[0.02em] text-[var(--label-2)]">{t.previewShort}</span>
        <span className="text-xs text-[var(--label-3)]">{t.tapKanjiHint}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b-[0.5px] border-[color:var(--sep)] px-5 pb-3 pt-1.5 text-xs text-[var(--label-2)]">
        {loading && annotatedLines.length === 0 ? (
          <span>{t.dictLoading}</span>
        ) : failed ? (
          <span className="text-[var(--danger)]">{annotationError || reviewError || correctionError || t.dictErrorTitle}</span>
        ) : (
          <>
            <span>{t.statAuto} <b className="font-semibold tabular-nums text-[var(--label)]">{counts.auto}</b></span>
            <span>{t.statGlossary} <b className="font-semibold tabular-nums text-[var(--label)]">{counts.glossary}</b></span>
            <span>{t.statManual} <b className="font-semibold tabular-nums text-[var(--label)]">{counts.manual}</b></span>
            {reviewCount > 0 && (
              <button type="button" onClick={jumpToNextReview} className="ml-auto font-semibold tabular-nums text-[var(--review)]">
                {t.needsReviewBadge} {reviewCount} · {t.nextReviewItem}
              </button>
            )}
          </>
        )}
      </div>

      <div lang="ja" className="min-h-0 flex-1 overflow-auto overscroll-contain px-5 pb-5 pt-1" style={{ fontFamily: PREVIEW_FONT_STACK[previewFontFamily] }}>
        {loading && annotatedLines.length === 0 ? (
          <div aria-label={t.annotatingProgress}>
            {[92, 70, 84, 58].map(width => (
              <div key={width} className="my-[22px] h-3.5 animate-pulse rounded-full bg-[var(--fill)]" style={{ width: `${width}%` }} />
            ))}
          </div>
        ) : failed ? (
          <div className="grid min-h-[300px] place-items-center text-center text-[var(--label-2)]">
            <div>
              <IconWarning size={46} className="mx-auto text-[var(--label-3)]" />
              <h3 className="mb-1.5 mt-3.5 text-xl font-semibold text-[var(--label)]">{t.dictErrorTitle}</h3>
              <p className="mx-auto mb-[18px] max-w-[280px] text-sm leading-relaxed">{t.dictErrorBody}</p>
              <button type="button" className="btn btn-ink" onClick={() => { void runDependencyRepair(); }}>{t.retry}</button>
            </div>
          </div>
        ) : (
          <div className={isAnnotating ? 'opacity-60' : undefined}>
            {annotatedLines.slice(previewStart, previewStart + PAGE_SIZE).map(line => (
              <div
                key={line.id}
                className="script-line border-b-[0.5px] border-[color:var(--sep)] py-3 last:border-0"
                style={{ fontSize: `${Math.max(fontSize, 14) + 1}px`, lineHeight: 2.25 }}
              >
                {line.speaker && <span className="font-semibold text-[var(--label-2)]">{line.speaker}：</span>}
                {line.tokens.length === 0 && <br />}
                {line.tokens.map((token, tokenIndex) => {
                  if (!token.ruby && !token.hasKanji) return <span key={tokenIndex}>{token.surface}</span>;
                  const rtColor = token.needsReview ? 'var(--review)' : token.readingSource === 'manual' ? 'var(--ok)' : 'var(--ruby)';
                  return (
                    <ruby
                      key={tokenIndex}
                      id={`ruby-token-${line.id}-${tokenIndex}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => openTokenEditor(line.id, tokenIndex)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openTokenEditor(line.id, tokenIndex);
                        }
                      }}
                      className={`cursor-pointer rounded-[4px] transition-colors hover:bg-[var(--fill-2)] ${
                        token.needsReview ? 'underline decoration-[var(--review)] decoration-dotted decoration-2 underline-offset-[5px]' : ''
                      }`}
                    >
                      {token.surface}
                      {token.ruby && (
                        <rt className="select-none text-[0.5em] font-medium tracking-[0.02em]" style={{ color: rtColor, visibility: previewShowRuby ? 'visible' : 'hidden' }}>
                          {token.ruby}
                        </rt>
                      )}
                    </ruby>
                  );
                })}
              </div>
            ))}
            {annotatedLines.length > PAGE_SIZE && (
              <div className="flex items-center justify-between gap-3 pt-3 text-xs text-[var(--label-2)]">
                <button type="button" disabled={previewStart === 0} className="btn h-8 text-xs" onClick={() => setPreviewPage(Math.max(0, previewStart / PAGE_SIZE - 1))}>{t.prevPage}</button>
                <span className="tabular-nums">{previewStart + 1}–{Math.min(previewStart + PAGE_SIZE, annotatedLines.length)} / {annotatedLines.length}</span>
                <button type="button" disabled={previewStart + PAGE_SIZE >= annotatedLines.length} className="btn h-8 text-xs" onClick={() => setPreviewPage(previewStart / PAGE_SIZE + 1)}>{t.nextPage}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
