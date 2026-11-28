import Foundation
import Vision
import WebKit
import UIKit

/// Native Apple Vision OCR bridge for the packaged iOS app.
/// Mirrors `PixivNativeBridge.swift`: exposes `window.furiganaOcr` to the local
/// `capacitor://localhost` origin and returns top-left pixel-coordinate boxes.
final class OcrNativeBridge: NSObject, WKScriptMessageHandler {
    static let messageHandlerName = "furiganaOcr"
    private static weak var activeWebView: WKWebView?

    static func attach(_ webView: WKWebView) {
        activeWebView = webView
    }

    static func register(on configuration: WKWebViewConfiguration) {
        let alreadyRegistered = configuration.userContentController.userScripts.contains {
            $0.source.contains("__furiganaOcrResolve")
        }
        guard !alreadyRegistered else { return }

        configuration.userContentController.add(OcrNativeBridge(), name: messageHandlerName)
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: bridgeScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
    }

    private static let bridgeScript = """
    (function () {
      if (window.furiganaOcr) { return; }
      var handler = window.webkit && window.webkit.messageHandlers
        ? window.webkit.messageHandlers.furiganaOcr
        : null;
      if (!handler) { return; }

      var pending = {};
      var seq = 0;

      window.__furiganaOcrResolve = function (payloadJson) {
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
          entry.reject(new Error(payload.error || 'Apple Vision OCR failed'));
        }
      };

      window.furiganaOcr = {
        isNative: true,
        engine: 'apple-vision',
        recognize: function (base64Image) {
          return new Promise(function (resolve, reject) {
            var requestId = 'ocr-' + Date.now().toString(36) + '-' + (++seq);
            pending[requestId] = { resolve: resolve, reject: reject };
            try {
              handler.postMessage({ imageBase64: base64Image, requestId: requestId });
            } catch (err) {
              delete pending[requestId];
              reject(err);
            }
          });
        }
      };
    })();
    """

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host == "localhost",
              let body = message.body as? [String: Any],
              let requestId = body["requestId"] as? String,
              !requestId.isEmpty,
              let imageBase64 = body["imageBase64"] as? String else {
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let result = self.recognizeBase64(requestId: requestId, base64: imageBase64)
            self.deliver(result)
        }
    }

    private func recognizeBase64(requestId: String, base64: String) -> [String: Any] {
        let rawBase64: String
        if let comma = base64.firstIndex(of: ","), base64.hasPrefix("data:") {
            rawBase64 = String(base64[base64.index(after: comma)...])
        } else {
            rawBase64 = base64
        }
        guard let data = Data(base64Encoded: rawBase64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: data),
              let cgImage = image.cgImage else {
            return ["requestId": requestId, "ok": false, "error": "Invalid image data"]
        }

        let width = Double(cgImage.width)
        let height = Double(cgImage.height)
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["ja-JP", "zh-Hans", "en-US"]
        request.usesLanguageCorrection = true

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return ["requestId": requestId, "ok": false, "error": error.localizedDescription]
        }

        var boxes: [[String: Any]] = []
        for observation in request.results ?? [] {
            guard let top = observation.topCandidates(1).first else { continue }
            let text = top.string.trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty { continue }
            let bb = observation.boundingBox
            let px = bb.origin.x * width
            let pw = bb.size.width * width
            let ph = bb.size.height * height
            let py = (1.0 - bb.origin.y - bb.size.height) * height
            boxes.append([
                "x": px,
                "y": py,
                "width": pw,
                "height": ph,
                "text": text,
                "confidence": Double(top.confidence),
                "vertical": ph > pw * 1.15
            ])
        }

        return [
            "requestId": requestId,
            "ok": true,
            "data": [
                "width": width,
                "height": height,
                "boxes": boxes
            ]
        ]
    }

    private func deliver(_ result: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(result),
              let data = try? JSONSerialization.data(withJSONObject: result),
              let json = String(data: data, encoding: .utf8) else {
            return
        }
        let escaped: String
        if let wrapped = try? JSONSerialization.data(withJSONObject: [json]),
           let literal = String(data: wrapped, encoding: .utf8) {
            escaped = String(literal.dropFirst().dropLast())
        } else {
            return
        }
        let script = "window.__furiganaOcrResolve && window.__furiganaOcrResolve(\(escaped));"
        DispatchQueue.main.async {
            Self.activeWebView?.evaluateJavaScript(script, completionHandler: nil)
        }
    }
}
