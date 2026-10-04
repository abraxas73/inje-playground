import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:webview_flutter/webview_flutter.dart';
import '../app/theme.dart';
import 'gw_client.dart';
import 'gw_creds.dart';

const gwOrigin = 'https://gw.innogrid.com';

/// document.cookie → 크레덴셜 → gw050A02 검증(이름·이메일 확보). 토큰 값은 예외 메시지에 넣지 않는다.
Future<GwCreds> verifyGwCookies(String cookieString, http.Client httpClient) async {
  final c = parseGwCookies(cookieString);
  if (c == null) throw GwException(0, 0, '로그인 쿠키를 찾지 못했습니다');
  final s = await GwClient(httpClient: httpClient, creds: () => c).session();
  return c.copyWith(empName: s.empName, email: s.email);
}

/// WebView로 gw.innogrid.com에 로그인시키고, 페이지가 뜰 때마다 쿠키를 읽어 크레덴셜이 보이면 검증·저장한다.
class GwConnectScreen extends ConsumerStatefulWidget {
  const GwConnectScreen({super.key, this.webView});

  /// 테스트용: WebView 자리에 끼울 위젯(플랫폼 WebView가 없는 테스트에서는 컨트롤러도 만들지 않는다).
  final Widget Function()? webView;
  @override
  ConsumerState<GwConnectScreen> createState() => _GwConnectScreenState();
}

class _GwConnectScreenState extends ConsumerState<GwConnectScreen> {
  WebViewController? _c;
  Timer? _hintTimer;
  bool _busy = false, _hint = false;
  String? _error, _done;

  @override
  void initState() {
    super.initState();
    if (widget.webView == null) {
      _c = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setNavigationDelegate(NavigationDelegate(onPageFinished: (_) => _check()))
        ..loadRequest(Uri.parse('$gwOrigin/'));
    }
    _hintTimer = Timer(const Duration(seconds: 60), () {
      if (mounted) setState(() => _hint = true);
    });
  }

  @override
  void dispose() {
    _hintTimer?.cancel();
    super.dispose();
  }

  Future<void> _check() async {
    final c = _c;
    if (c == null || _busy || _done != null || !mounted) return;
    String raw;
    try {
      raw = (await c.runJavaScriptReturningResult('document.cookie')).toString();
    } catch (_) {
      return;
    }
    // 화면이 닫힌 뒤에도 onPageFinished가 올 수 있다(컨트롤러는 살아 있음)
    if (!mounted || parseGwCookies(raw) == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final creds = await verifyGwCookies(raw, ref.read(gwHttpClientProvider));
      if (!mounted) return;
      await ref.read(gwProvider.notifier).connect(creds);
      if (mounted) setState(() => _done = '${creds.empName ?? ''} (${creds.email ?? ''}) 연결됨');
    } on GwException catch (e) {
      if (mounted) setState(() => _error = '로그인을 확인하지 못했습니다: ${e.message}');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _clearCookies() async {
    await WebViewCookieManager().clearCookies();
    await _c?.loadRequest(Uri.parse('$gwOrigin/'));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('아마란스 연결'), actions: [TextButton(onPressed: _clearCookies, child: const Text('쿠키 지우고 로그인'))]),
      body: Column(children: [
        Container(
          width: double.infinity,
          color: Brand.blueTint,
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          child: Text(
            _done ?? _error ?? (_busy ? '로그인을 확인하는 중…' : '평소처럼 아마란스에 로그인하세요. 로그인되면 자동으로 연결됩니다.${_hint ? '\n로그인했는데도 연결되지 않으면 오른쪽 위 "쿠키 지우고 로그인"을 눌러 다시 시도하세요.' : ''}'),
            style: theme.textTheme.bodySmall?.copyWith(color: _error != null ? Brand.dangerText : Brand.navy),
          ),
        ),
        if (_done != null)
          Padding(padding: const EdgeInsets.all(16), child: FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('완료')))
        else
          Expanded(child: widget.webView?.call() ?? WebViewWidget(controller: _c!)),
      ]),
    );
  }
}
