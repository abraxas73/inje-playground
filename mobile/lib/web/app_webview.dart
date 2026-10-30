import 'dart:async';
import 'dart:io';
import 'package:url_launcher/url_launcher.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_all_linux/webview_all_linux.dart' as lx;
import 'package:webview_platform_interface/webview_platform_interface.dart' as wa;
import 'package:flutter_inappwebview_platform_interface/flutter_inappwebview_platform_interface.dart'
    as ia;
import 'package:flutter_inappwebview_windows/flutter_inappwebview_windows.dart'
    as win;
import 'linux_webview_guard.dart';
import 'windows_webview_settings.dart';

/// Keep the existing Apple/Android engines; use WebView2 only on Windows, WebKitGTK only on Linux.
class AppNavigationDelegate {
  const AppNavigationDelegate({
    this.onNavigationRequest,
    this.onPageStarted,
    this.onPageFinished,
    this.onTitleChanged,
    this.onUrlChange,
    this.onWebResourceError,
  });
  final FutureOr<NavigationDecision> Function(NavigationRequest)?
  onNavigationRequest;
  final void Function(String)? onPageStarted, onPageFinished;
  final void Function(String?)? onTitleChanged;
  final void Function(UrlChange)? onUrlChange;
  final void Function(WebResourceError)? onWebResourceError;
}

class AppWebController {
  static win.WindowsWebViewEnvironment? _environment;
  static bool _unavailable = false;
  static Future<void> initializeWindows() async {
    if (!Platform.isWindows) return;
    try {
      final folder = await Directory.systemTemp.createTemp('innocrew-web-');
      _environment = await win.WindowsWebViewEnvironment.static().create(
        settings: ia.WebViewEnvironmentSettings(userDataFolder: folder.path),
      );
      _unavailable = false;
    } catch (_) {
      _unavailable = true;
    }
  }

  /// [javaScript]가 false면 Windows WebView2도 스크립트를 끈다(메일 본문 같은 신뢰할 수 없는 HTML용). 다른 플랫폼은 setJavaScriptMode로.
  AppWebController({this.javaScript = true})
    : native = (Platform.isWindows || Platform.isLinux) ? null : WebViewController(),
      linux = Platform.isLinux ? lx.LinuxWebViewController(const lx.LinuxWebViewControllerCreationParams()) : null;
  final bool javaScript;
  final WebViewController? native;
  final lx.LinuxWebViewController? linux;
  final _ready = Completer<ia.PlatformInAppWebViewController>();
  AppNavigationDelegate? _delegate;
  Widget? _windows;
  dynamic get platform => native!.platform;
  Future<void> setJavaScriptMode(JavaScriptMode mode) async {
    if (linux != null) {
      await linux!.setJavaScriptMode(mode == JavaScriptMode.disabled ? wa.JavaScriptMode.disabled : wa.JavaScriptMode.unrestricted);
      return;
    }
    await native?.setJavaScriptMode(mode);
  }

  Future<void> setNavigationDelegate(AppNavigationDelegate d) async {
    _delegate = d;
    if (linux != null) {
      final nav = lx.LinuxNavigationDelegate(const lx.LinuxNavigationDelegateCreationParams());
      await nav.setOnNavigationRequest((r) async {
        final decision = await d.onNavigationRequest?.call(NavigationRequest(url: r.url, isMainFrame: r.isMainFrame));
        return decision == NavigationDecision.prevent ? wa.NavigationDecision.prevent : wa.NavigationDecision.navigate;
      });
      await nav.setOnPageStarted((url) => d.onPageStarted?.call(url));
      await nav.setOnPageFinished((url) => d.onPageFinished?.call(url));
      await nav.setOnUrlChange((c) => _urlOrNull(c.url) == null ? null : d.onUrlChange?.call(UrlChange(url: c.url)));
      await nav.setOnWebResourceError(
        (e) => d.onWebResourceError?.call(WebResourceError(errorCode: e.errorCode, description: e.description, isForMainFrame: e.isForMainFrame)),
      );
      await linux!.setPlatformNavigationDelegate(nav);
      return;
    }
    await native?.setNavigationDelegate(
      NavigationDelegate(
        onNavigationRequest: d.onNavigationRequest,
        onPageStarted: d.onPageStarted,
        onPageFinished: d.onPageFinished,
        onUrlChange: d.onUrlChange,
        onWebResourceError: d.onWebResourceError,
      ),
    );
  }

  Future<void> loadRequest(Uri url) async {
    if (linux != null) return linux!.loadRequest(wa.LoadRequestParams(uri: url));
    if (native == null && _unavailable) return;
    if (native != null) {
      await native!.loadRequest(url);
      return;
    }
    await (await _ready.future).loadUrl(
      urlRequest: ia.URLRequest(url: ia.WebUri(url.toString())),
    );
  }

  /// HTML 문자열을 바로 그린다(주소 없음 — about:blank).
  Future<void> loadHtmlString(String html) async {
    if (linux != null) return linux!.loadHtmlString(html);
    if (native == null && _unavailable) return;
    if (native != null) {
      await native!.loadHtmlString(html);
      return;
    }
    await (await _ready.future).loadData(data: html, mimeType: 'text/html', encoding: 'utf8', baseUrl: ia.WebUri('about:blank'));
  }

  Future<String?> getUserAgent() async => linux != null
      ? linux!.getUserAgent()
      : _unavailable && native == null
      ? null
      : native != null
      ? native!.getUserAgent()
      : (await (await _ready.future).evaluateJavascript(
          source: 'navigator.userAgent',
        ))?.toString();
  Future<void> setUserAgent(String value) async {
    if (linux != null) return linux!.setUserAgent(value);
    if (native == null && _unavailable) return;
    if (native != null) {
      await native!.setUserAgent(value);
      return;
    }
    await setWindowsUserAgent(await _ready.future, value);
  }

  /// WebKitGTK는 페이지가 없을 때 빈 주소('')를 돌려준다 — 스킴 없는 값은 주소 없음(null)으로.
  static String? _urlOrNull(String? url) => (url == null || !(Uri.tryParse(url)?.hasScheme ?? false)) ? null : url;
  Future<String?> getTitle() async => linux != null
      ? linux!.getTitle()
      : native != null ? native!.getTitle() : (await _ready.future).getTitle();
  Future<String?> currentUrl() async => linux != null
      ? _urlOrNull(await linux!.currentUrl())
      : _unavailable && native == null
      ? null
      : native != null
      ? native!.currentUrl()
      : (await (await _ready.future).getUrl())?.toString();
  Future<void> reload() async {
    if (linux != null) return linux!.reload();
    if (native == null && _unavailable) return;
    if (native != null) {
      await native!.reload();
    } else {
      await (await _ready.future).reload();
    }
  }

  Future<bool> canGoBack() async => linux != null
      ? linux!.canGoBack()
      : _unavailable && native == null
      ? false
      : native != null
      ? native!.canGoBack()
      : (await _ready.future).canGoBack();
  Future<void> goBack() async => linux != null
      ? linux!.goBack()
      : native != null ? native!.goBack() : (await _ready.future).goBack();
  Future<void> runJavaScript(String source) async {
    if (linux != null) return linux!.runJavaScript(source);
    if (native == null && _unavailable) return;
    if (native != null) {
      await native!.runJavaScript(source);
      return;
    }
    await (await _ready.future).evaluateJavascript(source: source);
  }

  Future<Object> runJavaScriptReturningResult(String source) async => linux != null
      ? linux!.runJavaScriptReturningResult(source)
      : _unavailable && native == null
      ? ''
      : native != null
      ? native!.runJavaScriptReturningResult(source)
      : (await (await _ready.future).evaluateJavascript(source: source)) ?? '';

  /// [avoidFabs]: 전체 화면 웹 화면이면 true(Linux만 — 떠 있는 버튼 자리를 오른쪽에 비운다).
  Widget build(BuildContext context, {bool avoidFabs = false}) {
    // 앱 전체 SelectionArea(main.dart SelectAllText)의 탭·길게 누르기 인식기가 WebView 위 터치를 가져가면
    // iOS에서 탭할 때마다 Flutter가 포커스를 뺏어 키보드가 닫힌다(아마란스 비밀번호 입력 불가, 2026-10-20).
    // WebView가 자기 영역의 제스처를 먼저 갖고, 글자 선택은 WebView 자체 선택에 맡긴다.
    if (linux != null) {
      return LinuxWebViewGuard(
        avoidFabs: avoidFabs,
        child: SelectionContainer.disabled(
          child: lx.LinuxWebViewWidget(wa.PlatformWebViewWidgetCreationParams(controller: linux!)).build(context),
        ),
      );
    }
    if (native != null) {
      return SelectionContainer.disabled(
        child: WebViewWidget(controller: native!, gestureRecognizers: {Factory<OneSequenceGestureRecognizer>(EagerGestureRecognizer.new)}),
      );
    }
    if (_unavailable) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                '웹 화면을 시작하지 못했습니다. Microsoft Edge WebView2 Runtime 설치 후 앱을 다시 실행해 주세요.',
              ),
              TextButton(
                onPressed: () => launchUrl(
                  Uri.parse(
                    'https://developer.microsoft.com/microsoft-edge/webview2/',
                  ),
                  mode: LaunchMode.externalApplication,
                ),
                child: const Text('WebView2 설치 안내'),
              ),
            ],
          ),
        ),
      );
    }
    return _windows ??= win.WindowsInAppWebViewWidget(
      win.WindowsInAppWebViewWidgetCreationParams(
        webViewEnvironment: _environment,
        initialSettings: ia.InAppWebViewSettings(
          javaScriptEnabled: javaScript,
          useShouldOverrideUrlLoading: true,
        ),
        onWebViewCreated: (controller) => _ready.complete(controller),
        onLoadStart: (_, url) => _delegate?.onPageStarted?.call(url.toString()),
        onLoadStop: (_, url) => _delegate?.onPageFinished?.call(url.toString()),
        onTitleChanged: (_, title) => _delegate?.onTitleChanged?.call(title),
        onUpdateVisitedHistory: (_, url, _) =>
            _delegate?.onUrlChange?.call(UrlChange(url: url?.toString())),
        shouldOverrideUrlLoading: (_, action) async {
          final url = action.request.url;
          if (url == null) return ia.NavigationActionPolicy.CANCEL;
          final decision = await _delegate?.onNavigationRequest?.call(
            NavigationRequest(
              url: url.toString(),
              isMainFrame: action.isForMainFrame,
            ),
          );
          return decision == NavigationDecision.prevent
              ? ia.NavigationActionPolicy.CANCEL
              : ia.NavigationActionPolicy.ALLOW;
        },
        onReceivedError: (_, request, error) =>
            _delegate?.onWebResourceError?.call(
              WebResourceError(
                errorCode: error.type.toNativeValue() ?? -1,
                description: error.description,
                isForMainFrame: request.isForMainFrame,
              ),
            ),
      ),
    ).build(context);
  }

  static Future<void> clearCookies() async {
    if (Platform.isLinux) {
      await lx.LinuxWebViewCookieManager(const lx.LinuxWebViewCookieManagerCreationParams()).clearCookies();
    } else if (Platform.isWindows) {
      await win.WindowsCookieManager(
        win.WindowsCookieManagerCreationParams(
          webViewEnvironment: _environment,
        ),
      ).deleteAllCookies();
    } else {
      await WebViewCookieManager().clearCookies();
    }
  }

  static Future<void> clearSession() async {
    if (Platform.isWindows) {
      // Rotate even if old-profile cleanup fails; never reuse another user's web session.
      try {
        await clearCookies();
        await _environment?.dispose();
      } catch (_) {}
      _environment = null;
      await initializeWindows();
    } else if (Platform.isLinux) {
      await lx.LinuxWebViewDataManager(const lx.LinuxWebViewDataManagerCreationParams()).clearAllWebsiteData();
    } else {
      await clearCookies();
      await WebViewController().clearLocalStorage();
    }
  }
}
