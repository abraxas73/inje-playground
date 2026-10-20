import 'dart:async';
import 'dart:io';
import 'package:url_launcher/url_launcher.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:flutter_inappwebview_platform_interface/flutter_inappwebview_platform_interface.dart'
    as ia;
import 'package:flutter_inappwebview_windows/flutter_inappwebview_windows.dart'
    as win;
import 'windows_webview_settings.dart';

/// Keep the existing Apple/Android engines; use WebView2 only on Windows.
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
  AppWebController({this.javaScript = true}) : native = Platform.isWindows ? null : WebViewController();
  final bool javaScript;
  final WebViewController? native;
  final _ready = Completer<ia.PlatformInAppWebViewController>();
  AppNavigationDelegate? _delegate;
  Widget? _windows;
  dynamic get platform => native!.platform;
  Future<void> setJavaScriptMode(JavaScriptMode mode) async {
    await native?.setJavaScriptMode(mode);
  }

  Future<void> setNavigationDelegate(AppNavigationDelegate d) async {
    _delegate = d;
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
    if (native == null && _unavailable) return;
    if (native != null) {
      await native!.loadHtmlString(html);
      return;
    }
    await (await _ready.future).loadData(data: html, mimeType: 'text/html', encoding: 'utf8', baseUrl: ia.WebUri('about:blank'));
  }

  Future<String?> getUserAgent() async => _unavailable && native == null
      ? null
      : native != null
      ? native!.getUserAgent()
      : (await (await _ready.future).evaluateJavascript(
          source: 'navigator.userAgent',
        ))?.toString();
  Future<void> setUserAgent(String value) async {
    if (native == null && _unavailable) return;
    if (native != null) {
      await native!.setUserAgent(value);
      return;
    }
    await setWindowsUserAgent(await _ready.future, value);
  }

  Future<String?> getTitle() async =>
      native != null ? native!.getTitle() : (await _ready.future).getTitle();
  Future<String?> currentUrl() async => _unavailable && native == null
      ? null
      : native != null
      ? native!.currentUrl()
      : (await (await _ready.future).getUrl())?.toString();
  Future<void> reload() async {
    if (native == null && _unavailable) return;
    if (native != null) {
      await native!.reload();
    } else {
      await (await _ready.future).reload();
    }
  }

  Future<bool> canGoBack() async => _unavailable && native == null
      ? false
      : native != null
      ? native!.canGoBack()
      : (await _ready.future).canGoBack();
  Future<void> goBack() async =>
      native != null ? native!.goBack() : (await _ready.future).goBack();
  Future<void> runJavaScript(String source) async {
    if (native == null && _unavailable) return;
    if (native != null) {
      await native!.runJavaScript(source);
      return;
    }
    await (await _ready.future).evaluateJavascript(source: source);
  }

  Future<Object> runJavaScriptReturningResult(String source) async =>
      _unavailable && native == null
      ? ''
      : native != null
      ? native!.runJavaScriptReturningResult(source)
      : (await (await _ready.future).evaluateJavascript(source: source)) ?? '';

  Widget build(BuildContext context) {
    // 앱 전체 SelectionArea(main.dart SelectAllText)의 탭·길게 누르기 인식기가 WebView 위 터치를 가져가면
    // iOS에서 탭할 때마다 Flutter가 포커스를 뺏어 키보드가 닫힌다(아마란스 비밀번호 입력 불가, 2026-10-20).
    // WebView가 자기 영역의 제스처를 먼저 갖고, 글자 선택은 WebView 자체 선택에 맡긴다.
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
    if (Platform.isWindows) {
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
    } else {
      await clearCookies();
      await WebViewController().clearLocalStorage();
    }
  }
}
