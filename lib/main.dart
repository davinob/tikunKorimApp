import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'local_server.dart';
import 'update_service.dart';

class _GitHubCertOverrides extends HttpOverrides {
  static const _trustedHosts = [
    'raw.githubusercontent.com',
    'api.github.com',
    'github.com',
  ];

  @override
  HttpClient createHttpClient(SecurityContext? context) {
    return super.createHttpClient(context)
      ..badCertificateCallback = (cert, host, port) =>
          _trustedHosts.contains(host);
  }
}

// We serve the bundled-then-disk HTML/JS/JSON over an in-app HTTP server on
// 127.0.0.1 because Chromium WebView refuses to fetch() against file:// URLs
// ("URL scheme 'file' is not supported"), and our display engine relies on
// fetch() to load data/torah.json.
final LocalFileServer localServer = LocalFileServer();

Future main() async {
  WidgetsFlutterBinding.ensureInitialized();
  HttpOverrides.global = _GitHubCertOverrides();
  await UpdateService.instance.initialize();
  await localServer.start(rootDir: UpdateService.instance.getLocalBasePath());
  runApp(MyApp());
}

class MyApp extends StatefulWidget {
  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> with WidgetsBindingObserver {
  InAppWebViewController? webViewController;
  final UpdateService _updateService = UpdateService.instance;
  Timer? _updateTimer;
  bool _initialSyncDone = false;

  static const _updateInterval = Duration(minutes: 5);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _initialSyncDone = _updateService.hasLocalContent;
    _checkForUpdates();
    _updateTimer = Timer.periodic(_updateInterval, (_) => _checkForUpdates());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _checkForUpdates();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _updateTimer?.cancel();
    super.dispose();
  }

  Future<void> _checkForUpdates() async {
    if (!_updateService.isConfigured) return;

    final result = await _updateService.checkAndUpdate();
    print('[Main] Update result: ${result.message}');

    if (!_initialSyncDone && _updateService.hasLocalContent && mounted) {
      _initialSyncDone = true;
      webViewController?.loadUrl(
        urlRequest: URLRequest(url: WebUri('${localServer.baseUrl}/indexIntro.html')),
      );
    } else if (result.needsReload && _initialSyncDone && mounted) {
      print('[Main] Reloading WebView after update');
      webViewController?.reload();
    }
  }

  void _goToIndex() {
    webViewController?.loadUrl(
      urlRequest: URLRequest(url: WebUri('${localServer.baseUrl}/index.html')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        body: PopScope(
          canPop: false,
          onPopInvokedWithResult: (didPop, result) {
            if (!didPop) _goToIndex();
          },
          child: SafeArea(
            child: _buildWebView(),
          ),
        ),
      ),
    );
  }

  Widget _buildWebView() {
    final settings = InAppWebViewSettings(
      supportZoom: false,
      javaScriptEnabled: true,
      cacheEnabled: false,
      textZoom: Platform.isAndroid ? 170 : 100,
    );

    return InAppWebView(
      onWebViewCreated: (controller) => webViewController = controller,
      initialUrlRequest: URLRequest(
        url: WebUri('${localServer.baseUrl}/indexIntro.html'),
      ),
      initialSettings: settings,
      onConsoleMessage: (controller, msg) {
        print('[WebView console] ${msg.messageLevel}: ${msg.message}');
      },
    );
  }
}
