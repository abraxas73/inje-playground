import 'dart:async';
import 'api/client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'release/desktop_update_host.dart';
import 'assistant/innobot_button.dart';
import 'assistant/innobot_prefs.dart';
import 'assistant/assistant_window.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'app/router.dart';
import 'briefing/live_background.dart';
import 'gw/talk_notifications.dart';
import 'mcp/mcp_worker_provider.dart';
import 'app/theme.dart';
import 'app/theme_mode.dart';
import 'auth/session.dart';
import 'config.dart';
import 'web/app_webview.dart';
import 'dooray/calendar_webview.dart';
import 'features/home/pinned_widgets.dart';
import 'telemetry/app_events.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  _hookErrorReports();
  await AppWebController.initializeWindows();
  await Supabase.initialize(
    url: Config.supabaseUrl,
    publishableKey: Config.supabaseAnonKey,
  );
  unawaited(registerLiveBackground());
  // 떠 있는 버튼 숨김 여부는 첫 화면 전에 읽어 둔다(켤 때 깜빡임 방지)
  var fabsHidden = false;
  try {
    fabsHidden = (await SharedPreferences.getInstance()).getBool(InnobotFabsHidden.key) ?? false;
  } catch (_) {}
  runApp(ProviderScope(overrides: [innobotFabsHiddenInitialProvider.overrideWithValue(fabsHidden)], child: const App()));
}

/// 미처리 예외의 **타입 이름만** 앱 이벤트로 보고하고 기존 처리(콘솔 출력 등)는 그대로 잇는다. 메시지·스택은 보내지 않는다.
void _hookErrorReports() {
  final prevFlutter = FlutterError.onError;
  FlutterError.onError = (d) {
    appEvents.report('app_error', errorTypeName(d.exception));
    prevFlutter?.call(d);
  };
  final dispatcher = WidgetsBinding.instance.platformDispatcher;
  final prevPlatform = dispatcher.onError;
  dispatcher.onError = (e, s) {
    appEvents.report('app_error', errorTypeName(e));
    return prevPlatform?.call(e, s) ?? false;
  };
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
    messengerNotifyTap.addListener(_onNotifyTap); // OS 알림 탭 → 우리 앱 화면으로
    // 장애 신호 보고(/api/app/events) — 개발 빌드는 보내지 않고, 로그인 전이면 버린다
    if (Config.appVersion != 'dev') {
      appEvents.sender = (events) async {
        if (Supabase.instance.client.auth.currentUser == null) return;
        await ref.read(apiClientProvider).postJson('/api/app/events', {'events': events});
      };
    }
  }

  /// 메신저 OS 알림을 누르면 그 경로로 이동(push는 내비게이터 틀 안에 쌓는다). 한 번 처리하고 비운다.
  void _onNotifyTap() {
    final path = messengerNotifyTap.value;
    if (path == null || path.isEmpty) return;
    messengerNotifyTap.value = null;
    if (Supabase.instance.client.auth.currentUser == null) return;
    _router.push(path);
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
    messengerNotifyTap.removeListener(_onNotifyTap);
    _router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(talkAlertWatcherProvider); // 데스크탑: 메신저 멘션 OS 알림(아마란스 연결 때만 돈다)
    ref.watch(mcpWorkerProvider); // 데스크탑: Claude 커넥터 요청 실행기(로그인·스위치 켬 때만)
    return MaterialApp.router(
      title: 'INNOCREW',
      theme: appTheme(),
      darkTheme: appTheme(brightness: Brightness.dark),
      themeMode: ref.watch(themeModeProvider),
      routerConfig: _router,
      // 기본 위젯 문구(글자 선택의 복사·전체 선택, 날짜 선택 등)를 한국어로
      locale: const Locale('ko'),
      supportedLocales: const [Locale('ko'), Locale('en')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      // 이노봇 버튼은 앱 전체 위에 한 번 — 탭·웹·아마란스·Dooray 어느 화면에서나(InnobotOverlay)
      // 모든 네이티브 화면의 글자를 끌어서(데스크톱)·길게 눌러(모바일) 골라 복사 — 이노봇 버튼 레이어는 밖(길게 눌러 옮기기와 겹치지 않게)
      builder: (context, child) {
        Brand.brightness = Theme.of(context).brightness; // 네이티브 화면이 읽는 Brand 토큰을 활성 밝기로 맞춘다
        return DesktopUpdateHost(child: Stack(children: [DoorayCalendarHost(child: SelectAllText(child: child ?? const SizedBox.shrink())), const Positioned.fill(child: PinnedWidgetsHost()), Overlay(key: assistantWindowOverlay), InnobotOverlay(router: _router)]));
      },
    );
  }
}

/// 앱 전체 글자 선택·복사. SelectionArea는 선택 손잡이·복사 메뉴를 띄울 Overlay가 위에 있어야 하는데 builder 자리는 Navigator 밖이라
/// 전용 Overlay를 하나 둔다. 엔트리는 한 번만 만들고, child가 바뀌면 다시 그리게 한다. 웹 화면(WebView)은 웹뷰 자체 선택을 쓴다.
class SelectAllText extends StatefulWidget {
  const SelectAllText({super.key, required this.child});
  final Widget child;
  @override
  State<SelectAllText> createState() => _SelectAllTextState();
}

class _SelectAllTextState extends State<SelectAllText> {
  late final OverlayEntry _entry = OverlayEntry(builder: (_) => SelectionArea(child: widget.child));

  @override
  void didUpdateWidget(SelectAllText old) {
    super.didUpdateWidget(old);
    if (old.child != widget.child) _entry.markNeedsBuild();
  }

  @override
  Widget build(BuildContext context) => Overlay(initialEntries: [_entry]);
}
