// mobile/test/mcp/mcp_tools_update_test.dart — Task 8: update_reservation·update_calendar_event·attendance_month(캡처 요청 본문·응답 키 일치).
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/mcp/approval_schemas.dart';
import 'package:playground/mcp/mcp_tools.dart';
import 'package:playground/mcp/mcp_worker.dart';
import 'mcp_tools_test.dart' show Gw, org, cap, hasKeys;

const _fx = 'test/mcp/fixtures/captured';
Map captured(String label) => jsonDecode(File('$_fx/$label.json').readAsStringSync()) as Map;
Map body(String label, String path, [int nth = 0]) => ((captured(label)['calls'] as List).where((c) => c['path'] == path).toList()[nth] as Map)['body'] as Map;

/// 캡처의 본인 empSeq(3060)를 테스트 계정(7)으로.
dynamic me(dynamic v) => jsonDecode(jsonEncode(v).replaceAll('"3060"', '"7"'));

void main() {
  late Directory dir;
  setUp(() => dir = Directory.systemTemp.createTempSync('mcp_update_test'));
  tearDown(() => dir.deleteSync(recursive: true));
  Future<dynamic> run(Gw gw, String tool, Map<String, dynamic> args) async =>
      jsonDecode(await McpTools(gw: gw.api(), appSupportDir: () => dir.path, schemas: ApprovalSchemas(loader: (p) => File(p).readAsString())).execute(tool, args));

  group('update_reservation', () {
    Map<String, Object? Function(Map<String, dynamic>)> routes({bool failReadback = false, String owner = '7', String repeatType = '10'}) {
      final before = me(cap('update_reservation', '/schres/rs121A10')) as Map;
      final after = me(cap('update_reservation', '/schres/rs121A10', 1)) as Map;
      return {
        ...org(),
        '/schres/rs121A10': (b) {
          if (b['seqNum'] == 76195) return {...before, 'empSeq': owner, 'repeatType': repeatType};
          if (failReadback) throw const SocketException('x');
          return after;
        },
        '/schres/rs121A12': (_) => cap('update_reservation', '/schres/rs121A12'),
      };
    }

    test('A10 원본 → A12 수정(캡처 본문) → A10 새 seqNum 재조회, 응답 키', () async {
      final gw = Gw(routes());
      final r = await run(gw, 'update_reservation', captured('update_reservation')['args'] as Map<String, dynamic>);
      expect(gw.order.where((p) => p.startsWith('/schres')), ['/schres/rs121A10', '/schres/rs121A12', '/schres/rs121A10']);
      final want = me(body('update_reservation', '/schres/rs121A12')) as Map;
      final got = gw.calls['/schres/rs121A12']!.single;
      expect(got.keys.toSet(), want.keys.toSet());
      for (final k in ['seqNum', 'resIdx', 'resSeq', 'reqText', 'startDate', 'endDate', 'startDatePk', 'createDatePk', 'apprYn', 'alldayYn', 'repeatType', 'uidList', 'resSubscriberList', 'descText', 'resName']) {
        expect(got[k], want[k], reason: k);
      }
      expect(gw.calls['/schres/rs121A10']!.last, containsPair('seqNum', 76198));
      expect(gw.calls['/schres/rs121A10']!.last, containsPair('resIdx', '2'));
      hasKeys(r, captured('update_reservation')['toolResult']);
      expect((r['ok'], r['verified_by_readback'], r['seqNum'], r['prev_seqNum'], r['reissued'], r['resIdx'], r['period'], r['attendeesVerified']),
          (true, true, 76198, 76195, true, '2', '202610120800~202610120845', true));
      expect(r.containsKey('lunchWarning'), false);
    });

    test('참석자 지정 → 본인 먼저 통째로 교체, 점심 경고', () async {
      final gw = Gw(routes());
      final r = await run(gw, 'update_reservation', {'res_seq': '45', 'seq_num': '76195', 'attendees': ['강팀장'], 'start': '202610121230', 'end': '202610121330'});
      final subs = gw.calls['/schres/rs121A12']!.single['resSubscriberList'] as List;
      expect(subs.map((s) => s['empSeq']), ['7', '31']);
      expect(subs[1], {'groupSeq': 'g', 'compSeq': '1000', 'deptSeq': '130', 'empSeq': '31'});
      expect(r['attendeesVerified'], false, reason: '재조회 참석자에 31이 없다');
      expect(r['lunchWarning'], contains('점심'));
    });

    test('남의 예약은 거절, 재조회 실패는 ok:true·verified false', () async {
      await expectLater(run(Gw(routes(owner: '99')), 'update_reservation', {'res_seq': '45', 'seq_num': 76195, 'req_text': 'y'}),
          throwsA(isA<McpToolError>().having((e) => e.message, 'm', contains('본인'))));
      final r = await run(Gw(routes(failReadback: true)), 'update_reservation', {'res_seq': '45', 'seq_num': 76195, 'req_text': 'y'});
      expect((r['ok'], r['verified_by_readback'], r['seqNum']), (true, false, 76198));
      expect(r['note'], contains('재조회'));
    });

    test('반복 예약(repeatType≠10)은 A12 없이 거절', () async {
      final gw = Gw(routes(repeatType: '20'));
      await expectLater(run(gw, 'update_reservation', {'res_seq': '45', 'seq_num': 76195, 'req_text': 'y'}), throwsA(isA<McpToolError>().having((e) => e.message, 'm', contains('반복 예약'))));
      expect(gw.calls.containsKey('/schres/rs121A12'), false);
    });
  });

  group('update_calendar_event', () {
    Map<String, Object? Function(Map<String, dynamic>)> routes({String creator = '7'}) {
      var n = 0;
      return {
        ...org(),
        '/schres/sc111A02': (_) => me(cap('create_calendar_event', '/schres/sc111A02')),
        '/schres/sc111A03': (_) {
          final d = me(cap('update_calendar_event', '/schres/sc111A03', n++ == 0 ? 0 : 1)) as Map;
          final rows = [for (final r in d['resultList'] as List) r['schSeq'] == '97461' ? {...r, 'createSeq': creator} : r];
          return {...d, 'resultList': rows};
        },
        '/schres/sc111A05': (_) => cap('update_calendar_event', '/schres/sc111A05'),
      };
    }

    test('A03 원본·소유권 → A05 수정(itemList 캡처 형상) → A03 재조회, 응답 키', () async {
      final gw = Gw(routes());
      final r = await run(gw, 'update_calendar_event', captured('update_calendar_event')['args'] as Map<String, dynamic>);
      expect(gw.order.where((p) => p.startsWith('/schres/sc111A0') && p != '/schres/sc111A02'), ['/schres/sc111A03', '/schres/sc111A05', '/schres/sc111A03']);
      final want = me(body('update_calendar_event', '/schres/sc111A05')) as Map;
      final got = gw.calls['/schres/sc111A05']!.single;
      expect(got.keys.toSet(), want.keys.toSet());
      for (final k in ['schSeq', 'schmSeq', 'schGbnCode', 'rangeCode', 'repeatType', 'alarm_yn', 'alarmOnModify', 'mailSend', 'videoYn', 'videoTimeZone', 'empSeq', 'langCode']) {
        expect(got[k], want[k], reason: k);
      }
      final items = got['itemList'] as List;
      expect(items.map((i) => i['item']), ['videoYn', 'schParticipants', 'mailSend', 'schTitle', 'schDate']);
      expect(items[1]['updateSchPartEmpList'], [
        {'compSeq': '1000', 'deptSeq': '130', 'empName': '홍길동', 'empSeq': '7', 'mcalSeq': '993', 'orgSeq': '7', 'orgType': 'E', 'partType': 'M'},
      ]);
      expect(items[3], {'item': 'schTitle', 'schTitle': 'x'});
      expect(items[4], {'item': 'schDate', 'schDate': {'allDay': 'N', 'endDate': '202610122345', 'lunar': 'N', 'lunarDate': '', 'startDate': '202610122300'}});
      hasKeys(r, captured('update_calendar_event')['toolResult']);
      expect((r['ok'], r['verified_by_readback'], r['schSeq'], r['period'], r['title']), (true, true, '97461', '202610122300~202610122345', 'x'));
    });

    test('제목만 바꾸면 schDate 항목 없음 · 남의 일정·contents·없는 일정은 거절', () async {
      final gw = Gw(routes());
      await run(gw, 'update_calendar_event', {'sch_seq': 97461, 'date': '2026-10-12', 'title': 'x'});
      expect((gw.calls['/schres/sc111A05']!.single['itemList'] as List).map((i) => i['item']), ['videoYn', 'schParticipants', 'mailSend', 'schTitle']);
      await expectLater(run(Gw(routes(creator: '99')), 'update_calendar_event', {'sch_seq': '97461', 'date': '20261012', 'title': 'y'}),
          throwsA(isA<McpToolError>().having((e) => e.message, 'm', contains('본인'))));
      await expectLater(run(Gw(routes()), 'update_calendar_event', {'sch_seq': '97461', 'date': '20261012', 'contents': 'y'}),
          throwsA(isA<McpToolError>().having((e) => e.message, 'm', contains('contents'))));
      await expectLater(run(Gw(routes()), 'update_calendar_event', {'sch_seq': '1', 'date': '20261012', 'title': 'y'}),
          throwsA(isA<McpToolError>().having((e) => e.message, 'm', contains('찾지 못했습니다'))));
    });
  });

  group('attendance_month', () {
    const path = '/human/openapi/worktime/status/getWorkTimeStatusList';
    Map<String, Object? Function(Map<String, dynamic>)> routes() {
      final rows = (cap('attendance_month', path) as List).cast<Map>();
      Map row(String dt, Map<String, Object?> over) => {...rows[0], 'atDt': dt, ...over};
      return {
        ...org(),
        path: (_) => [
              {...rows[0], 'holiNm': '근로일', 'attresultNm': '출근'},
              {...rows[2], 'holiNm': '유휴', 'attresultNm': '휴일'},
              row('20261008', {'holiNm': '근로일', 'attresultNm': '정상근무', 'atNm': '오후반차', 'comeTm': '0848', 'leaveTm': '1802', 'basicworkTm': 480, 'overworkTm': 30}),
              row('20261012', {'holiNm': '근로일', 'attresultNm': '지각', 'comeTm': '0931', 'basicworkTm': 450}),
              row('20261013', {'holiNm': '근로일', 'attresultNm': '결근', 'comeTm': ''}),
            ],
      };
    }

    test('month → 그 달 1일~말일 요청, days·summary', () async {
      final gw = Gw(routes());
      final r = await run(gw, 'attendance_month', {'month': '202610'});
      expect(gw.calls[path]!.single, {'coCd': 'C7', 'empCdList': ['E7'], 'startDate': '20261001', 'endDate': '20261031'});
      final want = captured('attendance_month')['toolResult'] as Map;
      hasKeys(r, want);
      hasKeys((r['days'] as List).first, (want['days'] as List).first);
      hasKeys(r['summary'], want['summary']);
      expect((r['kind'], r['period'], r['rowCount']), ('attendancePeriod', '20261001~20261031', 5));
      expect((r['days'] as List).first, {'come': '09:08', 'date': '20261001', 'dayType': '근로일', 'leave': '', 'overtimeMin': 0, 'reason': null, 'result': '출근', 'workMin': 0});
      expect((r['days'] as List)[2], {'come': '08:48', 'date': '20261008', 'dayType': '근로일', 'leave': '18:02', 'overtimeMin': 30, 'reason': '오후반차', 'result': '정상근무', 'workMin': 480});
      expect(r['summary'], {'absentCount': 1, 'lateCount': 1, 'overtimeMin': 30, 'totalWorkHours': '15h30m', 'totalWorkMin': 930, 'workDays': 2});
    });

    test('start/end 우선, 2월 말일, 형식 오류', () async {
      final gw = Gw(routes());
      await run(gw, 'attendance_month', {'start': '20260901', 'end': '20260930', 'month': '202610'});
      expect(gw.calls[path]!.last, containsPair('startDate', '20260901'));
      expect(gw.calls[path]!.last, containsPair('endDate', '20260930'));
      final feb = await run(gw, 'attendance_month', {'month': 202802});
      expect(feb['period'], '20280201~20280229');
      await expectLater(run(gw, 'attendance_month', {'month': '2026'}), throwsA(isA<McpToolError>()));
    });
  });
}
