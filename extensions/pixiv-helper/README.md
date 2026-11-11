# Uku Pixiv 登录助手 / Pixiv browser helper

适用于桌面 Chrome / Edge 的普通窗口，不在无痕窗口运行。登录态只用于本机访问 Pixiv，网页只会收到账号状态和导入所需的小说内容。

1. 解压下载的 ZIP。
2. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
3. 打开「开发者模式」，选择「加载已解压的扩展程序」，选中包含 `manifest.json` 的文件夹。
4. 刷新 Uku 网页，在「设置 → Pixiv 账号」检测助手并登录。
5. 在 Pixiv 官方页面完成登录，返回 Uku 重试导入。

退出会清除当前浏览器的 Pixiv Cookie，也会影响其他 Pixiv 标签页。助手不保存账号密码，不把 Cookie 发给 Uku 网页或服务器。登录及受限作品读取仍需要浏览器能访问 Pixiv。

For desktop Chrome / Edge: unzip, open the browser's Extensions page, enable Developer mode, choose **Load unpacked**, and select the folder containing `manifest.json`. Refresh Uku, open **Settings → Pixiv account**, and sign in on the official Pixiv page. Return to Uku to import.

Signing out clears the browser's Pixiv cookies, including sessions used by other Pixiv tabs. The helper never sends cookies to Uku or its relay. Source code is included for review. No Chrome Web Store publication is implied by this package.
