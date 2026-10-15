import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';
import 'package:playground/assistant/innobot_button.dart';
import 'package:playground/assistant/innobot_prefs.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'chat_brain.dart' show BrainTokens;

/// 설정 서버 가짜 — GET ?key=innobot_button, PUT 기록.
class FakeSettings {
  String value = '';
  var failPut = false;
  final puts = <Map<String, dynamic>>[];
  ApiClient get client => ApiClient(httpClient: MockClient((r) async {
    if (r.method == 'PUT') {
      if (failPut) return http.Response('{"error":"x"}', 500);
      puts.add(jsonDecode(r.body) as Map<String, dynamic>);
      value = '${puts.last['value']}';
      return http.Response('{"ok":true}', 200);
    }
    expect(r.url.queryParameters['key'], 'innobot_button');
    return http.Response(jsonEncode(value.isEmpty ? {} : {'innobot_button': value}), 200);
  }), tokens: BrainTokens(), baseUrl: 'https://x.test', userAgent: 'UA');
}

GoRouter testRouter() => GoRouter(initialLocation: '/home', observers: [InnobotPopupObserver()], routes: [
  GoRoute(path: '/home', builder: (c, s) => Scaffold(body: Column(children: [const Text('홈'), TextButton(onPressed: () => c.push('/web'), child: const Text('웹 열기')), TextButton(onPressed: () => showDialog<void>(context: c, builder: (_) => const AlertDialog(content: Text('대화상자'))), child: const Text('대화상자 열기'))]))),
  GoRoute(path: '/web', builder: (c, s) => const Scaffold(body: Text('웹 화면'))),
  GoRoute(path: '/login', builder: (c, s) => const Scaffold(body: Text('로그인'))),
]);

Widget app(GoRouter router, FakeSettings s, {bool signedIn = true}) => ProviderScope(
  key: UniqueKey(),
  overrides: [apiClientProvider.overrideWithValue(s.client), innobotSignedInProvider.overrideWithValue(signedIn)],
  child: MaterialApp.router(routerConfig: router, builder: (c, child) => Stack(children: [child!, InnobotOverlay(router: router)])),
);

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    innobotPopups.value = 0;
    innobotFanOpen.value = false;
  });

  test('표시 규칙 — 로그인·설정·팝업·펼친 메뉴·로그인 화면', () {
    bool v({bool signedIn = true, String path = '/web', int popups = 0, bool fanOpen = false, bool enabled = true, bool available = true}) => innobotOverlayVisible(signedIn: signedIn, path: path, popups: popups, fanOpen: fanOpen, enabled: enabled, available: available);
    expect(v(), isTrue);
    expect(v(path: '/gw/mail'), isTrue);
    expect(v(signedIn: false), isFalse);
    expect(v(enabled: false), isFalse);
    expect(v(available: false), isFalse);
    expect(v(popups: 1), isFalse);
    expect(v(fanOpen: true), isFalse);
    for (final p in ['/login', '/splash', '/guest']) {
      expect(v(path: p), isFalse, reason: p);
    }
    expect(isTabPath('/home'), isTrue);
    expect(isTabPath('/ladder/history'), isTrue);
    expect(isTabPath('/web'), isFalse);
    expect(showsClaudeAt('/home', desktop: true), isTrue);
    expect(showsClaudeAt('/web', desktop: true), isFalse);
    expect(showsClaudeAt('/home', desktop: false), isFalse);
  });

  testWidgets('이노봇은 홈 밖(웹 화면)에서도 보이고, Claude는 홈에서만(데스크톱)', (t) async {
    final s = FakeSettings();
    final router = testRouter();
    await t.pumpWidget(app(router, s));
    await t.pumpAndSettle();
    expect(find.byTooltip('비서 이노봇'), findsOneWidget);
    expect(find.byTooltip('Claude 열기'), Platform.isMacOS || Platform.isWindows ? findsOneWidget : findsNothing);
    await t.tap(find.text('웹 열기'));
    await t.pumpAndSettle();
    expect(find.text('웹 화면'), findsOneWidget);
    expect(find.byTooltip('비서 이노봇'), findsOneWidget);
    expect(find.byTooltip('Claude 열기'), findsNothing);
  });

  testWidgets('대화상자가 열려 있으면 숨기고 닫히면 다시 보인다', (t) async {
    final s = FakeSettings();
    final router = testRouter();
    await t.pumpWidget(app(router, s));
    await t.pumpAndSettle();
    await t.tap(find.text('대화상자 열기'));
    await t.pumpAndSettle();
    expect(find.byTooltip('비서 이노봇'), findsNothing);
    await t.tapAt(const Offset(5, 5));
    await t.pumpAndSettle();
    expect(find.byTooltip('비서 이노봇'), findsOneWidget);
  });

  testWidgets('계정 설정이 off면 숨기고, 로그인 화면·로그아웃 상태에서도 숨긴다', (t) async {
    final s = FakeSettings()..value = 'off';
    await t.pumpWidget(app(testRouter(), s));
    await t.pumpAndSettle();
    expect(find.byTooltip('비서 이노봇'), findsNothing);
    await t.pumpWidget(app(testRouter(), FakeSettings(), signedIn: false));
    await t.pumpAndSettle();
    expect(find.byTooltip('비서 이노봇'), findsNothing);
    final r = testRouter();
    await t.pumpWidget(app(r, FakeSettings()));
    r.go('/login');
    await t.pumpAndSettle();
    expect(find.byTooltip('비서 이노봇'), findsNothing);
  });

  test('설정 저장 — PUT on|off, 실패하면 이전 값으로 되돌림', () async {
    final s = FakeSettings();
    final c = ProviderContainer(overrides: [apiClientProvider.overrideWithValue(s.client), innobotSignedInProvider.overrideWithValue(true)]);
    addTearDown(c.dispose);
    expect(await c.read(innobotButtonPrefProvider.future), isTrue);
    expect(await c.read(innobotButtonPrefProvider.notifier).set(false), isTrue);
    expect(s.puts.single, {'key': 'innobot_button', 'value': 'off'});
    expect(c.read(innobotButtonPrefProvider).value, isFalse);
    s.failPut = true;
    expect(await c.read(innobotButtonPrefProvider.notifier).set(true), isFalse);
    expect(c.read(innobotButtonPrefProvider).value, isFalse);
  });
}
