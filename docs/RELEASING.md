# 发布流程 / Releasing

## 一次发布

1. 同步版本号（必须一致，`tests/versionSync.test.mjs` 会检查）：
   - `package.json` 与 `package-lock.json` 的 `version`
   - `android/AndroidManifest.xml` 的 `versionName`，并把 `versionCode` 加 1
   - `ios/App/App.xcodeproj/project.pbxproj` 的 `MARKETING_VERSION`（以及构建号）
2. 更新 `RELEASE_NOTES.md`，合并到 `main`。
3. 打标签并推送：
   ```bash
   git tag v1.3.0 && git push origin v1.3.0
   ```
4. GitHub Actions（`.github/workflows/release.yml`）会运行测试、构建，并把文件发布到 Releases：
   - `Uku-Furigana-vX.Y.Z-windows.exe`：Windows 桌面版（由 GitHub 的 Windows 云端机器构建，**未做代码签名**，首次运行可能出现 SmartScreen 提示）
   - `Uku-Furigana-web-vX.Y.Z.zip`：静态网页包
   - `Uku-Furigana-vX.Y.Z.apk`：已签名 APK（需要下面的两个 Secret）
   - `SHA256SUMS.txt`：校验值

应用内「检查更新」依赖上面三个**固定的文件名格式**（`Uku-Furigana-vX.Y.Z.apk`、`Uku-Furigana-vX.Y.Z-windows.exe`、`SHA256SUMS.txt`）和 `releases/latest`（不含草稿与预发布版本）。改名会让自动更新找不到安装包。Android 的 APK 必须用同一把 `uku-release.jks` 签名，否则系统安装器会拒绝覆盖安装。中转服务的部署见 `server/relay/DEPLOY.md`。

## 发布之后：同步到网站服务器

GitHub 的发布文件在中国大陆经常下不动（直连实测 40 秒一个字节都没有），所以官网的下载按钮优先走自己的服务器，GitHub 只作为备用链接。每次发布完成后：

1. 把发布文件同步到服务器（服务器自己从 GitHub 拉取并校验 `SHA256SUMS.txt`，通过后才对外可见）：
   ```bash
   scripts/sync-release-to-server.sh vX.Y.Z
   ```
   文件会放在 `https://saiaino.xyz/downloads/vX.Y.Z/<文件名>`，由 nginx 直接提供（支持断点续传）。脚本不会删除任何东西，旧版本留在服务器上，需要时手动清理。
2. 更新官网（站点文件不在本仓库里，在服务器的 `/var/www/saiaino.xyz/html`）：
   - `uku/uku.js` 里的 `RELEASE`：版本、日期、更新说明链接，以及三个安装包的文件名、大小和 SHA-256（取自发布页的 `SHA256SUMS.txt`）；
   - `config.js` 里应用的 `version`，和 `uku/index.html` 里 `eyebrow-version` 的静态占位版本。
3. 在线版 `uku.saiaino.xyz` 用发布出来的 `Uku-Furigana-web-vX.Y.Z.zip` 整体替换 `/var/www/uku.saiaino.xyz/html`（先备份，并保留旧版里新版不再带的 `_next/static` 文件，让还开着旧页面的人不会加载失败）。

应用内的自动更新在 GitHub 取不到版本信息时会改走中转服务，并优先使用服务器镜像下载，GitHub 作为备用。

## 词典静态资产与缓存

网页版第一次打开会下载注音词典（约 14 MB Brotli / 19 MB gzip）和日中词典分片。只有 `DecompressionStream` 支持 `brotli` 的浏览器会用到 Brotli（按 MDN 兼容表主要是 Firefox / Safari，未逐一实测）；Chrome / Edge 实测到 157 仍不支持，会走 gzip。生成的文件都必须随整站一起上传，不能只上传 HTML：

- `public/dict/manifest.json` 与 `public/dict/assets/<hash>/`；
- `public/lookup/ja-zh/index.json`、`public/lookup/ja-zh/assets/<hash>/`；
- `public/lookup/ja-en/...` 同上；
- 原来的 `.gz` 分片仍要保留：Chrome / Edge、Chrome 99 / 旧 WebView 以及其他不支持 Brotli 解压的浏览器都会回退到它们。

`assets/<hash>/` 里的文件名带内容哈希，可以长期缓存；`manifest.json` 和 `index.json` 会随词典更新，必须每次重新验证：

```nginx
location ~ ^/(?:dict|lookup/[^/]+)/assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
}
location ~ ^/(?:dict/manifest\.json|lookup/[^/]+/index\.json)$ {
    add_header Cache-Control "no-cache";
}
```

词典源更新后运行：

```bash
npm run compress:dict
```

`scripts/build-dictionary.mjs` 和 `tools/build-reading-table.mjs` 也会自动重新生成 Brotli 资产。线上服务器在下次发布前不会自动获得这些文件，不能把本地构建当作线上已经提速。

标签必须和 `package.json` 的版本一致（`v1.3.0` ↔ `1.3.0`），否则发布会在第一步失败。

## 官网下载链接

不需要存放文件，直接指向最新版本：

```
https://github.com/Cheese-nya/uku-furigana/releases/latest/download/<文件名>
```

文件名里带版本号，所以按钮最好链接到 Releases 页面：
`https://github.com/Cheese-nya/uku-furigana/releases/latest`。

## 让 Actions 签名 APK（可选）

不配置也能发布，只是 Release 里没有 APK。发布任务运行在名为 `release` 的 Environment 里，签名用的 Secret 也放在这个环境中（而不是仓库级别）。

1. 仓库 Settings → Environments → New environment，名字填 `release`：
   - 勾选 **Required reviewers**，选自己：每次发布都要手动批准，工作流才能读取密钥。
   - **Deployment branches and tags** 选 *Selected branches and tags*，只允许 `v*`。
2. 在自己的终端里存入 Secret（密码要用键盘输入，不要经过聊天或脚本）：
   ```bash
   base64 -w0 ~/keys/uku-release.jks | gh secret set ANDROID_KEYSTORE_BASE64 --env release --repo Cheese-nya/uku-furigana
   gh secret set ANDROID_KEYSTORE_PASSWORD --env release --repo Cheese-nya/uku-furigana
   ```
   密钥别名固定为 `uku`。

没有配置这两个 Secret 时，Release 只含网页包。想完全避免把密钥交给 GitHub，可以改在本机打包（`scripts/build-apk.sh`），再手动把 APK 上传到 Release。

## 本地打包

```bash
npm run build:web                                         # out/
pip install -r requirements-desktop.txt && npm run package:exe   # Windows 上生成 UkuFurigana.exe
ANDROID_KEYSTORE=~/keys/uku-release.jks bash scripts/build-apk.sh # UkuFurigana.apk（会提示输入密码）
```
