import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/gw_client.dart' show gwHttpClientProvider;
import 'package:playground/messenger/messenger_enabled.dart';
import 'package:playground/messenger/messenger_provider.dart';
import 'package:playground/messenger/messenger_tools.dart' show messengerError;

class _Pref extends MessengerEnabledPref {
  _Pref(this.on);
  final bool on;
  @override
  Future<bool> build() async => on;
}

void main() {
  test('연동을 끄면 메신저 로그인 자체를 하지 않는다(네트워크 0회) — 이노봇·커넥터 도구는 안내 문구', () async {
    var hits = 0;
    final c = ProviderContainer(overrides: [
      messengerEnabledProvider.overrideWith(() => _Pref(false)),
      gwHttpClientProvider.overrideWithValue(MockClient((_) async {
        hits++;
        return http.Response('{}', 500);
      })),
    ]);
    addTearDown(c.dispose);
    Object? err;
    try {
      await c.read(messengerClientProvider).ensureSession();
    } catch (e) {
      err = e;
    }
    expect(err, isA<MessengerDisabledException>());
    expect(hits, 0);
    expect(messengerError(err!), contains('연동이 꺼져 있습니다'));
  });

  testWidgets('꺼져 있으면 화면 대신 안내, [설정으로 이동]은 더보기로', (tester) async {
    final router = GoRouter(initialLocation: '/gw/messenger', routes: [
      GoRoute(path: '/gw/messenger', builder: (_, _) => const MessengerGate(child: Text('메신저 본문'))),
      GoRoute(path: '/more', builder: (_, _) => const Text('더보기 화면')),
    ]);
    await tester.pumpWidget(ProviderScope(overrides: [messengerEnabledProvider.overrideWith(() => _Pref(false))], child: MaterialApp.router(routerConfig: router)));
    await tester.pumpAndSettle();
    expect(find.text('메신저 본문'), findsNothing);
    expect(find.text(messengerOffText), findsOneWidget);
    await tester.tap(find.text('설정으로 이동'));
    await tester.pumpAndSettle();
    expect(find.text('더보기 화면'), findsOneWidget);
  });

  testWidgets('켜져 있으면 그대로', (tester) async {
    await tester.pumpWidget(ProviderScope(overrides: [messengerEnabledProvider.overrideWith(() => _Pref(true))], child: const MaterialApp(home: MessengerGate(child: Text('메신저 본문')))));
    await tester.pumpAndSettle();
    expect(find.text('메신저 본문'), findsOneWidget);
  });
}
