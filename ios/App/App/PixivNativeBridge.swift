import Foundation
import WebKit
import UIKit

/// Native Pixiv transport for the packaged iOS app.
///
/// The Capacitor bundle is served from the local `capacitor://localhost` origin, so a
/// `fetch('/api/pixiv?id=…')` resolves to a path the static export never emitted
/// (→ WebKit `TypeError: Load failed`), and a direct `https://www.pixiv.net/…` call is
/// rejected by CORS. Android already handles this by intercepting the virtual
/// `localhost` origin in `MainActivity.java` (`handlePixivAjaxProxy` /
/// `handlePixivImageProxy`); this is the same contract for iOS, exposed to JS as
/// `window.furiganaPixiv` (see `app/utils/pixivNativeBridge.ts`).
///
/// The Swift cleaning helpers below mirror `app/utils/pixivImporter.ts`; the TypeScript
/// copies stay authoritative and are covered by `tests/libraryDatabase.test.mjs`.
final class PixivNativeBridge: NSObject, WKScriptMessageHandler {
    static let messageHandlerName = "furiganaPixiv"
    static let pixivUserAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

    private static let metadataTimeout: TimeInterval = 20
    private static let imageTimeout: TimeInterval = 15
    private static weak var activeWebView: WKWebView?
    private static var loginController: UINavigationController?
    private static let accountStore = WKWebsiteDataStore.default()
    private static let requestSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        return URLSession(configuration: config, delegate: PixivRedirectGuard(), delegateQueue: nil)
    }()

    /// Call once the bridge web view exists so replies have a target to evaluate on.
    static func attach(_ webView: WKWebView) {
        activeWebView = webView
    }

    /// Registers the bridge on a web view configuration. Safe to call more than once:
    /// a recreated configuration (the app rebuilds it on `setServerBasePath`) must still
    /// get the bridge, so idempotence is detected from the injected script itself rather
    /// than from object identity.
    static func register(on configuration: WKWebViewConfiguration) {
        let alreadyRegistered = configuration.userContentController.userScripts.contains {
            $0.source.contains("__furiganaPixivResolve")
        }
        guard !alreadyRegistered else { return }

        configuration.userContentController.add(PixivNativeBridge(), name: messageHandlerName)
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: bridgeScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
    }

    /// Marks the page as running inside the native shell and forwards promise calls to
    /// the message handler, keeping one pending entry per request id.
    private static let bridgeScript = """
    (function () {
      if (window.furiganaPixiv) { return; }
      var handler = window.webkit && window.webkit.messageHandlers
        ? window.webkit.messageHandlers.furiganaPixiv
        : null;
      if (!handler) { return; }

      var pending = {};
      var seq = 0;

      function request(kind, param) {
        return new Promise(function (resolve, reject) {
          var requestId = 'pixiv-' + Date.now().toString(36) + '-' + (++seq);
          pending[requestId] = { resolve: resolve, reject: reject };
          try {
            handler.postMessage({ kind: kind, param: param, requestId: requestId });
          } catch (err) {
            delete pending[requestId];
            reject(err);
          }
        });
      }

      window.__furiganaPixivResolve = function (payloadJson) {
        var payload;
        try {
          payload = typeof payloadJson === 'string' ? JSON.parse(payloadJson) : payloadJson;
        } catch (err) {
          return;
        }
        if (!payload || !payload.requestId) { return; }
        var entry = pending[payload.requestId];
        if (!entry) { return; }
        delete pending[payload.requestId];
        if (payload.ok) {
          entry.resolve(payload.data === undefined ? null : payload.data);
        } else {
          entry.reject(new Error(payload.error || 'Pixiv request failed'));
        }
      };

      window.furiganaPixiv = {
        isNative: true,
        novel: function (id) { return request('novel', id); },
        image: function (url) { return request('image', url); },
        account: function (action) { return request('account', action); }
      };
      try {
        document.documentElement.setAttribute('data-furigana-native', 'ios');
      } catch (err) {}
    })();
    """

    // MARK: - WKScriptMessageHandler

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host == "localhost",
              let body = message.body as? [String: Any],
              let requestId = body["requestId"] as? String,
              !requestId.isEmpty else {
            return
        }
        let kind = body["kind"] as? String ?? ""
        let param = body["param"] as? String ?? ""
        if kind == "account" {
            handleAccount(requestId: requestId, action: param)
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let result: [String: Any]
            switch kind {
            case "novel":
                result = self.fetchNovel(requestId: requestId, id: param)
            case "image":
                result = self.fetchImage(requestId: requestId, urlString: param)
            default:
                result = Self.failure(requestId: requestId, error: "Unknown Pixiv request: \(kind)")
            }
            self.deliver(result)
        }
    }

    // MARK: - Local Pixiv account

    private static func isPixivCookie(_ cookie: HTTPCookie) -> Bool {
        let domain = cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
        return (domain == "pixiv.net" || domain.hasSuffix(".pixiv.net"))
            && (cookie.expiresDate == nil || cookie.expiresDate! > Date())
    }

    private func accountStatus(requestId: String) {
        Self.accountStore.httpCookieStore.getAllCookies { cookies in
            let saved = cookies.contains { Self.isPixivCookie($0) && $0.name == "PHPSESSID"
                && $0.value.range(of: "^[1-9][0-9]*_[^;\\s]+$", options: .regularExpression) != nil }
            self.deliver(["requestId": requestId, "ok": true,
                          "data": ["supported": true, "loggedIn": saved]])
        }
    }

    private func handleAccount(requestId: String, action: String) {
        switch action {
        case "status": accountStatus(requestId: requestId)
        case "login":
            guard Self.loginController == nil,
                  let root = Self.activeWebView?.window?.rootViewController else {
                deliver(Self.failure(requestId: requestId, error: "Pixiv 登录窗口不可用"))
                return
            }
            var presenter = root
            while let presented = presenter.presentedViewController { presenter = presented }
            let page = PixivLoginController(store: Self.accountStore) { [weak self] in
                Self.loginController = nil
                self?.accountStatus(requestId: requestId)
            }
            let navigation = UINavigationController(rootViewController: page)
            navigation.modalPresentationStyle = .fullScreen
            Self.loginController = navigation
            presenter.present(navigation, animated: true)
        case "logout":
            Self.accountStore.httpCookieStore.getAllCookies { cookies in
                let group = DispatchGroup()
                for cookie in cookies where Self.isPixivCookie(cookie) {
                    group.enter()
                    Self.accountStore.httpCookieStore.delete(cookie) { group.leave() }
                }
                group.notify(queue: .main) { self.accountStatus(requestId: requestId) }
            }
        default: deliver(Self.failure(requestId: requestId, error: "Unknown Pixiv account action"))
        }
    }

    /// Only native requests to Pixiv can receive these cookies, never the JS UI or relay.
    private static func cookieHeader(for url: URL) -> String? {
        guard let host = url.host, host == "pixiv.net" || host.hasSuffix(".pixiv.net") else { return nil }
        let semaphore = DispatchSemaphore(value: 0)
        var header: String?
        DispatchQueue.main.async {
            accountStore.httpCookieStore.getAllCookies { cookies in
                let matching = cookies.filter { cookie in
                    let domain = cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
                    return isPixivCookie(cookie) && (host == domain || host.hasSuffix("." + domain))
                        && url.path.hasPrefix(cookie.path)
                }
                header = HTTPCookie.requestHeaderFields(with: matching)["Cookie"]
                semaphore.signal()
            }
        }
        guard semaphore.wait(timeout: .now() + 5) == .success else { return nil }
        return header
    }

    private func deliver(_ result: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(result),
              let data = try? JSONSerialization.data(withJSONObject: result),
              let json = String(data: data, encoding: .utf8) else {
            return
        }
        let script = "window.__furiganaPixivResolve && window.__furiganaPixivResolve(\(Self.jsonStringLiteral(json)));"
        DispatchQueue.main.async {
            Self.activeWebView?.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    /// Wraps a JSON document into a JS string literal without hand-rolled escaping.
    private static func jsonStringLiteral(_ json: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [json]),
              let literal = String(data: data, encoding: .utf8) else {
            return "\"{}\""
        }
        return String(literal.dropFirst().dropLast())
    }

    // MARK: - Novel metadata

    private func fetchNovel(requestId: String, id: String) -> [String: Any] {
        guard id.range(of: "^\\d{4,15}$", options: .regularExpression) != nil,
              let url = URL(string: "https://www.pixiv.net/ajax/novel/\(id)") else {
            return Self.failure(requestId: requestId, error: "无效的 Pixiv 小说链接或 ID")
        }

        let outcome = Self.requestJSON(url: url, timeout: Self.metadataTimeout)
        switch outcome {
        case .failure(let error):
            return Self.failure(requestId: requestId, error: error.message)
        case .success(let json):
            guard let root = json as? [String: Any], let body = root["body"] as? [String: Any] else {
                let message = (json as? [String: Any])?["message"] as? String
                return Self.failure(requestId: requestId, error: message ?? "未找到该 Pixiv 小说")
            }
            let title = Self.trimmed(body["title"]) ?? "Pixiv #\(id)"
            let content = PixivContent.clean(Self.string(body["content"]) ?? "")
            guard !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                let message = body["isLoginOnly"] as? Bool == true
                    ? "这篇 Pixiv 小说需要登录后才能阅读。请前往「设置 → Pixiv 账号」登录自己的账号后重试。"
                    : "Pixiv 返回的正文为空，未导入空白书籍。作品可能需要登录或受到访问限制，请在 Pixiv 页面确认正文是否可见。"
                return Self.failure(requestId: requestId, error: message)
            }
            var coverUrl = PixivContent.mirrorCoverUrl(Self.string(body["coverUrl"]) ?? "")
            if let rawCover = Self.string(body["coverUrl"]), !rawCover.isEmpty,
               let dataUrl = fetchCoverDataUrl(rawCover) {
                coverUrl = dataUrl
            }
            return [
                "requestId": requestId,
                "ok": true,
                "data": [
                    "id": id,
                    "title": title,
                    "author": Self.trimmed(body["userName"]) ?? "",
                    "description": PixivContent.cleanDescription(Self.string(body["description"]) ?? ""),
                    "content": content,
                    "rubyOverrides": PixivContent.rubyOverrides(from: Self.string(body["content"]) ?? ""),
                    "coverUrl": coverUrl,
                    "sourceUrl": "https://www.pixiv.net/novel/show.php?id=\(id)"
                ]
            ]
        }
    }

    /// Same shape as `fetchPixivNovel`: a page refused by CORS/ATS still yields a
    /// mirror URL so the cover degrades instead of failing the import.
    private func fetchCoverDataUrl(_ urlString: String) -> String? {
        guard let url = URL(string: urlString) else { return nil }
        let outcome = Self.requestData(url: url, timeout: Self.imageTimeout)
        guard case .success(let payload) = outcome else { return nil }
        let mime = payload.contentType.hasPrefix("image/") ? payload.contentType : "image/jpeg"
        return "data:\(mime);base64,\(payload.data.base64EncodedString())"
    }

    // MARK: - Image proxy

    private func fetchImage(requestId: String, urlString: String) -> [String: Any] {
        guard urlString.hasPrefix("https://"), let url = URL(string: urlString) else {
            return Self.failure(requestId: requestId, error: "Invalid image URL")
        }
        let outcome = Self.requestData(url: url, timeout: Self.imageTimeout)
        switch outcome {
        case .failure(let error):
            return Self.failure(requestId: requestId, error: error.message)
        case .success(let payload):
            let mime = payload.contentType.hasPrefix("image/") ? payload.contentType : "image/jpeg"
            let dataUrl = "data:\(mime);base64,\(payload.data.base64EncodedString())"
            return ["requestId": requestId, "ok": true, "data": dataUrl]
        }
    }

    // MARK: - Networking

    private struct PixivBridgeError: Error {
        let message: String
    }

    private enum FetchOutcome {
        case success(Any)
        case failure(PixivBridgeError)
    }

    private struct BinaryPayload {
        let data: Data
        let contentType: String
    }

    private struct HttpClientError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private static func makeRequest(url: URL, timeout: TimeInterval) -> URLRequest {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.setValue(pixivUserAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("https://www.pixiv.net/", forHTTPHeaderField: "Referer")
        request.setValue("ja,zh-CN;q=0.9,en;q=0.8", forHTTPHeaderField: "Accept-Language")
        request.httpShouldHandleCookies = false
        if let cookies = cookieHeader(for: url) { request.setValue(cookies, forHTTPHeaderField: "Cookie") }
        return request
    }

    private enum FetchResult {
        case success(Data, HTTPURLResponse)
        case failure(PixivBridgeError)
    }

    private static func perform(_ request: URLRequest) -> FetchResult {
        let semaphore = DispatchSemaphore(value: 0)
        var outcome = FetchResult.failure(PixivBridgeError(message: "请求 Pixiv 失败"))
        let task = requestSession.dataTask(with: request) { data, response, error in
            defer { semaphore.signal() }
            if let error {
                outcome = .failure(PixivBridgeError(message: error.localizedDescription))
                return
            }
            guard let http = response as? HTTPURLResponse else {
                outcome = .failure(PixivBridgeError(message: "Pixiv 返回异常响应"))
                return
            }
            guard (200..<300).contains(http.statusCode) else {
                let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                outcome = .failure(PixivBridgeError(message: errorMessage(status: http.statusCode, body: body)))
                return
            }
            outcome = .success(data ?? Data(), http)
        }
        task.resume()
        if semaphore.wait(timeout: .now() + (request.timeoutInterval + 5)) == .timedOut {
            task.cancel()
            return .failure(PixivBridgeError(message: "请求 Pixiv 超时"))
        }
        return outcome
    }

    private static func requestJSON(url: URL, timeout: TimeInterval) -> FetchOutcome {
        switch perform(makeRequest(url: url, timeout: timeout)) {
        case .failure(let error):
            return .failure(error)
        case .success(let data, _):
            guard let object = try? JSONSerialization.jsonObject(with: data) else {
                return .failure(PixivBridgeError(message: "Pixiv 返回的内容不是有效 JSON"))
            }
            if let root = object as? [String: Any], root["error"] as? Bool == true {
                let message = root["message"] as? String ?? "未找到该 Pixiv 小说"
                return .failure(PixivBridgeError(message: message))
            }
            return .success(object)
        }
    }

    private static func requestData(url: URL, timeout: TimeInterval) -> Result<BinaryPayload, PixivBridgeError> {
        switch perform(makeRequest(url: url, timeout: timeout)) {
        case .failure(let error):
            return .failure(error)
        case .success(let data, let http):
            let contentType = http.value(forHTTPHeaderField: "Content-Type") ?? "image/jpeg"
            return .success(BinaryPayload(data: data, contentType: contentType))
        }
    }

    private static func errorMessage(status: Int, body: String) -> String {
        if status == 404 { return "未找到该 Pixiv 小说" }
        if let data = body.data(using: .utf8),
           let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
           let message = object["message"] as? String, !message.isEmpty {
            return message
        }
        return "无法从 Pixiv 获取小说 (HTTP \(status))"
    }

    private static func failure(requestId: String, error: String) -> [String: Any] {
        ["requestId": requestId, "ok": false, "error": error]
    }

    private static func string(_ value: Any?) -> String? {
        value as? String
    }

    private static func trimmed(_ value: Any?) -> String? {
        guard let text = value as? String else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// Avoid forwarding an authenticated request to a redirect target.
private final class PixivRedirectGuard: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// A separate configuration deliberately has no application scripts or message handlers.
private final class PixivLoginController: UIViewController, WKNavigationDelegate {
    private let loginView: WKWebView
    private let completed: () -> Void

    init(store: WKWebsiteDataStore, completed: @escaping () -> Void) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = store
        loginView = WKWebView(frame: .zero, configuration: configuration)
        self.completed = completed
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Pixiv"
        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(finish))
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .refresh, target: self, action: #selector(reload))
        loginView.navigationDelegate = self
        view = loginView
        loginView.load(URLRequest(url: URL(string: "https://accounts.pixiv.net/login?return_to=https%3A%2F%2Fwww.pixiv.net%2F")!))
    }

    @objc private func reload() { loginView.reload() }
    @objc private func finish() {
        loginView.stopLoading()
        dismiss(animated: true, completion: completed)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, url.scheme == "https" else {
            decisionHandler(.cancel)
            return
        }
        if navigationAction.targetFrame?.isMainFrame != false {
            let host = url.host ?? ""
            guard host == "pixiv.net" || host.hasSuffix(".pixiv.net") else { decisionHandler(.cancel); return }
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        navigationItem.prompt = "无法连接 Pixiv / Cannot connect to Pixiv"
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { navigationItem.prompt = nil }
}

/// String-level transform mirrored from `app/utils/pixivImporter.ts`.
enum PixivContent {
    private static let rubyPattern = "\\[\\[rb:([^\\s>＞]+)\\s*[>＞]\\s*([^\\]]+)\\]\\]"

    static func cleanDescription(_ html: String) -> String {
        guard !html.isEmpty else { return "" }
        var text = html.replacingOccurrences(of: "\r\n", with: "\n")
        text = replacing(text, pattern: "<br\\s*/?>", options: [.caseInsensitive], template: "\n")
        text = replacing(text, pattern: "<[^>]+>", options: [], template: "")
        for (needle, replacement) in entityMap {
            text = replacing(text, pattern: NSRegularExpression.escapedPattern(for: needle), options: [.caseInsensitive], template: replacement)
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// `[rb:kanji > reading]` and friends become readable text; readings are returned
    /// separately so the app can seed its ruby override list, exactly as TS does.
    static func clean(_ raw: String) -> String {
        guard !raw.isEmpty else { return "" }
        var text = raw.replacingOccurrences(of: "\r\n", with: "\n")
        text = replacing(text, pattern: rubyPattern, options: [], template: "$1($2)")
        text = replacing(text, pattern: "\\[chapter:([^\\]]+)\\]", options: [.caseInsensitive], template: "\n【$1】\n")
        text = replacing(text, pattern: "\\[newpage\\]", options: [.caseInsensitive], template: "\n\n")
        text = replacing(text, pattern: "\\[pixivimage:[^\\]]+\\]", options: [.caseInsensitive], template: "")
        text = replacing(text, pattern: "\\[uploadedimage:[^\\]]+\\]", options: [.caseInsensitive], template: "")
        text = replacing(text, pattern: "\n{4,}", options: [], template: "\n\n\n")
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func rubyOverrides(from raw: String) -> [String: String] {
        guard !raw.isEmpty, let regex = try? NSRegularExpression(pattern: rubyPattern) else { return [:] }
        var overrides: [String: String] = [:]
        let source = raw as NSString
        for match in regex.matches(in: raw, range: NSRange(location: 0, length: source.length)) {
            guard match.numberOfRanges == 3 else { continue }
            let kanji = source.substring(with: match.range(at: 1)).trimmingCharacters(in: .whitespacesAndNewlines)
            let reading = source.substring(with: match.range(at: 2)).trimmingCharacters(in: .whitespacesAndNewlines)
            if !kanji.isEmpty && !reading.isEmpty {
                overrides[kanji] = reading
            }
        }
        return overrides
    }

    static func mirrorCoverUrl(_ coverUrl: String) -> String {
        let trimmed = coverUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.hasPrefix("data:") else { return trimmed }
        return replacing(trimmed, pattern: "^https?://i\\.pximg\\.net/", options: [.caseInsensitive], template: "https://i.pixiv.re/")
    }

    private static let entityMap: [(String, String)] = [
        ("&nbsp;", " "),
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&quot;", "\""),
        ("&#39;", "'"),
        ("&apos;", "'"),
        ("&#x27;", "'"),
        ("&amp;", "&")
    ]

    private static func replacing(
        _ source: String,
        pattern: String,
        options: NSRegularExpression.Options,
        template: String
    ) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return source }
        let range = NSRange(location: 0, length: (source as NSString).length)
        return regex.stringByReplacingMatches(in: source, options: [], range: range, withTemplate: template)
    }
}
