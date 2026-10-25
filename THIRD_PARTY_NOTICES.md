# Third-Party Notices

本软件包含或在发行版中打包了以下第三方组件。它们各自遵循其原始许可证，不受本项目 [LICENSE](LICENSE) 约束。

This software includes or bundles the following third-party components, each under its own license.

## 运行时打包的组件 / Bundled at runtime

| 组件 | 许可证 | 来源 |
| :--- | :--- | :--- |
| Next.js | MIT | <https://github.com/vercel/next.js> |
| React / React DOM | MIT | <https://github.com/facebook/react> |
| kuromoji.js | Apache-2.0 | <https://github.com/takuyaa/kuromoji.js> |
| mecab-ipadic 2.7.0-20070801（`public/dict/`） | NAIST / ICOT（见下文） | <https://taku910.github.io/mecab/> |
| docx | MIT | <https://github.com/dolanmiu/docx> |
| JSZip | MIT（双许可 MIT / GPL-3.0，本项目选用 MIT） | <https://github.com/Stuk/jszip> |
| FileSaver.js | MIT | <https://github.com/eligrey/FileSaver.js> |
| PDF.js（`pdfjs-dist`，含 CMap 与标准字体数据） | Apache-2.0 | <https://github.com/mozilla/pdf.js> |
| 日中词典（`public/lookup/ja-zh/`，由 wty 从维基词典 / kaikki.org 数据生成） | CC BY-SA 4.0（见下文） | <https://github.com/yomidevs/wiktionary-to-yomitan> |
| 日英词典 Jitendex（`public/lookup/ja-en/`，基于 JMdict 与 Tatoeba） | CC BY-SA 4.0（见下文） | <https://jitendex.org> |
| Capacitor（iOS 版） | MIT | <https://github.com/ionic-team/capacitor> |
| pywebview（Windows 版） | BSD-3-Clause | <https://github.com/r0x0r/pywebview> |
| PyInstaller bootloader（Windows 版） | GPL-2.0 with bootloader exception | <https://github.com/pyinstaller/pyinstaller> |

完整的 Apache-2.0 许可证文本见 <https://www.apache.org/licenses/LICENSE-2.0>。MIT 与 BSD 许可证全文随各组件源码分发，也可在上述来源仓库中查阅。

---

## 日中词典 / Japanese–Chinese dictionary（`public/lookup/ja-zh/`）

内置查词词典的数据来自维基词典（Wiktionary）的中文版，经 [kaikki.org](https://kaikki.org/)（wiktextract）提取、
[wty / wiktionary-to-yomitan](https://github.com/yomidevs/wiktionary-to-yomitan) 转换为 Yomitan 格式，
再由本项目的 `scripts/build-dictionary.mjs` 压缩成内置格式（只保留释义与例句，内容未作其他改动）。

The bundled lookup dictionary is derived from the Chinese edition of Wiktionary, extracted by kaikki.org (wiktextract)
and converted by wty; `scripts/build-dictionary.mjs` repacks it (glosses and examples only).

许可 / License: [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/)（CC BY-SA 4.0）。
署名 / Attribution: Wiktionary contributors。该数据（及其改编版本）须以同样的许可证分发；它不受本项目 PolyForm 许可证约束。
This data (and adaptations of it) is shared under the same license and is not covered by this project's PolyForm license.

## 日英词典 Jitendex / Japanese–English dictionary（`public/lookup/ja-en/`）

内置的日英词典是 [Jitendex](https://jitendex.org)（© Stephen Kraus），以
[JMdict](https://www.edrdg.org/jmdict/j_jmdict.html)（Electronic Dictionary Research and Development Group，
按 [EDRDG 许可](https://www.edrdg.org/edrdg/licence.html) 使用）与 [Tatoeba](https://tatoeba.org) 例句为基础编成。
本项目的 `scripts/build-dictionary.mjs` 只保留了释义、词性与部分例句，未作其他改动。

Jitendex © Stephen Kraus, built on JMdict (EDRDG) and Tatoeba example sentences; repacked by
`scripts/build-dictionary.mjs` (glosses, parts of speech and some examples only).

许可 / License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)。Jitendex 的生成代码为 AGPL-3.0，本项目只使用其发布的词典数据，不包含其代码。
This project uses only the published dictionary data, not Jitendex's AGPL-3.0 code.

---

查词引擎为本项目自行实现，读取 Yomitan 词典格式，但不包含 Yomitan（GPL-3.0）的任何代码。
The lookup engine is our own; it reads the Yomitan dictionary format but contains no Yomitan (GPL-3.0) code.

---

## kuromoji.js

```
Copyright 2014 Takuya Asano
Copyright 2010-2014 Atilika Inc. and contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

## mecab-ipadic-2.7.0-20070801

`public/dict/` 中的词典数据由 kuromoji.js 从 mecab-ipadic 构建。依其许可证要求，附上以下声明：

```
Copyright 2000, 2001, 2002, 2003 Nara Institute of Science
and Technology.  All Rights Reserved.

Use, reproduction, and distribution of this software is permitted.
Any copy of this software, whether in its original form or modified,
must include both the above copyright notice and the following
paragraphs.

Nara Institute of Science and Technology (NAIST),
the copyright holders, disclaims all warranties with regard to this
software, including all implied warranties of merchantability and
fitness, in no event shall NAIST be liable for
any special, indirect or consequential damages or any damages
whatsoever resulting from loss of use, data or profits, whether in an
action of contract, negligence or other tortuous action, arising out
of or in connection with the use or performance of this software.

A large portion of the dictionary entries
originate from ICOT Free Software.  The following conditions for ICOT
Free Software applies to the current dictionary as well.

Each User may also freely distribute the Program, whether in its
original form or modified, to any third party or parties, PROVIDED
that the provisions of Section 3 ("NO WARRANTY") will ALWAYS appear
on, or be attached to, the Program, which is distributed substantially
in the same form as set out herein and that such intended
distribution, if actually made, will neither violate or otherwise
contravene any of the laws and regulations of the countries having
jurisdiction over the User or the intended distribution itself.

NO WARRANTY

The program was produced on an experimental basis in the course of the
research and development conducted during the project and is provided
to users as so produced on an experimental basis.  Accordingly, the
program is provided without any warranty whatsoever, whether express,
implied, statutory or otherwise.  The term "warranty" used herein
includes, but is not limited to, any warranty of the quality,
performance, merchantability and fitness for a particular purpose of
the program and the nonexistence of any infringement or violation of
any right of any third party.

Each user of the program will agree and understand, and be deemed to
have agreed and understood, that there is no warranty whatsoever for
the program and, accordingly, the entire risk arising from or
otherwise connected with the program is assumed by the user.

Therefore, neither ICOT, the copyright holder, or any other
organization that participated in or was otherwise related to the
development of the program and their respective officials, directors,
officers and other employees shall be held liable for any and all
damages, including, without limitation, general, special, incidental
and consequential damages, arising out of or otherwise in connection
with the use or inability to use the program or any product, material
or result produced or otherwise obtained by using the program,
regardless of whether they have been advised of, or otherwise had
knowledge of, the possibility of such damages at any time during the
project or thereafter.  Each user will be deemed to have agreed to the
foregoing by his or her commencement of use of the program.  The term
"use" as used herein includes, but is not limited to, the use,
modification, copying and distribution of the program and the
production of secondary products from the program.

In the case where the program, whether in its original form or
modified, was distributed or delivered to or received by a user from
any person, organization or entity other than ICOT, unless it makes or
grants independently of ICOT any specific warranty to the user in
writing, such person, organization or entity, will also be exempted
from and not be held liable to the user for any such damages as noted
above as far as the program is concerned.
```
