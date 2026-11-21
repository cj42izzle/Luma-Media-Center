import SwiftUI
import AVKit
import Security

struct TVChannel: Identifiable {
    let id: Int
    let title: String
    let url: URL
}

enum PlaylistCredential {
    private static let service = "io.github.cj42izzle.luma.tvos"
    static func read() -> String {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: "playlist-url",
                                    kSecReturnData as String: true,
                                    kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }
    static func write(_ value: String) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: "playlist-url"]
        SecItemDelete(query as CFDictionary)
        guard !value.isEmpty, let data = value.data(using: .utf8) else { return }
        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(attributes as CFDictionary, nil)
    }
}

@MainActor
final class TVPlaylist: ObservableObject {
    @Published var address: String = PlaylistCredential.read()
    @Published private(set) var channels: [TVChannel] = []
    @Published var error: String?
    @Published var loading = false

    func load() async {
        guard !loading else { return }
        let raw = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: raw), url.scheme == "https", url.host != nil else {
            error = "Enter an HTTPS M3U playlist URL from your authorized provider."; return
        }
        loading = true; defer { loading = false }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200, data.count < 5_000_000,
                  let text = String(data: data, encoding: .utf8) else {
                throw NSError(domain: "Luma", code: 1, userInfo: [NSLocalizedDescriptionKey: "Playlist unavailable or too large."])
            }
            var parsed: [TVChannel] = []
            var title = ""
            for line in text.components(separatedBy: .newlines) {
                let value = line.trimmingCharacters(in: .whitespacesAndNewlines)
                if value.hasPrefix("#EXTINF:") {
                    title = String(value.split(separator: ",", maxSplits: 1, omittingEmptySubsequences: false).last ?? "")
                } else if !value.hasPrefix("#"), !value.isEmpty {
                    if let stream = URL(string: value), ["https", "http"].contains(stream.scheme ?? ""),
                       !title.isEmpty, parsed.count < 5000 {
                        parsed.append(TVChannel(id: parsed.count, title: title, url: stream))
                    }
                    title = ""
                }
            }
            guard !parsed.isEmpty else { throw NSError(domain: "Luma", code: 2, userInfo: [NSLocalizedDescriptionKey: "No usable channels in this playlist."]) }
            channels = parsed
            PlaylistCredential.write(raw)
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

struct NativeTVPlayer: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = AVPlayer(url: url)
        controller.player?.play()
        return controller
    }
    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if controller.player == nil { controller.player = AVPlayer(url: url) }
    }
}
