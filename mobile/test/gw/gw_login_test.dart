import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/gw/gw_login_js.dart';
import 'package:playground/gw/gw_login_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('로그인 정보는 보안 저장소에 왕복·삭제된다', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final s = GwLoginStore();
    expect(await s.load(), isNull);
    await s.save(const GwLogin(id: 'seunguk.kang', pw: 'p@ss'));
    final l = await s.load();
    expect((l?.id, l?.pw), ('seunguk.kang', 'p@ss'));
    await s.clear();
    expect(await s.load(), isNull);
  });
  test('gwLoginProvider: 저장 → 상태 반영 → 삭제', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final c = ProviderContainer();
    addTearDown(c.dispose);
    expect(await c.read(gwLoginProvider.future), isNull);
    await c.read(gwLoginProvider.notifier).save(const GwLogin(id: 'a', pw: 'b'));
    expect(c.read(gwLoginProvider).value?.id, 'a');
    await c.read(gwLoginProvider.notifier).clear();
    expect(c.read(gwLoginProvider).value, isNull);
  });
  group('decideFill', () {
    const login = GwLogin(id: 'me', pw: 'pw');
    test('아이디 화면이면 아이디, 비밀번호 화면이면 비밀번호를 채운다(각 1회)', () {
      expect(decideFill(const GwProbe(hasId: true, hasPw: false, hasOtp: false, error: ''), login, idDone: false, pwDone: false), FillAction.fillId);
      expect(decideFill(const GwProbe(hasId: true, hasPw: false, hasOtp: false, error: ''), login, idDone: true, pwDone: false), FillAction.none);
      expect(decideFill(const GwProbe(hasId: false, hasPw: true, hasOtp: false, error: ''), login, idDone: true, pwDone: false), FillAction.fillPw);
      expect(decideFill(const GwProbe(hasId: false, hasPw: true, hasOtp: false, error: ''), login, idDone: true, pwDone: true), FillAction.none);
    });
    test('OTP 화면·오류 문구·저장된 정보 없음이면 사람에게 넘긴다(reveal)', () {
      expect(decideFill(const GwProbe(hasId: false, hasPw: false, hasOtp: true, error: ''), login, idDone: true, pwDone: true), FillAction.reveal);
      expect(decideFill(const GwProbe(hasId: false, hasPw: true, hasOtp: false, error: '비밀번호가 일치하지 않습니다'), login, idDone: true, pwDone: true), FillAction.reveal);
      expect(decideFill(const GwProbe(hasId: true, hasPw: false, hasOtp: false, error: ''), null, idDone: false, pwDone: false), FillAction.reveal);
      expect(decideFill(const GwProbe(hasId: false, hasPw: true, hasOtp: false, error: ''), const GwLogin(id: 'me', pw: ''), idDone: true, pwDone: false), FillAction.reveal);
    });
    test('아무 필드도 없으면(로딩 중·메인) none', () {
      expect(decideFill(const GwProbe(hasId: false, hasPw: false, hasOtp: false, error: ''), login, idDone: false, pwDone: false), FillAction.none);
    });
  });
  group('JS 조각', () {
    test('viewport 교정 JS는 device-width를 넣는다', () {
      expect(viewportFixJs, contains('width=device-width'));
      expect(viewportFixJs, contains("meta[name=viewport]"));
      // 폰 폭에서 로그인 버튼을 덮는 하단 저작권 문구는 숨긴다(입력칸·버튼이 든 요소는 건드리지 않음, SPA 재렌더에도 다시 적용)
      expect(viewportFixJs, contains('Copyright'));
      expect(viewportFixJs, contains('MutationObserver'));
      expect(viewportFixJs, contains('input,button,form'));
    });
    test('fillJs는 값을 JSON 문자열로 안전하게 넣고 선택자·버튼을 담는다', () {
      final js = fillJs(selector: '#reqLoginPw', value: 'a"b\'c</script>', submitText: '로그인');
      expect(js, contains('#reqLoginPw'));
      expect(js, contains(jsonEncode('a"b\'c</script>')));
      expect(js, contains(jsonEncode('로그인')));
      expect(js, contains('HTMLInputElement.prototype'));
    });
    test('probe 결과는 따옴표로 감싼 JSON 문자열(iOS)도 읽는다', () {
      const j = '{"hasId":true,"hasPw":false,"hasOtp":false,"error":""}';
      expect(GwProbe.parse(j)?.hasId, true);
      expect(GwProbe.parse(jsonEncode(j))?.hasId, true);
      expect(GwProbe.parse('null'), isNull);
      expect(GwProbe.parse('garbage'), isNull);
    });
  });
}
