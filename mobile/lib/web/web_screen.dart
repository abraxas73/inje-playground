import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart' show defaultTargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../web/app_webview.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import '../api/client.dart';
import '../config.dart';
import '../app/theme.dart';
import 'app_actions.dart';
import 'web_session.dart';
import '../favorites/favorites.dart';
import '../more/catalog.dart';

/// 웹 기능을 앱 안에서 연다. 세션은 앱과 별개 — /login으로 튕기면 web-token으로 부트스트랩, 연속 2회 실패면 오류 상태.
class WebScreen extends ConsumerStatefulWidget {
  const WebScreen({super.key, required this.path});
  final String path;
  @override
  ConsumerState<WebScreen> createState() => _WebScreenState();
}

class _WebScreenState extends ConsumerState<WebScreen>
    with WidgetsBindingObserver {
  late final AppWebController _c;
  final _origin = Uri.parse(Config.apiBase);
  String _title = '';
  /// 지금 보고 있는 우리 웹 경로(경로+쿼리) — 페이지 안에서 이동하면 따라 바뀐다(즐겨찾기 대상).
  late String _pagePath = widget.path;
  bool _loading = true;
  String? _error;
  final _guard = BootstrapGuard();
  // 오류는 바로 보여 주지 않는다 — 가로챈 내비게이션 뒤 곧바로 새 로드가 시작되면(seq 증가) 그 오류는 버린다.
  int _loadSeq = 0;
  Timer? _errTimer;
  // 웹 페이지 자체 제목 줄(h1 + 설명 p + 아이콘)을 읽어 앱 상단 한 줄(제목·설명)로 옮기고 페이지 쪽은 숨긴다 — 제목이 두 번 나오지 않게.
  // 페이지가 데이터를 읽은 뒤 제목을 그리거나(SPA) 창 폭에 따라 숨기므로(md 미만) 주기적으로 다시 본다. null = 페이지 제목 줄 없음/안 보임.
  ({String title, String desc})? _pageHead;
  Timer? _titleTimer;
  final _back = BackTracker();
  bool _openingOAuth = false;
  bool _openingBrowser = false;
  bool _refreshAfterOAuth = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _c = AppWebController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        AppNavigationDelegate(
          onNavigationRequest: _onNav,
          onTitleChanged: (title) {
            if (mounted) setState(() => _title = title ?? '');
          },
          onPageStarted: (u) {
            if (!mounted) return;
            // 뒤로 가다가 /login·/auth/mobile에 닿으면 세션 시작점(첫 로드의 유령 항목) — 부트스트랩을 또 하지 말고 화면을 닫는다
            if (_back.consume() && isSessionBoundary(u, appOrigin: _origin)) {
              if (mounted) Navigator.of(context).pop();
              return;
            }
            _loadSeq++;
            _errTimer?.cancel();
            setState(() {
              _loading = true;
              _error = null;
            });
          },
          onPageFinished: (_) async {
            if (Platform.isMacOS) {
              try {
                await const MethodChannel(
                  'com.innogrid.playground/webview',
                ).invokeMethod<void>(
                  'enableFilePicker',
                  (_c.platform as WebKitWebViewController).webViewIdentifier,
                );
              } on PlatformException catch (_) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('파일 선택창을 준비하지 못했습니다. 브라우저로 열어 이용해 주세요.'),
                    ),
                  );
                }
              }
            }
            try {
              await _c.runJavaScript(blankLinkBridgeJs);
            } catch (_) {} // 새 창 링크를 같은 창 이동으로(외부는 _onNav가 브라우저로)
            final t = await _c.getTitle();
            unawaited(_checkPageTitle());
            _titleTimer ??= Timer.periodic(const Duration(seconds: 2), (_) => _checkPageTitle());
            final here = pagePathOf(await _c.currentUrl(), appOrigin: _origin);
            if (mounted) {
              setState(() {
                _loading = false;
                _title = t ?? '';
                if (here != null) _pagePath = here;
              });
            }
          },
          onWebResourceError: (e) {
            if (!(e.isForMainFrame ?? true) ||
                isIgnorableWebError(
                  code: e.errorCode,
                  description: e.description,
                )) {
              return;
            }
            final seq = _loadSeq;
            _errTimer?.cancel();
            _errTimer = Timer(const Duration(milliseconds: 700), () {
              if (mounted && seq == _loadSeq) {
                setState(() {
                  _loading = false;
                  _error = '페이지를 불러오지 못했습니다 (${e.description})';
                });
              }
            });
          },
        ),
      );
    unawaited(_loadInitial());
    if (Platform.isAndroid) {
      (_c.platform as AndroidWebViewController).setOnShowFileSelector((
        params,
      ) async {
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
    _titleTimer?.cancel();
    super.dispose();
  }

  Future<void> _setUserAgent() async {
    final ua = await _c.getUserAgent();
    await _c.setUserAgent(
      '${ua ?? ''} ${Config.userAgent(Platform.operatingSystem)}'.trim(),
    );
  }

  Future<void> _loadInitial() async {
    try {
      await _setUserAgent();
      final url = await initialWebSessionUrl(
        ref.read(apiClientProvider),
        Config.apiBase,
        widget.path,
        eagerBootstrap: Platform.isWindows,
      );
      if (mounted) {
        await _c.loadRequest(Uri.parse(url));
      }
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e.message;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = '로그인 상태를 만들지 못했습니다: $e';
        });
      }
    }
  }

  Future<NavigationDecision> _onNav(NavigationRequest req) async {
    final uri = Uri.parse(req.url);
    // 웹 화면이 여는 앱 네이티브 화면(조직도의 메신저 대화·메일 보내기)
    if (isAppAction(uri, _origin)) {
      if (req.isMainFrame && mounted) unawaited(handleAppAction(context, ref, uri));
      return NavigationDecision.prevent;
    }
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
      var target =
          destination ??
          Uri.tryParse(await _c.currentUrl() ?? '') ??
          _origin.resolve(widget.path);
      if (!target.hasScheme ||
          isSessionBoundary(target.toString(), appOrigin: _origin)) {
        target = _origin.resolve(widget.path);
      }
      // Blob URLs belong to the WebView process; open the source page instead.
      if (target.scheme == 'blob') {
        target =
            Uri.tryParse(await _c.currentUrl() ?? '') ??
            _origin.resolve(widget.path);
      }
      final next = browserSessionPath(target, appOrigin: _origin);
      final url = next == null
          ? target
          : Uri.parse(
              await webBootstrapUrl(
                ref.read(apiClientProvider),
                Config.apiBase,
                next,
              ),
            );
      if (!mounted) return;
      if (!await launchUrl(url, mode: LaunchMode.externalApplication)) {
        throw StateError('Browser unavailable');
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('브라우저로 열지 못했습니다. 다시 시도해 주세요.')),
        );
      }
    } finally {
      if (mounted) setState(() => _openingBrowser = false);
    }
  }

  // Microsoft는 네이티브 세션으로 승인 URL을 발급해 별도 웹 로그인을 만들지 않는다. Jira는 기존 웹 세션 흐름을 유지한다.
  Future<void> _connectOAuth(Uri uri) async {
    if (_openingOAuth) return;
    _openingOAuth = true;
    try {
      final url = await oauthLaunchUrl(ref.read(apiClientProvider), uri);
      if (!mounted) return;
      _refreshAfterOAuth = true;
      if (!await launchUrl(
        Uri.parse(url),
        mode: LaunchMode.externalApplication,
      )) {
        throw StateError('브라우저를 열지 못했습니다');
      }
    } catch (_) {
      _refreshAfterOAuth = false;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('계정 연결을 시작하지 못했습니다. 다시 시도해 주세요.')),
        );
      }
    } finally {
      _openingOAuth = false;
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
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
      if (mounted) {
        setState(() {
          _loading = false;
          _error = '로그인 상태를 만들지 못했습니다. 다시 시도해 주세요.';
        });
      }
      return;
    }
    try {
      final url = await webBootstrapUrl(
        ref.read(apiClientProvider),
        Config.apiBase,
        nextPath.startsWith('/') ? nextPath : widget.path,
      );
      await _c.loadRequest(Uri.parse(url));
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.message;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = '로그인 상태를 만들지 못했습니다: $e';
      });
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
    setState(() {
      _error = null;
      _loading = true;
      _guard.reset();
    });
    unawaited(_loadInitial());
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

  // 보이는 h1을 찾아 제목·설명을 돌려주고, 그 h1·바로 옆 설명 p·아이콘(그림만 있는 형제)을 숨긴다. 버튼 등 나머지는 그대로.
  // 한 번 옮긴 h1은 data-app-title에 값을 남겨 숨긴 뒤에도 같은 값을 돌려준다(페이지가 바뀌면 새 h1).
  static const _pageHeadJs = r"""(() => {
  const h = document.querySelector('h1'); if (!h) return '';
  if (h.dataset.appTitle) return h.dataset.appTitle;
  const r = h.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return '';
  const box = h.parentElement; const p = box ? box.querySelector(':scope > p') : null;
  const v = JSON.stringify({t: (h.textContent || '').trim(), d: p ? (p.textContent || '').trim() : ''});
  h.dataset.appTitle = v;
  if (!document.getElementById('app-title-style')) { const s = document.createElement('style'); s.id = 'app-title-style'; s.textContent = '[data-app-hidden]{display:none!important}'; document.head.appendChild(s); }
  const hide = (e) => e && e.setAttribute('data-app-hidden', '');
  const iconOnly = (e) => e && !(e.textContent || '').trim() && (e.tagName.toLowerCase() === 'svg' || e.querySelector('svg'));
  hide(h); hide(p);
  if (box) for (const c of Array.from(box.children)) if (c !== h && c !== p && iconOnly(c)) hide(c);
  const prev = box && box.previousElementSibling; if (iconOnly(prev)) hide(prev);
  return v;
})()""";

  Future<void> _checkPageTitle() async {
    try {
      var raw = '${await _c.runJavaScriptReturningResult(_pageHeadJs)}';
      if (raw.startsWith('"')) raw = jsonDecode(raw) as String; // Android 등은 문자열을 JSON으로 한 번 감싸 돌려준다
      ({String title, String desc})? head;
      if (raw.isNotEmpty) {
        final j = jsonDecode(raw);
        if (j is Map && '${j['t'] ?? ''}'.isNotEmpty) head = (title: '${j['t']}', desc: '${j['d'] ?? ''}');
      }
      if (mounted && head != _pageHead) setState(() => _pageHead = head);
    } catch (_) {}
  }

  String _headerTitle() {
    if (!_loading && _pageHead != null) return _pageHead!.title; // 페이지 제목 줄을 옮겨 온 경우
    final t = webTitleFor(title: _title, loading: _loading);
    return _loading || t != '이노그리드' ? t : (pageLabelFor(_pagePath) ?? t);
  }

  @override
  Widget build(BuildContext context) => CallbackShortcuts(
    bindings: defaultTargetPlatform == TargetPlatform.macOS
        ? {
            const SingleActivator(LogicalKeyboardKey.keyR, meta: true): () =>
                unawaited(_reload()),
            const SingleActivator(
              LogicalKeyboardKey.bracketLeft,
              meta: true,
            ): () =>
                unawaited(_goBack()),
          }
        : {},
    child: Focus(
      autofocus: defaultTargetPlatform == TargetPlatform.macOS,
      child: PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) unawaited(_goBack());
        },
        child: Scaffold(
          appBar: AppBar(
            leading: BackButton(onPressed: _goBack),
            title: Row(children: [
              Flexible(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                  Text(
                    // 웹 페이지 <title>이 사이트 이름(이노그리드)뿐이면 메뉴 이름으로(즐겨찾기 이름과 같게). 페이지가 구체적인 제목을 주면 그대로.
                    _headerTitle(),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  // 페이지 제목 줄의 가벼운 설명(있으면) — 제목 아래 작게 한 줄
                  if (!_loading && (_pageHead?.desc.isNotEmpty ?? false))
                    Text(_pageHead!.desc, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w400, color: Brand.muted)),
                ]),
              ),
              if (!_loading && _error == null)
                FavoriteStar(
                  path: '/web?path=${Uri.encodeComponent(_pagePath)}',
                  title: pageLabelFor(_pagePath) ?? webTitleFor(title: _title, loading: false),
                ),
            ]),
            actions: [
              IconButton(
                icon: const Icon(Icons.refresh),
                tooltip: '새로고침',
                onPressed: _reload,
              ),
              IconButton(
                icon: const Icon(Icons.open_in_browser),
                tooltip: '브라우저로 열기',
                onPressed: _openingBrowser ? null : () => _openInBrowser(),
              ),
            ],
            bottom: _loading
                ? const PreferredSize(
                    preferredSize: Size.fromHeight(2),
                    child: LinearProgressIndicator(minHeight: 2),
                  )
                : null,
          ),
          body: Stack(
            fit: StackFit.expand,
            children: [
              Offstage(offstage: _error != null, child: _c.build(context, avoidFabs: true)),
              if (_error != null)
                Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error!, textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        FilledButton(
                          onPressed: _retry,
                          child: const Text('다시 시도'),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    ),
  );
}
