import 'package:flutter_test/flutter_test.dart';
import 'package:playground/gw/gw_login_js.dart';
import 'package:playground/telemetry/app_events.dart';

void main() {
  test('허용 kind·code만 큐에 쌓아 한 번에 보낸다(버전·플랫폼 포함, 메시지 없음)', () async {
    final sent = <List<Map<String, String>>>[];
    final ev = AppEvents(delay: const Duration(hours: 1))..sender = (b) async => sent.add(b);
    ev.report('gw_login_failed', 'no_button');
    ev.report('gw_unauthorized', 'session_expired');
    ev.report('gw_login_failed', 'wrong password'); // 모르는 code
    ev.report('crash', 'x'); // 모르는 kind
    ev.report('app_error', errorTypeName(StateError('token=secret')));
    await ev.flush();
    expect(sent, hasLength(1));
    expect(sent.single.map((e) => '${e['kind']}:${e['code']}'), ['gw_login_failed:no_button', 'gw_unauthorized:session_expired', 'app_error:StateError']);
    expect(sent.single.first.keys, unorderedEquals(['kind', 'code', 'version', 'platform', 'at']));
    expect(sent.toString(), isNot(contains('secret')));
    await ev.flush();
    expect(sent, hasLength(1)); // 빈 큐는 안 보낸다
  });
  test('보내기 실패는 조용히 버리고, sender가 없으면(로그인 전·개발 빌드) 쌓지도 않는다', () async {
    final ev = AppEvents(delay: const Duration(hours: 1))..sender = (_) async => throw Exception('offline');
    ev.report('gw_login_failed', 'watchdog');
    await ev.flush(); // 던지지 않는다
    var calls = 0;
    final none = AppEvents(delay: const Duration(hours: 1));
    none.report('gw_login_failed', 'watchdog');
    none.sender = (_) async => calls++;
    await none.flush();
    expect(calls, 0);
  });
  test('한 묶음은 최대 20개, 지연 뒤 자동 전송', () async {
    final sent = <List<Map<String, String>>>[];
    final ev = AppEvents(delay: const Duration(milliseconds: 5))..sender = (b) async => sent.add(b);
    for (var i = 0; i < 25; i++) {
      ev.report('app_error', 'StateError');
    }
    await Future<void>.delayed(const Duration(milliseconds: 30));
    expect(sent.single, hasLength(20));
  });
  test('errorTypeName은 타입 이름만, 서버 형식에 맞춘다 / fillJs 결과 코드(iOS 따옴표 포함)', () {
    expect(errorTypeName(const FormatException('비밀')), 'FormatException');
    expect(errorTypeName(<String, int>{}), matches(RegExp(r'^[A-Za-z_$][\w$<>,.? ]{0,79}$')));
    expect(fillFailureCode('no-button'), 'no_button');
    expect(fillFailureCode('"no-field"'), 'no_field');
    expect(fillFailureCode('ok'), isNull);
    expect(fillFailureCode(null), isNull);
  });
}
