// mobile/test/mcp/mcp_tools_test.dart — McpTools 디스패치: inno-creed 응답 키(fixtures/expected) 일치 + 인자 정규화 + 사람 그룹·결재선 제안.
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/gw_api.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/mcp/approval_schemas.dart';
import 'package:playground/mcp/mcp_args.dart' as a;
import 'package:playground/mcp/mcp_tools.dart';
import 'package:playground/mcp/mcp_worker.dart';
import '../gw/fakes.dart';

const _fx = 'test/mcp/fixtures';
dynamic expected(String name) => jsonDecode(File('$_fx/expected/$name.json').readAsStringSync());

/// 캡처(inno-creed 실측)에서 그 경로 호출의 resultData.
dynamic cap(String label, String path, [int nth = 0]) {
  final calls = (jsonDecode(File('$_fx/captured/$label.json').readAsStringSync())['calls'] as List).where((c) => c['path'] == path).toList();
  return calls[nth]['response']['resultData'];
}

void hasKeys(Object? got, Object? want, [String why = '']) {
  expect(got, isA<Map>(), reason: why);
  expect((got as Map).keys, containsAll((want as Map).keys), reason: why);
}

http.Response okRes(Object? data) => http.Response.bytes(utf8.encode(jsonEncode({'resultCode': 0, 'resultData': data})), 200, headers: {'content-type': 'application/json; charset=utf-8'});

class Gw {
  Gw(this.routes);
  final Map<String, Object? Function(Map<String, dynamic> body)> routes;
  final calls = <String, List<Map<String, dynamic>>>{};
  final raw = <String, String>{};
  final order = <String>[];
  /// 'METHOD 경로?쿼리' 순서(GET 쿼리 단정용).
  final urls = <String>[];
  MockClient get client => MockClient((r) async {
        order.add(r.url.path);
        urls.add('${r.method} ${r.url.path}${r.url.hasQuery ? '?${r.url.query}' : ''}');
        Map<String, dynamic> b = {};
        try {
          final j = jsonDecode(r.body);
          if (j is Map<String, dynamic>) b = j;
        } catch (_) {}
        (calls[r.url.path] ??= []).add(b);
        raw[r.url.path] = r.body;
        final f = routes[r.url.path];
        if (f == null) return http.Response('{"resultCode":999,"resultMsg":"unexpected ${r.url.path}"}', 200);
        final v = f(b);
        return v is http.Response ? v : okRes(v);
      });
  GwApi api() => GwApi(GwClient(httpClient: client, creds: () => testCreds));
}

/// 조직: 회사(c) > 법인(b) > 기술운영부문(100) > R&D본부(110) > 클라우드 네이티브 센터(120) > 플랫폼팀(130); 경영지원부문(200) > 인사지원실(210) > 인사총무팀(211); 대표이사(300).
Map<String, Object? Function(Map<String, dynamic>)> org({String myDept = '130', String myDuty = '팀원'}) {
  Map<String, dynamic> p(String emp, String name, String dept, String duty, {String pos = '책임'}) => {
        'empSeq': emp, 'empName': name, 'deptSeq': dept, 'deptName': _names[dept], 'emailAddr': 'u$emp@innogrid.com', 'dutyName': duty, 'positionName': pos, 'dutyCode': '1',
        'loginId': 'id$emp', 'mobileTelNum': '010-0000-$emp', 'path': '1000|1000|$dept', 'pathName': '이노그리드>이노그리드>${_names[dept]}', 'workStatus': '999', 'atNm': '',
      };
  final members = <String, List<Map<String, dynamic>>>{
    '130': [p('31', '강팀장', '130', myDuty == '팀장' ? '팀원' : '팀장'), p('33', '김민준', '130', '팀원')],
    '120': [if (myDept != '120') p('41', '최센터', '120', '센터장')],
    '110': [p('51', '박본부', '110', '본부장')],
    '100': [p('61', '이부문', '100', '부문장')],
    '200': [p('71', '정CFO', '200', '부문장')],
    '210': [p('81', '한실장', '210', '실장')],
    '211': [p('91', '윤팀장', '211', '팀장'), p('34', '김민준', '211', '팀원')],
    '300': [p('1', '대표', '300', '대표이사')],
  };
  members[myDept]!.insert(0, p('7', '홍길동', myDept, myDuty, pos: '상무'));
  Map<String, dynamic> d(String id, String parentKey, String parent, int level) => {'id': id, 'text': _names[id], 'orgGubun': 'd', 'keySeq': 'd$id', 'parentKeySeq': parentKey, 'parentSeq': parent, 'path': '1000|1000|$id|', 'orgLevel': level, 'childUserCnt': members[id]!.length};
  return {
    '/gw/gw050A02': (_) => {'sessionInfo': {'ucUserInfo': {'compSeq': '1000', 'deptSeq': myDept, 'empName': '홍길동', 'emailAdd': 'hong', 'emailDomain': 'innogrid.com', 'erpEmpSeq': 'E7', 'erpDeptSeq': 'D7', 'erpCompSeq': 'C7'}}},
    '/gw/APIHandler/gw102A01': (_) => {'treeList': [
          {'id': '1000', 'text': '이노그리드', 'orgGubun': 'c', 'keySeq': 'c1000', 'parentKeySeq': null, 'parentSeq': '0', 'path': '1000|', 'orgLevel': 0, 'childUserCnt': 13},
          {'id': '1000', 'text': '이노그리드', 'orgGubun': 'b', 'keySeq': 'b1000', 'parentKeySeq': 'c1000', 'parentSeq': '1000', 'path': '1000|1000|', 'orgLevel': 1, 'childUserCnt': 13},
          d('100', 'b1000', '1000', 2), d('110', 'd100', '100', 3), d('120', 'd110', '110', 4), d('130', 'd120', '120', 5),
          d('200', 'b1000', '1000', 2), d('210', 'd200', '200', 3), d('211', 'd210', '210', 4), d('300', 'b1000', '1000', 2),
        ]},
    '/gw/APIHandler/gw102A02': (b) => members[b['selectedId']] ?? [],
  };
}

const _names = {'100': '기술운영부문', '110': 'R&D본부', '120': '클라우드 네이티브 센터', '130': '플랫폼팀', '200': '경영지원부문', '210': '인사지원실', '211': '인사총무팀', '300': '대표이사'};

void main() {
  late Directory dir;
  setUp(() => dir = Directory.systemTemp.createTempSync('mcp_tools_test'));
  tearDown(() => dir.deleteSync(recursive: true));
  final schemas = ApprovalSchemas(loader: (p) => File(p).readAsString());
  McpTools tools(Gw? gw) => McpTools(gw: gw?.api(), appSupportDir: () => dir.path, schemas: schemas);
  Future<dynamic> run(Gw? gw, String tool, [Map<String, dynamic> args = const {}]) async => jsonDecode(await tools(gw).execute(tool, args));
  Future<dynamic> runOn(McpTools t, String tool, [Map<String, dynamic> args = const {}]) async => jsonDecode(await t.execute(tool, args));

  group('인자 정규화', () {
    test('str·intOf·boolOf·strList·ymd·hm', () {
      expect(a.str({'k': 3060}, 'k'), '3060');
      expect(a.str({}, 'k', 'd'), 'd');
      expect(a.intOf({'k': '76198'}, 'k'), 76198);
      expect(a.intOf({'k': 76198}, 'k'), 76198);
      expect(a.intOf({'k': 'x'}, 'k'), isNull);
      expect(a.boolOf({'k': 'true'}, 'k'), isTrue);
      expect(a.boolOf({}, 'k', true), isTrue);
      expect(a.strList({'k': ['김철수', 3166]}, 'k'), ['김철수', '3166']);
      expect(a.strList({'k': 'a@x.com, b@x.com'}, 'k'), ['a@x.com', 'b@x.com']);
      expect(a.ymd('2026-10-12'), '20261012');
      expect(a.ymd('202610120830'), '20261012');
      expect(a.hm('202610121330'), DateTime.utc(2026, 10, 12, 13, 30));
    });

    test('모르는 도구·아마란스 미연결·서버 오류 → McpToolError 문장', () async {
      await expectLater(run(Gw(org()), 'nope'), throwsA(isA<McpToolError>().having((e) => e.message, 'm', contains('모르는 도구'))));
      await expectLater(run(null, 'whoami'), throwsA(isA<McpToolError>().having((e) => e.message, 'm', contains('아마란스가 연결되어 있지 않습니다'))));
      final bad = Gw({'/gw/gw050A02': (_) => http.Response.bytes(utf8.encode('{"resultCode":5,"resultMsg":"서버가 거절함"}'), 200)});
      await expectLater(run(bad, 'whoami'), throwsA(isA<McpToolError>().having((e) => e.message, 'm', '서버가 거절함')));
      await expectLater(run(Gw(org()), 'read_mail'), throwsA(isA<McpToolError>().having((e) => e.message, 'm', contains('muid'))));
    });
  });

  group('세션·사람·조직', () {
    test('whoami — 세션 + 부서원 행의 직책·직급', () async {
      final r = await run(Gw(org(myDuty: '팀장')), 'whoami');
      hasKeys(r, expected('whoami'));
      expect((r['empSeq'], r['groupSeq'], r['deptSeq'], r['duty'], r['position'], r['email'], r['empCd'], r['profileResolved']), ('7', 'g', '130', '팀장', '상무', 'hong@innogrid.com', 'E7', true));
    });

    test('find_person — 이름·부서명·직책 부분일치, 숫자는 empSeq 완전일치, limit·truncated', () async {
      final gw = Gw(org());
      final t = tools(gw);
      final kim = await runOn(t, 'find_person', {'query': '김민준'});
      expect((kim['people'] as List).map((p) => '${p['empSeq']}/${p['deptName']}'), ['33/플랫폼팀', '34/인사총무팀']);
      final one = (kim['people'] as List).first;
      expect((one['loginId'], one['mobile'], one['deptPath'], one['duty']), ('id33', '010-0000-33', '이노그리드>이노그리드>플랫폼팀', '팀원'));
      expect(one['deptChain'], [{'deptId': '1000', 'name': '이노그리드'}, {'deptId': '1000', 'name': '이노그리드'}, {'deptId': '130', 'name': '플랫폼팀'}]);
      expect((await runOn(t, 'find_person', {'query': 31}))['people'].single['name'], '강팀장');
      expect((await runOn(t, 'find_person', {'query': '인사총무'}))['people'].length, 2);
      final lim = await runOn(t, 'find_person', {'query': '팀', 'limit': 2});
      expect((lim['people'].length, lim['truncated'], lim['matched'] > 2, lim['rosterSize']), (2, true, true, 11));
      expect((await runOn(t, 'find_person', {'query': '팀', 'no_limit': true}))['truncated'], false);
      expect(gw.calls['/gw/APIHandler/gw102A01']!.length, 1, reason: '명부 캐시');
    });

    test('org_chart — 중첩 트리·평면·parent_seq·dept_id', () async {
      final t = tools(Gw(org()));
      final tree = await runOn(t, 'org_chart');
      hasKeys(tree, expected('org_chart'));
      hasKeys((tree['tree'] as List).first, (expected('org_chart')['tree'] as List).first);
      expect((tree['kind'], tree['count'], tree['scope']), ('deptTree', 10, '0'));
      final flat = await runOn(t, 'org_chart', {'flat': true});
      hasKeys(flat, expected('org_chart-True'));
      hasKeys((flat['depts'] as List).first, (expected('org_chart-True')['depts'] as List).first);
      final sub = await runOn(t, 'org_chart', {'parent_seq': 110});
      expect((sub['scope'], sub['count'], sub['tree'].single['deptId'], sub['tree'].single['children'].single['children'].single['name']), ('110', 3, '110', '플랫폼팀'));
      final mem = await runOn(t, 'org_chart', {'dept_id': '130'});
      expect((mem['kind'], mem['deptId'], mem['count']), ('deptMembers', '130', 3));
      expect((mem['members'] as List).first.keys, containsAll(['deptId', 'deptName', 'deptPath', 'duty', 'dutyCode', 'email', 'empSeq', 'loginId', 'mobile', 'name', 'note', 'position']));
    });
  });

  group('사람 그룹', () {
    test('목록(빈 파일) 키 · 저장 검증(동명이인·없는 사람은 저장 안 함) · 조회 · add/remove · 삭제', () async {
      final gw = Gw(org());
      final t = tools(gw);
      final empty = await runOn(t, 'person_group');
      hasKeys(empty, expected('person_group'));
      expect((empty['count'], empty['path']), (0, '${dir.path}/person_groups.json'));

      final amb = await runOn(t, 'save_person_group', {'name': '주간보고', 'members': ['김민준', '강팀장']});
      expect(amb['ok'], false);
      expect((amb['candidates'] as List).single['input'], '김민준');
      expect(((amb['candidates'] as List).single['people'] as List).map((p) => p['empSeq']), ['33', '34']);
      final none = await runOn(t, 'save_person_group', {'name': '주간보고', 'members': ['없는사람']});
      expect((none['ok'], none['candidates'].single['reason']), (false, 'not_found'));
      expect(File('${dir.path}/person_groups.json').existsSync(), isFalse);

      final saved = await runOn(t, 'save_person_group', {'name': '주간보고', 'members': ['강팀장', 33], 'note': '매주'});
      expect((saved['ok'], saved['count']), (true, 2));
      final file = jsonDecode(File('${dir.path}/person_groups.json').readAsStringSync());
      expect(file['groups']['주간보고'], {'note': '매주', 'members': [{'empSeq': '31', 'label': '강팀장'}, {'empSeq': '33', 'label': '김민준'}]});

      await expectLater(runOn(t, 'save_person_group', {'name': '없는그룹', 'members': ['강팀장'], 'mode': 'add'}), throwsA(isA<McpToolError>()));
      await runOn(t, 'save_person_group', {'name': '주간보고', 'members': ['정CFO'], 'mode': 'add'});
      await runOn(t, 'save_person_group', {'name': '주간보고', 'members': ['33'], 'mode': 'remove'});
      // 사람이 손으로 넣은 명부 밖 empSeq
      final f = jsonDecode(File('${dir.path}/person_groups.json').readAsStringSync());
      (f['groups']['주간보고']['members'] as List).add({'empSeq': '999', 'label': '퇴사자'});
      File('${dir.path}/person_groups.json').writeAsStringSync(jsonEncode(f));

      final g = await runOn(t, 'person_group', {'name': '주간보고'});
      expect([g['note'], g['empSeqs'], g['emails']], ['매주', ['31', '71', '999'], ['u31@innogrid.com', 'u71@innogrid.com']]);
      expect((g['members'] as List).last, {'empSeq': '999', 'name': '퇴사자', 'email': '', 'dept': '', 'duty': '', 'status': 'not_found'});
      expect(g['missing'], [{'empSeq': '999', 'label': '퇴사자'}]);
      expect((await runOn(t, 'person_group'))['groups'], [{'name': '주간보고', 'count': 3, 'note': '매주'}]);

      expect((await runOn(t, 'delete_person_group', {'name': '주간보고'}))['ok'], true);
      await expectLater(runOn(t, 'delete_person_group', {'name': '주간보고'}), throwsA(isA<McpToolError>()));
    });
  });

  group('회의실', () {
    Map<String, Object? Function(Map<String, dynamic>)> rooms() => {
          ...org(),
          '/schres/rs121A01': (_) => cap('find_free_rooms-window', '/schres/rs121A01'),
          '/schres/rs121A05': (_) => {'resultList': [
                {'resSeq': '45', 'resName': '회의실A', 'seqNum': 5, 'resIdx': '1', 'resStartDate': '202610120900', 'resEndDate': '202610121000', 'reqText': '남의 회의', 'empSeq': '99', 'empName': '남', 'resUserName': '남', 'alldayYn': 'N', 'resTitleDisplay': '[남] 회의실A', 'descText': '안건 전문'},
                {'resSeq': '46', 'resName': '회의실B', 'seqNum': 6, 'resIdx': 2, 'resStartDate': '202610121500', 'resEndDate': '202610121600', 'reqText': '내 회의', 'empSeq': '7', 'empName': '홍길동', 'resUserName': '홍길동', 'alldayYn': 'N', 'resTitleDisplay': ''},
              ]},
        };

    test('list_resources — 원본 resultList', () async {
      final r = await run(Gw(rooms()), 'list_resources');
      hasKeys(r, expected('list_resources'));
      hasKeys((r['resultList'] as List).first, (expected('list_resources')['resultList'] as List).first);
    });

    test('list_reservations — 슬림/verbose, res_seqs 필터', () async {
      final gw = Gw(rooms());
      final slim = await run(gw, 'list_reservations', {'start': '2026-10-12', 'end': 20261012, 'res_seqs': ['46']});
      expect((slim['count'], slim['reservations'].single['title'], slim['reservations'].single['displayTitle']), (1, '내 회의', '[홍길동] 회의실B'));
      expect(gw.calls['/schres/rs121A05']!.last['resList'], [{'resSeq': '46'}]);
      expect(gw.calls['/schres/rs121A05']!.last['startDate'], '20261012');
      final v = await run(gw, 'list_reservations', {'start': '20261012', 'end': '20261012', 'verbose': true});
      expect(v['reservations'].first['descText'], '안건 전문');
    });

    test('my_reservations — 내 것만, displayTitle·seqNum·resIdx', () async {
      final r = await run(Gw(rooms()), 'my_reservations', {'start': '20261012', 'end': '20261012'});
      expect((r['kind'], r['empSeq'], r['count'], r['period']), ('myReservations', '7', 1, '20261012~20261012'));
      expect(r['reservations'].single, {'allDay': false, 'attendees': '홍길동', 'displayTitle': '[홍길동] 회의실B', 'end': '2026-10-12T16:00', 'owner': '홍길동', 'ownerEmpSeq': '7', 'resIdx': '2', 'resName': '회의실B', 'resSeq': '46', 'seqNum': 6, 'start': '2026-10-12T15:00', 'title': '내 회의'});
    });

    test('find_free_rooms — window·점심 제외/포함·group', () async {
      final gw = Gw(rooms());
      final r = await run(gw, 'find_free_rooms', {'date': '20261012', 'duration_min': '30', 'window': '08:00-10:00'});
      expect((r['kind'], r['window'], r['durationMin'], r['lunchExcluded'], r['group']), ('freeSlots', '08:00-10:00', 30, true, '전체'));
      final a45 = (r['rooms'] as List).firstWhere((x) => x['resSeq'] == '45');
      expect(a45['freeSlots'], [{'from': '08:00', 'to': '09:00', 'minutes': 60}]);
      expect(r['roomsChecked'], (cap('find_free_rooms-window', '/schres/rs121A01')['resultList'] as List).length);
      final lunch = await run(gw, 'find_free_rooms', {'date': '20261012', 'duration_min': 60, 'window': '1200-1500', 'include_lunch': true});
      expect(((lunch['rooms'] as List).firstWhere((x) => x['resSeq'] == '46'))['freeSlots'], [{'from': '12:00', 'to': '15:00', 'minutes': 180}]);
      final noLunch = await run(gw, 'find_free_rooms', {'date': '20261012', 'duration_min': 60, 'window': '1200-1500'});
      expect(((noLunch['rooms'] as List).firstWhere((x) => x['resSeq'] == '46'))['freeSlots'], [{'from': '12:00', 'to': '13:00', 'minutes': 60}, {'from': '14:00', 'to': '15:00', 'minutes': 60}]);
    });

    test('reserve_resource — 참석자(이름·empSeq) 등록, read-back, 점심 경고', () async {
      final gw = Gw({
        ...rooms(),
        '/schres/rs121A06': (_) => cap('reserve_resource', '/schres/rs121A06'),
        '/schres/rs121A10': (_) => {...cap('reserve_resource', '/schres/rs121A10'), 'reqText': '주간회의', 'subscriberList': [{'empSeq': '7', 'empName': '홍길동'}, {'empSeq': '31', 'empName': '강팀장'}]},
      });
      final r = await run(gw, 'reserve_resource', {'res_seq': 45, 'req_text': '주간회의', 'start': '202610121230', 'end': '202610121330', 'desc': '안건', 'attendees': ['강팀장']});
      hasKeys(r, (jsonDecode(File('$_fx/captured/reserve_resource.json').readAsStringSync())['toolResult']));
      expect([r['ok'], r['seqNum'], r['attendeesVerified'], r['attendees'], r['lunchWarning'] != null], [true, 76195, true, ['홍길동', '강팀장'], true]);
      final b = gw.calls['/schres/rs121A06']!.single;
      expect([b['resSeq'], b['descText'], [for (final s in b['resSubscriberList'] as List) s['empSeq']]], ['45', '안건', ['7', '31']]);
      await expectLater(run(gw, 'reserve_resource', {'res_seq': 45, 'req_text': 'x', 'start': '202610121000', 'end': '202610121100', 'attendees': ['김민준']}), throwsA(isA<McpToolError>().having((e) => e.message, 'm', contains('동명이인'))));
    });

    test('cancel_reservation — seq_num 숫자·문자열 모두, res_idx 기본 1', () async {
      for (final seq in [76198, '76198']) {
        var gone = false;
        final gw = Gw({
          ...rooms(),
          '/schres/rs121A10': (_) => gone ? http.Response.bytes(utf8.encode('{"resultCode":1,"resultMsg":"없음"}'), 200) : {...cap('cancel_reservation-2c', '/schres/rs121A10'), 'empSeq': '7'},
          '/schres/rs121A11': (_) {
            gone = true;
            return {'successTf': true};
          },
        });
        final r = await run(gw, 'cancel_reservation', {'res_seq': 45, 'seq_num': seq});
        expect(r, {'canceled': true, 'ok': true, 'seqNum': 76198, 'verified_by_readback': true});
        expect((gw.calls['/schres/rs121A10']!.first['seqNum'], gw.calls['/schres/rs121A10']!.first['resIdx']), (76198, '1'));
      }
    });
  });

  group('쓰기 후 재조회 실패 — 성공으로 돌려주고 verified_by_readback:false(재시도로 중복 생성 방지)', () {
    http.Response fail(_) => http.Response.bytes(utf8.encode('{"resultCode":9,"resultMsg":"조회 실패"}'), 200);

    test('reserve_resource — rs121A10 실패', () async {
      final gw = Gw({
        ...org(),
        '/schres/rs121A01': (_) => cap('find_free_rooms-window', '/schres/rs121A01'),
        '/schres/rs121A06': (_) => cap('reserve_resource', '/schres/rs121A06'),
        '/schres/rs121A10': fail,
      });
      final r = await run(gw, 'reserve_resource', {'res_seq': 45, 'req_text': '주간회의', 'start': '202610120800', 'end': '202610120830'});
      expect([r['ok'], r['verified_by_readback'], r['seqNum'], r['note'] != null], [true, false, 76195, true]);
    });

    test('create_calendar_event — sc111A03 실패', () async {
      final gw = Gw({
        ...org(),
        '/schres/sc111A02': (_) => {'resultList': [{'mcalSeq': '993', 'calType': 'E', 'empSeq': '7', 'calTitle': '개인캘린더.홍길동'}]},
        '/schres/sc111A05': (_) => {'schSeq': '97461', 'schmSeq': '97461'},
        '/schres/sc111A03': fail,
      });
      final r = await run(gw, 'create_calendar_event', {'title': '주간회의', 'start': '202610122300', 'end': '202610122330'});
      expect([r['ok'], r['verified_by_readback'], r['schSeq'], r['note'] != null], [true, false, '97461', true]);
    });
  });

  group('일정', () {
    Map<String, Object? Function(Map<String, dynamic>)> cal() => {
          ...org(),
          '/schres/sc111A02': (_) => {'resultList': [
                {...(cap('create_calendar_event', '/schres/sc111A02')['resultList'] as List).first, 'mcalSeq': '993', 'calType': 'E', 'empSeq': '7', 'calTitle': '개인캘린더.홍길동'},
                {'mcalSeq': '230', 'calType': 'M', 'empSeq': '0', 'calTitle': '이노그리드', 'calColor': '#fff'},
              ]},
          '/schres/sc111A03': (_) => cap('list_events-after-update', '/schres/sc111A03'),
        };

    test('list_calendars — 원본 resultList', () async {
      final r = await run(Gw(cal()), 'list_calendars');
      hasKeys(r, expected('list_calendars'));
      hasKeys((r['resultList'] as List).first, (expected('list_calendars')['resultList'] as List).first);
    });

    test('list_events — 기간, mine·calendar(이름(mcalSeq))', () async {
      final gw = Gw(cal());
      final r = await run(gw, 'list_events', {'start': 20261012, 'end': '2026-10-12'});
      final want = jsonDecode(File('$_fx/captured/list_events-after-update.json').readAsStringSync())['toolResult'];
      hasKeys(r, want);
      hasKeys((r['events'] as List).first, (want['events'] as List).first);
      expect(((r['events'] as List).first['start'], (r['events'] as List).first['mine'], (r['events'] as List)[2]['mine']), ('2026-10-12T23:00', true, false));
      expect((gw.calls['/schres/sc111A03']!.single['startDate'], gw.calls['/schres/sc111A03']!.single['endDate']), ('20261012', '20261012'));
    });

    test('create_calendar_event — contents 그대로, 참여자 이름 해석, 캘린더 이름 지정, read-back', () async {
      final gw = Gw({...cal(), '/schres/sc111A05': (_) => {'schSeq': '97461', 'schmSeq': '97461'}, '/schres/sc111A03': (_) => {'resultList': [{'schSeq': '97461', 'schTitle': '주간회의', 'mcalSeq': '230'}]}});
      final r = await run(gw, 'create_calendar_event', {'title': '주간회의', 'start': '202610122300', 'end': 202610122330, 'contents': '안건', 'participants': ['강팀장', '91'], 'calendar': '이노그리드'});
      hasKeys(r, jsonDecode(File('$_fx/captured/create_calendar_event.json').readAsStringSync())['toolResult']);
      expect((r['ok'], r['calendar'], r['schSeq'], r['warning'] != null), (true, '이노그리드(230)', '97461', true));
      final b = gw.calls['/schres/sc111A05']!.single;
      expect((b['contents'], b['mcalSeq'], b['calType'], b['mailSend'], b['endDate']), ('안건', '230', 'M', 'N', '202610122330'));
      expect((b['schPartEmpList'] as List).map((p) => '${p['empSeq']}/${p['deptSeq']}/${p['partType']}'), ['7/130/M', '31/130/W', '91/211/W']);
      await expectLater(run(gw, 'create_calendar_event', {'title': 't', 'start': '202610122300', 'end': '202610122330', 'participants': ['김민준']}), throwsA(isA<McpToolError>()));
    });

    test('delete_calendar_event — 본인 작성만, 재조회', () async {
      var gone = false;
      final gw = Gw({
        ...cal(),
        '/schres/sc111A03': (_) => gone ? {'resultList': []} : {'resultList': [{'schSeq': '97461', 'mcalSeq': '993', 'createSeq': '7'}]},
        '/schres/sc111A06': (_) {
          gone = true;
          return true;
        },
      });
      final r = await run(gw, 'delete_calendar_event', {'sch_seq': 97461, 'date': '2026-10-12'});
      expect(r, {'deleted': true, 'ok': true, 'schSeq': '97461', 'verified_by_readback': true});
    });
  });

  group('근태', () {
    test('get_attendance_today — work_dt 지정, null은 빈값', () async {
      final gw = Gw({...org(), '/human/common/judgeTimeManagement/getTodayComeLeaveInfo': (_) => {'comeTm': '202610090858', 'leaveTm': null, 'holidayYn': 'N'}});
      final r = await run(gw, 'get_attendance_today', {'work_dt': 20261009});
      hasKeys(r, expected('get_attendance_today'));
      expect(r, {'comeTm': '202610090858', 'holidayYn': 'N', 'leaveTm': '', 'workDt': '20261009'});
      expect(gw.calls['/human/common/judgeTimeManagement/getTodayComeLeaveInfo']!.single, {'empCd': 'E7', 'coCd': 'C7', 'workDt': '20261009'});
    });

    test('attendance_clock_in — 이미 있으면 재기록 안 함', () async {
      final gw = Gw({...org(), '/human/common/judgeTimeManagement/getTodayComeLeaveInfo': (_) => {'comeTm': '202610100858', 'leaveTm': ''}});
      final r = await run(gw, 'attendance_clock_in');
      expect((r['ok'], r['already'], r['comeTm']), (true, true, '202610100858'));
      expect(gw.calls['/human/common/judgeTimeManagement/getJudgeTimeManagement'], isNull);
    });
  });

  group('메일', () {
    Map<String, Object? Function(Map<String, dynamic>)> mail() {
      final boxes = cap('list_mailboxes', '/mail/mail000A01') as Map;
      final list = (boxes['mailboxList'] as List).cast<Map>();
      list[0] = {...list[0], 'name': 'INBOX', 'fullname': 'INBOX'};
      list[2] = {...list[2], 'name': 'DRAFTS', 'fullname': 'DRAFTS'};
      return {
        ...org(),
        '/mail/mail000A01': (_) => boxes,
        '/mail/mail000A03': (_) => cap('mailbox_counts', '/mail/mail000A03'),
        '/mail/mail003A01': (b) => b['mboxSeq'] == 25498 ? cap('list_mail_drafts', '/mail/mail003A01') : cap('list_mail_inbox', '/mail/mail003A01'),
        // 캡처는 서명·본문 HTML이 가려져 있어 여기서 넣는다: 외부 호스트 <img> 1개, 서명은 웹 작성기 형상(<div dze_signature><html>…</html></div>)
        '/mail/mail002A01': (_) {
          final d = cap('read_mail-attach', '/mail/mail002A01') as Map;
          final mime = d['mime'] as Map;
          return {...d, 'mime': {...mime, 'body': {...mime['body'] as Map, 'html': '<html><body><p>안내</p><img src="https://www.example.com/banner.png"></body></html>'}}};
        },
        '/mail/mail014A01': (_) => {
              ...cap('save_mail_draft-plain', '/mail/mail014A01') as Map,
              'signature': '<div class="dze_signature" dze_signature_index="1"><html><head></head><body><table><tr><td>홍길동</td></tr></table></body></html><br /></div>',
            },
        '/mail/mail014A14': (_) => {'code': '0', 'autoMUID': 14580025, 'mailKey': 'K1.eml'},
        '/mail/mail014A04': (_) => {'result': true},
      };
    }

    test('list_mailboxes·mailbox_counts — 원본 봉투/배열', () async {
      final gw = Gw(mail());
      final boxes = await run(gw, 'list_mailboxes');
      hasKeys(boxes, expected('list_mailboxes'));
      hasKeys((boxes['mailboxList'] as List).first, (expected('list_mailboxes')['mailboxList'] as List).first);
      final counts = await run(gw, 'mailbox_counts');
      expect(counts, isA<List>());
      hasKeys((counts as List).first, (expected('mailbox_counts') as List).first);
    });

    test('list_mail_inbox·list_mail_drafts — Records 봉투, 메일함은 이름으로', () async {
      final gw = Gw(mail());
      final inbox = await run(gw, 'list_mail_inbox');
      hasKeys(inbox, expected('list_mail_inbox'));
      hasKeys((inbox['Records'] as List).first, (expected('list_mail_inbox')['Records'] as List).first);
      expect((gw.calls['/mail/mail003A01']!.last['mboxSeq'], gw.calls['/mail/mail003A01']!.last['boxName']), (25492, 'INBOX'));
      final drafts = await run(gw, 'list_mail_drafts');
      hasKeys(drafts, expected('list_mail_drafts'));
      expect((gw.calls['/mail/mail003A01']!.last['mboxSeq'], gw.calls['/mail/mail003A01']!.last['boxName'], gw.calls['/mail/mail003A01']!.last['pageSize']), (25498, 'INBOX', 20), reason: 'inno-creed 캡처: DRAFTS mboxSeq + boxName INBOX');
    });

    test('read_mail — 헤더·첨부(fileSn)·원격 리소스 수', () async {
      final gw = Gw(mail());
      final r = await run(gw, 'read_mail', {'muid': 14858746});
      final want = jsonDecode(File('$_fx/captured/read_mail-attach.json').readAsStringSync())['toolResult'];
      hasKeys(r, want);
      hasKeys((r['attachments'] as List).first, (want['attachments'] as List).first);
      expect([r['muid'], r['remoteResourceCount'], r['inlineImages']], ['14858746', 1, []]);
      expect(r['cc'], matches(RegExp(r'^[^,<]+ ?<user@example\.com>,[^,<]+<user@example\.com>$')), reason: '참조 2명(표시 이름 <주소>) — 이름 값은 픽스처 가림에 따라 바뀐다');
      expect((r['attachments'] as List).first['fileSizeApprox'], 298182);
      expect(r['attachments'].first['fileSn'], want['attachments'].first['fileSn']);
      expect(gw.calls['/mail/mail002A01']!.single, {'uid': '14858746'});
    });

    test('save_mail_draft — 받는사람 기본 본인, 서명, read-back', () async {
      final gw = Gw(mail());
      final r = await run(gw, 'save_mail_draft', {'subject': '제목', 'html': '<p>본문</p>', 'cc': 'a@x.com'});
      hasKeys(r, jsonDecode(File('$_fx/captured/save_mail_draft-plain.json').readAsStringSync())['toolResult']);
      expect((r['ok'], r['sent'], r['draft_muid'], r['to'], r['cc'], r['signature_attached'], r['verified_by_readback']), (true, false, '14580025', 'hong@innogrid.com', 'a@x.com', true, true));
      expect(r['mail_key'], jsonDecode(File('$_fx/captured/save_mail_draft-plain.json').readAsStringSync())['toolResult']['mail_key'], reason: 'A01 작성 폼 mailkey(A14 mailKey 아님)');
      final body = gw.raw['/mail/mail014A14']!;
      expect(body, contains('<p>본문</p><div class="dze_signature"'));
      expect(body, isNot(contains('<body>')));
      final nosig = await run(gw, 'save_mail_draft', {'subject': '제목', 'html': '<p>본문</p>', 'signature': false});
      expect(nosig['signature_attached'], false);
    });

    test('send_mail — A04 발송, to·cc·bcc', () async {
      final gw = Gw(mail());
      final r = await run(gw, 'send_mail', {'subject': '보고', 'to': 'a@x.com,b@x.com', 'bcc': 'c@x.com', 'html': '본문', 'signature': false});
      expect((r['ok'], r['sent'], r['to'], r['bcc']), (true, true, 'a@x.com,b@x.com', 'c@x.com'));
      expect(gw.raw['/mail/mail014A04'], allOf(contains('a@x.com,b@x.com'), contains('c@x.com')));
    });
  });

  group('결재', () {
    test('approval_counts — 함 라벨, 모르는 메뉴는 원래 키', () async {
      final gw = Gw({...org(), '/eap/api/getMenuCountInfo': (_) => {'1001100': '3', '1001110': '1', '1001200': '0', '1000400': '2', '1010002': '0', '1010005': '0'}});
      final r = await run(gw, 'approval_counts');
      hasKeys(r, expected('approval_counts'));
      expect((r['approved(기결)'], r['sent(상신)']), ('3', '2'));
    });

    test('pending_approvals — page_size, 대기일수', () async {
      final gw = Gw({...org(), '/eap/eap105A04': (_) => {'map': {'totalCount': 1, 'list': [{'DOC_ID': '9', 'FORM_ID': '41', 'DOC_TITLE': '외근', 'FORM_NM': '외근신청', 'USER_NM': '강팀장', 'DEPT_NM': '플랫폼팀', 'ARRIVED_DT': '20261001', 'DOC_STSNM': '진행', 'READYN': 'N', 'FILE_CNT': 0}]}}});
      final r = await run(gw, 'pending_approvals', {'page_size': '5'});
      expect((r['totalCount'], r['items'].single['docId'], r['items'].single['waitingDays'] is int), (1, '9', true));
      expect(gw.calls['/eap/eap105A04']!.single['pageSize'], '5');
    });

    test('read_approval — 헤더·본문·결재선(user_info)', () async {
      final gw = Gw({...org(), '/eap/eap111A04': (_) => cap('read_approval-attach', '/eap/eap111A04')});
      final r = await run(gw, 'read_approval', {'doc_id': 141373, 'form_id': '144'});
      final want = jsonDecode(File('$_fx/captured/read_approval-attach.json').readAsStringSync())['toolResult'];
      hasKeys(r, want);
      expect((r['docNo'], r['attachCount'], r['repDt']), (want['docNo'], '1', '20260805141603'));
      expect(r['approvalLine'], want['approvalLine']);
      expect(gw.calls['/eap/eap111A04']!.single['setReadYn'], 'N');
    });

    test('결재선 스키마·신청 가이드 — 내장 자산 그대로, 별칭·form_id 해석', () async {
      hasKeys(await run(null, 'list_approval_line_schemas'), expected('list_approval_line_schemas'));
      hasKeys(await run(null, 'list_approval_submission_guides'), expected('list_approval_submission_guides'));
      for (final (dt, fx) in [('연차', '연차휴가신청'), ('41', '외근신청'), ('출장신청서', '출장신청'), ('휴일근무', '휴일주말근무')]) {
        final s = await run(null, 'get_approval_line_schema', {'doc_type': dt});
        hasKeys(s, expected('get_approval_line_schema-$fx'), dt);
        expect(s['docType'], fx);
      }
      for (final id in ['36', '40', '41', '43']) {
        final g = await run(null, 'get_approval_submission_guide', {'doc_type': int.parse(id)});
        hasKeys(g, expected('get_approval_submission_guide-$id'), id);
      }
      await expectLater(run(null, 'get_approval_line_schema', {'doc_type': '품의서'}), throwsA(isA<McpToolError>()));
    });

    group('suggest_approval_line', () {
      List<String> who(Map r, [int branch = 0]) => [for (final s in r['branches'][branch]['steps'] as List) '${s['pos']}:${s['status']}:${(s['candidates'] as List).map((c) => c['name']).join('|')}'];

      test('연차휴가신청 — 팀원: 팀장 → 센터장', () async {
        final r = await run(Gw(org()), 'suggest_approval_line', {'doc_type': '연차휴가신청'});
        expect((r['verificationRequired'], r['drafter']['grade'], r['formId']), (true, '팀원', 36));
        expect(who(r), ['L_팀장:후보1:강팀장', 'L_센터장:후보1:최센터']);
        expect(r['warnings'], isNotEmpty);
      });

      test('외근신청(41) — 팀원, 같은 라인', () async {
        final r = await run(Gw(org()), 'suggest_approval_line', {'doc_type': '41'});
        expect([r['docType'], who(r)], ['외근신청', ['L_팀장:후보1:강팀장', 'L_센터장:후보1:최센터']]);
      });

      test('휴일주말근무 — 센터장: 본인 단계 표시, 고정 직책(CFO·대표이사)은 지정 부서에서', () async {
        final r = await run(Gw(org(myDept: '120', myDuty: '센터장')), 'suggest_approval_line', {'doc_type': '휴일근무'});
        expect(r['drafter']['grade'], '사업부장/실장/센터장이상');
        expect(who(r), ['L_센터장:본인:홍길동', 'L_본부장:후보1:박본부', 'L_부문장:후보1:이부문', 'CFO:후보1:정CFO', '대표이사:후보1:대표']);
      });

      test('출장신청 — 팀장·해외: 유관 합의, trip 비면 국내·해외 둘 다', () async {
        final gw = Gw(org(myDuty: '팀장'));
        final r = await run(gw, 'suggest_approval_line', {'doc_type': '출장신청', 'trip': '해외'});
        expect((r['branches'] as List).single['when'], {'grade': '팀장', 'trip': '해외'});
        expect(who(r), ['L_팀장:본인:홍길동', 'L_센터장:후보1:최센터', 'L_본부장:후보1:박본부', '인사총무팀장:후보1:윤팀장', '기술운영부문장:후보1:이부문', 'L_부문장:후보1:이부문']);
        final both = await run(gw, 'suggest_approval_line', {'doc_type': '출장'});
        expect((both['branches'] as List).map((b) => b['when']['trip']), ['국내', '해외']);
        await expectLater(run(gw, 'suggest_approval_line', {'doc_type': '출장', 'trip': '우주'}), throwsA(isA<McpToolError>()));
      });
    });
  });

  group('게시판·검색', () {
    test('list_notices — articles·totalCnt, field·기간 매핑', () async {
      final gw = Gw({...org(), '/board/APIHandler/ViewBoardNewAndNoticeArtList': (_) => cap('list_notices-20', '/board/APIHandler/ViewBoardNewAndNoticeArtList')});
      final r = await run(gw, 'list_notices', {'search': '연금', 'field': 'title', 'start_date': '20261001', 'end_date': '2026-10-10', 'page_size': '2'});
      hasKeys(r, expected('list_notices-2'));
      hasKeys((r['articles'] as List).first, (expected('list_notices-2')['articles'] as List).first);
      expect(((r['articles'] as List).first['artSeqNo'], (r['articles'] as List).first['fileCnt'], (r['articles'] as List).first['readCnt']), ('3068', 4, '97'));
      final b = gw.calls['/board/APIHandler/ViewBoardNewAndNoticeArtList']!.single;
      expect((b['searchTitle'], b['searchTotal'], b['searchStartDate'], b['searchEndDate'], b['pageSize']), ('연금', '', '2026-10-01', '2026-10-10', 2));
    });

    test('read_notice — 본문 이미지 자리·images[]', () async {
      final raw = cap('read_notice-attach', '/board/APIHandler/ViewPost') as Map;
      final gw = Gw({...org(), '/board/APIHandler/ViewPost': (_) => {...raw, 'art': {...raw['art'] as Map, 'art_content': '<p>안내</p><img src="/upload/a.png"><p>끝</p>'}}});
      final r = await run(gw, 'read_notice', {'art_seq_no': 3068});
      hasKeys(r, jsonDecode(File('$_fx/captured/read_notice-attach.json').readAsStringSync())['toolResult']);
      expect([r['images'], r['content'], r['fileCnt'], r['readCnt']], [['/upload/a.png'], '안내\n[이미지]끝', 4, '98']);
    });

    test('search — 모듈별 results, 범위·limit', () async {
      final gw = Gw({...org(), '/gw/APIHandler/gw018A02': (b) => switch ((b['body'] as Map)['boardType']) {
            '0' => cap('search-3', '/gw/APIHandler/gw018A02', 0),
            '6' => cap('search-3', '/gw/APIHandler/gw018A02', 1),
            '9' => cap('search-3', '/gw/APIHandler/gw018A02', 2),
            _ => {'resultgrid': [], 'totalcount': 0},
          }});
      final r = await run(gw, 'search', {'query': '회의', 'limit': '3'});
      final want = jsonDecode(File('$_fx/captured/search-3.json').readAsStringSync())['toolResult'];
      hasKeys(r, want);
      final res = r['results'] as List;
      expect(res.map((m) => m['module']).take(3), ['메일', '전자결재', '게시판']);
      for (var i = 0; i < 3; i++) {
        hasKeys(res[i], want['results'][i]);
        hasKeys((res[i]['items'] as List).first, (want['results'][i]['items'] as List).first, res[i]['module']);
      }
      expect((res[0]['items'] as List).first['muid'], '14859592');
      expect(gw.calls['/gw/APIHandler/gw018A02']!.first['body']['pageSize'], 3);
      final one = await run(gw, 'search', {'query': '회의', 'scope': '결재', 'from': '2026-10-01'});
      expect([(one['results'] as List).single['module'], one['period']], ['전자결재', {'from': '2026-10-01', 'to': ''}]);
    });
  });

  group('오류 문장(M1·M3)', () {
    McpTools withClient(MockClient c) => McpTools(gw: GwApi(GwClient(httpClient: c, creds: () => testCreds)), appSupportDir: () => Directory.systemTemp.path);
    Future<String> err(McpTools t, String tool) async {
      try {
        await t.execute(tool, const {});
      } on McpToolError catch (e) {
        return e.message;
      }
      fail('McpToolError가 나야 함');
    }

    test('연결 끊김(status 0): 쓰기 도구엔 "이미 반영됐을 수 있음", 읽기 도구엔 없음', () async {
      final t = withClient(MockClient((_) async => throw http.ClientException('down')));
      expect(await err(t, 'attendance_clock_in'), allOf(startsWith('그룹웨어에 연결할 수 없습니다'), endsWith(' — 요청이 이미 반영됐을 수 있습니다. 다시 실행하기 전에 목록으로 확인하세요.')));
      expect(await err(t, 'whoami'), isNot(contains('반영됐을 수')));
    });

    test('세션 만료(401)는 다시 연결할 곳(앱 더보기 > 아마란스)까지 안내', () async {
      final t = withClient(MockClient((_) async => http.Response('{"resultCode":140}', 401)));
      expect(await err(t, 'whoami'), '아마란스 로그인이 만료되었습니다. 앱 더보기 > 아마란스에서 다시 연결해 주세요.');
    });
  });
}
