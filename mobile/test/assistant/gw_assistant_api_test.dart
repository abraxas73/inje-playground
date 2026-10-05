// mobile/test/assistant/gw_assistant_api_test.dart
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/assistant/gw_assistant_api.dart';
import 'package:playground/gw/gw_api.dart';
import 'package:playground/gw/gw_client.dart';
import '../gw/fakes.dart';

http.Response ok(Object? data) => http.Response.bytes(utf8.encode(jsonEncode({'resultCode': 0, 'resultData': data})), 200, headers: {'content-type': 'application/json; charset=utf-8'});
const session = {'sessionInfo': {'ucUserInfo': {'compSeq': '10', 'deptSeq': '20', 'empName': '홍길동', 'emailAdd': 'hong', 'emailDomain': 'innogrid.com', 'erpEmpSeq': 'E', 'erpDeptSeq': 'D', 'erpCompSeq': 'C'}}};

/// 경로 → 응답(함수면 요청 본문을 받아 계산). 요청 본문 기록.
class Gw {
  Gw(this.routes);
  final Map<String, Object? Function(Map<String, dynamic> body)> routes;
  final calls = <String, List<Map<String, dynamic>>>{};
  final rawBodies = <String, String>{};
  MockClient get client => MockClient((r) async {
        final raw = r.body;
        Map<String, dynamic> b = {};
        try { final j = jsonDecode(raw); if (j is Map<String, dynamic>) b = j; } catch (_) {}
        (calls[r.url.path] ??= []).add(b);
        rawBodies[r.url.path] = raw;
        final f = routes[r.url.path];
        if (f == null) return http.Response('{"resultCode":999,"resultMsg":"unexpected ${r.url.path}"}', 200);
        final v = f(b);
        if (v is http.Response) return v;
        return ok(v);
      });
  GwApi api() => GwApi(GwClient(httpClient: client, creds: () => testCreds));
}

Map<String, Object? Function(Map<String, dynamic>)> base() => {
      '/gw/gw050A02': (_) => session,
      '/gw/APIHandler/gw102A01': (_) => {'treeList': [
            {'id': '1000', 'text': '이노그리드', 'path': '1000|', 'orgGubun': 'c', 'childUserCnt': 0},
            {'id': '20', 'text': '클라우드팀', 'path': '1000|20|', 'orgGubun': 'd', 'childUserCnt': 2},
            {'id': '30', 'text': '경영지원팀', 'path': '1000|30|', 'orgGubun': 'd', 'childUserCnt': 2},
          ]},
      '/gw/APIHandler/gw102A02': (b) => b['selectedId'] == '20'
          ? [{'empSeq': '31', 'empName': '강승억', 'deptSeq': '20', 'deptName': '클라우드팀', 'emailAddr': 'kang@innogrid.com', 'dutyName': '팀원', 'positionName': '책임'}, {'empSeq': '33', 'empName': '김민준', 'deptSeq': '20', 'deptName': '클라우드팀', 'emailAddr': 'kim1@innogrid.com', 'dutyName': '', 'positionName': ''}]
          : [{'empSeq': '32', 'empName': '정선미', 'deptSeq': '30', 'deptName': '경영지원팀', 'emailAddr': 'jung@innogrid.com', 'dutyName': '', 'positionName': ''}, {'empSeq': '34', 'empName': '김민준', 'deptSeq': '30', 'deptName': '경영지원팀', 'emailAddr': 'kim2@innogrid.com', 'dutyName': '', 'positionName': ''}],
      '/schres/rs121A01': (_) => {'resultList': [{'resSeq': 'R1', 'resName': '회의실A', 'attrSeq': '1', 'attrName': '회의실'}, {'resSeq': 'R2', 'resName': '회의실B', 'attrSeq': '1', 'attrName': '회의실'}]},
      '/schres/rs121A05': (_) => {'resultList': [
            {'resSeq': 'R1', 'resName': '회의실A', 'seqNum': 5, 'resIdx': 1, 'resStartDate': '202610051200', 'resEndDate': '202610051600', 'reqText': '워크숍', 'empSeq': '99'},
            {'resSeq': 'R2', 'resName': '회의실B', 'seqNum': 6, 'resIdx': '1', 'resStartDate': '202610051500', 'resEndDate': '202610051600', 'reqText': '내 회의', 'empSeq': '7'},
          ]},
      '/schres/sc111A02': (_) => {'resultList': [{'mcalSeq': '1', 'calType': 'E', 'empSeq': '7', 'calTitle': '내 캘린더'}, {'mcalSeq': '9', 'calType': 'M', 'empSeq': '0', 'calTitle': '부서'}]},
    };

void main() {
  test('freeSlots·minutesOn — 점유를 빼고 duration 이상 구간만, 다른 날 점유는 하루 전체', () {
    expect(freeSlots([(780, 840), (900, 960)], 720, 1080, 60), [(720, 780), (840, 900), (960, 1080)]);
    expect(freeSlots([(780, 840)], 720, 1080, 120), [(840, 1080)]);
    expect(freeSlots([(-1 << 40, 1 << 40)], 720, 1080, 30), isEmpty);
    expect(minutesOn('202610051030', '20261005'), 630);
    expect(minutesOn('202610041800', '20261005')! < 0, isTrue);
    expect(minutesOn('202610061000', '20261005')! > 1440, isTrue);
    expect(minutesOn('2026100510', '20261005'), isNull);
    expect(gwStamp(DateTime(2026, 10, 5, 9, 5)), '202610050905');
    expect(parseLocal('2026-10-05T14:00'), DateTime.utc(2026, 10, 5, 14));
    expect(parseLocal('14:00'), isNull);
  });

  test('roster·findPerson — 인원 있는 부서만 훑고(캐시), 정확 일치 우선·동명이인은 둘 다', () async {
    final gw = Gw(base());
    final api = gw.api();
    expect((await api.findPerson('강승억')).map((p) => p.empSeq), ['31']);
    final kims = await api.findPerson('김민준');
    expect(kims.map((p) => '${p.empSeq}/${p.deptName}'), ['33/클라우드팀', '34/경영지원팀']);
    expect((await api.findPerson('jung@')).single.name, '정선미');
    expect(await api.findPerson('없는사람'), isEmpty);
    expect(gw.calls['/gw/APIHandler/gw102A02']!.length, 2, reason: '회사 노드(c)는 안 부르고, 두 번째 검색부터는 캐시');
    expect(kims.first.toJson(), {'empSeq': '33', 'name': '김민준', 'deptSeq': '20', 'deptName': '클라우드팀', 'email': 'kim1@innogrid.com', 'duty': '', 'position': ''});
  });

  test('freeRooms — 예약·점심을 빼고 빈 구간, 이른 시작 순', () async {
    final api = Gw(base()).api();
    final rooms = await api.freeRooms(DateTime(2026, 10, 5), 720, 1080, 60);
    expect(rooms.map((r) => '${r['resName']}:${(r['freeSlots'] as List).map((s) => '${s['from']}-${s['to']}').join(',')}'), ['회의실B:12:00-13:00,14:00-15:00,16:00-18:00', '회의실A:16:00-18:00']);
  });

  test('myReservations — 내 것만, seqNum·resIdx 포함', () async {
    final mine = await Gw(base()).api().myReservations(DateTime(2026, 10, 5), DateTime(2026, 10, 5));
    expect(mine, [{'resSeq': 'R2', 'resName': '회의실B', 'seqNum': 6, 'resIdx': '1', 'start': '2026-10-05T15:00', 'end': '2026-10-05T16:00', 'title': '내 회의'}]);
  });

  test('reserveRoom — rs121A06(본인 참석자 첫 항목) → rs121A10 read-back', () async {
    final gw = Gw({...base(), '/schres/rs121A06': (_) => {'seqNum': 77, 'resIdx': 1}, '/schres/rs121A10': (_) => {'reqText': '주간회의', 'empSeq': '7', 'resName': '회의실A', 'startDate': '202610051400', 'endDate': '202610051500', 'createDate': '20261005130000'}});
    final r = await gw.api().reserveRoom(resSeq: 'R1', start: '202610051400', end: '202610051500', title: '주간회의');
    expect(r, {'ok': true, 'resSeq': 'R1', 'seqNum': 77, 'resIdx': '1', 'title': '주간회의', 'start': '202610051400', 'end': '202610051500'});
    final b = gw.calls['/schres/rs121A06']!.single;
    expect((b['resSeq'], b['reqText'], b['startDate'], b['endDate'], b['alldayYn']), ('R1', '주간회의', '202610051400', '202610051500', 'N'));
    expect(b['resSubscriberList'], [{'groupSeq': 'g', 'compSeq': '10', 'deptSeq': '20', 'empSeq': '7'}]);
    expect(gw.calls['/schres/rs121A10']!.single['seqNum'], 77);
  });

  test('cancelReservation — 소유권 가드, 스냅샷으로 rs121A11, 재조회 실패면 성공', () async {
    var gone = false;
    final gw = Gw({...base(), '/schres/rs121A10': (_) => gone ? http.Response.bytes(utf8.encode('{"resultCode":1,"resultMsg":"없음"}'), 200) : {'reqText': '내 회의', 'empSeq': '7', 'resName': '회의실B', 'startDate': '202610051500', 'endDate': '202610051600', 'createDate': 'C1'}, '/schres/rs121A11': (_) { gone = true; return {}; }});
    expect(await gw.api().cancelReservation('R2', 6, '1'), {'ok': true, 'canceled': true});
    final d = (gw.calls['/schres/rs121A11']!.single['resSeqList'] as List).single as Map;
    expect((d['resSeq'], d['seqNum'], d['reqText'], d['createDate']), ('R2', 6, '내 회의', 'C1'));
    final other = Gw({...base(), '/schres/rs121A10': (_) => {'reqText': '남의 것', 'empSeq': '99'}});
    await expectLater(other.api().cancelReservation('R1', 5, '1'), throwsA(isA<GwException>().having((e) => e.message, 'message', contains('본인 예약이 아니'))));
    expect(other.calls['/schres/rs121A11'], isNull);
  });

  test('createEvent — 개인 캘린더에 주최(M)+참석(W, 각자 부서), mailSend N, read-back 제목', () async {
    final gw = Gw({...base(), '/schres/sc111A05': (_) => {'schSeq': '900', 'schmSeq': '900'}, '/schres/sc111A03': (_) => {'resultList': [{'schSeq': '900', 'schTitle': '주간회의', 'startDate': '202610051400', 'endDate': '202610051500', 'mcalSeq': '1', 'delYn': 'Y', 'createSeq': '7'}]}});
    const kang = GwPerson(empSeq: '31', name: '강승억', deptSeq: '20', deptName: '클라우드팀', email: '', duty: '', position: '');
    const jung = GwPerson(empSeq: '32', name: '정선미', deptSeq: '30', deptName: '경영지원팀', email: '', duty: '', position: '');
    final r = await gw.api().createEvent(title: '주간회의', start: '202610051400', end: '202610051500', attendees: [kang, jung, kang], place: '회의실A');
    expect(r, {'ok': true, 'schSeq': '900', 'title': '주간회의', 'start': '202610051400', 'end': '202610051500', 'attendees': ['강승억', '정선미']});
    final b = gw.calls['/schres/sc111A05']!.single;
    expect((b['schSeq'], b['mcalSeq'], b['calType'], b['mailSend'], b['inviterPartType']), ('', '1', 'E', 'N', 'M'));
    expect(b['contents'], '장소: 회의실A');
    expect([for (final p in b['schPartEmpList'] as List) '${p['empSeq']}/${p['partType']}/${p['deptSeq']}'], ['7/M/20', '31/W/20', '32/W/30']);
  });

  test('deleteEvent — 내가 만든 일정만, sc111A06 후 사라졌는지 재조회', () async {
    var deleted = false;
    final gw = Gw({...base(), '/schres/sc111A03': (_) => {'resultList': deleted ? [] : [{'schSeq': '900', 'schTitle': '주간회의', 'mcalSeq': '1', 'createSeq': '7', 'startDate': '202610051400', 'endDate': '202610051500'}, {'schSeq': '901', 'schTitle': '남의 일정', 'mcalSeq': '9', 'createSeq': '99', 'startDate': '202610051400', 'endDate': '202610051500'}]}, '/schres/sc111A06': (_) { deleted = true; return {}; }});
    expect(await gw.api().deleteEvent('900', '20261005'), {'ok': true, 'deleted': true});
    expect(gw.calls['/schres/sc111A06']!.single, {'mcalSeq': '1', 'schmSeq': '900', 'schSeq': '900', 'rangeCode': '', 'langCode': 'kr'});
    final g2 = Gw({...base(), '/schres/sc111A03': (_) => {'resultList': [{'schSeq': '901', 'schTitle': '남의 일정', 'mcalSeq': '9', 'createSeq': '99'}]}});
    await expectLater(g2.api().deleteEvent('901', '20261005'), throwsA(isA<GwException>()));
    expect(g2.calls['/schres/sc111A06'], isNull);
  });

  test('callMultipart — 서명 헤더 + multipart 본문, resultData 반환', () async {
    String? ct, sign;
    String body = '';
    final c = GwClient(httpClient: MockClient((r) async { ct = r.headers['content-type']; sign = r.headers['wehago-sign']; body = r.body; return ok({'result': true}); }), creds: () => testCreds);
    expect(await c.callMultipart('/mail/mail014A04', {'subject': '안녕', 'to': 'a@x'}), {'result': true});
    expect(ct, startsWith('multipart/form-data; boundary='));
    expect(sign, isNotEmpty);
    expect(body, contains('name="subject"'));
    expect(body, contains('안녕'));
  });

  test('cancelReservation — 취소 뒤에도 재조회에 그대로 있으면 canceled:false', () async {
    final gw = Gw({...base(), '/schres/rs121A10': (_) => {'reqText': '내 회의', 'empSeq': '7'}, '/schres/rs121A11': (_) => {}});
    expect(await gw.api().cancelReservation('R2', 6, '1'), {'ok': false, 'canceled': false});
  });

  test('cancelReservation — 재조회 네트워크 오류는 ok:false, 인증 만료는 다시 던진다', () async {
    var called = 0;
    final r = await Gw({...base(), '/schres/rs121A10': (_) => called++ == 0 ? {'reqText': 't', 'empSeq': '7'} : http.Response('boom', 500), '/schres/rs121A11': (_) => {}}).api().cancelReservation('R2', 6, '1');
    expect(r['ok'], false);
    expect(r['message'], contains('확인하지 못'));
    called = 0;
    await expectLater(
        Gw({...base(), '/schres/rs121A10': (_) => called++ == 0 ? {'reqText': 't', 'empSeq': '7'} : http.Response('{"resultCode":140}', 401), '/schres/rs121A11': (_) => {}}).api().cancelReservation('R2', 6, '1'),
        throwsA(isA<GwUnauthorized>()));
  });

  test('roster — 부서 실패는 캐시 안 함(재시도), 전부 실패면 예외, 인증 만료는 다시 던진다', () async {
    var fail = true;
    final gw = Gw({...base(), '/gw/APIHandler/gw102A02': (b) => b['selectedId'] == '30' && fail ? http.Response('x', 500) : base()['/gw/APIHandler/gw102A02']!(b)});
    final api = gw.api();
    expect((await api.roster()).length, 2);
    fail = false;
    expect((await api.roster()).length, 4, reason: '부분 결과는 캐시되지 않는다');
    final all = Gw({...base(), '/gw/APIHandler/gw102A02': (_) => http.Response('x', 500)}).api();
    await expectLater(all.roster(), throwsA(isA<GwException>()));
    final un = Gw({...base(), '/gw/APIHandler/gw102A02': (_) => http.Response('{"resultCode":140}', 401)}).api();
    await expectLater(un.roster(), throwsA(isA<GwUnauthorized>()));
  });

  test('freeRooms — 시각이 깨진 예약이 있는 방은 빈 방으로 보이지 않는다', () async {
    final r = base();
    r['/schres/rs121A05'] = (_) => {'resultList': [{'resSeq': 'R1', 'resStartDate': 'bad', 'resEndDate': '202610051600', 'empSeq': '1'}]};
    final rooms = await Gw(r).api().freeRooms(DateTime(2026, 10, 5), 720, 1080, 60);
    expect(rooms.map((x) => x['resSeq']), ['R2']);
    expect(minutesOn('2026100510ab', '20261005'), isNull);
  });
}
