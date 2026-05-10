import 'dart:async';
import 'dart:io';

/// A tiny HTTP server that serves static files from a local directory on
/// 127.0.0.1. We need this because Chromium WebView refuses fetch() against
/// file:// URLs ("URL scheme 'file' is not supported"). All app HTML/JS/JSON
/// is served through here so the display engine's fetch('./data/torah.json')
/// works the same way it would in a regular browser.
class LocalFileServer {
  HttpServer? _server;
  String _rootDir = '';
  int _port = 0;

  /// The base URL the WebView should use, e.g. "http://127.0.0.1:54321".
  /// Empty until [start] has run.
  String get baseUrl => _server == null ? '' : 'http://127.0.0.1:$_port';

  bool get isRunning => _server != null;

  /// Pinned by default so the WebView always loads from the same URL
  /// origin between launches. The browser keys localStorage / cookies /
  /// IndexedDB by origin (scheme + host + port), so a random port (the
  /// `bind(0)` behaviour) made every relaunch look like a new origin
  /// and silently wiped persistent state — that's why the first-launch
  /// intro popup kept re-appearing on every relaunch even after the
  /// user dismissed it. The chosen port is a high, unprivileged number
  /// unlikely to collide with anything else on a phone or emulator;
  /// if it IS taken (rare), we fall back to the OS-assigned port.
  static const int _defaultPort = 47353;

  Future<void> start({required String rootDir, int? port}) async {
    if (_server != null) return;
    _rootDir = rootDir;
    final wanted = port ?? _defaultPort;
    try {
      _server = await HttpServer.bind(InternetAddress.loopbackIPv4, wanted);
    } on SocketException {
      // Port already in use (e.g. a previous instance of the app didn't
      // shut its server down). Fall back to a random port; localStorage
      // for this launch won't line up with previous launches, but at
      // least the app boots.
      _server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    }
    _port = _server!.port;
    print('[LocalFileServer] listening on $baseUrl, root=$_rootDir');
    _server!.listen(_handle);
  }

  Future<void> stop() async {
    await _server?.close(force: true);
    _server = null;
  }

  Future<void> _handle(HttpRequest req) async {
    try {
      var path = Uri.decodeComponent(req.uri.path);
      if (path.isEmpty || path == '/') path = '/indexIntro.html';
      // Strip any leading slashes for join, but keep path normalized.
      final normalized = path.startsWith('/') ? path.substring(1) : path;
      final fsPath = _safeJoin(_rootDir, normalized);
      if (fsPath == null) {
        req.response.statusCode = HttpStatus.forbidden;
        await req.response.close();
        return;
      }
      final file = File(fsPath);
      if (!await file.exists()) {
        req.response.statusCode = HttpStatus.notFound;
        req.response.write('Not found: $path');
        await req.response.close();
        return;
      }
      final mime = _mimeFor(fsPath);
      req.response.headers.contentType = ContentType.parse(mime);
      req.response.headers.set('Cache-Control', 'no-store');
      await req.response.addStream(file.openRead());
      await req.response.close();
    } catch (e) {
      print('[LocalFileServer] error: $e');
      try {
        req.response.statusCode = HttpStatus.internalServerError;
        await req.response.close();
      } catch (_) {}
    }
  }

  String? _safeJoin(String root, String relative) {
    final resolved = File('$root/$relative').absolute.path;
    final rootAbs = Directory(root).absolute.path;
    if (!resolved.startsWith(rootAbs)) return null;
    return resolved;
  }

  String _mimeFor(String path) {
    final lower = path.toLowerCase();
    if (lower.endsWith('.html') || lower.endsWith('.htm')) {
      return 'text/html; charset=utf-8';
    }
    if (lower.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (lower.endsWith('.css')) return 'text/css; charset=utf-8';
    if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.woff2')) return 'font/woff2';
    if (lower.endsWith('.woff')) return 'font/woff';
    if (lower.endsWith('.ttf')) return 'font/ttf';
    if (lower.endsWith('.otf')) return 'font/otf';
    return 'application/octet-stream';
  }
}
