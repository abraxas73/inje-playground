import 'dart:async';
import 'dart:io' show Platform;
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import '../api/client.dart';
import '../config.dart';
import 'web_session.dart';

/// 웹 기능을 앱 안에서 연다. 세션은 앱과 별개 — /login으로 튕기면 web-token으로 부트스트랩, 연속 2회 실패면 오류 상태.
class WebScreen extends ConsumerStatefulWidget {
  const WebScreen({super.key, required this.path});
  final String path;
  @override
  ConsumerState<WebScreen> createState() => _WebScreenState();
}

class _WebScreenState extends ConsumerState<WebScreen> with WidgetsBindingObserver {
  late final WebViewController _c;
  final _origin = Uri.parse(Config.apiBase);
  String _title = '';
  bool _loading = true;
  String? _error;
  final _guard = BootstrapGuard();
  // 오류는 바로 보여 주지 않는다 — 가로챈 내비게이션 뒤 곧바로 새 로드가 시작되면(seq 증가) 그 오류는 버린다.
  int _loadSeq = 0;
  Timer? _errTimer;
  final _back = BackTracker();
  bool _openingOAuth = false;
  bool _openingBrowser = false;
  bool _refreshAfterOAuth = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _c = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(
        onNavigationRequest: _onNav,
        onPageStarted: (u) {
          if (!mounted) return;
          // 뒤로 가다가 /login·/auth/mobile에 닿으면 세션 시작점(첫 로드의 유령 항목) — 부트스트랩을 또 하지 말고 화면을 닫는다
          if (_back.consume() && isSessionBoundary(u, appOrigin: _origin)) {
            if (mounted) Navigator.of(context).pop();
            return;
          }
          _loadSeq++;
          _errTimer?.cancel();
          setState(() { _loading = true; _error = null; });
        },
        onPageFinished: (_) async {
          if (Platform.isMacOS) {
            try {
              await const MethodChannel('com.innogrid.playground/webview').invokeMethod<void>(
                'enableFilePicker', (_c.platform as WebKitWebViewController).webViewIdentifier);
            } on PlatformException catch (_) {
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                  content: Text('파일 선택창을 준비하지 못했습니다. 브라우저로 열어 이용해 주세요.')));
              }
            }
          }
          final t = await _c.getTitle();
          if (mounted) setState(() { _loading = false; _title = t ?? ''; });
        },
        onWebResourceError: (e) {
          if (!(e.isForMainFrame ?? true) || isIgnorableWebError(code: e.errorCode, description: e.description)) return;
          final seq = _loadSeq;
          _errTimer?.cancel();
          _errTimer = Timer(const Duration(milliseconds: 700), () {
            if (mounted && seq == _loadSeq) setState(() { _loading = false; _error = '페이지를 불러오지 못했습니다 (${e.description})'; });
          });
        },
      ));
    _setUserAgent().then((_) {
      if (mounted) _c.loadRequest(Uri.parse('${Config.apiBase}${widget.path}'));
    });
    if (Platform.isAndroid) {
      (_c.platform as AndroidWebViewController).setOnShowFileSelector((params) async {
        if (params.mode == FileSelectorMode.openMultiple) {
          final files = await FilePicker.pickFiles();
          return files.map((f) => f.uri.toString()).toList();
        }
        final f = await FilePicker.pickFile();
        return f == null ? <String>[] : [f.uri.toString()];
      });
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _errTimer?.cancel();
    super.dispose();
  }

  Future<void> _setUserAgent() async {
    final ua = await _c.getUserAgent();
    await _c.setUserAgent('${ua ?? ''} ${Config.userAgent(Platform.operatingSystem)}'.trim());
  }

  Future<NavigationDecision> _onNav(NavigationRequest req) async {
    final uri = Uri.parse(req.url);
    switch (WebNavPolicy.decide(uri, appOrigin: _origin)) {
      case NavAction.oauthConnect:
        if (req.isMainFrame) unawaited(_connectOAuth(uri));
        return NavigationDecision.prevent;
      case NavAction.inApp:
        return NavigationDecision.navigate;
      case NavAction.external:
        if (req.isMainFrame) unawaited(_openInBrowser(uri));
        return NavigationDecision.prevent;
      case NavAction.loginRedirect:
        _bootstrap(uri.queryParameters['next'] ?? widget.path);
        return NavigationDecision.prevent;
    }
  }

  Future<void> _openInBrowser([Uri? destination]) async {
    if (_openingBrowser) return;
    setState(() => _openingBrowser = true);
    try {
      var target = destination ?? Uri.tryParse(await _c.currentUrl() ?? '') ??
          _origin.resolve(widget.path);
      if (!target.hasScheme || isSessionBoundary(target.toString(), appOrigin: _origin)) {
        target = _origin.resolve(widget.path);
      }
      // Blob URLs belong to the WebView process; open the source page instead.
      if (target.scheme == 'blob') {
        target = Uri.tryParse(await _c.currentUrl() ?? '') ?? _origin.resolve(widget.path);
      }
      final next = browserSessionPath(target, appOrigin: _origin);
      final url = next == null ? target : Uri.parse(await webBootstrapUrl(
        ref.read(apiClientProvider), Config.apiBase, next));
      if (!mounted) return;
      if (!await launchUrl(url, mode: LaunchMode.externalApplication)) {
        throw StateError('Browser unavailable');
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('브라우저로 열지 못했습니다. 다시 시도해 주세요.')));
      }
    } finally {
      if (mounted) setState(() => _openingBrowser = false);
    }
  }

  // OAuth 시작·콜백이 같은 브라우저의 쿠키를 사용하도록 먼저 별도 웹 세션을 만든다.
  Future<void> _connectOAuth(Uri uri) async {
    if (_openingOAuth) return;
    _openingOAuth = true;
    try {
      final next = Uri(path: uri.path, query: uri.hasQuery ? uri.query : null).toString();
      final url = await webBootstrapUrl(ref.read(apiClientProvider), Config.apiBase, next);
      if (!mounted) return;
      _refreshAfterOAuth = true;
      if (!await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication)) {
        throw StateError('브라우저를 열지 못했습니다');
      }
    } catch (_) {
      _refreshAfterOAuth = false;
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('계정 연결을 시작하지 못했습니다. 다시 시도해 주세요.')));
    } finally {
      _openingOAuth = false;
      if (mounted) setState(() { _loading = false; });
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _refreshAfterOAuth) {
      _refreshAfterOAuth = false;
      unawaited(_reload());
    }
  }

  Future<void> _bootstrap(String nextPath) async {
    if (!_guard.tryBegin()) {
      if (mounted) setState(() { _loading = false; _error = '로그인 상태를 만들지 못했습니다. 다시 시도해 주세요.'; });
      return;
    }
    try {
      final url = await webBootstrapUrl(ref.read(apiClientProvider), Config.apiBase, nextPath.startsWith('/') ? nextPath : widget.path);
      await _c.loadRequest(Uri.parse(url));
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() { _loading = false; _error = e.message; });
    } catch (e) {
      if (!mounted) return;
      setState(() { _loading = false; _error = '로그인 상태를 만들지 못했습니다: $e'; });
    }
  }

  /// /auth/mobile에서의 reload는 토큰 없는 재진입이라 처음부터(원래 경로 → /login → 부트스트랩) 다시 간다.
  Future<void> _reload() async {
    if (isAuthBootstrapPage(await _c.currentUrl(), appOrigin: _origin)) {
      _retry();
    } else {
      await _c.reload();
    }
  }

  void _retry() {
    setState(() { _error = null; _guard.reset(); });
    _c.loadRequest(Uri.parse('${Config.apiBase}${widget.path}'));
  }

  Future<void> _goBack() async {
    final canGoBack = await _c.canGoBack();
    if (!mounted) return;
    if (canGoBack) {
      _back.begin();
      await _c.goBack();
    } else {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) => CallbackShortcuts(
    bindings: Platform.isMacOS ? {
      const SingleActivator(LogicalKeyboardKey.keyR, meta: true): () => unawaited(_reload()),
      const SingleActivator(LogicalKeyboardKey.bracketLeft, meta: true): () => unawaited(_goBack()),
    } : {},
    child: Focus(
      autofocus: Platform.isMacOS,
      child: PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) unawaited(_goBack());
        },
        child: Scaffold(
          appBar: AppBar(
            leading: BackButton(onPressed: _goBack),
            title: Text(webTitleFor(title: _title, loading: _loading, path: widget.path), overflow: TextOverflow.ellipsis),
            actions: [
              IconButton(icon: const Icon(Icons.refresh), tooltip: '새로고침', onPressed: _reload),
              IconButton(icon: const Icon(Icons.open_in_browser), tooltip: '브라우저로 열기', onPressed: _openingBrowser ? null : () => _openInBrowser()),
            ],
            bottom: _loading ? const PreferredSize(preferredSize: Size.fromHeight(2), child: LinearProgressIndicator(minHeight: 2)) : null,
          ),
          body: _error != null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(_error!, textAlign: TextAlign.center),
                  const SizedBox(height: 12),
                  FilledButton(onPressed: _retry, child: const Text('다시 시도')),
                ])))
              : WebViewWidget(controller: _c),
        ),
      ),
    ),
  );
}
