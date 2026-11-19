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
    private var channelQueue: [(url: URL, title: String)] = []
    private var channelIndex = 0
    private weak var activePlayerViewer: AVPlayerViewController?
    private weak var previousChannelButton: UIButton?
    private weak var nextChannelButton: UIButton?
    private weak var skipButton: UIButton?
    private weak var skipPlayer: AVPlayer?
    private var skipObserver: Any?
    private var skipPlan: [String: Any] = [:]
    private var currentSkipKind = ""
    private var appliedSkips = Set<String>()
    private var playbackStatusObservation: NSKeyValueObservation?
    private var triedHLSAlternative = false

    // GitHub Pages repositories share a host. Only this project's path can
    // invoke native IPTV networking or media playback.
    private func trustedPage(_ url: URL?) -> Bool {
        guard let url,
              url.scheme?.lowercased() == "https",
              url.host?.lowercased() == trustedHost else { return false }
        return url.path == "/Luma-Media-Center" ||
               url.path.hasPrefix("/Luma-Media-Center/")
    }

    private let fetchBridge = #"""
    (() => {
      const requests = new Map();
      const MAX_BYTES = 25 * 1024 * 1024;
      window.LumaNativeIPTV = {
        version: 2,
        maxBytes: MAX_BYTES,
        fetchText(raw, requestedLimit) {
          return new Promise((resolve, reject) => {
            const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
            const limit = Math.max(1024, Math.min(MAX_BYTES, Number(requestedLimit) || 1000000));
            const timeout = setTimeout(() => {
              requests.delete(id);
              reject(new Error("The IPTV provider took too long to respond"));
            }, 120000);
            requests.set(id, {resolve, reject, timeout, limit, chunks: [], received: 0});
            window.webkit.messageHandlers.lumaNativeIPTV.postMessage({action:"fetchText",id,url:String(raw),limit});
          });
        },
        _receive(result) {
          const item = requests.get(result.id);
          if (!item) return;
          const fail = message => {
            clearTimeout(item.timeout);
            requests.delete(result.id);
            item.reject(new Error(message));
          };
          if (result.error) { fail(String(result.error)); return; }
          if (typeof result.chunk === "string") {
            try {
              const binary = atob(result.chunk);
              const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
              item.received += bytes.byteLength;
              if (item.received > item.limit) { fail("IPTV guide exceeds the supported size"); return; }
              item.chunks.push(bytes);
              if (!result.final) return;
              const data = new Uint8Array(item.received);
              let offset = 0;
              for (const part of item.chunks) { data.set(part, offset); offset += part.length; }
              const text = new TextDecoder("utf-8", {fatal: true}).decode(data);
              clearTimeout(item.timeout);
              requests.delete(result.id);
              item.resolve(text);
            } catch { fail("IPTV guide contains invalid data"); }
            return;
          }
          clearTimeout(item.timeout);
          requests.delete(result.id);
          item.resolve(String(result.text || ""));
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
        let normalizedHost = lower.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        if normalizedHost == "localhost" || normalizedHost.hasSuffix(".localhost") ||
           normalizedHost.hasSuffix(".local") || normalizedHost == "0.0.0.0" ||
           normalizedHost == "::1" || normalizedHost == "::" { return nil }
        if normalizedHost.contains(":") &&
           (normalizedHost.hasPrefix("fc") || normalizedHost.hasPrefix("fd") ||
            normalizedHost.hasPrefix("fe80:") || normalizedHost.hasPrefix("::ffff:")) {
            return nil
        }
        // Reject loopback/link-local/private network IPs from browser bridge requests.
        let octets = normalizedHost.split(separator: ".").compactMap { Int($0) }
        if octets.count == 4 && octets.allSatisfy({ $0 >= 0 && $0 <= 255 }) {
            if [0,10,127].contains(octets[0]) ||
                (octets[0] == 100 && (64...127).contains(octets[1])) ||
                (octets[0] == 169 && octets[1] == 254) ||
                (octets[0] == 172 && (16...31).contains(octets[1])) ||
                (octets[0] == 192 && octets[1] == 168) ||
                (octets[0] == 198 && (18...19).contains(octets[1])) ||
                octets[0] >= 224 { return nil }
        }
        return url
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol.lowercased() == "https",
              message.frameInfo.securityOrigin.host.lowercased() == trustedHost,
              trustedPage(browser.url),
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
            skipPlan = data["skip"] as? [String: Any] ?? [:]
            appliedSkips.removeAll()
            let rows = data["queue"] as? [[String: Any]] ?? []
            let selected = data["index"] as? Int ?? 0
            var items: [(url: URL, title: String)] = []
            if rows.count > 1 && rows.count <= 41 {
                for entry in rows {
                    guard let raw = entry["url"] as? String,
                          let mediaURL = allowedURL(raw) else { items = []; break }
                    let label = String((entry["title"] as? String ?? "Channel").prefix(130))
                    items.append((url: mediaURL, title: label))
                }
                if !(items.count == rows.count && selected >= 0 &&
                     selected < items.count && items[selected].url == url) {
                    items = []
                }
            }
            channelQueue = items
            channelIndex = items.isEmpty ? 0 : selected
            presentMedia(url, title: title)
        } else if message.name == "lumaNativeIPTV" {
            guard data["action"] as? String == "fetchText",
                  let id = data["id"] as? String,
                  id.count < 100,
                  id.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) })
            else { return }
            guard let raw = data["url"] as? String, let url = allowedURL(raw) else {
                sendResponse(id, text: nil, error: "Enter a permitted HTTP(S) IPTV playlist or guide URL.")
                return
            }
            let limit = min(25 * 1024 * 1024, max(1024, data["limit"] as? Int ?? 1000000))
            fetchText(url, id: id, limit: limit)
        }
    }

    private func fetchText(_ url: URL, id: String, limit: Int) {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: 65)
        request.httpMethod = "GET"
        // Enforce the size limit incrementally; dataTask completion handlers
        // otherwise buffer the entire HTTP response before checking its size.
        let delegate = LumaSameHostRedirects(source: url, maxBytes: limit) { [weak self] text, error in
            self?.sendResponse(id, text: text, error: error)
        }
        let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
        session.dataTask(with: request).resume()
    }

    private func sendResponse(_ id: String, text: String?, error: String?) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.trustedPage(self.browser.url) else { return }
            // Chunk large guide responses rather than injecting a 25 MB JavaScript literal
            // in one evaluateJavaScript call. No playlist URLs leave the local app.
            if let text, text.utf8.count > 160_000 {
                let bytes = Array(text.utf8)
                func sendChunk(_ offset: Int) {
                    let end = min(bytes.count, offset + 128 * 1024)
                    let chunk = Data(bytes[offset..<end]).base64EncodedString()
                    let value: [String: Any] = [
                        "id": id, "chunk": chunk, "final": end == bytes.count
                    ]
                    guard let payload = try? JSONSerialization.data(withJSONObject: value),
                          let json = String(data: payload, encoding: .utf8) else { return }
                    self.browser.evaluateJavaScript("window.LumaNativeIPTV?._receive(\(json))") {
                        _, evaluationError in
                        if evaluationError == nil && end < bytes.count {
                            sendChunk(end)
                        }
                    }
                }
                sendChunk(0)
                return
            }
            let object: [String: Any] = [
                "id": id, "text": text == nil ? NSNull() : text!,
                "error": error == nil ? NSNull() : error!
            ]
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
            self?.channelQueue = []
            self?.channelIndex = 0
            self?.skipPlan = [:]
            self?.appliedSkips.removeAll()
            self?.presentMedia(file, title: title)
        }
    }

    private func makeChannelButton(_ title: String, action: Selector) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(title, for: .normal)
        button.setTitleColor(.white, for: .normal)
        button.backgroundColor = UIColor.black.withAlphaComponent(0.75)
        button.layer.cornerRadius = 11
        button.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        button.contentEdgeInsets = UIEdgeInsets(top: 12, left: 16, bottom: 12, right: 16)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    private func addQueueControls(to viewer: AVPlayerViewController) {
        guard channelQueue.count > 1 else { return }
        viewer.loadViewIfNeeded()
        guard let overlay = viewer.contentOverlayView else { return }
        let previous = makeChannelButton("‹ Previous", action: #selector(previousChannel))
        let next = makeChannelButton("Next ›", action: #selector(nextChannel))
        overlay.addSubview(previous)
        overlay.addSubview(next)
        NSLayoutConstraint.activate([
            previous.leadingAnchor.constraint(equalTo: overlay.safeAreaLayoutGuide.leadingAnchor, constant: 14),
            previous.topAnchor.constraint(equalTo: overlay.safeAreaLayoutGuide.topAnchor, constant: 12),
            next.leadingAnchor.constraint(equalTo: previous.trailingAnchor, constant: 10),
            next.centerYAnchor.constraint(equalTo: previous.centerYAnchor)
        ])
        previousChannelButton = previous
        nextChannelButton = next
        updateQueueControls()
    }

    private func addSkipControls(to viewer: AVPlayerViewController) {
        viewer.loadViewIfNeeded()
        guard let overlay = viewer.contentOverlayView else { return }
        let button = makeChannelButton("Skip intro ››", action: #selector(skipCurrentSegment))
        button.isHidden = true
        overlay.addSubview(button)
        NSLayoutConstraint.activate([
            button.trailingAnchor.constraint(equalTo: overlay.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            button.bottomAnchor.constraint(equalTo: overlay.safeAreaLayoutGuide.bottomAnchor, constant: -74)
        ])
        skipButton = button
    }

    private func updateSkipControl(at seconds: Double) {
        guard let player = activePlayerViewer?.player, seconds.isFinite, seconds >= 0 else {
            skipButton?.isHidden = true
            return
        }
        let duration = player.currentItem?.duration.seconds ?? .nan
        var match = ""
        for kind in ["recap", "intro"] {
            guard let part = skipPlan[kind] as? [String: Any],
                  let a = part["start"] as? NSNumber,
                  let b = part["end"] as? NSNumber else { continue }
            let start = a.doubleValue, end = b.doubleValue
            guard start.isFinite, end.isFinite, start >= 0,
                  end > start + 3, end - start <= 600, end < 86400 else { continue }
            if seconds >= start && seconds < end - 3 { match = kind; break }
        }
        if match.isEmpty, duration.isFinite, duration > 10, duration < 86400,
           let startValue = skipPlan["creditsStart"] as? NSNumber {
            let start = startValue.doubleValue
            if start.isFinite && start >= 0 && seconds >= start && seconds < duration - 3 &&
                start < duration - 5 { match = "credits" }
        }
        currentSkipKind = match
        skipButton?.isHidden = match.isEmpty
        if !match.isEmpty {
            let text = match == "recap" ? "Skip recap" : match == "intro" ? "Skip intro" : "Skip credits"
            skipButton?.setTitle(text + " ››", for: .normal)
            if skipPlan["autoSkip"] as? Bool == true && !appliedSkips.contains(match) {
                skipSegment(match)
            }
        }
    }

    @objc private func skipCurrentSegment() { skipSegment(currentSkipKind) }

    private func skipSegment(_ kind: String) {
        guard !kind.isEmpty, let player = activePlayerViewer?.player else { return }
        var target = 0.0
        if kind == "credits" {
            let duration = player.currentItem?.duration.seconds ?? .nan
            guard duration.isFinite, duration > 10, duration < 86400 else { return }
            target = duration - 0.25
        } else {
            guard let part = skipPlan[kind] as? [String: Any],
                  let end = part["end"] as? NSNumber else { return }
            target = end.doubleValue
            guard target.isFinite, target > 0, target < 86400 else { return }
        }
        appliedSkips.insert(kind)
        skipButton?.isHidden = true
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600),
                    toleranceBefore: .zero, toleranceAfter: .zero)
    }

    private func updateQueueControls() {
        previousChannelButton?.isEnabled = channelIndex > 0
        nextChannelButton?.isEnabled = channelIndex + 1 < channelQueue.count
        previousChannelButton?.alpha = channelIndex > 0 ? 1 : 0.4
        nextChannelButton?.alpha = channelIndex + 1 < channelQueue.count ? 1 : 0.4
    }

    @objc private func previousChannel() { moveChannel(-1) }
    @objc private func nextChannel() { moveChannel(1) }

    // Xtream services can expose the same live channel as raw MPEG-TS or HLS.
    // AVPlayer generally supports HLS more broadly than standalone TS.
    // Retry only the exact same stream, host and credentials with .m3u8.
    private func hlsCandidate(for url: URL) -> URL? {
        guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              url.pathExtension.lowercased() == "ts",
              url.pathComponents.contains("live"),
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return nil }
        components.path = String(components.path.dropLast(3)) + ".m3u8"
        guard let candidate = components.url,
              candidate.host?.lowercased() == url.host?.lowercased(),
              candidate.scheme?.lowercased() == url.scheme?.lowercased()
        else { return nil }
        return candidate
    }

    private func observeMediaItem(_ item: AVPlayerItem, source: URL) {
        playbackStatusObservation?.invalidate()
        playbackStatusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] observed, _ in
            guard observed.status == .failed else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self,
                      let viewer = self.activePlayerViewer,
                      viewer.player?.currentItem === observed else { return }
                if !self.triedHLSAlternative, let alternative = self.hlsCandidate(for: source) {
                    self.triedHLSAlternative = true
                    let next = AVPlayerItem(url: alternative)
                    viewer.player?.replaceCurrentItem(with: next)
                    self.observeMediaItem(next, source: alternative)
                    viewer.player?.play()
                } else {
                    self.showMediaError(in: viewer)
                }
            }
        }
    }

    private func showMediaError(in viewer: AVPlayerViewController) {
        guard let overlay = viewer.contentOverlayView else { return }
        let tag = 4188
        guard overlay.viewWithTag(tag) == nil else { return }
        let message = UILabel()
        message.tag = tag
        message.text = "This stream could not play in Luma. Check provider access or supported HLS/video codecs."
        message.textAlignment = .center
        message.numberOfLines = 0
        message.textColor = .white
        message.backgroundColor = UIColor.black.withAlphaComponent(0.86)
        message.font = .systemFont(ofSize: 15, weight: .medium)
        message.layer.cornerRadius = 12
        message.layer.masksToBounds = true
        message.translatesAutoresizingMaskIntoConstraints = false
        overlay.addSubview(message)
        NSLayoutConstraint.activate([
            message.leadingAnchor.constraint(equalTo: overlay.safeAreaLayoutGuide.leadingAnchor, constant: 22),
            message.trailingAnchor.constraint(equalTo: overlay.safeAreaLayoutGuide.trailingAnchor, constant: -22),
            message.bottomAnchor.constraint(equalTo: overlay.safeAreaLayoutGuide.bottomAnchor, constant: -135),
            message.heightAnchor.constraint(greaterThanOrEqualToConstant: 62)
        ])
    }

    private func moveChannel(_ direction: Int) {
        let target = channelIndex + direction
        guard target >= 0, target < channelQueue.count,
              let viewer = activePlayerViewer else { return }
        channelIndex = target
        skipPlan = [:]
        currentSkipKind = ""
        appliedSkips.removeAll()
        skipButton?.isHidden = true
        let channel = channelQueue[target]
        viewer.title = channel.title
        triedHLSAlternative = false
        viewer.contentOverlayView?.viewWithTag(4188)?.removeFromSuperview()
        let item = AVPlayerItem(url: channel.url)
        viewer.player?.replaceCurrentItem(with: item)
        observeMediaItem(item, source: channel.url)
        viewer.player?.play()
        updateQueueControls()
    }

    private func presentMedia(_ url: URL, title: String) {
        guard presentedViewController == nil else { return }
        triedHLSAlternative = false
        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        player.allowsExternalPlayback = true
        let viewer = AVPlayerViewController()
        viewer.player = player
        viewer.title = title
        viewer.showsPlaybackControls = true
        viewer.allowsPictureInPicturePlayback = true
        activePlayerViewer = viewer
        observeMediaItem(item, source: url)
        addQueueControls(to: viewer)
        addSkipControls(to: viewer)
        if let token = skipObserver, let previous = skipPlayer {
            previous.removeTimeObserver(token)
        }
        skipPlayer = player
        skipObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            self?.updateSkipControl(at: time.seconds)
        }
        present(viewer, animated: true) { player.play() }
    }

    deinit {
        playbackStatusObservation?.invalidate()
        if let token = skipObserver, let player = skipPlayer {
            player.removeTimeObserver(token)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard trustedPage(webView.url) else { return }
        // First native launch: open the provider login once, or auto-reload
        // previously saved channels. The app still honors user navigation afterward.
        let onboarding = #"""
        (() => {
          try {
            if (!window.LumaNativeIPTV || typeof LumaIPTV === "undefined") return;
            const KEY = "luma.native.onboarding.v1";
            if (localStorage.getItem(KEY) === "1") return;
            const config = JSON.parse(localStorage.getItem("luma.iptv.v1") || "{}");
            const saved = !!(config.browserSources?.length || config.m3u);
            localStorage.setItem(KEY, "1");
            if (typeof state !== "undefined") {
              state.tab = "Live TV";
              if (typeof nav === "function") nav();
            }
            LumaIPTV.render(saved ? "guide" : "connections");
          } catch {}
        })();
        """#
        webView.evaluateJavaScript(onboarding, completionHandler: nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.targetFrame?.isMainFrame != false && !trustedPage(url) {
            if ["http","https"].contains(url.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
        } else { decisionHandler(.allow) }
    }
}

/// Streams playlist/EPG text with a hard size ceiling and same-provider redirects.
private final class LumaSameHostRedirects: NSObject, URLSessionDataDelegate {
    private let originalHost: String
    private let originalScheme: String
    private let originalPort: Int
    private let maxBytes: Int
    private let completion: (String?, String?) -> Void
    private var received = Data()
    private var failure: String?

    init(source: URL, maxBytes: Int, completion: @escaping (String?, String?) -> Void) {
        originalHost = source.host?.lowercased() ?? ""
        originalScheme = source.scheme?.lowercased() ?? ""
        originalPort = source.port ?? (originalScheme == "https" ? 443 : 80)
        self.maxBytes = maxBytes
        self.completion = completion
        super.init()
    }

    func urlSession(_ session: URLSession,
                    task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        guard let destination = request.url,
              destination.host?.lowercased() == originalHost,
              destination.user == nil, destination.password == nil else {
            completionHandler(nil)
            return
        }
        let scheme = destination.scheme?.lowercased() ?? ""
        let port = destination.port ?? (scheme == "https" ? 443 : 80)
        let sameOrigin = scheme == originalScheme && port == originalPort
        let safeUpgrade = originalScheme == "http" && scheme == "https" &&
                          originalPort == 80 && port == 443
        // Reject HTTPS -> HTTP downgrades, port changes and cross-host redirects.
        completionHandler(sameOrigin || safeUpgrade ? request : nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode) else {
            failure = "The IPTV provider could not return its playlist or guide."
            completionHandler(.cancel)
            return
        }
        guard response.expectedContentLength <= Int64(maxBytes) else {
            failure = "IPTV playlist/EPG exceeds the supported size."
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive data: Data) {
        guard data.count <= maxBytes - received.count else {
            failure = "IPTV playlist/EPG exceeds the supported size."
            dataTask.cancel()
            return
        }
        received.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    didCompleteWithError error: Error?) {
        if let failure {
            completion(nil, failure)
        } else if error != nil {
            completion(nil, "The IPTV provider could not return its playlist or guide.")
        } else if let text = String(data: received, encoding: .utf8) {
            completion(text, nil)
        } else {
            completion(nil, "IPTV playlist/EPG is not UTF-8 text.")
        }
        session.finishTasksAndInvalidate()
    }
}
