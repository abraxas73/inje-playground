import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/api/client.dart';
import 'package:playground/auth/session.dart';
import 'package:playground/features/home/home_screen.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_creds.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../auth/fake_auth.dart';
import '../gw/fakes.dart';
import 'briefing_provider_test.dart' show AppApi, gwAll, gwRoutes;

/// 홈 화면 통합 — 수집·요약 배선. GW 연결 여부에 따라 Claude 호출(POST /api/mobile/briefing)이 달라진다.
Future<AppApi> pumpHome(WidgetTester tester, {required GwCreds? creds}) async {
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
  testWidgets('아마란스 연결됨: 섹션이 그려지고 Claude 문장을 1회 받아 카드에 보인다', (tester) async {
    final app = await pumpHome(tester, creds: testCreds);
    expect(app.calls['/api/mobile/briefing'], 1);
    expect(find.text('오늘 10시 주간회의가 있습니다.'), findsOneWidget);
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
  });
}
