import AVFoundation
import SwiftUI
import WebKit

@main
struct LumaApp: App {
    @StateObject private var web = WebModel()

    init() {
        // Keeps playing with the screen locked or the app in the background (with UIBackgroundModes: audio).
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
    }

    var body: some Scene {
        WindowGroup {
            WebView(webView: web.webView)
                .ignoresSafeArea()
                .background(Color("LaunchBackground").ignoresSafeArea())
                .preferredColorScheme(.dark)
                .onOpenURL { web.open($0) }
        }
    }
}

/// UIKit's WKWebView in SwiftUI.
struct WebView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
