import UIKit
import WebKit

/// The one web view, its configuration, and where it is allowed to go.
@MainActor
final class WebModel: NSObject, ObservableObject {
    static let origin = URL(string: "luma://app/")!

    let webView: WKWebView
    private var loaded = false

    override init() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: "luma")
        config.websiteDataStore = .default() // persistent: IndexedDB keeps the songs and the profile
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = [] // the next track can start in the background
        config.userContentController.addUserScript(WKUserScript(
            source: "window.lumaNative = { platform: 'ios', bundleId: '\(Bundle.main.bundleIdentifier ?? "")' }",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))

        webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(named: "LaunchBackground")
        webView.underPageBackgroundColor = webView.backgroundColor
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never // the page handles the safe areas
        webView.scrollView.bounces = false
        if #available(iOS 16.4, *) { webView.isInspectable = true } // Safari → Develop, for debugging

        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        load(Self.origin)
    }

    private func load(_ url: URL) {
        loaded = true
        webView.load(URLRequest(url: url))
    }

    /// `luma://search` (or `luma://app/search`) from outside → the app's /search route.
    func open(_ url: URL) {
        guard url.scheme == "luma" else { return }
        var path = url.host == "app" ? url.path : "/" + (url.host ?? "") + url.path
        if path.isEmpty { path = "/" }
        if let query = url.query { path += "?" + query }

        if !loaded || webView.url == nil {
            return load(URL(string: path, relativeTo: Self.origin)!.absoluteURL)
        }
        // Route in place, without a reload, so playback keeps going (router.ts listens for popstate).
        let js = "if (location.pathname + location.search !== \(literal(path))) { history.pushState(null, '', \(literal(path))); dispatchEvent(new PopStateEvent('popstate')) }"
        webView.evaluateJavaScript(js)
    }

    private func literal(_ s: String) -> String {
        let data = try! JSONSerialization.data(withJSONObject: [s])
        return String(String(data: data, encoding: .utf8)!.dropFirst().dropLast())
    }

    private static func isApp(_ url: URL) -> Bool {
        (url.scheme == "luma" && url.host == "app") || ["about", "blob", "data"].contains(url.scheme ?? "")
    }
}

extension WebModel: WKNavigationDelegate, WKUIDelegate {
    /// Everything outside the app (https links, shortcuts://run-shortcut for "Save to Luma") opens outside it.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, !Self.isApp(url) else { return decisionHandler(.allow) }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    /// target=_blank and window.open.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, !Self.isApp(url) { UIApplication.shared.open(url) }
        return nil
    }

    /// iOS can end the web content process in the background; come back to a working page.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}
