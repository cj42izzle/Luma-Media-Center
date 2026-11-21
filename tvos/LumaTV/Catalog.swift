import Foundation
import SwiftUI

struct MediaItem: Identifiable, Hashable {
    let id: String
    let title: String
    let kind: String
    let year: String
    let summary: String
    let poster: URL?
    static func == (a: Self, b: Self) -> Bool { a.id == b.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

private struct CineResult: Decodable { let metas: [CineRow] }
private struct CineRow: Decodable {
    let id: String?
    let name: String?
    let poster: String?
    let description: String?
    let releaseInfo: String?
}
private struct AnimeResult: Decodable {
    let data: AnimeData?
    struct AnimeData: Decodable { let Page: Page? }
    struct Page: Decodable { let media: [AnimeRow]? }
}
private struct AnimeRow: Decodable {
    let id: Int
    let title: Titles
    let description: String?
    let startDate: StartDate?
    let coverImage: Cover?
    struct Titles: Decodable { let english: String?; let romaji: String? }
    struct StartDate: Decodable { let year: Int? }
    struct Cover: Decodable { let extraLarge: String?; let large: String? }
}

@MainActor
final class LumaCatalog: ObservableObject {
    @Published private(set) var items: [MediaItem] = []
    @Published private(set) var error: String?
    @Published private(set) var loading = false

    func load() async {
        guard !loading else { return }
        loading = true; defer { loading = false }
        async let movies = fetchCinema("movie")
        async let series = fetchCinema("series")
        async let anime = fetchAnime()
        let all = await (movies, series, anime)
        let candidates = all.0 + all.1 + all.2
        var seen = Set<String>()
        items = candidates.filter { seen.insert($0.id).inserted }
        error = items.isEmpty ? "Catalog services are unavailable. Check your internet connection." : nil
    }

    private func httpsURL(_ text: String?) -> URL? {
        guard let text, let url = URL(string: text), url.scheme == "https" else { return nil }
        return url
    }

    private func fetchCinema(_ kind: String) async -> [MediaItem] {
        guard let url = URL(string: "https://v3-cinemeta.strem.io/catalog/\(kind)/top.json") else { return [] }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return [] }
            return try JSONDecoder().decode(CineResult.self, from: data).metas.compactMap { row in
                guard let id = row.id, id.hasPrefix("tt"), let name = row.name, !name.isEmpty else { return nil }
                return MediaItem(id: "\(kind):\(id)", title: name, kind: kind, year: row.releaseInfo ?? "",
                                 summary: row.description ?? "", poster: httpsURL(row.poster))
            }
        } catch { return [] }
    }

    private func fetchAnime() async -> [MediaItem] {
        guard let url = URL(string: "https://graphql.anilist.co") else { return [] }
        let query = "query { Page(page:1,perPage:40) { media(type:ANIME,isAdult:false,sort:POPULARITY_DESC) { id title { english romaji } description(asHtml:false) startDate { year } coverImage { extraLarge large } } } }"
        do {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["query": query])
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return [] }
            return try JSONDecoder().decode(AnimeResult.self, from: data).data?.Page?.media?.compactMap { row in
                guard let title = row.title.english ?? row.title.romaji, !title.isEmpty else { return nil }
                return MediaItem(id: "anime:\(row.id)", title: title, kind: "anime",
                                 year: row.startDate?.year.map(String.init) ?? "",
                                 summary: row.description ?? "",
                                 poster: httpsURL(row.coverImage?.extraLarge ?? row.coverImage?.large))
            } ?? []
        } catch { return [] }
    }
}

@MainActor
final class LumaLibrary: ObservableObject {
    @Published var watchlist: Set<String> = [] { didSet { save() } }
    @Published var favorites: Set<String> = [] { didSet { save() } }
    @Published var watched: Set<String> = [] { didSet { save() } }
    init() {
        watchlist = Set(UserDefaults.standard.stringArray(forKey: "luma.tv.watchlist") ?? [])
        favorites = Set(UserDefaults.standard.stringArray(forKey: "luma.tv.favorites") ?? [])
        watched = Set(UserDefaults.standard.stringArray(forKey: "luma.tv.watched") ?? [])
    }
    private func save() {
        UserDefaults.standard.set(Array(watchlist), forKey: "luma.tv.watchlist")
        UserDefaults.standard.set(Array(favorites), forKey: "luma.tv.favorites")
        UserDefaults.standard.set(Array(watched), forKey: "luma.tv.watched")
    }
    func toggleWatchlist(_ id: String) { if !watchlist.insert(id).inserted { watchlist.remove(id) } }
    func toggleFavorite(_ id: String) { if !favorites.insert(id).inserted { favorites.remove(id) } }
    func toggleWatched(_ id: String) { if !watched.insert(id).inserted { watched.remove(id) } }
}
