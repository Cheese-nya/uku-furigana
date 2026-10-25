# Reading tools v3: PDF/EPUB import, word lookup, bilingual reading

Approved design: `docs/mockups/reading-tools-v3.html` (demo buttons at the top switch scenes).
Branch: `feat/reading-tools`. Code style: TypeScript, 2-space indent, single quotes, comments only
where the reason is not obvious (match `app/utils/docxImporter.ts`). Tests: `node --test tests/*.test.mjs`,
TypeScript modules are loaded with `tests/loadTypescript.mjs`; `@xmldom/xmldom` stands in for DOMParser.

## Decisions (from the user)

- PDF and EPUB become plain text in the existing book pipeline (library → reader / workbench).
  EPUB keeps its illustrations and its own ルビ (as `RubyOverride`s). Scanned PDFs (no text layer)
  are rejected with a clear error.
- Lookup is our own engine (Yomitan is GPL-3.0 and cannot be embedded in a PolyForm-NC app), but it
  reads **Yomitan-format dictionary zips**. The bundled dictionary is wty ja→zh (Wiktionary via kaikki,
  ~187k entries, CC BY-SA 4.0) and ships inside the app. Users may import other Yomitan zips.
- Translation: Microsoft Edge's free endpoint by default, optional OpenAI-compatible LLM. Reader only.
  **Per sentence**: every sentence is followed by its translation (left of it in vertical writing).
  Whole-book background pre-translation, cached so it also works offline.

## Shared formats

### Image lines (EPUB illustrations)

A content line that is exactly `￼` + image id (e.g. `￼img-3`) stands for an illustration.
`app/utils/bookAssets.ts` exports `IMAGE_LINE = /^￼(img-\d+)$/`. The annotator leaves such lines
alone; the reader renders them as `<figure>`. Image bytes live in IndexedDB (not in the library JSON).

### ImportedBook (returned by the EPUB and PDF importers)

```ts
export interface ImportedBookImage { id: string; mime: string; data: Uint8Array }
export interface ImportedBook {
  title: string;
  author: string;
  text: string;                  // lines joined with '\n'; image lines as above
  overrides: RubyOverride[];     // see app/utils/rubyOverrides.ts: { line, start, surface, reading, type: 'hiragana' }
  chapters: { title: string; startLine: number }[];
  images: ImportedBookImage[];
  cover?: { mime: string; data: Uint8Array };
}
export class ScannedPdfError extends Error {}
```

### Token analysis (from the kuromoji worker, used by lookup)

```ts
export interface AnalyzedToken {
  surface: string; basicForm: string; reading: string;
  pos: string; posDetail: string; conjugatedForm: string;
  start: number; end: number;    // offsets in the analysed text
}
```

### Lookup result

```ts
export interface DictEntry { dict: string; term: string; reading: string; tags: string[]; glosses: string[]; examples: [string, string][]; score: number }
export interface LookupResult {
  start: number; end: number;    // highlighted range in the line (includes trailing auxiliaries)
  query: string;                 // text.slice(start, end)
  lemma: string;                 // dictionary form that matched
  inflections: string[];         // e.g. ['masu'] / ['past'] / ['te'], mapped to labels by the UI
  entries: DictEntry[];          // ordered by dictionary order, then score
}
```

### Translation settings (localStorage `uku-translation-settings-v1`)

```ts
{ engine: 'microsoft' | 'llm'; target: 'zh-Hans' | 'zh-Hant' | 'en';
  llm: { baseUrl: string; model: string; apiKey: string } }
```

Microsoft endpoint (verified 2026-10-25, CORS `*`, no auth):
`POST https://edge.microsoft.com/translate/translatetext?from=ja&to=zh-Hans&isEnterpriseClient=false`
with a JSON array of strings; response `[{ translations: [{ text, to }] }, …]` in the same order.

## Work split

| Part | Owner | Files |
| --- | --- | --- |
| A. EPUB + PDF importers | worker | `app/utils/epubImporter.ts`, `app/utils/pdfImporter.ts`, `app/utils/bookAssets.ts` (types + IMAGE_LINE only), tests |
| B. Dictionary build, store, lookup | worker | `scripts/build-dictionary.mjs`, `app/utils/yomitanFormat.ts`, `app/utils/dictionaryStore.ts`, `app/utils/lookup.ts`, tests |
| C. Sentences, translation engines, cache, pre-translate | worker | `app/utils/sentences.ts`, `app/utils/translation.ts`, `app/utils/translationStore.ts`, tests |
| D. Integration and UI (library import, reader lookup card, bilingual rendering, Aa, settings sheet, i18n, worker `analyze`, asset storage, notices) | leader | everything else |
