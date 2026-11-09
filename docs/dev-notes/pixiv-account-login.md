# Pixiv 本机账号登录

## 目标与交互约定

- 设置新增「Pixiv 账号」；手机复用现有工作台设置，桌面复用侧栏设置。
- 作品要求登录时显示原因及「前往设置登录 Pixiv」按钮，直接进入账号面板。
- 复用现有 Modal、按钮、颜色与焦点管理；检查 390×844 中文及 1440×900 英文布局。
- 状态包括：检查中、未登录、登录态已保存、操作失败（可重试）、平台不支持。
- 登录按钮打开官方登录页；用户完成登录后关闭该窗口，返回重试导入。
- 显示「登录态已保存」而非保证账号有效；会话可能过期，作品仍可能无访问权限。

## 平台实现

- **Android**：独立的 WebView 登录窗口，不注入 AndroidBridge。CookieManager 保存会话；仅固定的 Pixiv 小说 AJAX 请求添加 Cookie，关闭自动重定向。退出只清除 Pixiv 域 Cookie。
- **iOS**：独立 WKWebViewConfiguration，不加载应用脚本或消息桥；默认 WKWebsiteDataStore 保存 Cookie。原生请求读取该 Cookie store，按目标域名及路径筛选；不转发重定向。应用消息桥只接受 localhost 主框架。
- **Windows**：独立 pywebview 窗口，不传 js_api；会话由应用专属 WebView profile 持久化。localhost 的 `/api/pixiv-ajax` 由原生服务访问固定 Pixiv 地址；退出清除登录窗口 Cookie。
- **Web**：安装桌面 Chrome / Edge 的 Uku Pixiv 登录助手，复用当前浏览器自己的 Pixiv 登录态。官方页面登录；账号状态通过 Cookie 变更通知及页面恢复焦点刷新。助手只向受信 Uku 顶层页面开放固定账号动作和小说 ID 读取，不返回 Cookie、收藏状态等无关数据；后台请求因浏览器隐私设置无法带会话时，使用真实 Pixiv 标签页进行同源读取。退出会清除浏览器的 Pixiv Cookie，界面明确提示会影响其他 Pixiv 标签页。

账号密码在 Pixiv 官方页输入。账号面板只接收是否保存会话的布尔值；不把 Cookie 送入前端、日志或中转。原生客户端已有本机会话时，设备端导入预算为 30 秒，且不回落到匿名中转；匿名设备请求仍在 8 秒后尝试中转。网页版助手读取上限为 45 秒，助手失败不会被匿名服务器结果覆盖。

## Issue #58 的实际证据

2026-11-09，作品 `14910277` 的匿名官方响应：标题正确、`isLoginOnly=true`、`characterCount=18089`、`content=""`。此前空字符串被视为成功，生成空白书籍。现在拒绝空白正文，并指向账号设置。

## 验证

- Node 单测：三种桥接账号状态/登录/退出、旧客户端、错误识别、已有会话的受限作品导入、匿名中转隔离。
- Python 单测：登录窗口无应用 API、Cookie 域过滤、固定端点与重定向限制、退出、不泄露会话。
- `tools/check-pixiv-account.mjs`：使用假会话验证设置入口、导入报错跳转、登录/退出状态、键盘焦点、窄屏/宽屏及英文布局。截图位于 `tests/.tmp/pixiv-account/`。
- 类型检查、改动文件 lint、生产构建与 Android Java 编译。
- 2026-11-09 验证通过：638 项 Node 测试通过 / 1 项跳过，54 项桌面 Python 测试、34 项中转测试通过；类型检查与改动文件 lint 通过，生产构建及客户端静态导出通过，Android Java 编译通过。
- 黑苹果 Xcode 26.5 的 iOS Simulator Release / iPhoneOS Release（无签名）均构建通过。在独立的 `com.cheese.uku.pixivqa` 模拟器应用中，以临时测试 Cookie 和网络响应夹具验证实际 WKHTTPCookieStore、原生 Cookie 转发、登录状态、退出、官方登录窗口隔离及设置入口。测试脚手架只加入远端临时目录，未进入生产源码。结果与截图位于 `tests/.tmp/pixiv-account/ios-native-report.json`、`ios-simulator.png`。
- 测试未使用真实用户账号。用户在正式客户端的官方窗口完成登录后，仍应以实际作品确认网络、验证码、会话有效性与访问权限；测试会话不代表已登录真实 Pixiv 账号。

## 网页版安装与验证

1. 网页「设置 → Pixiv 账号」下载助手 ZIP，解压。
2. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`；开启开发者模式，加载含 `manifest.json` 的文件夹。
3. 刷新 Uku 页面，点击登录；在 Pixiv 官方标签页完成登录后返回导入。

源码位于 `extensions/pixiv-helper/`，生成脚本 `scripts/build-pixiv-browser-helper.mjs`，可下载包为 `public/uku-pixiv-helper.zip`。`vendor-assets.mjs` 在开发、测试、生产及静态构建前自动打包，包内提供全部源码和双语安装说明。需要浏览器能访问 Pixiv；本次没有向扩展商店发布。

`tools/check-pixiv-browser-helper.mjs` 在隔离的真实 Chromium 扩展环境中加载 MV3 助手，以本地 HTTPS 站点模拟 Pixiv 官方登录和小说 API，使用真正的 Secure / HttpOnly / SameSite=Strict 测试 Cookie。已验证 Cookie 变更自动更新账号状态、官方登录标签页、带会话导入、同源标签页备用读取、登出清除 Cookie、网页不读取 Cookie、导入不访问匿名中转，以及助手包实际下载。浏览器报告及 390/1440px 截图位于 `tests/.tmp/pixiv-browser-helper/`；没有使用真实用户账号。

网页版补充验证：全量 Node 测试 647 通过 / 1 跳过；类型检查、改动文件 lint、生产构建及静态导出通过。最终静态导出在真实扩展中重跑：正文及注音已持久化到书库，浏览器 Cookie 的读取与退出均通过，实际下载的 ZIP 包含与源码一致的助手文件。
