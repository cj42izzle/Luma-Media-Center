import SwiftUI

@main
struct LumaTVApp: App {
    @StateObject private var catalog = LumaCatalog()
    @StateObject private var library = LumaLibrary()
    @StateObject private var playlist = TVPlaylist()

    var body: some Scene {
        WindowGroup {
            LumaTVRoot()
                .environmentObject(catalog)
                .environmentObject(library)
                .environmentObject(playlist)
                .preferredColorScheme(.dark)
                .task { await catalog.load() }
        }
    }
}

struct LumaTVRoot: View {
    @EnvironmentObject private var catalog: LumaCatalog
    @EnvironmentObject private var library: LumaLibrary
    @EnvironmentObject private var playlist: TVPlaylist
    @State private var query = ""
    @State private var newViewerName = ""
    @State private var selected: TVChannel?

    var body: some View {
        NavigationStack {
            TabView {
                home.tabItem { Label("Home", systemImage: "house.fill") }
                live.tabItem { Label("Live TV", systemImage: "tv.fill") }
                discover.tabItem { Label("Discover", systemImage: "sparkles.tv.fill") }
                search.tabItem { Label("Search", systemImage: "magnifyingglass") }
                myStuff.tabItem { Label("My Stuff", systemImage: "heart.text.square.fill") }
                profiles.tabItem { Label("Profiles", systemImage: "person.2.fill") }
                settings.tabItem { Label("Settings", systemImage: "gearshape.fill") }
            }
            .navigationDestination(for: MediaItem.self) { item in
                DetailPage(item: item)
            }
        }
        .fullScreenCover(item: $selected) { channel in
            NativeTVPlayer(url: channel.url).ignoresSafeArea()
                .overlay(alignment: .topLeading) {
                    Text(channel.title).font(.caption).padding(10)
                        .background(.black.opacity(0.55)).padding()
                }
        }
    }

    private var home: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 42) {
                Text("Luma").font(.system(size: 62, weight: .black))
                Text("Watching as "+library.activeViewerName).font(.title3).foregroundStyle(.secondary)
                Text("Your entertainment, without the clutter.")
                    .font(.title2).foregroundStyle(.secondary)
                if catalog.loading { ProgressView("Loading verified catalogs…") }
                if let error = catalog.error { Text(error).foregroundStyle(.orange) }
                shelf("Continue Watching", items: catalog.items.filter { library.watched.contains($0.id) })
                shelf("Your Watchlist", items: catalog.items.filter { library.watchlist.contains($0.id) })
                shelf("Your Favorites", items: catalog.items.filter { library.favorites.contains($0.id) })
                shelf("Movies to Discover", items: Array(catalog.items.filter { $0.kind == "movie" }.prefix(14)))
                shelf("TV Series", items: Array(catalog.items.filter { $0.kind == "series" }.prefix(14)))
                shelf("Anime", items: Array(catalog.items.filter { $0.kind == "anime" }.prefix(14)))
            }
            .padding(60)
        }
    }

    private func shelf(_ title: String, items: [MediaItem]) -> some View {
        Group {
            if !items.isEmpty {
                VStack(alignment: .leading, spacing: 20) {
                    Text(title).font(.title2.bold())
                    ScrollView(.horizontal) {
                        LazyHStack(spacing: 26) {
                            ForEach(items) { item in
                                NavigationLink(value: item) { PosterCard(item: item) }
                                    .buttonStyle(.plain)
                            }
                        }
                        .padding(.vertical, 18)
                    }
                }
                .focusSection()
            }
        }
    }

    private var discover: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 34) {
                Text("Discover").font(.largeTitle.bold())
                shelf("Movies", items: catalog.items.filter { $0.kind == "movie" })
                shelf("Series", items: catalog.items.filter { $0.kind == "series" })
                shelf("Anime", items: catalog.items.filter { $0.kind == "anime" })
                Button("Refresh Catalog") { Task { await catalog.load() } }
            }
            .padding(60)
        }
    }

    private var search: some View {
        let matches = query.isEmpty ? [] : catalog.items.filter {
            $0.title.localizedCaseInsensitiveContains(query)
        }
        return ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                Text("Search").font(.largeTitle.bold())
                TextField("Search movies, series and anime", text: $query)
                    .frame(maxWidth: 750)
                Text(query.isEmpty ? "Enter a title to search the loaded catalog." : "\(matches.count) matching titles")
                    .foregroundStyle(.secondary)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 25), count: 5), spacing: 25) {
                    ForEach(matches) { item in
                        NavigationLink(value: item) { PosterCard(item: item) }
                            .buttonStyle(.plain)
                    }
                }
            }
            .padding(60)
        }
    }

    private var live: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 25) {
                Text("Live TV").font(.largeTitle.bold())
                if playlist.channels.isEmpty {
                    Text("Connect an authorized HTTPS M3U source in Settings to load channels.")
                        .foregroundStyle(.secondary)
                    Button("Load configured playlist") { Task { await playlist.load() } }
                } else {
                    Text("\(playlist.channels.count) loaded channels")
                        .foregroundStyle(.secondary)
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 20), count: 4), spacing: 20) {
                        ForEach(playlist.channels) { channel in
                            Button { selected = channel } label: {
                                VStack(alignment: .leading, spacing: 12) {
                                    Image(systemName: "play.tv.fill").font(.largeTitle)
                                    Text(channel.title).lineLimit(2)
                                }
                                .frame(maxWidth: .infinity, minHeight: 100, alignment: .leading)
                                .padding(12)
                            }
                        }
                    }
                }
                if let error = playlist.error {
                    Text(error).foregroundStyle(.orange)
                }
            }
            .padding(60)
        }
    }

    private var myStuff: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 36) {
                Text("My Stuff").font(.largeTitle.bold())
                shelf("Watchlist", items: catalog.items.filter { library.watchlist.contains($0.id) })
                shelf("Favorites", items: catalog.items.filter { library.favorites.contains($0.id) })
                shelf("Marked Watched", items: catalog.items.filter { library.watched.contains($0.id) })
                Text("Saved locally on this Apple TV; not automatically synced with Luma on other devices.")
                    .foregroundStyle(.secondary).font(.footnote)
            }
            .padding(60)
        }
    }

    private var profiles: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                Text("Who is watching?").font(.largeTitle.bold())
                Text("Viewer history, Favorites and Watchlist are saved separately on this Apple TV.")
                    .foregroundStyle(.secondary)
                ForEach(library.viewers) { viewer in
                    HStack(spacing: 22) {
                        Image(systemName: "person.crop.circle.fill").font(.system(size: 46))
                        VStack(alignment: .leading) {
                            Text(viewer.name).font(.title2.bold())
                            if viewer.id == library.activeViewerID {
                                Text("Current viewer").foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Button(viewer.id == library.activeViewerID ? "Selected" : "Switch") {
                            library.selectViewer(viewer.id)
                        }
                        .disabled(viewer.id == library.activeViewerID)
                        if viewer.id != "default" {
                            Button("Delete") { _ = library.removeViewer(viewer.id) }
                        }
                    }
                    .padding(19)
                    .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 15))
                }
                if library.viewers.count < 8 {
                    TextField("New viewer name", text: $newViewerName)
                        .frame(maxWidth: 660)
                    Button("Add Viewer") {
                        if library.addViewer(newViewerName) { newViewerName = "" }
                    }
                }
                Text("Profiles are not password-protected or automatically synchronized with Luma on other devices. The default viewer cannot be deleted.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding(60)
        }
    }

    private var settings: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                Text("Settings").font(.largeTitle.bold())
                Text("Live TV playlist").font(.title2.bold())
                TextField("HTTPS M3U playlist URL", text: $playlist.address)
                    .frame(maxWidth: 900)
                Button(playlist.loading ? "Loading…" : "Connect & Load Channels") {
                    Task { await playlist.load() }
                }
                .disabled(playlist.loading)
                if let error = playlist.error { Text(error).foregroundStyle(.orange) }
                Text("Playlist addresses are stored in this Apple TV's Keychain. Only authorized media is supported.")
                    .font(.footnote).foregroundStyle(.secondary)
                Divider()
                Text("Native tvOS preview: guide, DVR, add-on playback and cross-device sync still require native integrations.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding(60)
        }
    }
}

struct PosterCard: View {
    let item: MediaItem
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            AsyncImage(url: item.poster) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                ZStack {
                    RoundedRectangle(cornerRadius: 14).fill(.white.opacity(0.10))
                    Image(systemName: "film").font(.system(size: 44))
                }
            }
            .frame(width: 210, height: 300)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            Text(item.title).font(.headline).lineLimit(2).frame(width: 210, alignment: .leading)
            Text(item.year).foregroundStyle(.secondary).font(.caption)
        }
        .frame(width: 210, alignment: .leading)
        .padding(8)
    }
}

struct DetailPage: View {
    @EnvironmentObject private var library: LumaLibrary
    let item: MediaItem
    var body: some View {
        ScrollView {
            HStack(alignment: .top, spacing: 50) {
                AsyncImage(url: item.poster) { image in
                    image.resizable().scaledToFit()
                } placeholder: {
                    Image(systemName: "film").font(.system(size: 65))
                }
                .frame(width: 300, height: 430)
                VStack(alignment: .leading, spacing: 24) {
                    Text(item.title).font(.system(size: 52, weight: .bold))
                    Text(item.kind.capitalized + "  ·  " + item.year).foregroundStyle(.secondary)
                    Text(item.summary.isEmpty ? "Synopsis unavailable from the metadata provider." : item.summary)
                        .lineLimit(8).frame(maxWidth: 820, alignment: .leading)
                    HStack(spacing: 18) {
                        Button(library.watchlist.contains(item.id) ? "✓ In Watchlist" : "+ Add to Watchlist") {
                            library.toggleWatchlist(item.id)
                        }
                        Button(library.favorites.contains(item.id) ? "♥ In Favorites" : "♡ Add to Favorites") {
                            library.toggleFavorite(item.id)
                        }
                        Button(library.watched.contains(item.id) ? "Mark Unwatched" : "Mark Watched") {
                            library.toggleWatched(item.id)
                        }
                    }
                    Text("This catalog shows provider metadata, not a guaranteed playback source.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .padding(60)
        }
    }
}
