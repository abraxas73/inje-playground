import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';
import 'package:playground/app/router.dart';
import 'package:playground/app/tab_shell.dart';
import 'package:playground/auth/session.dart';
import 'package:playground/gw/gw_creds.dart';
import 'package:playground/features/ladder/ladder_screen.dart';
import '../auth/fake_auth.dart';
import '../gw/fakes.dart';

class _Tokens implements TokenSource {
  @override
  Future<String?> accessToken() async => 't';
  @override
  Future<String?> refreshToken() async => 't';
  @override
  Future<void> onUnauthorized() async {}
}

Future<void> pumpShell(WidgetTester tester, AppSession user) async {
  final auth = FakeAuth()..current = session(expired: false);
  addTearDown(auth.ctrl.close);
  final api = ApiClient(httpClient: MockClient((_) async => http.Response('{"members":[]}', 200)), tokens: _Tokens(), baseUrl: 'http://x', userAgent: 't');
  final router = buildRouter(refresh: ValueNotifier(0), redirect: (_, _) => null);
  await tester.pumpWidget(ProviderScope(overrides: [
    authClientProvider.overrideWithValue(auth),
    sessionFetcherProvider.overrideWithValue((_, {required record}) async => user),
    apiClientProvider.overrideWithValue(api),
    gwStoreProvider.overrideWithValue(FakeGwStore()),
  ], child: MaterialApp.router(routerConfig: router)));
  await tester.pumpAndSettle();
}

Finder fanItem(String label) => find.descendant(of: find.byType(FanItem), matching: find.text(label));
Finder tab(String label) => find.descendant(of: find.byType(NavigationBar), matching: find.text(label));

void main() {
  final user = AppSession(email: 'u@innogrid.com', role: 'user', permissions: const {});

  testWidgets('부채꼴에는 탭과 항목을 잇는 선이 없다', (tester) async {
    await pumpShell(tester, user);
    await tester.tap(tab('업무'));
    await tester.pumpAndSettle();
    expect(find.descendant(of: find.byType(FanMenu), matching: find.byType(CustomPaint)), findsNothing);
  });

  testWidgets('하단 바는 홈·일상·AI·업무·더보기 — 하위 메뉴는 접혀 있다', (tester) async {
    await pumpShell(tester, user);
    for (final l in ['홈', '일상', 'AI', '업무', '아마란스', '더보기']) {
      expect(tab(l), findsOneWidget, reason: l);
    }
    expect(find.byType(FanItem), findsNothing);
  });

  testWidgets('일상을 누르면 하위 메뉴가 부채꼴로 펼쳐지고, 사다리를 고르면 그 탭으로 이동하며 접힌다', (tester) async {
    await pumpShell(tester, user);
    await tester.tap(tab('일상'));
    await tester.pumpAndSettle();
    for (final l in ['뭐 먹지', '사다리', '커피 타임', '설문']) {
      expect(fanItem(l), findsOneWidget, reason: l);
    }
    await tester.tap(fanItem('사다리'));
    await tester.pumpAndSettle();
    expect(find.byType(LadderScreen), findsOneWidget);
    expect(find.byType(FanItem), findsNothing);
  });

  testWidgets('업무는 Teams 채팅이 첫 항목, 바깥을 누르면 접힌다', (tester) async {
    await pumpShell(tester, user);
    await tester.tap(tab('업무'));
    await tester.pumpAndSettle();
    final labels = tester.widgetList<FanItem>(find.byType(FanItem)).map((w) => w.page.label).toList();
    expect(labels.first, 'Teams 채팅');
    expect(labels, containsAll(['RFP 분석', 'PPT 만들기', '인사·부고']));
    expect(labels, isNot(contains('마케팅 Master DB'))); // 기본 거부
    await tester.tapAt(const Offset(400, 60)); // 스크림
    await tester.pumpAndSettle();
    expect(find.byType(FanItem), findsNothing);
  });

  testWidgets('같은 그룹을 다시 누르면 접히고, 다른 그룹을 누르면 그 그룹으로 바뀐다', (tester) async {
    await pumpShell(tester, user);
    await tester.tap(tab('AI'));
    await tester.pumpAndSettle();
    expect(fanItem('Claude Code'), findsOneWidget);
    await tester.tap(tab('업무'));
    await tester.pumpAndSettle();
    expect(fanItem('Claude Code'), findsNothing);
    expect(fanItem('Teams 채팅'), findsOneWidget);
    await tester.tap(tab('업무'));
    await tester.pumpAndSettle();
    expect(find.byType(FanItem), findsNothing);
  });

  testWidgets('하위 메뉴는 왼쪽부터 시간차를 두고 하나씩 펼쳐지고, 접힐 때는 역순으로 접힌다', (tester) async {
    await pumpShell(tester, user);
    await tester.tap(tab('업무'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 120));
    double op(int i) => tester.widget<Opacity>(find.ancestor(of: find.byType(FanItem).at(i), matching: find.byType(Opacity)).first).opacity;
    final n = tester.widgetList(find.byType(FanItem)).length;
    expect(n, greaterThanOrEqualTo(4));
    expect(op(0), greaterThan(0.5)); // 첫 항목은 거의 다 나옴
    expect(op(n - 1), lessThan(0.5)); // 마지막 항목은 아직
    expect(op(0), greaterThan(op(1)));
    await tester.pumpAndSettle();
    expect(op(0), 1);
    expect(op(n - 1), 1);

    await tester.tapAt(const Offset(400, 60)); // 바깥 → 접힘 시작
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 160)); // 접힘 322ms의 절반(easeOutBack 되돌림은 끝 40%가 1 이상이라 더 뒤에서 본다)
    expect(find.byType(FanItem), findsNWidgets(n)); // 아직 접히는 중
    expect(op(n - 1), lessThan(op(0))); // 마지막 항목부터 사라진다
    await tester.pumpAndSettle();
    expect(find.byType(FanItem), findsNothing);
  });

  testWidgets('아마란스 그룹의 항목은 네이티브 화면으로 push된다(WebView 아님)', (tester) async {
    await pumpShell(tester, user);
    await tester.tap(tab('아마란스'));
    await tester.pumpAndSettle();
    for (final l in ['미결 결재', '출퇴근', '오늘 일정', '메일']) {
      expect(fanItem(l), findsOneWidget, reason: l);
    }
    await tester.tap(fanItem('출퇴근'));
    await tester.pumpAndSettle();
    expect(find.text('아마란스 연결하기'), findsOneWidget); // 미연결 → GwGate 안내
    expect(find.byType(FanItem), findsNothing);
  });

  testWidgets('볼 수 있는 페이지가 없는 그룹은 탭에서 빠진다', (tester) async {
    await pumpShell(tester, AppSession(email: 'u@innogrid.com', role: 'user', permissions: const {'usage_code': false, 'usage_chat': false, 'usage_perf': false}));
    expect(tab('AI'), findsNothing);
    expect(tab('일상'), findsOneWidget);
    expect(tab('업무'), findsOneWidget);
  });
}
