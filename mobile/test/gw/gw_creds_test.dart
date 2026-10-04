import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_creds.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('authToken에서 groupSeq·empSeq를 뗀다', () {
    const c = GwCreds(authToken: 'gcmsX|3166|secret', signKey: 'k');
    expect(c.groupSeq, 'gcmsX');
    expect(c.empSeq, '3166');
  });
  group('parseGwCookies', () {
    test('oAuthToken·signKey 둘 다 있을 때만', () {
      final c = parseGwCookies('a=1; oAuthToken=g%7C1%7Cs; signKey=KEY%3D%3D; b=2');
      expect(c?.authToken, 'g|1|s'); // 퍼센트 인코딩 해제
      expect(c?.signKey, 'KEY==');
      expect(parseGwCookies('oAuthToken=x'), isNull);
      expect(parseGwCookies(''), isNull);
    });
    test('BIZCUBE_AT/HK로 폴백', () {
      final c = parseGwCookies('BIZCUBE_AT=t; BIZCUBE_HK=h');
      expect((c?.authToken, c?.signKey), ('t', 'h'));
    });
    test('[리뷰5] 다른 쿠키 값이 깨진 퍼센트 인코딩이어도 예외 없이 토큰을 찾는다', () {
      final c = parseGwCookies('bad=%E0%A4%A; oAuthToken=t; signKey=h; worse=100%');
      expect((c?.authToken, c?.signKey), ('t', 'h'));
    });
    test('iOS가 돌려주는 따옴표 감싼 JSON 문자열도 벗긴다', () {
      final c = parseGwCookies('"oAuthToken=t; signKey=h"');
      expect((c?.authToken, c?.signKey), ('t', 'h'));
    });
  });
  test('저장소 왕복과 삭제', () async {
    SharedPreferences.setMockInitialValues({});
    final s = GwCredsStore();
    expect(await s.load(), isNull);
    await s.save(const GwCreds(authToken: 'a|b|c', signKey: 'k', empName: '홍길동', email: 'h@innogrid.com'));
    final c = await s.load();
    expect((c?.authToken, c?.signKey, c?.empName, c?.email), ('a|b|c', 'k', '홍길동', 'h@innogrid.com'));
    await s.clear();
    expect(await s.load(), isNull);
  });
  test('상태: 없음 → connect → needsRelogin → disconnect', () async {
    SharedPreferences.setMockInitialValues({});
    final container = ProviderContainer();
    addTearDown(container.dispose);
    expect((await container.read(gwProvider.future)).status, GwStatus.none);
    await container.read(gwProvider.notifier).connect(const GwCreds(authToken: 'a|b|c', signKey: 'k'));
    expect(container.read(gwProvider).value?.status, GwStatus.connected);
    container.read(gwProvider.notifier).markUnauthorized();
    expect(container.read(gwProvider).value?.status, GwStatus.needsRelogin);
    expect(container.read(gwProvider).value?.creds, isNotNull); // 토큰은 유지
    await container.read(gwProvider.notifier).disconnect();
    expect(container.read(gwProvider).value?.status, GwStatus.none);
    expect(await GwCredsStore().load(), isNull);
  });
  test('[리뷰1·7] 401이 병렬로 두 번 와도 GwUnauthorized만 나오고, 만료 상태에선 클라이언트가 null', () async {
    SharedPreferences.setMockInitialValues({});
    final container = ProviderContainer(overrides: [gwHttpClientProvider.overrideWithValue(MockClient((_) async => http.Response('{"resultCode":140}', 401)))]);
    addTearDown(container.dispose);
    await container.read(gwProvider.notifier).connect(const GwCreds(authToken: 'a|b|c', signKey: 'k'));
    final client = container.read(gwClientProvider)!;
    final results = await Future.wait([client.call('/p', {}), client.call('/q', {})].map((f) => f.then((_) => 'ok').catchError((e) => e.runtimeType.toString())));
    expect(results, ['GwUnauthorized', 'GwUnauthorized']);
    expect(container.read(gwProvider).value?.status, GwStatus.needsRelogin);
    expect(container.read(gwClientProvider), isNull); // 만료면 요청을 보내지 않는다
    await container.read(gwProvider.notifier).connect(const GwCreds(authToken: 'a|b|c', signKey: 'k2'));
    expect(container.read(gwClientProvider), isNotNull);
  });
}
