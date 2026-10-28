import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { loadTypescript } from './loadTypescript.mjs';

globalThis.DOMParser = DOMParser;

const { importEpub } = loadTypescript('../app/utils/epubImporter.ts');
const { IMAGE_LINE, imageLine } = loadTypescript('../app/utils/bookAssets.ts');
const { validateRubyOverrides } = loadTypescript('../app/utils/rubyOverrides.ts');

async function buildEpubBuffer(files) {
  const zip = new JSZip();
  const containerXml =
    files['META-INF/container.xml'] ??
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  zip.file('META-INF/container.xml', containerXml);
  for (const [path, content] of Object.entries(files)) {
    if (path === 'META-INF/container.xml') continue;
    zip.file(path, content);
  }
  return zip.generateAsync({ type: 'arraybuffer' });
}

test('importEpub extracts ruby with final line and accurate start offsets', async () => {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
  <metadata>
    <dc:title>吾輩は猫である</dc:title>
    <dc:creator>夏目漱石</dc:creator>
  </metadata>
  <manifest>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>`;

  const ch1 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Ignored Head</title><style>body { color: black; }</style></head>
<body>
  <p>
    　<ruby>吾輩<rp>（</rp><rt>わがはい</rt><rp>）</rp></ruby>は
    <ruby><rb>猫</rb><rt>ネコ</rt></ruby>である。<br/>
    <ruby>名前<rt>なまえ</rt></ruby>はまだ<ruby>無<rt></rt></ruby><ruby>い<rt>い</rt></ruby>。
  </p>
  <p>English
    words and 日本語
    テスト。</p>
  <script>console.log("ignore me");</script>
</body>
</html>`;

  const buf = await buildEpubBuffer({
    'OEBPS/content.opf': opf,
    'OEBPS/text/ch1.xhtml': ch1,
  });

  const book = await importEpub(buf, 'wagahai.epub', new DOMParser());
  assert.equal(book.title, '吾輩は猫である');
  assert.equal(book.author, '夏目漱石');
  assert.equal(
    book.text,
    ['　吾輩は猫である。', '名前はまだ無い。', 'English words and 日本語テスト。'].join('\n'),
  );
  assert.deepEqual(book.overrides, [
    {
      line: '　吾輩は猫である。',
      start: 1,
      surface: '吾輩',
      reading: 'わがはい',
      type: 'hiragana',
    },
    {
      line: '　吾輩は猫である。',
      start: 4,
      surface: '猫',
      reading: 'ねこ',
      type: 'hiragana',
    },
    {
      line: '名前はまだ無い。',
      start: 0,
      surface: '名前',
      reading: 'なまえ',
      type: 'hiragana',
    },
  ]);
  assert.equal(validateRubyOverrides(book.overrides).length, 3);
});

test('importEpub handles cover detection, cover-page skipping, images, and deduplication', async () => {
  const coverBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const img1Bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const img2Bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38]);

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
  <metadata></metadata>
  <manifest>
    <item id="cov-img" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="cov-page" href="text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="extra" href="text/extra.xhtml" media-type="application/xhtml+xml"/>
    <item id="ill1" href="images/ill1.png" media-type="image/png"/>
    <item id="ill2" href="images/ill2.gif" media-type="image/gif"/>
  </manifest>
  <spine>
    <itemref idref="cov-page"/>
    <itemref idref="ch1"/>
    <itemref idref="extra" linear="no"/>
  </spine>
</package>`;

  const coverXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink">
<body>
  <div><svg><image xlink:href="../images/cover.jpg"/></svg></div>
</body>
</html>`;

  const ch1Xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body>
  <h1>第一章</h1>
  <p>最初の段落<img src="../images/ill1.png"/>続きの文</p>
  <figure><svg><image href="../images/ill2.gif"/></svg></figure>
  <p><img src="../images/ill1.png"/></p>
  <p><img src="../images/missing.png"/></p>
</body>
</html>`;

  const extraXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>スキップされる</p></body></html>`;

  const buf = await buildEpubBuffer({
    'OEBPS/content.opf': opf,
    'OEBPS/images/cover.jpg': coverBytes,
    'OEBPS/images/ill1.png': img1Bytes,
    'OEBPS/images/ill2.gif': img2Bytes,
    'OEBPS/text/cover.xhtml': coverXhtml,
    'OEBPS/text/ch1.xhtml': ch1Xhtml,
    'OEBPS/text/extra.xhtml': extraXhtml,
  });

  const book = await importEpub(buf, 'my-novel.epub', new DOMParser());
  assert.equal(book.title, 'my-novel');
  assert.equal(book.author, '');
  assert.ok(book.cover);
  assert.equal(book.cover.mime, 'image/jpeg');
  assert.deepEqual(Array.from(book.cover.data), Array.from(coverBytes));

  assert.equal(book.images.length, 2);
  assert.equal(book.images[0].id, 'img-1');
  assert.equal(book.images[0].mime, 'image/png');
  assert.deepEqual(Array.from(book.images[0].data), Array.from(img1Bytes));
  assert.equal(book.images[1].id, 'img-2');
  assert.equal(book.images[1].mime, 'image/gif');

  const expectedLines = [
    '第一章',
    '最初の段落',
    imageLine('img-1'),
    '続きの文',
    imageLine('img-2'),
    imageLine('img-1'),
  ];
  assert.equal(book.text, expectedLines.join('\n'));
  assert.match(expectedLines[2], IMAGE_LINE);
  assert.deepEqual(book.chapters, [{ title: '第一章', startLine: 0 }]);
});

test('importEpub resolves EPUB3 nav TOC chapters with fragments and deduplicates startLine', async () => {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
  <metadata><dc:title>TOC Book</dc:title></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="text/ch%201.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`;

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="text/ch%201.xhtml">第一章</a></li>
      <li><a href="text/ch%201.xhtml#top">第一章（重複）</a></li>
      <li><a href="text/ch%201.xhtml#sec-2">第一節</a></li>
      <li><a href="text/ch%201.xhtml#missing">存在しない</a></li>
      <li><a href="text/ch2.xhtml#part-b">第二章後半</a></li>
    </ol>
  </nav>
</body>
</html>`;

  const ch1 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body>
  <h1 id="top">第一章の見出し</h1>
  <p>導入の段落。</p>
  <section id="sec-2">
    <h2>第一節の見出し</h2>
    <p>第一節の本文。</p>
  </section>
</body>
</html>`;

  const ch2 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body>
  <h1>第二章の見出し</h1>
  <p id="part-b">後半の段落。</p>
</body>
</html>`;

  const buf = await buildEpubBuffer({
    'OEBPS/content.opf': opf,
    'OEBPS/nav.xhtml': nav,
    'OEBPS/text/ch 1.xhtml': ch1,
    'OEBPS/text/ch2.xhtml': ch2,
  });

  const book = await importEpub(buf, 'toc.epub', new DOMParser());
  assert.deepEqual(book.chapters, [
    { title: '第一章', startLine: 0 },
    { title: '第一節', startLine: 2 },
    { title: '第二章後半', startLine: 5 },
  ]);
});

test('importEpub falls back to NCX TOC and meta cover when EPUB2 format is used', async () => {
  const coverBytes = new Uint8Array([1, 2, 3]);
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <metadata>
    <dc:title>EPUB2 Book</dc:title>
    <meta name="cover" content="cover-id"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover-id" href="cover.png" media-type="image/png"/>
    <item id="p1" href="p1.xhtml" media-type="application/xhtml+xml"/>
    <item id="p2" href="p2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="p1"/>
    <itemref idref="p2"/>
  </spine>
</package>`;

  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="np1" playOrder="1">
      <navLabel><text>序章</text></navLabel>
      <content src="p1.xhtml"/>
    </navPoint>
    <navPoint id="np2" playOrder="2">
      <navLabel><text>本編</text></navLabel>
      <content src="p2.xhtml#sub"/>
    </navPoint>
  </navMap>
</ncx>`;

  const p1 = `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>序章テキスト</p></body></html>`;
  const p2 = `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>前置き</p><h2 id="sub">本編開始</h2></body></html>`;

  const buf = await buildEpubBuffer({
    'OEBPS/content.opf': opf,
    'OEBPS/toc.ncx': ncx,
    'OEBPS/cover.png': coverBytes,
    'OEBPS/p1.xhtml': p1,
    'OEBPS/p2.xhtml': p2,
  });

  const book = await importEpub(buf, 'epub2.epub', new DOMParser());
  assert.equal(book.cover?.mime, 'image/png');
  assert.deepEqual(book.chapters, [
    { title: '序章', startLine: 0 },
    { title: '本編', startLine: 2 },
  ]);
});

test('importEpub replaces named HTML entities when strict XHTML parsing fails', async () => {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Entities</dc:title></metadata>
  <manifest>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;

  const c1 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body>
  <p>&ldquo;こんにちは&rdquo;&mdash;世界&hellip;&nbsp;テスト</p>
</body>
</html>`;

  const buf = await buildEpubBuffer({
    'OEBPS/content.opf': opf,
    'OEBPS/c1.xhtml': c1,
  });

  let xhtmlAttempts = 0;
  const strictXmlParser = {
    parseFromString(source, type) {
      if (type === 'application/xhtml+xml') {
        xhtmlAttempts += 1;
        if (/&(nbsp|mdash|hellip|ldquo|rdquo);/.test(source)) {
          return new DOMParser().parseFromString('<parsererror>Undefined entity</parsererror>', 'application/xml');
        }
      }
      return new DOMParser().parseFromString(source, type);
    },
  };

  const book = await importEpub(buf, 'entities.epub', strictXmlParser);
  assert.equal(xhtmlAttempts, 2);
  assert.equal(book.text, '“こんにちは”—世界…\u00A0テスト');
});

test('importEpub rejects encrypted EPUBs and empty EPUBs', async () => {
  const encryptedBuf = await buildEpubBuffer({
    'META-INF/encryption.xml': `<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
            xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:CipherData><enc:CipherReference URI="OEBPS/text/ch1.xhtml"/></enc:CipherData>
  </enc:EncryptedData>
</encryption>`,
    'OEBPS/content.opf': `<package xmlns="http://www.idpf.org/2007/opf"><metadata/><manifest/><spine/></package>`,
  });

  await assert.rejects(
    () => importEpub(encryptedBuf, 'drm.epub', new DOMParser()),
    { message: '不支持加密的 EPUB' },
  );

  const emptyBuf = await buildEpubBuffer({
    'OEBPS/content.opf': `<package xmlns="http://www.idpf.org/2007/opf">
      <metadata/>
      <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="c1"/></spine>
    </package>`,
    'OEBPS/c1.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>   </p></body></html>`,
  });

  await assert.rejects(
    () => importEpub(emptyBuf, 'empty.epub', new DOMParser()),
    { message: 'EPUB 中没有可读的正文' },
  );
});

const OPF_NAV = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>テスト</dc:title></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="g" href="gaiji/1-2.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="nav"/><itemref idref="c1"/></spine>
</package>`;

test('importEpub keeps gaiji inside the sentence, drops bouten/pagebreak/hidden text and the nav page', async () => {
  const c1 = `﻿<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
  <h1>第一章</h1>
  <p>彼は<img class="gaiji" src="gaiji/1-2.png" alt="躾"/>を受けた。</p>
  <p>これは<img src="gaiji/1-2.png" style="height:1em"/>です。</p>
  <p>強調は<ruby>ここ<rt>・・</rt></ruby>と<ruby>漢字<rt>かんじ</rt></ruby>。</p>
  <span epub:type="pagebreak" id="p12">12</span>
  <p style="display:none">隠れた文</p>
  <p>　</p>
  <p>&#160;</p>
  <p>終わり</p>
</body></html>`;
  const nav = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
  <nav epub:type="toc"><ol><li><a href="c1.xhtml">第一章</a></li></ol></nav></body></html>`;
  const buf = await buildEpubBuffer({
    'OEBPS/content.opf': OPF_NAV,
    'OEBPS/nav.xhtml': nav,
    'OEBPS/c1.xhtml': c1,
    'OEBPS/gaiji/1-2.png': new Uint8Array([0x89, 0x50]),
  });
  const book = await importEpub(buf, 't.epub', new DOMParser());
  assert.equal(
    book.text,
    ['第一章', '彼は躾を受けた。', 'これはです。', '強調はここと漢字。', '終わり'].join('\n'),
  );
  assert.equal(book.images.length, 0);
  assert.deepEqual(book.overrides.map(o => o.surface), ['漢字']);
  assert.deepEqual(book.chapters, [{ title: '第一章', startLine: 0 }]);
});

test('importEpub accepts EPUBs whose only encryption is font obfuscation', async () => {
  const buf = await buildEpubBuffer({
    'META-INF/encryption.xml': `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
    <enc:CipherData><enc:CipherReference URI="OEBPS/font.otf"/></enc:CipherData></enc:EncryptedData>
</encryption>`,
    'OEBPS/content.opf': `<package xmlns="http://www.idpf.org/2007/opf"><metadata/>
      <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`,
    'OEBPS/c1.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>読める</p></body></html>`,
  });
  assert.equal((await importEpub(buf, 'f.epub', new DOMParser())).text, '読める');
});

test('importEpub handles a light-novel style EPUB: contents page, footnotes, spacers, bouten, multi-ruby', async () => {
  const JSZipLocal = JSZip;
  const X = (b) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja"><head><meta charset="UTF-8"/><title>x</title><link rel="stylesheet" href="../style/s.css"/></head><body class="p-text">${b}</body></html>`;
  const z = new JSZipLocal();
  z.file('mimetype','application/epub+zip');
  z.file('META-INF/container.xml',`<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="item/standard.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  z.file('item/standard.opf',`<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="u" prefix="rendition: http://www.idpf.org/vocab/rendition/#"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title id="t">ロクでなし魔術講師と禁忌教典</dc:title><dc:creator>羊太郎</dc:creator><meta name="cover" content="cover"/></metadata><manifest>
  <item id="cover" href="image/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
  <item id="nav" href="navigation-documents.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  <item id="p-cover" href="xhtml/p-cover.xhtml" media-type="application/xhtml+xml" properties="svg"/>
  <item id="p-title" href="xhtml/p-title.xhtml" media-type="application/xhtml+xml"/>
  <item id="p-toc" href="xhtml/p-toc.xhtml" media-type="application/xhtml+xml"/>
  <item id="p-001" href="xhtml/p-001.xhtml" media-type="application/xhtml+xml"/>
  <item id="p-002" href="xhtml/p-002.xhtml" media-type="application/xhtml+xml"/>
  <item id="p-colophon" href="xhtml/p-colophon.xhtml" media-type="application/xhtml+xml"/>
  <item id="i1" href="image/i-001.jpg" media-type="image/jpeg"/>
  </manifest><spine page-progression-direction="rtl"><itemref idref="p-cover"/><itemref idref="p-title"/><itemref idref="nav" linear="no"/><itemref idref="p-toc"/><itemref idref="p-001"/><itemref idref="p-002"/><itemref idref="p-colophon"/></spine></package>`);
  z.file('item/image/cover.jpg',new Uint8Array([1,2,3]));
  z.file('item/image/i-001.jpg',new Uint8Array([4,5,6]));
  z.file('item/navigation-documents.xhtml',X(`<nav epub:type="toc" id="toc"><h1>目次</h1><ol><li><a href="xhtml/p-title.xhtml">タイトル</a></li><li><a href="xhtml/p-001.xhtml">プロローグ</a></li><li><a href="xhtml/p-002.xhtml#c2">第一章　<span>「魔術師」</span></a></li></ol></nav>`));
  z.file('item/xhtml/p-cover.xhtml',X(`<div class="main align-center"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 800 1200"><image width="800" height="1200" xlink:href="../image/cover.jpg"/></svg></div>`));
  z.file('item/xhtml/p-title.xhtml',X(`<div class="main"><p class="title">ロクでなし魔術講師と禁忌教典</p><p class="author">羊太郎</p></div>`));
  z.file('item/xhtml/p-toc.xhtml',X(`<div class="main"><h2 class="mt">目次</h2><p><a href="p-001.xhtml">プロローグ</a></p><p><a href="p-002.xhtml#c2">第一章</a></p></div>`));
  z.file('item/xhtml/p-001.xhtml',X(`<div class="main"><h2 id="pro" class="mt">プロローグ</h2>
  <p class="p-indent">　<ruby>世界<rt>せかい</rt></ruby>は<ruby>残酷<rt>ざんこく</rt></ruby>だ。<span class="em-sesame"><ruby>誰<rt>﹅</rt></ruby><ruby>も<rt>﹅</rt></ruby></span>が<ruby>知<rt>し</rt></ruby>っている。</p>
  <p><br/></p>
  <p class="p-indent">「ねえ、<ruby><rb>先生</rb><rp>(</rp><rt>せんせい</rt><rp>)</rp></ruby>」</p>
  <p>　彼は<span class="tcy">12</span>年前、<ruby>魔<rt>ま</rt>術<rt>じゅつ</rt></ruby>を学んだ。<a epub:type="noteref" href="#n1">＊1</a></p>
  <p class="illust"><img src="../image/i-001.jpg" alt=""/></p>
  <aside epub:type="footnote" id="n1"><p>注釈：古い言葉だ。</p></aside>
  <div class="scene-break"><p>◇◇◇</p></div>
  <p>最後の行　　　　　 です。<br/>改行の後。</p></div>`));
  z.file('item/xhtml/p-002.xhtml',X(`<div class="main"><h2 id="c2">第一章　「魔術師」</h2><p>本文が始まる。 Hello world   and  <b>bold</b><i>italic</i> text。</p><p><a id="x"></a>アンカー付き。</p></div>`));
  z.file('item/xhtml/p-colophon.xhtml',X(`<div class="main"><p>奥付</p><p>発行　2020年</p></div>`));
  
  const book = await importEpub(await z.generateAsync({ type: 'arraybuffer' }), 'ln.epub', new DOMParser());
  assert.equal(book.title, 'ロクでなし魔術講師と禁忌教典');
  assert.equal(book.author, '羊太郎');
  assert.ok(book.cover);
  assert.equal(book.images.length, 1);
  const lines = book.text.split('\n');
  // the printed 目次 page is not story text, and the manifest nav page is skipped too
  assert.ok(!lines.includes('目次'));
  assert.equal(lines.filter(l => l === 'プロローグ').length, 1);
  assert.equal(lines[3], '　世界は残酷だ。誰もが知っている。');
  assert.equal(lines[5], '　彼は12年前、魔術を学んだ。＊1');
  // the footnote body follows the chapter text instead of interrupting it
  assert.equal(lines[lines.indexOf('改行の後。') + 1], '注釈：古い言葉だ。');
  assert.deepEqual(book.chapters.map(c => c.title), ['タイトル', 'プロローグ', '第一章　「魔術師」']);
  for (const c of book.chapters) assert.ok(lines[c.startLine].length > 0);
  assert.equal(lines[book.chapters[2].startLine], '第一章　「魔術師」');
  // bouten dots are not readings; split ruby keeps one reading for the whole word
  assert.deepEqual(book.overrides.map(o => `${o.surface}:${o.reading}`), ['世界:せかい', '残酷:ざんこく', '知:し', '先生:せんせい', '魔術:まじゅつ']);
});
