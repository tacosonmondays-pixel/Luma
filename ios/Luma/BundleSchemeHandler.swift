import UniformTypeIdentifiers
import WebKit

/// Serves luma://app/… from the app bundle's www/ folder (the web build).
/// App routes such as /search get index.html; api/ answers 404 at once, so the web app runs in phone mode.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root = Bundle.main.resourceURL!.appendingPathComponent("www", isDirectory: true).standardizedFileURL

    private static let types = [
        "html": "text/html", "js": "text/javascript", "mjs": "text/javascript", "css": "text/css",
        "json": "application/json", "webmanifest": "application/manifest+json", "svg": "image/svg+xml",
        "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp",
        "woff": "font/woff", "woff2": "font/woff2", "ttf": "font/ttf", "otf": "font/otf", "wasm": "application/wasm",
        "txt": "text/plain", "ico": "image/x-icon", "mp4": "video/mp4", "m4a": "audio/mp4", "mp3": "audio/mpeg",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let url = task.request.url!
        let path = url.path.removingPercentEncoding ?? url.path

        if path.hasPrefix("/api/") { return respond(task, url, status: 404, type: "text/plain", body: Data()) }

        if let file = file(for: path), let data = try? Data(contentsOf: file) {
            return respond(task, url, status: 200, type: mimeType(file.pathExtension), body: data)
        }
        // A missing asset is a 404; anything else is an app route.
        if !(path as NSString).pathExtension.isEmpty {
            return respond(task, url, status: 404, type: "text/plain", body: Data())
        }
        let index = root.appendingPathComponent("index.html")
        respond(task, url, status: 200, type: "text/html", body: (try? Data(contentsOf: index)) ?? Data())
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {} // every response is sent synchronously

    /// The file under www/ for a URL path, if there is one (never outside www/).
    private func file(for path: String) -> URL? {
        let file = root.appendingPathComponent(String(path.drop(while: { $0 == "/" }))).standardizedFileURL
        var isDirectory: ObjCBool = false
        guard file.path.hasPrefix(root.path + "/"),
              FileManager.default.fileExists(atPath: file.path, isDirectory: &isDirectory),
              !isDirectory.boolValue else { return nil }
        return file
    }

    private func mimeType(_ ext: String) -> String {
        Self.types[ext.lowercased()] ?? UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
    }

    private func respond(_ task: WKURLSchemeTask, _ url: URL, status: Int, type: String, body: Data) {
        let headers = ["Content-Type": type, "Content-Length": String(body.count), "Cache-Control": "no-cache"]
        task.didReceive(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(body)
        task.didFinish()
    }
}
