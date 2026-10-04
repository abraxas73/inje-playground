import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/gw_api.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_creds.dart';

const _creds = GwCreds(authToken: 'g|7|s', signKey: 'k');
final _now = DateTime(2026, 10, 4, 12);
http.Response ok(Object? data) => http.Response(jsonEncode({'resultCode': 0, 'resultData': data}), 200, headers: {'content-type': 'application/json'});
const session = {'sessionInfo': {'ucUserInfo': {'compSeq': '10', 'deptSeq': '20', 'empName': '홍', 'emailAdd': 'h', 'emailDomain': 'x.com', 'erpEmpSeq': 'E1', 'erpDeptSeq': 'D1', 'erpCompSeq': 'C1'}}};

/// 경로별 응답 + 호출 기록. 같은 경로가 여러 번이면 순서대로 소비한다.
class Fake {
  Fake(this.routes);
  final Map<String, List<Object?>> routes;
  final calls = <(String, Map<String, dynamic>)>[];
  GwApi api() => GwApi(GwClient(httpClient: MockClient((r) async {
        final body = r.body.startsWith('{') ? jsonDecode(r.body) as Map<String, dynamic> : <String, dynamic>{'form': r.body};
        calls.add((r.url.path, body));
        final q = routes[r.url.path];
        if (q == null || q.isEmpty) return http.Response('{"resultCode":999,"resultMsg":"unexpected ${r.url.path}"}', 200);
        return ok(q.length == 1 ? q.first : q.removeAt(0));
      }), creds: () => _creds, now: () => _now), now: () => _now);
  int count(String path) => calls.where((c) => c.$1 == path).length;
}

void main() {
  test('approvalCounts: 세션 값으로 body를 채우고 라벨 맵을 돌려준다', () async {
    final f = Fake({'/gw/gw050A02': [session], '/eap/api/getMenuCountInfo': [{'1001000': '2'}]});
    expect(await f.api().approvalCounts(), {'pending': 2, 'approved': 0, 'reference': 0, 'sent': 0});
    final body = f.calls.last.$2;
    expect((body['deptSeq'], body['compSeq'], body['bizSeq'], body['empSeq'], body['groupSeq'], body['userSe'], body['pageCode']), ('20', '10', '10', '7', 'g', 'USER|AT', 'EapSide'));
  });
  test('pendingApprovals: eap105A04 미결함 body + map.list 정제, 오래 기다린 순', () async {
    final f = Fake({'/gw/gw050A02': [session], '/eap/eap105A04': [{'map': {'totalCount': 2, 'list': [
      {'DOC_ID': 'B', 'FORM_ID': '1', 'DOC_TITLE': 'b', 'ARRIVED_DT': '20261003', 'READYN': 'Y'},
      {'DOC_ID': 'A', 'FORM_ID': '1', 'DOC_TITLE': 'a', 'ARRIVED_DT': '20260920', 'READYN': 'N'},
    ]}}]});
    final (total, docs) = await f.api().pendingApprovals();
    expect(total, 2);
    expect(docs.map((d) => d.docId), ['A', 'B']);
    final body = f.calls.last.$2;
    expect((body['eaBoxId'], body['menuNo'], body['periodPicker'], body['sfrDt'], body['stoDt'], body['pageSize']), ('1000900', '1001000', 'ARRIVED_DT', '20260706', '20261004', '50'));
  });
  test('approvalDetail: eap111A04, 열람 처리 없음(setReadYn N)', () async {
    final f = Fake({'/eap/eap111A04': [{'docTitle': 't', 'contentsWord': 'c', 'empName': '김'}]});
    final d = await f.api().approvalDetail('D1', '7');
    expect((d.title, d.content, d.drafter), ('t', 'c', '김'));
    expect((f.calls.last.$2['doc_id'], f.calls.last.$2['form_id'], f.calls.last.$2['setReadYn']), ('D1', '7', 'N'));
  });
  test('attendanceToday: 근태 코드(empCd/coCd)와 오늘 날짜', () async {
    final f = Fake({'/gw/gw050A02': [session], '/human/common/judgeTimeManagement/getTodayComeLeaveInfo': [{'comeTm': '202610040902', 'leaveTm': ''}]});
    final a = await f.api().attendanceToday();
    expect((a.workDt, a.comeTm, a.clockedOut), ('20261004', '202610040902', false));
    expect((f.calls.last.$2['empCd'], f.calls.last.$2['coCd'], f.calls.last.$2['workDt']), ('E1', 'C1', '20261004'));
  });
  test('punch: 이미 출근 기록이 있으면 기록 호출 0회, already', () async {
    final f = Fake({'/gw/gw050A02': [session], '/human/common/judgeTimeManagement/getTodayComeLeaveInfo': [{'comeTm': '202610040902', 'leaveTm': ''}]});
    final r = await f.api().punch(clockIn: true);
    expect((r.ok, r.already, r.kind), (true, true, '출근'));
    expect(f.count('/human/common/judgeTimeManagement/getJudgeTimeManagement'), 0);
  });
  test('punch: 기록 → read-back으로 반영 판정(attendFg 4=퇴근)', () async {
    const base = '/human/common/judgeTimeManagement';
    final f = Fake({'/gw/gw050A02': [session], '$base/getTodayComeLeaveInfo': [{'comeTm': '202610040902', 'leaveTm': ''}, {'comeTm': '202610040902', 'leaveTm': '202610041805'}], '$base/confirmApplicationStatus': [{}], '$base/getJudgeTimeManagement': [{'successCount': 1}]});
    final r = await f.api().punch(clockIn: false);
    expect((r.ok, r.already, r.verified, r.kind, r.leaveTm), (true, false, true, '퇴근', '202610041805'));
    final punch = f.calls.firstWhere((c) => c.$1 == '$base/getJudgeTimeManagement').$2;
    expect(punch['type'], 'WEB');
    expect((punch['judgeData'] as Map)['attendFg'], '4');
    expect((punch['judgeData'] as Map)['deptCd'], 'D1');
  });
  test('punch: read-back에 반영이 없으면 ok=false·verified=false', () async {
    const base = '/human/common/judgeTimeManagement';
    final f = Fake({'/gw/gw050A02': [session], '$base/getTodayComeLeaveInfo': [{'comeTm': '', 'leaveTm': ''}, {'comeTm': '', 'leaveTm': ''}], '$base/confirmApplicationStatus': [{}], '$base/getJudgeTimeManagement': [{}]});
    final r = await f.api().punch(clockIn: true);
    expect((r.ok, r.verified), (false, false));
  });
}
