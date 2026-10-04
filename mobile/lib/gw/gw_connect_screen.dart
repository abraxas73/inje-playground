import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:webview_flutter/webview_flutter.dart';
import '../app/theme.dart';
import 'gw_client.dart';
import 'gw_creds.dart';
import 'gw_login_js.dart';
import 'gw_login_store.dart';

const gwOrigin = 'https://gw.innogrid.com';

/// document.cookie → 크레덴셜 → gw050A02 검증(이름·이메일 확보). 토큰 값은 예외 메시지에 넣지 않는다.
Future<GwCreds> verifyGwCookies(String cookieString, http.Client httpClient) async {
  final c = parseGwCookies(cookieString);
  if (c == null) throw GwException(0, 0, '로그인 쿠키를 찾지 못했습니다');
  final s = await GwClient(httpClient: httpClient, creds: () => c).session();
  return c.copyWith(empName: s.empName, email: s.email);
}

/// WebView로 gw.innogrid.com에 로그인시킨다. 저장된 아이디·비밀번호가 있으면 WebView를 가린 채 자동으로 넣고,
/// 쿠키가 생기는 즉시(URL 변경·1초 폴링) 검증·저장하고 닫는다. 아마란스 메인은 보여 주지 않는다.
class GwConnectScreen extends ConsumerStatefulWidget {
  const GwConnectScreen({super.key, this.webView});

  /// 테스트용: WebView 자리에 끼울 위젯(플랫폼 WebView가 없는 테스트에서는 컨트롤러도 만들지 않는다).
  final Widget Function()? webView;
  @override
  ConsumerState<GwConnectScreen> createState() => _GwConnectScreenState();
}

class _GwConnectScreenState extends ConsumerState<GwConnectScreen> {
  WebViewController? _c;
  Timer? _poll, _hintTimer;
  bool _busy = false, _hint = false, _idDone = false, _pwDone = false, _manual = false, _loginChecked = false, _ticking = false;
  GwLogin? _login;
  String? _error, _status;

  bool get _auto => _login != null && !_manual;

  @override
  void initState() {
    super.initState();
    ref.read(gwLoginStoreProvider).load().then((l) {
      if (mounted) setState(() { _login = l; _loginChecked = true; });
    }).catchError((_) {
      if (mounted) setState(() => _loginChecked = true);
    });
    if (widget.webView == null) {
      _c = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setNavigationDelegate(NavigationDelegate(
          onPageStarted: (_) => _fixViewport(),
          onPageFinished: (_) { _fixViewport(); _tick(); },
          onUrlChange: (_) => _tick(), // SPA 라우팅은 onPageFinished가 안 온다
        ))
        ..loadRequest(Uri.parse('$gwOrigin/'));
      _poll = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
    }
    _hintTimer = Timer(const Duration(seconds: 60), () {
      if (mounted) setState(() => _hint = true);
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    _hintTimer?.cancel();
    super.dispose();
  }

  Future<void> _fixViewport() async {
    try {
      await _c?.runJavaScript(viewportFixJs);
    } catch (_) {}
  }

  Future<void> _tick() async {
    final c = _c;
    if (c == null || _busy || _ticking || !mounted) return;
    _ticking = true;
    try {
      String raw;
      try {
        raw = (await c.runJavaScriptReturningResult('document.cookie')).toString();
      } catch (_) {
        return;
      }
      if (!mounted) return;
      if (parseGwCookies(raw) != null) {
        await _finish(raw);
        return;
      }
      if (!_auto || !_loginChecked) return;
      final probe = GwProbe.parse(await c.runJavaScriptReturningResult(probeJs));
      if (probe == null || !mounted) return;
      switch (decideFill(probe, _login, idDone: _idDone, pwDone: _pwDone)) {
        case FillAction.fillId:
          _idDone = true;
          setState(() => _status = '아이디 입력 중…');
          await c.runJavaScript(fillJs(selector: '#reqLoginId', value: _login!.id, submitText: '다음'));
        case FillAction.fillPw:
          _pwDone = true;
          setState(() => _status = '비밀번호 입력 중…');
          await c.runJavaScript(fillJs(selector: '#reqLoginPw', value: _login!.pw, submitText: '로그인'));
        case FillAction.reveal:
          setState(() {
            _manual = true;
            _error = probe.hasOtp ? '추가 인증이 필요합니다. 아래에서 직접 진행하세요.' : (probe.error.isNotEmpty ? '아마란스: ${probe.error}' : '자동 로그인을 못 했습니다. 직접 로그인하세요.');
          });
        case FillAction.none:
          break;
      }
    } finally {
      _ticking = false;
    }
  }

  Future<void> _finish(String raw) async {
    setState(() { _busy = true; _error = null; _status = '로그인을 확인하는 중…'; });
    try {
      final creds = await verifyGwCookies(raw, ref.read(gwHttpClientProvider));
      if (!mounted) return;
      await ref.read(gwProvider.notifier).connect(creds);
      if (mounted) Navigator.of(context).pop(true); // 성공 즉시 닫는다 — 아마란스 메인은 볼 필요 없다
    } on GwException catch (e) {
      if (mounted) setState(() { _error = '로그인을 확인하지 못했습니다: ${e.message}'; _manual = true; });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _clearCookies() async {
    await WebViewCookieManager().clearCookies();
    setState(() { _idDone = false; _pwDone = false; _error = null; });
    await _c?.loadRequest(Uri.parse('$gwOrigin/'));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final banner = _error ??
        (_busy
            ? '로그인을 확인하는 중…'
            : _auto
                ? '저장된 아이디로 자동 로그인합니다.'
                : '평소처럼 아마란스에 로그인하세요. 로그인되면 자동으로 연결되고 이 화면은 닫힙니다.${_hint ? '\n로그인했는데도 연결되지 않으면 오른쪽 위 "쿠키 지우고 로그인"을 눌러 다시 시도하세요.' : ''}');
    return Scaffold(
      appBar: AppBar(title: const Text('아마란스 연결'), actions: [TextButton(onPressed: _clearCookies, child: const Text('쿠키 지우고 로그인'))]),
      body: Column(children: [
        Container(
          width: double.infinity,
          color: Brand.blueTint,
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          child: Text(banner, style: theme.textTheme.bodySmall?.copyWith(color: _error != null ? Brand.dangerText : Brand.navy)),
        ),
        Expanded(
          child: Stack(fit: StackFit.expand, children: [
            widget.webView?.call() ?? WebViewWidget(controller: _c!),
            if (_auto || _busy)
              ColoredBox(
                color: Brand.ground,
                child: Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    const SizedBox(width: 28, height: 28, child: CircularProgressIndicator(strokeWidth: 3)),
                    const SizedBox(height: 16),
                    Text(_busy ? '로그인 확인 중…' : '자동 로그인 중…', style: theme.textTheme.titleMedium),
                    if (_status != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(_status!, style: theme.textTheme.bodySmall)),
                    const SizedBox(height: 20),
                    if (!_busy) TextButton(onPressed: () => setState(() => _manual = true), child: const Text('직접 로그인')),
                  ]),
                ),
              ),
          ]),
        ),
      ]),
    );
  }
}
