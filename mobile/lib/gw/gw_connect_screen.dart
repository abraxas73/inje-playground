import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:webview_flutter/webview_flutter.dart';
import '../web/app_webview.dart';
import '../app/theme.dart';
import 'gw_client.dart';
import 'gw_creds.dart';
import 'gw_login_js.dart';
import 'gw_login_store.dart';
import '../telemetry/app_events.dart';

const gwOrigin = 'https://gw.innogrid.com';

/// 1초 감시(쿠키·로그인 화면 탐지)는 앱이 WebView를 가리고 자동 입력할 때만 돈다.
/// 사람이 입력하는 동안(앱 입력칸·웹 화면 직접 로그인) 매초 WebView에 스크립트를 실행하면
/// iOS 27에서 입력칸 키보드가 1초마다 닫혔다(2026-10-20 iPhone 17 실측 영상). 그때는 페이지 이동 신호로만 확인한다.
bool gwShouldPoll({required bool auto, required bool busy}) => auto && !busy;

/// document.cookie → 크레덴셜 → gw050A02 검증(이름·이메일 확보). 토큰 값은 예외 메시지에 넣지 않는다.
Future<GwCreds> verifyGwCookies(String cookieString, http.Client httpClient) async {
  final c = parseGwCookies(cookieString);
  if (c == null) throw GwException(0, 0, '로그인 쿠키를 찾지 못했습니다');
  final s = await GwClient(httpClient: httpClient, creds: () => c).session();
  return c.copyWith(empName: s.empName, email: s.email);
}

/// WebView로 gw.innogrid.com에 로그인시킨다. 저장된 아이디·비밀번호가 있으면 WebView를 가린 채 자동으로 넣고,
/// 쿠키가 생기는 즉시(URL 변경·1초 폴링) 검증·저장하고 닫는다. 아마란스 메인은 보여 주지 않는다.
/// 저장된 정보가 없거나 틀렸으면 앱의 네이티브 입력칸으로 받아 같은 자동 입력 경로로 넣는다 —
/// iPhone에서 WebView 입력칸을 직접 누르면 키보드가 열렸다 닫히기를 반복해 입력할 수 없었다(2026-10-20, 1.7.16~1.7.18).
class GwConnectScreen extends ConsumerStatefulWidget {
  const GwConnectScreen({super.key, this.webView});

  /// 테스트용: WebView 자리에 끼울 위젯(플랫폼 WebView가 없는 테스트에서는 컨트롤러도 만들지 않는다).
  final Widget Function()? webView;
  @override
  ConsumerState<GwConnectScreen> createState() => _GwConnectScreenState();
}

class _GwConnectScreenState extends ConsumerState<GwConnectScreen> {
  AppWebController? _c;
  Timer? _poll, _hintTimer, _autoWatch;
  bool _busy = false, _hint = false, _idDone = false, _pwDone = false, _manual = false, _loginChecked = false, _ticking = false;
  GwLogin? _login;
  String? _error, _status;
  final _idCtl = TextEditingController(), _pwCtl = TextEditingController();
  bool _remember = false, _retry = false;

  bool get _auto => _login != null && !_manual;
  bool get _form => _loginChecked && _login == null && !_manual && !_busy;

  @override
  void initState() {
    super.initState();
    ref.read(gwLoginStoreProvider).load().then((l) {
      if (mounted) setState(() { _login = l; _loginChecked = true; });
      if (mounted && l != null) _armAutoWatch(); // 저장값이 잘못됐거나 로그인 페이지가 바뀌면 자동 입력이 멈출 수 있다 — 지나면 직접 로그인으로
    }).catchError((_) {
      if (mounted) setState(() => _loginChecked = true);
    });
    if (widget.webView == null) {
      _c = AppWebController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setNavigationDelegate(AppNavigationDelegate(
          onPageStarted: (_) => _fixViewport(),
          onPageFinished: (_) { _fixViewport(); _tick(); },
          onUrlChange: (_) => _tick(), // SPA 라우팅은 onPageFinished가 안 온다
        ))
        ..loadRequest(Uri.parse('$gwOrigin/'));
      _poll = Timer.periodic(const Duration(seconds: 1), (_) { if (gwShouldPoll(auto: _auto, busy: _busy)) _tick(); });
    }
    _hintTimer = Timer(const Duration(seconds: 60), () {
      if (mounted) setState(() => _hint = true);
    });
  }

  /// 자동 로그인 워치독 — 25초 안에 완료(쿠키 확보)나 수동 전환이 안 되면 직접 로그인으로 떨어뜨린다(무한 대기 방지).
  void _armAutoWatch() {
    _autoWatch?.cancel();
    _autoWatch = Timer(const Duration(seconds: 12), () async {
      await _tick(); // 그사이 로그인이 끝났을 수 있다(아마란스 응답이 느린 날) — 쿠키부터 한 번 더 본다
      if (mounted && _auto && !_busy) {
        appEvents.report('gw_login_failed', 'watchdog');
        setState(() {
          // 오류 경로와 같게: 아이디를 채운 네이티브 입력 폼으로 떨어뜨린다(플랫폼 무관하게 안전).
          if (_login != null && _idCtl.text.isEmpty) _idCtl.text = _login!.id;
          _login = null;
          _retry = true;
          _status = null;
          _error = '자동 로그인이 지연됩니다. 아이디·비밀번호를 확인해 직접 로그인해 주세요.';
        });
      }
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    _hintTimer?.cancel();
    _autoWatch?.cancel();
    _idCtl.dispose();
    _pwCtl.dispose();
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
          _reportFill(await c.runJavaScriptReturningResult(fillJs(selector: '#reqLoginId', value: _login!.id, submitText: '다음')));
        case FillAction.fillPw:
          _pwDone = true;
          setState(() => _status = '비밀번호 입력 중…');
          _reportFill(await c.runJavaScriptReturningResult(fillJs(selector: '#reqLoginPw', value: _login!.pw, submitText: '로그인')));
        case FillAction.reveal:
          _autoWatch?.cancel(); // 수동/재시도로 전환 — 워치독 불필요
          appEvents.report('gw_login_failed', probe.hasOtp ? 'otp' : 'reveal_error');
          setState(() {
            if (probe.hasOtp) {
              _manual = true;
              _error = '추가 인증이 필요합니다. 아래에서 직접 진행하세요.';
            } else {
              // 아이디·비밀번호 문제는 WebView 입력칸 대신 네이티브 입력 화면으로 되돌린다(같은 아이디는 채워 둔다)
              if (_login != null && _idCtl.text.isEmpty) _idCtl.text = _login!.id;
              _login = null;
              _retry = true;
              _error = probe.error.isNotEmpty ? '아마란스: ${probe.error}' : '자동 로그인을 못 했습니다. 아이디·비밀번호를 확인하세요.';
            }
          });
        case FillAction.none:
          break;
      }
    } finally {
      _ticking = false;
    }
  }

  /// 입력칸·버튼을 못 찾았으면(로그인 페이지 DOM 변경 의심) 보고만 한다 — 화면 처리는 워치독이 맡는다.
  void _reportFill(Object? result) {
    final code = fillFailureCode(result);
    if (code != null) appEvents.report('gw_login_failed', code);
  }

  Future<void> _finish(String raw) async {
    _autoWatch?.cancel();
    setState(() { _busy = true; _error = null; _status = '로그인을 확인하는 중…'; });
    try {
      final creds = await verifyGwCookies(raw, ref.read(gwHttpClientProvider));
      if (!mounted) return;
      await ref.read(gwProvider.notifier).connect(creds);
      if (mounted) Navigator.of(context).pop(true); // 성공 즉시 닫는다 — 아마란스 메인은 볼 필요 없다
    } on GwException catch (e) {
      appEvents.report('gw_login_failed', 'verify_failed');
      if (mounted) setState(() { _error = '로그인을 확인하지 못했습니다: ${e.message}'; _manual = true; });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// 네이티브 입력칸 → 자동 입력 경로. 오류 뒤 재시도면 로그인 첫 화면부터 다시 연다(남은 오류 문구가 곧바로 reveal을 부르지 않게).
  Future<void> _submitForm() async {
    final id = _idCtl.text.trim(), pw = _pwCtl.text;
    if (id.isEmpty || pw.isEmpty) return setState(() => _error = '아이디와 비밀번호를 모두 입력하세요.');
    FocusScope.of(context).unfocus();
    final login = GwLogin(id: id, pw: pw);
    if (_remember) {
      try {
        await ref.read(gwLoginProvider.notifier).save(login);
      } catch (_) {}
    }
    if (!mounted) return;
    final reload = _retry;
    setState(() { _login = login; _idDone = false; _pwDone = false; _error = null; _retry = false; _status = null; });
    _armAutoWatch(); // 수동 입력값으로 다시 자동 입력을 시도 — 또 멈추면 25초 뒤 폼으로
    if (reload) await _c?.loadRequest(Uri.parse('$gwOrigin/'));
  }

  Future<void> _clearCookies() async {
    await AppWebController.clearCookies();
    setState(() { _idDone = false; _pwDone = false; _error = null; });
    await _c?.loadRequest(Uri.parse('$gwOrigin/'));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final banner = _error ??
        (_busy
            ? '로그인을 확인하는 중…'
            : _form
                ? '아마란스 아이디와 비밀번호를 입력하세요. 로그인되면 자동으로 연결되고 이 화면은 닫힙니다.'
                : _auto
                ? '저장된 아이디로 자동 로그인합니다.'
                : '평소처럼 아마란스에 로그인하세요. 로그인되면 자동으로 연결되고 이 화면은 닫힙니다.${_hint ? '\n로그인했는데도 연결되지 않으면 오른쪽 위 "쿠키 지우고 로그인"을 눌러 다시 시도하세요.' : ''}');
    final kb = MediaQuery.viewInsetsOf(context).bottom;
    return Scaffold(
      // 키보드가 올라와도 WebView 크기를 바꾸지 않는다 — 크기 변화에 로그인 페이지가 입력칸을 다시 그리면 포커스가 날아간다
      resizeToAvoidBottomInset: false,
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
            widget.webView?.call() ?? _c!.build(context),
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
            if (_form)
              Material(
                color: Brand.ground,
                child: SingleChildScrollView(
                  padding: EdgeInsets.fromLTRB(24, 32, 24, 24 + kb),
                  child: AutofillGroup(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Text('아마란스 로그인', style: theme.textTheme.titleLarge),
                      const SizedBox(height: 20),
                      TextField(controller: _idCtl, autocorrect: false, enableSuggestions: false, textInputAction: TextInputAction.next, autofillHints: const [AutofillHints.username], decoration: const InputDecoration(labelText: '아이디', border: OutlineInputBorder())),
                      const SizedBox(height: 12),
                      TextField(controller: _pwCtl, obscureText: true, autocorrect: false, enableSuggestions: false, textInputAction: TextInputAction.done, autofillHints: const [AutofillHints.password], onSubmitted: (_) => _submitForm(), decoration: const InputDecoration(labelText: '비밀번호', border: OutlineInputBorder())),
                      CheckboxListTile(value: _remember, onChanged: (v) => setState(() => _remember = v ?? false), contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, title: const Text('이 기기에 저장하고 다음부터 자동 로그인'), subtitle: const Text('보안 저장소(Keychain)에만 저장됩니다. 더보기 → 아마란스에서 지울 수 있습니다.')),
                      const SizedBox(height: 8),
                      FilledButton(onPressed: _submitForm, child: const Text('로그인')),
                      const SizedBox(height: 8),
                      TextButton(onPressed: () => setState(() => _manual = true), child: const Text('아마란스 웹 화면에서 직접 로그인')),
                    ]),
                  ),
                ),
              ),
          ]),
        ),
      ]),
    );
  }
}
