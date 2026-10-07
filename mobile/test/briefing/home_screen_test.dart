import 'package:flutter/material.dart';
import 'package:playground/briefing/briefing_provider.dart';
import 'package:playground/gw/gw_org_absences.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/api/client.dart';
import 'package:playground/auth/session.dart';
import 'package:playground/briefing/summary_provider.dart';
import 'package:playground/features/home/home_screen.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_creds.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../auth/fake_auth.dart';
import '../gw/fakes.dart';
import 'briefing_provider_test.dart' show AppApi, gwAll, gwRoutes;

/// 홈 화면 통합 — 수집·요약 배선. GW 연결 여부에 따라 Claude 호출(POST /api/mobile/briefing)이 달라진다.
Future<AppApi> pumpHome(WidgetTester tester, {required GwCreds? creds, DateTime Function()? clock, Future<GwOrgAbsences> Function()? loadCompany}) async {
  SharedPreferences.setMockInitialValues({});
  final auth = FakeAuth()..current = session(expired: false);
  addTearDown(auth.ctrl.close);
  final user = AppSession(email: 'u@innogrid.com', name: '강승욱', role: 'user', permissions: const {});
  final app = AppApi({
    '/api/teams/mentions': (200, {'connected': true, 'items': [{'chatId': 'c', 'topic': '센터', 'from': '김민준', 'text': '확인 부탁', 'at': '2026-10-05T00:00:00Z'}]}),
    '/api/mobile/briefing': (200, {'enabled': true, 'text': '오늘 10시 주간회의가 있습니다.', 'model': 'm', 'at': 'x'}),
    '/api/mobile/release': (200, {'version': '', 'build': 0, 'url': ''}),
  });
  await tester.pumpWidget(ProviderScope(key: UniqueKey(), overrides: [
    if (clock != null) briefingClockProvider.overrideWithValue(clock),
    if (loadCompany != null) companyAbsencesProvider.overrideWith((ref) => loadCompany()),
    authClientProvider.overrideWithValue(auth),
    sessionFetcherProvider.overrideWithValue((_, {required record}) async => user),
    apiClientProvider.overrideWithValue(app.client),
    gwStoreProvider.overrideWithValue(FakeGwStore(creds)),
    gwHttpClientProvider.overrideWithValue(gwRoutes(gwAll)),
  ], child: MaterialApp(home: HomeScreen(now: DateTime(2026, 10, 5, 8, 40)))));
  await tester.pumpAndSettle();
  return app;
}

void main() {
  testWidgets('전체 토글: 부재자가 없어도 보이고, 켤 때만 회사 전체 조회·끄면 소속 복원', (tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 1800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var calls = 0;
    final app = await pumpHome(tester, creds: testCreds, loadCompany: () async {
      calls++;
      return const GwOrgAbsences(scopeName:'회사 전체',isCenter:false,members:[GwOrgMemberStatus('other','다른팀원','외근')]);
    });
    expect(calls, 0);
    await tester.ensureVisible(find.byType(FilterChip));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(FilterChip)); await tester.pumpAndSettle();
    expect(calls, 1);
    expect(find.text('회사 전체 부재'), findsOneWidget);
    expect(find.text('다른팀원 · 외근'), findsOneWidget);
    expect(tester.widget<FilterChip>(find.byType(FilterChip)).selected, true);
    await tester.tap(find.byType(FilterChip)); await tester.pumpAndSettle();
    expect(find.text('팀원 부재'), findsOneWidget);
    expect(find.text('다른팀원 · 외근'), findsNothing);
    expect(tester.widget<FilterChip>(find.byType(FilterChip)).selected, false);
    expect(app.calls['/api/mobile/briefing'], 1, reason:'전체 목록 전환은 소속 기준 브리핑을 바꾸지 않는다');
    await tester.tap(find.byType(FilterChip)); await tester.pumpAndSettle();
    expect(calls, 2, reason:'다시 켜면 최신 상태를 조회한다');
  });

  testWidgets('전체 조회 실패는 오류·재시도를 표시하고 소속 목록으로 돌아갈 수 있다', (tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 1800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var calls = 0;
    await pumpHome(tester, creds: testCreds, loadCompany: () async {
      if (++calls == 1) throw StateError('offline');
      return const GwOrgAbsences(scopeName:'회사 전체',isCenter:false,members:[]);
    });
    await tester.ensureVisible(find.byType(FilterChip));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(FilterChip)); await tester.pumpAndSettle();
    expect(find.text('조직도 상태를 불러오지 못했습니다 · 다시 시도'), findsOneWidget);
    await tester.tap(find.text('조직도 상태를 불러오지 못했습니다 · 다시 시도')); await tester.pumpAndSettle();
    expect(calls, 2);
    expect(find.text('현재 부재자가 없습니다.'), findsOneWidget);
    await tester.tap(find.byType(FilterChip)); await tester.pumpAndSettle();
    expect(find.text('팀원 부재'), findsOneWidget);
  });

  testWidgets('07:00 타이머가 다음 날에도 원본 데이터와 브리핑을 다시 수집한다', (tester) async {
    var now = DateTime.utc(2026, 10, 6, 6, 59);
    final app = await pumpHome(tester, creds: testCreds, clock: () => now);
    expect(app.calls['/api/mobile/briefing'], 1);
    now = DateTime.utc(2026, 10, 6, 7);
    await tester.pump(const Duration(minutes: 1));
    await tester.pumpAndSettle();
    expect(app.calls['/api/mobile/briefing'], 2);
    expect(app.calls['/api/teams/mentions'], 2);
    now = DateTime.utc(2026, 10, 7, 7);
    await tester.pump(const Duration(days: 1));
    await tester.pumpAndSettle();
    expect(app.calls['/api/mobile/briefing'], 3);
  });

  testWidgets('백그라운드에서 07:00을 넘기면 복귀할 때 한 번 갱신한다', (tester) async {
    var now = DateTime.utc(2026, 10, 6, 8);
    final app = await pumpHome(tester, creds: testCreds, clock: () => now);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    now = DateTime.utc(2026, 10, 8, 8);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(app.calls['/api/mobile/briefing'], 2);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(app.calls['/api/mobile/briefing'], 2);
  });

  testWidgets('수동 새로고침은 당일 캐시를 무시하고 실패 시 재시도할 수 있다', (tester) async {
    final app = await pumpHome(tester, creds: testCreds);
    app.routes['/api/mobile/briefing'] = (502, {'error': 'unavailable'});
    await tester.tap(find.byTooltip('브리핑 새로고침'));
    await tester.pumpAndSettle();
    expect(app.calls['/api/mobile/briefing'], 2);
    expect(find.text('오늘 10시 주간회의가 있습니다.'), findsOneWidget);
    expect(find.textContaining('브리핑을 새로 받지 못했습니다'), findsOneWidget);
    app.routes['/api/mobile/briefing'] = (200, {'enabled': true, 'text': '새로운 브리핑', 'at': 'x'});
    await tester.tap(find.byTooltip('브리핑 새로고침'));
    await tester.pumpAndSettle();
    expect(app.calls['/api/mobile/briefing'], 3);
    expect(app.calls['/api/teams/mentions'], 3);
    expect(find.text('새로운 브리핑'), findsOneWidget);
  });

  testWidgets('아마란스 연결됨: 섹션이 그려지고 Claude 문장을 1회 받아 카드에 보인다', (tester) async {
    final app = await pumpHome(tester, creds: testCreds);
    expect(app.calls['/api/mobile/briefing'], 1);
    expect(find.text('오늘 10시 주간회의가 있습니다.'), findsOneWidget);
    expect(find.text('데일리 브리핑'), findsOneWidget);
    expect(find.text('오늘의 한 줄'), findsOneWidget, reason: '격언 카드는 그대로 위에 남는다');
    expect(find.text('지금 필요한 것'), findsOneWidget);
    expect((app.bodies['/api/mobile/briefing'] as Map)['name'], '강승욱');
  });
  testWidgets('아마란스 미연결: 연결 카드 + Teams 섹션만, Claude는 부르지 않고 격언을 유지한다', (tester) async {
    final app = await pumpHome(tester, creds: null);
    expect(find.text('아마란스를 연결하세요'), findsOneWidget);
    expect(find.text('지금 필요한 것'), findsNothing);
    expect(find.text('Teams 답장 대기 1'), findsOneWidget);
    expect(app.calls['/api/mobile/briefing'], isNull, reason: '빈 데이터로 문장을 만들지 않는다');
    expect(find.text('오늘의 한 줄'), findsOneWidget);
    expect(find.text('데일리 브리핑'), findsNothing);
  });
}
