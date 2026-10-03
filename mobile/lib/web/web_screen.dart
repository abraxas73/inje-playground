import 'dart:io' show Platform;
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
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

class _WebScreenState extends ConsumerState<WebScreen> {
  late final WebViewController _c;
  final _origin = Uri.parse(Config.apiBase);
  String _title = '';
  bool _loading = true;
  String? _error;
  final _guard = BootstrapGuard();

  @override
  void initState() {
    super.initState();
    _c = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(
        onNavigationRequest: _onNav,
        onPageStarted: (_) => setState(() { _loading = true; _error = null; }),
        onPageFinished: (_) async {
          final t = await _c.getTitle();
          if (mounted) setState(() { _loading = false; _title = t ?? ''; });
        },
        onWebResourceError: (e) {
          if (e.isForMainFrame ?? true) setState(() { _loading = false; _error = '페이지를 불러오지 못했습니다 (${e.description})'; });
        },
      ));
    _setUserAgent().then((_) => _c.loadRequest(Uri.parse('${Config.apiBase}${widget.path}')));
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

  Future<void> _setUserAgent() async {
    final ua = await _c.getUserAgent();
    await _c.setUserAgent('${ua ?? ''} ${Config.userAgent(Platform.operatingSystem)}'.trim());
  }

  Future<NavigationDecision> _onNav(NavigationRequest req) async {
    final uri = Uri.parse(req.url);
    switch (WebNavPolicy.decide(uri, appOrigin: _origin)) {
      case NavAction.inApp:
        return NavigationDecision.navigate;
      case NavAction.external:
        launchUrl(uri, mode: LaunchMode.externalApplication);
        return NavigationDecision.prevent;
      case NavAction.loginRedirect:
        _bootstrap(uri.queryParameters['next'] ?? widget.path);
        return NavigationDecision.prevent;
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
      setState(() { _loading = false; _error = e.message; });
    } catch (e) {
      setState(() { _loading = false; _error = '로그인 상태를 만들지 못했습니다: $e'; });
    }
  }

  void _retry() {
    setState(() { _error = null; _guard.reset(); });
    _c.loadRequest(Uri.parse('${Config.apiBase}${widget.path}'));
  }

  @override
  Widget build(BuildContext context) => PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) async {
          if (didPop) return;
          if (await _c.canGoBack()) {
            _c.goBack();
          } else if (context.mounted) {
            Navigator.of(context).pop();
          }
        },
        child: Scaffold(
          appBar: AppBar(
            title: Text(_title.isEmpty ? widget.path : _title, overflow: TextOverflow.ellipsis),
            actions: [
              IconButton(icon: const Icon(Icons.refresh), onPressed: () => _c.reload()),
              IconButton(icon: const Icon(Icons.open_in_browser), tooltip: '브라우저로 열기', onPressed: () => launchUrl(Uri.parse('${Config.apiBase}${widget.path}'), mode: LaunchMode.externalApplication)),
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
      );
}
