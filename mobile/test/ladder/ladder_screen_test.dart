import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';
import 'package:playground/features/ladder/ladder_screen.dart';

class _Tokens implements TokenSource {
  @override Future<String?> accessToken() async => 't';
  @override Future<String?> refreshToken() async => 't';
  @override Future<void> onUnauthorized() async {}
}

void main() {
  testWidgets('사다리를 만들지 않고 화면이 사라져도(로그아웃·탭 정리) dispose가 예외 없이 끝난다', (tester) async {
    final api = ApiClient(httpClient: MockClient((_) async => http.Response('{"members":[]}', 200)), tokens: _Tokens(), baseUrl: 'http://x', userAgent: 't');
    await tester.pumpWidget(ProviderScope(overrides: [apiClientProvider.overrideWithValue(api)], child: const MaterialApp(home: LadderScreen())));
    await tester.pump();
    await tester.pumpWidget(const MaterialApp(home: SizedBox())); // 화면 제거 → dispose
    await tester.pump();
    expect(tester.takeException(), isNull, reason: 'late final AnimationController가 dispose에서 처음 생성되면 "Looking up a deactivated widget\'s ancestor is unsafe"');
  });
}
