import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../briefing/briefing_provider.dart';
import '../web/app_webview.dart';
import 'calendar_bridge.dart';
import 'calendar_session.dart';

/// A mounted, non-interactive WebView runs same-origin reads with HttpOnly cookies.
/// Login is a separate visible WebView sharing the platform cookie store.
class DoorayCalendarHost extends ConsumerWidget {
  const DoorayCalendarHost({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final owner = ref.watch(doorayCalendarOwnerProvider);
    return Stack(
      children: [
        if (owner != null)
          Positioned(
            width: 1,
            height: 1,
            child: ExcludeSemantics(
              child: IgnorePointer(
                child: _CalendarEngine(key: ValueKey(owner)),
              ),
            ),
          ),
        child,
      ],
    );
  }
}

class _CalendarEngine extends ConsumerStatefulWidget {
  const _CalendarEngine({super.key});
  @override
  ConsumerState<_CalendarEngine> createState() => _CalendarEngineState();
}

class _CalendarEngineState extends ConsumerState<_CalendarEngine> {
  late final AppWebController _web;
  late final DoorayCalendarClient _client;
  late final DoorayCalendarTransport _transport;
  final _loaded = Completer<void>();
  @override
  void initState() {
    super.initState();
    _transport = ref.read(doorayCalendarTransportProvider.notifier);
    _web = AppWebController();
    _client = DoorayCalendarClient(
      run: (js) async {
        await _loaded.future;
        await _web.runJavaScript(js);
      },
      evaluate: _web.runJavaScriptReturningResult,
    );
    _web.setJavaScriptMode(JavaScriptMode.unrestricted);
    _web.setNavigationDelegate(
      AppNavigationDelegate(
        onPageFinished: (_) {
          if (!_loaded.isCompleted) _loaded.complete();
        },
      ),
    );
    _web.loadRequest(Uri.parse('$doorayOrigin/calendar'));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _transport.attach(_client);
      ref.invalidate(briefingProvider);
    });
  }

  @override
  void dispose() {
    _client.close();
    if (!_loaded.isCompleted) _loaded.complete();
    // Provider updates cannot run during widget-tree disposal.
    Future.microtask(() => _transport.detach(_client));
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => _web.build(context);
}

class DoorayCalendarLogin extends StatefulWidget {
  const DoorayCalendarLogin({super.key});
  @override
  State<DoorayCalendarLogin> createState() => _DoorayCalendarLoginState();
}

class _DoorayCalendarLoginState extends State<DoorayCalendarLogin> {
  late final AppWebController _web;
  late final DoorayCalendarClient _client;
  bool _busy = false;
  String? _error;
  @override
  void initState() {
    super.initState();
    _web = AppWebController();
    _client = DoorayCalendarClient(
      run: _web.runJavaScript,
      evaluate: _web.runJavaScriptReturningResult,
    );
    _web.setJavaScriptMode(JavaScriptMode.unrestricted);
    _web.loadRequest(Uri.parse('$doorayOrigin/calendar'));
  }

  Future<void> _verify() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final now = DateTime.now().toUtc().add(const Duration(hours: 9));
      await _client.read(now.toIso8601String().substring(0, 10));
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Dooray 로그인 후 일정이 보이면 연결 확인을 눌러 주세요.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _client.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Dooray 일정 연결'),
      actions: [
        TextButton(
          onPressed: _busy ? null : _verify,
          child: Text(_busy ? '확인 중…' : '연결 확인'),
        ),
      ],
    ),
    body: Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Text(
            _error ?? 'Dooray 계정으로 로그인한 뒤 연결 확인을 누르세요. 이노크루 계정과 달라도 됩니다.',
          ),
        ),
        Expanded(child: _web.build(context)),
      ],
    ),
  );
}
