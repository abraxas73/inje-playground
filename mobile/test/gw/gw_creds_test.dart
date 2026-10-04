import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
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
}
