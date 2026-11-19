import UIKit
import WebKit
import AVKit
import AVFoundation
import UniformTypeIdentifiers

/// Native iPhone shell for the Luma website. Native URLSession can read an
/// authorized HTTP Xtream playlist, and AVPlayer renders supported Dolby Vision
/// / Dolby Digital+ / Atmos tracks without transcoding or a paid proxy.
/// Releasing this on an iPhone still requires Apple code signing.
final class LumaWebController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, UIDocumentPickerDelegate {
    private var browser: WKWebView!
    private let site = URL(string: "https://cj42izzle.github.io/Luma-Media-Center/")!
    private let trustedHost = "cj42izzle.github.io"

    private let fetchBridge = #"""
    (() => {
      const requests = new Map();
      window.LumaNativeIPTV = {
        fetchText(raw, requestedLimit) {
          return new Promise((resolve, reject) => {
            const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
            const limit = Math.max(1024, Math.min(6 * 1024 * 1024, Number(requestedLimit) || 1000000));
            const timeout = setTimeout(() => {
              requests.delete(id);
              reject(new Error("The IPTV provider did not respond"));
            }, 35000);
            requests.set(id, {resolve, reject, timeout});
            window.webkit.messageHandlers.lumaNativeIPTV.postMessage({action:"fetchText",id,url:String(raw),limit});
          });
        },
        _receive(result) {
          const item = requests.get(result.id);
          if (!item) return;
          clearTimeout(item.timeout);
          requests.delete(result.id);
          if (result.error) item.reject(new Error(result.error));
          else item.resolve(String(result.text || ""));
        }
      };
    })();
    """#

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        let scripts = config.userContentController
        scripts.addUserScript(WKUserScript(source: fetchBridge,
                                           injectionTime: .atDocumentStart,
                                           forMainFrameOnly: true))
        scripts.add(self, name: "lumaNativeIPTV")
        scripts.add(self, name: "lumaNativePlayer")
        browser = WKWebView(frame: .zero, configuration: config)
        browser.navigationDelegate = self
        browser.isOpaque = false
        browser.backgroundColor = UIColor(red: 0.04, green: 0.05, blue: 0.09, alpha: 1)
        view = browser
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        browser.load(URLRequest(url: site, cachePolicy: .useProtocolCachePolicy))
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
    }

    private func allowedURL(_ string: String) -> URL? {
        guard string.count <= 6000, let url = URL(string: string),
              ["http","https"].contains(url.scheme?.lowercased() ?? ""),
              url.user == nil, url.password == nil,
              let host = url.host, !host.isEmpty else { return nil }
        let lower = host.lowercased()
        if lower == "localhost" || lower.hasSuffix(".local") || lower == "0.0.0.0" || lower == "::1" { return nil }
        // Reject loopback/link-local/private network IPs from browser bridge requests.
        let octets = lower.split(separator: ".").compactMap { Int($0) }
        if octets.count == 4 && octets.allSatisfy({ $0 >= 0 && $0 <= 255 }) {
            if [0,10,127].contains(octets[0]) || octets[0] == 169 && octets[1] == 254
                || octets[0] == 172 && (16...31).contains(octets[1])
                || octets[0] == 192 && octets[1] == 168 { return nil }
        }
        return url
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host.lowercased() == trustedHost,
              browser.url?.scheme?.lowercased() == "https",
              browser.url?.host?.lowercased() == trustedHost,
              let data = message.body as? [String: Any] else { return }
        if message.name == "lumaNativePlayer" {
            if data["action"] as? String == "openFile" {
                openNativeFilePicker()
                return
            }
            guard data["action"] as? String == "play",
                  let raw = data["url"] as? String,
                  let url = allowedURL(raw) else { return }
            let title = String((data["title"] as? String ?? "Luma IPTV").prefix(160))
            presentMedia(url, title: title)
        } else if message.name == "lumaNativeIPTV" {
            guard data["action"] as? String == "fetchText",
                  let id = data["id"] as? String,
                  id.count < 100, id.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) }),
                  let raw = data["url"] as? String, let url = allowedURL(raw) else { return }
            let limit = min(6 * 1024 * 1024, max(1024, data["limit"] as? Int ?? 1000000))
            fetchText(url, id: id, limit: limit)
        }
    }

    private func fetchText(_ url: URL, id: String, limit: Int) {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: 27)
        request.httpMethod = "GET"
        let session = URLSession(configuration: .ephemeral)
        session.dataTask(with: request) { [weak self] data, response, error in
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            if error != nil || !(200..<300).contains(code) {
                self?.sendResponse(id, text: nil, error: "The IPTV provider could not return its playlist or guide.")
            } else if let data, data.count <= limit,
                      let content = String(data: data, encoding: .utf8) {
                self?.sendResponse(id, text: content, error: nil)
            } else {
                self?.sendResponse(id, text: nil, error: "IPTV playlist is too large or not UTF-8 text.")
            }
            session.finishTasksAndInvalidate()
        }.resume()
    }

    private func sendResponse(_ id: String, text: String?, error: String?) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.browser.url?.host?.lowercased() == self.trustedHost else { return }
            let textValue: Any = text == nil ? NSNull() : text!
            let errorValue: Any = error == nil ? NSNull() : error!
            let object: [String: Any] = ["id": id, "text": textValue, "error": errorValue]
            guard let data = try? JSONSerialization.data(withJSONObject: object),
                  let json = String(data: data, encoding: .utf8) else { return }
            self.browser.evaluateJavaScript("window.LumaNativeIPTV?._receive(\(json))",
                                            completionHandler: nil)
        }
    }

    private func openNativeFilePicker() {
        guard presentedViewController == nil else { return }
        // The Files picker can browse local storage, iCloud Drive and any
        // third-party provider that exposes files through the iOS Files app.
        // AVPlayer still requires an Apple-supported container and codec.
        let picker = UIDocumentPickerViewController(
            forOpeningContentTypes: [.movie, .video, .audiovisualContent, .item],
            asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        present(picker, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController,
                        didPickDocumentsAt urls: [URL]) {
        guard let file = urls.first, file.isFileURL else { return }
        // asCopy:true hands AVPlayer an app-accessible local copy, without
        // persistent access to an entire provider or uploading the file.
        let title = file.deletingPathExtension().lastPathComponent
        controller.dismiss(animated: true) { [weak self] in
            self?.presentMedia(file, title: title)
        }
    }

    private func presentMedia(_ url: URL, title: String) {
        guard presentedViewController == nil else { return }
        let player = AVPlayer(url: url)
        player.allowsExternalPlayback = true
        let viewer = AVPlayerViewController()
        viewer.player = player
        viewer.title = title
        viewer.showsPlaybackControls = true
        viewer.allowsPictureInPicturePlayback = true
        present(viewer, animated: true) { player.play() }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.targetFrame?.isMainFrame == true &&
           (url.scheme?.lowercased() != "https" || url.host?.lowercased() != trustedHost) {
            if ["http","https"].contains(url.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
        } else { decisionHandler(.allow) }
    }
}
