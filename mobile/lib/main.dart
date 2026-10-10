import 'dart:async';
import 'api/client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'app/router.dart';
import 'gw/talk_notifications.dart';
import 'mcp/mcp_worker_provider.dart';
import 'app/theme.dart';
import 'auth/session.dart';
import 'config.dart';
import 'web/app_webview.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppWebController.initializeWindows();
  await Supabase.initialize(
    url: Config.supabaseUrl,
    publishableKey: Config.supabaseAnonKey,
  );
  runApp(const ProviderScope(child: App()));
}

class App extends ConsumerStatefulWidget {
  const App({super.key});
  @override
  ConsumerState<App> createState() => _AppState();
}

class _AppState extends ConsumerState<App> {
  late final GoRouter _router = buildRouter(
    refresh: ref.read(sessionListenableProvider),
    redirect: (context, state) =>
        redirectFor(ref.read(sessionProvider), state.matchedLocation),
  );
  String? _lastAuditPath;

  @override
  void initState() {
    super.initState();
    _router.routerDelegate.addListener(_auditPage);
    WidgetsBinding.instance.addPostFrameCallback((_) => _auditPage());
  }

  void _auditPage() {
    if (!mounted) return;
    final path = _router.routerDelegate.currentConfiguration.uri.path;
    if (path == _lastAuditPath) return;
    _lastAuditPath = path;
    // WebView records its actual web path itself. Never send OAuth query data.
    if (['/web', '/login', '/splash'].contains(path) ||
        Supabase.instance.client.auth.currentUser == null) {
      return;
    }
    unawaited(_sendPageAudit(path));
  }

  Future<void> _sendPageAudit(String path) async {
    try {
      await ref.read(apiClientProvider).postJson('/api/page-views', {
        'path': path,
      });
    } catch (_) {
      // Audit failure must not interrupt navigation.
    }
  }

  @override
  void dispose() {
    _router.routerDelegate.removeListener(_auditPage);
    _router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(talkAlertWatcherProvider); // 데스크탑: 메신저 멘션 OS 알림(아마란스 연결 때만 돈다)
    ref.watch(mcpWorkerProvider); // 데스크탑: Claude 커넥터 요청 실행기(로그인·스위치 켬 때만)
    return MaterialApp.router(
      title: '이노그리드',
      theme: appTheme(),
      routerConfig: _router,
    );
  }
}
