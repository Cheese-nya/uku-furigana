<div align="center">

  <img src="public/logo.png" alt="浮く Logo" width="104" height="104" />

  # 浮く · Uku Furigana

  **假名，浮在汉字之上。**

  面向日语学习者与配音练习者的离线振假名（ルビ）注音与排版工具。<br />
  多音字、量词音变、熟字训，以及导出 Word 时的错位，都在这里处理好。

  <p>
    <b>简体中文</b> • <a href="README_EN.md">English</a>
  </p>

  [![Release](https://img.shields.io/github/v/release/Cheese-nya/uku-furigana?label=Release&color=10b981)](https://github.com/Cheese-nya/uku-furigana/releases/latest)
  [![CI](https://github.com/Cheese-nya/uku-furigana/actions/workflows/ci.yml/badge.svg)](https://github.com/Cheese-nya/uku-furigana/actions/workflows/ci.yml)
  [![License: PolyForm Noncommercial](https://img.shields.io/badge/License-PolyForm_Noncommercial_1.0.0-orange.svg)](LICENSE)
  [![Platforms](https://img.shields.io/badge/Windows_·_Android_·_Web-3776ab)](#下载)

  <br />

  <img src="docs/images/workbench.png" alt="浮く 工作台：左侧原文，右侧实时注音预览" width="900" />

</div>

---

## 下载

前往 [Releases](https://github.com/Cheese-nya/uku-furigana/releases/latest) 选择对应平台：

| 平台 | 文件 | 说明 |
| :--- | :--- | :--- |
| **Windows** | `Uku-Furigana-vX.Y.Z-windows.exe` | 免安装的单文件桌面版 |
| **Android** | `Uku-Furigana-vX.Y.Z.apk` | 需要 Android 7.0 及以上 |
| **网页** | `Uku-Furigana-web-vX.Y.Z.zip` | 静态网页包，可部署到自己的服务器 |
| **iOS** | — | 原生外壳已完成，上架准备中 |

每个版本都附有 `SHA256SUMS.txt` 校验值。Windows 版暂未做代码签名，首次运行时系统可能出现 SmartScreen 提示。

---

## 解决的问题

直接查词典的注音工具，常在这几处出错：

| 场景 | 常见错误 | 浮く 的处理 |
| :--- | :--- | :--- |
| **多音字** | `辛い` 读音混淆（辣 vs 痛苦） | 结合前后文助词区分 `からい` 与 `つらい`；`何`（なに / なん）、`風`（かぜ / ふう）同理 |
| **量词音变** | `一発`、`一本` 读成 いちはつ、いちほん | 内置数词与量词音变规则，输出 `いっぱつ`、`いっぽん`、`三分（さんぷん）` 等促音与半浊音 |
| **熟字训** | `二人` 被拆成 `二(に)人(にん)` | 整词识别，注为 `二人（ふたり）`、`大人（おとな）`；动词送假名精确对齐 |
| **打印排版** | 导出到 Word 后假名掉落或变成括号 | 输出标准 Word `<w:ruby>` 结构，假名居中在汉字上方，字号与行距可调 |

注音与导出全程在本机完成，不上传任何文本，断网也能使用（只有从 Pixiv 导入小说需要联网）。

---

## 界面预览

### 点按校对

点击任意带假名的汉字，弹出候选读音和它所在的短句。可以选择只改这一处、改全文同一个词，或者记住这个语境；还能向右扩展圈选词组（比如把「二」扩展成「二人」，整词注为「ふたり」）。

<p align="center">
  <img src="docs/images/correction.png" alt="校对弹窗：辛い 的候选读音 からい / つらい，以及仅此处 / 全文同词 / 记住" width="850" />
</p>

右上角的「待复核」会列出软件没有把握的词，点「下一处」逐个检查。

### 专名词典

角色名、地名、作品专名等特殊读音，一次添加，所有台本复用。按原文精确匹配、长词优先，支持导入与导出。

<p align="center">
  <img src="docs/images/glossary.png" alt="专名词典：小日向 こひなた、月見里 やまなし、五十嵐 いがらし" width="850" />
</p>

### 台本库与阅读器

导入的台本、小说和字幕收进书库，按文本内容记住校对结果，改标题也不丢。内置三本示例（台本与两篇公版小说）。阅读器可调字体、字号，并切换注音显示与竖排。

<p align="center">
  <img src="docs/images/library.png" alt="台本库：书架与分类、搜索、排序" width="850" />
</p>

<p align="center">
  <img src="docs/images/reader.png" alt="阅读器：銀河鉄道の夜（序章）带注音阅读" width="850" />
</p>

### 批量处理

一次拖入多个 `.txt`、`.srt`、`.docx`，并行注音，再选一种格式全部导出。

<p align="center">
  <img src="docs/images/batch.png" alt="批量处理：文件队列与导出格式选择" width="850" />
</p>

### 深色模式与手机

外观跟随系统，也可以手动指定。手机上使用底部标签栏，原文与注音预览分页切换。

<p align="center">
  <img src="docs/images/workbench-dark.png" alt="深色模式的工作台" width="850" />
</p>

<p align="center">
  <img src="docs/images/mobile-preview.png" alt="手机：注音预览" width="280" />
  &nbsp;&nbsp;
  <img src="docs/images/mobile-reader.png" alt="手机：阅读器" width="280" />
</p>

---

## 功能清单

- **上下文形态素引擎**：基于本地 Kuromoji，集成多音字消歧规则与量词音变表。
- **三种注音**：平假名（初学）、片假名（进阶与外来语）、罗马音（拼读辅助）。
- **后台分词**：在 Web Worker 里计算，输入长文也不卡顿，新输入会中断过时的任务。
- **交互式校对**：
  - 点击汉字修改，对照前后文。
  - 向右扩展，整词标注。
  - 语境记忆：同一篇里相同语境的词自动套用。
  - 读音优先级：人工校对 › 原文自带注音 › 语境记忆 › 专名词典 › 自动分词。
- **导入与导出**：
  - **Word（`.docx`）**：原生 `<w:ruby>` 上标排版；可导入已经带注音的 Word 文档。
  - **字幕（`.srt`）**：保留时间轴与多行字幕，导出带注音的字幕；也可导入 `.vtt`。
  - **纯文本（`.txt`）**：干净的括号注音文本。
- **书库、阅读器、批量处理**：见上文截图。
- **数据留在本机**：以文本内容的 SHA-256 指纹为索引，改标题、重新导入都不丢校对记录。

---

## 从源码运行

```bash
git clone https://github.com/Cheese-nya/uku-furigana.git
cd uku-furigana
npm install
npm run dev
```

浏览器打开 `http://localhost:3000`。

```bash
npm test             # 单元测试
npx tsc --noEmit     # 类型检查
npm run lint
npm run build:web    # 静态网页包，输出到 out/
```

内置的读音对照表（`public/dict/readings.json.gz`）由随附的日英词典生成，重新构建词典后再生成一次即可：

```bash
node scripts/build-dictionary.mjs ja-en   # 需要 tools/dict-src/jitendex-yomitan.zip
node tools/build-reading-table.mjs        # 由 public/lookup/ja-en/terms-*.json.gz 生成对照表
```

### 打包

| 目标 | 命令 | 环境 |
| :--- | :--- | :--- |
| Windows exe | `pip install -r requirements-desktop.txt` 然后 `npm run package:exe` | Windows、Python 3.12、Node 22 |
| Android APK | `ANDROID_KEYSTORE=<你的密钥> bash scripts/build-apk.sh`（会提示输入密码） | Android SDK、JDK 17 |

发布流程见 [docs/RELEASING.md](docs/RELEASING.md)。

---

## 技术栈

- **前端**：Next.js 16 + React 19 + Tailwind CSS v4
- **分词引擎**：Kuromoji.js，在 Web Worker 中离线运行
- **文档处理**：docx、JSZip、xmldom
- **Windows**：PyWebView（WebView2）+ PyInstaller
- **Android**：原生 WebView 外壳（Java），由脚本直接打包
- **iOS**：Capacitor

---

## 目录结构

```text
uku-furigana/
├── app/
│   ├── components/      # 界面组件（侧边栏、校对弹窗、书库、阅读器、批处理等）
│   ├── hooks/           # 主题、书库、批处理等状态逻辑
│   ├── utils/           # 注音引擎、消歧规则、Word / SRT 导入导出、书库存储
│   ├── workers/         # 注音 Web Worker
│   ├── api/             # Pixiv 导入的服务端路由（静态导出时不包含）
│   └── page.tsx         # 页面入口
├── android/             # Android 外壳（清单、资源、Java 源码）
├── ios/                 # iOS 外壳（Capacitor）
├── scripts/             # 构建与发布脚本
├── public/dict/         # 离线分词词典
├── tests/               # 自动化测试
├── docs/                # 截图、品牌资源、发布说明与开发笔记
└── desktop_runner.py    # Windows 桌面版入口
```

---

## 许可协议

- **源代码**：自 v1.2.0 起（从提交 `a9c33a2`）以 [PolyForm Noncommercial 1.0.0](LICENSE) 发布。允许个人学习、研究、教学及其它**非商业**用途下的使用、修改与分发；**禁止任何商业用途**。需要商业授权请联系作者。
- **更早的版本**：此前的提交，包括已发布的 v1.1.0，曾以 MIT 协议发布，这些版本仍适用 MIT。
- **名称与图标**：不在上述许可范围内，见 [TRADEMARKS.md](TRADEMARKS.md)。
- **第三方组件**：见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- **参与贡献**：见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [CLA.md](CLA.md)。
