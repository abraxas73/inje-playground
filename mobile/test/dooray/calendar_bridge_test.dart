import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/dooray/calendar_bridge.dart';

const row = {
  'id': '1',
  'calendarId': '2',
  'subject': '회의',
  'startedAt': '2026-10-12T09:00:00+09:00',
  'endedAt': '2026-10-12T10:00:00+09:00',
  'wholeDayFlag': false,
};
void main() {
  test('unread mail query excludes read mail and never requests a body', () {
    final js = calendarRequestJs('mail', '2026-10-11', unreadMail: true);
    expect(js, contains('read=false&preview=false&size=5'));
    expect(js, contains('flags?.read === false'));
    expect(
      calendarResult(
        '{"items":[{"subject":"x","from":"sender","sentAt":"2026-10-11","unread":true}]}',
        unreadMail: true,
      )?['items'],
      hasLength(1),
    );
    expect(
      () => calendarResult(
        '{"items":[{"subject":"x","from":"sender","sentAt":"2026-10-11","unread":false}]}',
        unreadMail: true,
      ),
      throwsA(isA<DoorayCalendarException>()),
    );
  });
  test('WebView string encoding and malformed responses', () {
    expect(
      calendarResult(
        jsonEncode(
          jsonEncode({
            'items': [row],
          }),
        ),
      )?['items'],
      [row],
    );
    expect(calendarResult('null'), isNull);
    expect(
      () => calendarResult('{"items":[{"subject":"bad"}]}'),
      throwsA(isA<DoorayCalendarException>()),
    );
    expect(
      () => calendarResult('{"error":"login"}'),
      throwsA(predicate((e) => '$e'.contains('다시 로그인'))),
    );
  });
  test(
    'strict day and KST midnight range without token export or public API fallback',
    () {
      final js = calendarRequestJs('x', '2026-12-31');
      expect(js, contains('2027-01-01T00:00:00+09:00'));
      // 기간 조회(주간 7일·월간 42일): timeMax는 마지막 날 다음 00:00, 범위 밖은 거부
      expect(calendarRequestJs('x', '2026-12-31', days: 7), contains('2027-01-07T00:00:00+09:00'));
      expect(calendarRequestJs('x', '2026-09-28', days: 42), contains('2026-11-09T00:00:00+09:00'));
      expect(() => calendarRequestJs('x', '2026-12-31', days: 0), throwsFormatException);
      expect(() => calendarRequestJs('x', '2026-12-31', days: 43), throwsFormatException);
      expect(js, contains("'Dooray-Caller':'WEB'"));
      expect(js, isNot(contains('document.cookie')));
      expect(js, isNot(contains('api.dooray.com')));
      expect(() => calendarRequestJs('x', '2026-02-30'), throwsFormatException);
      expect(
        () => calendarRequestJs('x', "2026-10-12';alert(1)"),
        throwsFormatException,
      );
    },
  );
  test('isolates concurrent requests and erases response slots', () async {
    final scripts = <String>[];
    final client = DoorayCalendarClient(
      run: (s) async => scripts.add(s),
      evaluate: (_) async => jsonEncode({
        'items': [row],
      }),
    );
    expect((await client.read('2026-10-12'))['items'], [row]);
    expect((await client.read('2026-10-13'))['items'], [row]);
    expect(scripts.where((s) => s.startsWith('delete')).length, 2);
    expect(scripts.first, contains('request1'));
    expect(scripts[2], contains('request2'));
  });
  test('disconnect during a read discards prior account data', () async {
    final pending = Completer<Object>();
    final entered = Completer<void>();
    final client = DoorayCalendarClient(
      run: (_) async {},
      evaluate: (_) {
        entered.complete();
        return pending.future;
      },
    );
    final read = client.read('2026-10-12');
    final check = expectLater(read, throwsA(isA<DoorayCalendarException>()));
    await entered.future;
    client.close();
    pending.complete(
      jsonEncode({
        'items': [row],
      }),
    );
    await check;
    await expectLater(
      client.read('2026-10-12'),
      throwsA(isA<DoorayCalendarException>()),
    );
  });
}
