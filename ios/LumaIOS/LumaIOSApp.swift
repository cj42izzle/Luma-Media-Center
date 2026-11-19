import SwiftUI

@main
struct LumaIOSApp: App {
    var body: some Scene {
        WindowGroup {
            LumaWebContainer().ignoresSafeArea()
        }
    }
}

struct LumaWebContainer: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> LumaWebController {
        LumaWebController()
    }
    func updateUIViewController(_ controller: LumaWebController, context: Context) {}
}
