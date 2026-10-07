import 'dart:async';
import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';
import 'package:playground/briefing/briefing_provider.dart';
import 'package:playground/briefing/briefing_model.dart';
import 'package:playground/briefing/summary_provider.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_creds.dart';
import 'package:playground/gw/gw_models.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../gw/fakes.dart';

http.Response ok(Object? data) => http.Response.bytes(utf8.encode(jsonEncode({'resultCode': 0, 'resultData': data})), 200, headers: {'content-type': 'application/json; charset=utf-8'});
const session = {'sessionInfo': {'ucUserInfo': {'compSeq': '10', 'deptSeq': '20', 'empName': '홍길동', 'emailAdd': 'hong', 'emailDomain': 'innogrid.com', 'erpEmpSeq': 'E', 'erpDeptSeq': 'D', 'erpCompSeq': 'C'}}};
MockClient gwRoutes(Map<String, Object?> m) => MockClient((r) async => m.containsKey(r.url.path) ? ok(m[r.url.path]) : http.Response('{"resultCode":999,"resultMsg":"x"}', 200));

class _Tokens implements TokenSource {
  @override Future<String?> accessToken() async => 't';
  @override Future<String?> refreshToken() async => 't';
  @override Future<void> onUnauthorized() async {}
}
/// 앱 서버 가짜: 경로 → (상태, 본문). 호출 기록.
class AppApi {
  AppApi(Map<String, (int, Object)> routes) : routes = {'/api/jira/issues': (200, {'connected': false, 'items': []}), ...routes};
  final Map<String, (int, Object)> routes;
  final calls = <String, int>{};
  final bodies = <String, Object?>{};
  ApiClient get client => ApiClient(httpClient: MockClient((r) async {
        calls[r.url.path] = (calls[r.url.path] ?? 0) + 1;
        if (r.body.isNotEmpty) bodies[r.url.path] = jsonDecode(r.body);
        final (code, body) = routes[r.url.path] ?? (404, {'error': 'no route'});
        return http.Response.bytes(utf8.encode(jsonEncode(body)), code, headers: {'content-type': 'application/json; charset=utf-8'});
      }), tokens: _Tokens(), baseUrl: 'http://x', userAgent: 't');
}

final gwAll = <String, Object?>{
  '/gw/gw050A02': session,
  '/gw/APIHandler/gw102A02': [{'empSeq':'7','compSeq':'10','deptSeq':'20','deptName':'개발팀','dutyName':'팀원','atNm':''}],
  '/schres/sc111A02': {'resultList': [{'mcalSeq': '1', 'calType': 'E', 'empSeq': '7'}]},
  '/schres/sc111A03': {'resultList': [{'schSeq': 'a', 'schTitle': '주간회의', 'startDate': '202610051000', 'endDate': '202610051100', 'delYn': 'Y', 'mcalSeq': '1'}, {'schSeq': 'x', 'schTitle': '김민준 연차', 'startDate': '202610050000', 'endDate': '202610052359', 'alldayYn': 'Y', 'delYn': 'N', 'mcalSeq': '9', 'createName': '김민준'}]},
  '/eap/eap105A04': {'map': {'totalCount': 1, 'list': [{'DOC_ID': 'D1', 'FORM_ID': '7', 'DOC_TITLE': '휴가 신청', 'USER_NM': '이서연', 'ARRIVED_DT': '20261001', 'READYN': 'N'}]}},
  '/mail/mail000A01': {'children': [{'name': 'INBOX', 'mboxSeq': 5}]},
  '/mail/mail003A01': {'TotalUnseenCount': 2, 'Records': [{'muid': '1', 'subject': '견적', 'fromAddrName': '박지훈', 'tooltipDate': '2026-10-05 09:12:00', 'seen': false}]},
  '/human/common/judgeTimeManagement/getTodayComeLeaveInfo': {'comeTm': '', 'leaveTm': ''},
  '/board/APIHandler/ViewBoardNewAndNoticeArtList': {'totalCnt': 1, 'articleList': [{'art_seq_no': '1', 'art_title': '보안 교육', 'cat_title': '공지사항', 'is_new_yn': 'Y', 'art_read_yn': 'N'}]},
};

ProviderContainer scope({GwCreds? creds = testCreds, required MockClient gw, required ApiClient api}) {
  final c = ProviderContainer(overrides: [gwStoreProvider.overrideWithValue(FakeGwStore(creds)), gwHttpClientProvider.overrideWithValue(gw), apiClientProvider.overrideWithValue(api)]);
  addTearDown(c.dispose);
  return c;
}

void main() {
  test('Jira는 아마란스 미연결이어도 진행 중 목록을 수집하고 요약에 포함한다', () async {
    final app = AppApi({'/api/jira/issues': (200, {'connected': true, 'items': [{'key': 'AX-1', 'summary': '설계 검토', 'status': '진행 중'}]})});
    final c = scope(creds: null, gw: gwRoutes({}), api: app.client);
    final d = await c.read(briefingProvider.future);
    expect(d.jira?.items.single.key, 'AX-1');
    expect(summaryPayload(d)['jira'], [{'key': 'AX-1', 'title': '설계 검토', 'status': '진행 중', 'dueDate': null}]);
  });
  test('Jira 인증 만료는 재연결, 통신 오류는 소스별 오류로 구분한다', () async {
    for (final code in [409, 502]) {
      final app = AppApi({'/api/jira/issues': (code, {'error': 'failure'}), '/api/teams/mentions': (200, {'connected': false, 'items': []})});
      final c = scope(creds: null, gw: gwRoutes({}), api: app.client);
      final d = await c.read(briefingProvider.future);
      expect(d.jira?.reconnect == true, code == 409);
      expect(d.errors.containsKey('jira'), code == 502);
    }
  });

  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('07:00 기준 날짜는 자정에 바뀌지 않고 기기 시간대와 무관하다', () {
    expect(briefingPeriod(DateTime.utc(2026, 10, 7, 6, 59, 59)), '20261006');
    expect(briefingPeriod(DateTime.utc(2026, 10, 7, 7)), '20261007');
    expect(untilNextBriefing(DateTime.utc(2026, 10, 7, 6, 59, 59)), const Duration(seconds: 1));
    expect(untilNextBriefing(DateTime.utc(2026, 10, 7, 7)), const Duration(days: 1));
  });

  test('07:00 이전의 지연 응답은 버리고 새 시간대의 동시 요청은 합친다', () async {
    var now = DateTime.utc(2026, 10, 7, 6, 59);
    final gate = Completer<void>();
    var calls = 0;
    final api = ApiClient(httpClient: MockClient((r) async {
      final call = ++calls;
      if (call == 1) await gate.future;
      return http.Response(jsonEncode({'enabled': true, 'text': 'briefing $call'}), 200);
    }), tokens: _Tokens(), baseUrl: 'http://x', userAgent: 'test');
    final c = ProviderContainer(overrides: [
      apiClientProvider.overrideWithValue(api),
      briefingClockProvider.overrideWithValue(() => now),
    ]);
    addTearDown(c.dispose);
    await c.read(summaryProvider.future);
    final notifier = c.read(summaryProvider.notifier);
    final old = notifier.ensure(BriefingData(now: now, empSeq: '7'));
    await Future<void>.delayed(Duration.zero);
    now = DateTime.utc(2026, 10, 7, 7);
    final fresh = BriefingData(now: now, empSeq: '7');
    final a = notifier.ensure(fresh);
    final b = notifier.ensure(fresh);
    gate.complete();
    expect(await old, isFalse);
    expect(await a, isTrue);
    expect(await b, isTrue);
    expect(calls, 2);
    expect(c.read(summaryProvider).value!.text, 'briefing 2');
    await notifier.ensure(fresh);
    expect(calls, 2);
    await notifier.ensure(fresh, force: true);
    expect(calls, 3);
  });

  test('조직도 조회 실패는 다른 섹션에 영향을 주지 않고 캘린더 부재로 대체하지 않는다', () async {
    final routes = {...gwAll}..remove('/gw/APIHandler/gw102A02');
    final app = AppApi({'/api/teams/mentions': (200, {'connected':false,'items':[]})});
    final c = scope(gw: gwRoutes(routes), api: app.client);
    final d = await c.read(briefingProvider.future);
    expect(d.errors.keys, ['absences']);
    expect(d.today, isNotEmpty);
    expect(d.orgAbsences, isNull);
    expect(teamAbsences(d), isEmpty);
  });

  test('소스별 병렬 수집 — 하나(메일함 목록)가 실패해도 나머지는 채워지고 errors에만 남는다', () async {
    final gw = Map.of(gwAll)..remove('/mail/mail000A01');
    final app = AppApi({'/api/teams/mentions': (200, {'connected': true, 'items': [{'chatId': 'c', 'topic': '센터', 'from': '김민준', 'text': '확인 부탁', 'at': '2026-10-05T00:00:00Z'}]})});
    final c = scope(gw: gwRoutes(gw), api: app.client);
    await c.read(briefingProvider.notifier).refresh(name: '강승욱');
    final d = await c.read(briefingProvider.future);
    expect(d.name, '강승욱');
    expect(d.empSeq, '7');
    expect(d.today!.length, 2);
    expect(d.approvals!.$2.single.title, '휴가 신청');
    expect(d.inbox, isNull);
    expect(d.errors.keys, ['inbox']);
    expect(d.attendance!.clockedIn, isFalse);
    expect(d.notices!.$2.single.title, '보안 교육');
    expect(d.mentions!.connected, isTrue);
    expect(d.mentions!.items.single.from, '김민준');
    expect(app.calls['/api/teams/mentions'], 1);
  });
  test('첫 로딩이 끝난 뒤 refresh()는 다시 수집하고 notifier의 이름을 유지한다', () async {
    final app = AppApi({'/api/teams/mentions': (200, {'connected': false, 'items': []})});
    final c = scope(gw: gwRoutes(gwAll), api: app.client);
    await c.read(briefingProvider.notifier).refresh(name: '강승욱');
    expect(app.calls['/api/teams/mentions'], 1);
    await c.read(briefingProvider.notifier).refresh();
    expect(app.calls['/api/teams/mentions'], 2);
    expect((await c.read(briefingProvider.future)).name, '강승욱');
  });
  test('아마란스 미연결이면 GW 소스는 비우고 Teams만 수집; Teams 403은 오류가 아니라 미연결', () async {
    final app = AppApi({'/api/teams/mentions': (403, {'error': '권한 없음'})});
    final c = scope(creds: null, gw: gwRoutes(gwAll), api: app.client);
    final d = await c.read(briefingProvider.future);
    expect(d.empSeq, '');
    expect(d.today, isNull);
    expect(d.errors, isEmpty);
    expect(d.mentions!.connected, isFalse);
  });
  test('Teams 409(reconnect)·400(not_connected)도 오류가 아니라 미연결 — 재시도 줄 대신 섹션 숨김', () async {
    for (final code in [409, 400]) {
      final app = AppApi({'/api/teams/mentions': (code, {'error': 'x', 'code': code == 409 ? 'reconnect' : 'not_connected'})});
      final c = scope(gw: gwRoutes(gwAll), api: app.client);
      final d = await c.read(briefingProvider.future);
      expect(d.errors, isEmpty, reason: '$code');
      expect(d.mentions!.connected, isFalse, reason: '$code');
    }
  });
  test('요약: 오늘 캐시가 없으면 서버에 payload를 보내 저장하고, 같은 날에는 새로고침해도 다시 호출하지 않는다', () async {
    final app = AppApi({'/api/mobile/briefing': (200, {'enabled': true, 'text': '오늘 10시 주간회의가 있습니다.', 'model': 'm', 'at': 'x'})});
    final c = scope(gw: gwRoutes(gwAll), api: app.client);
    final d = await c.read(briefingProvider.future);
    expect(await c.read(summaryProvider.future), isNull);
    await c.read(summaryProvider.notifier).ensure(d);
    expect(c.read(summaryProvider).value!.text, '오늘 10시 주간회의가 있습니다.');
    expect(c.read(summaryProvider).value!.date, ymd(kstNow()));
    expect((app.bodies['/api/mobile/briefing'] as Map)['name'], isNotNull);
    expect((app.bodies['/api/mobile/briefing'] as Map).containsKey('meetings'), isTrue);
    await c.read(summaryProvider.notifier).ensure(d);
    await c.read(briefingProvider.notifier).refresh(); // 새로고침해도 같은 날이면 다시 만들지 않는다
    await c.read(summaryProvider.notifier).ensure(await c.read(briefingProvider.future));
    expect(app.calls['/api/mobile/briefing'], 1);
    final saved = jsonDecode((await SharedPreferences.getInstance()).getString('briefing.summary.v2')!) as Map;
    expect(saved['text'], '오늘 10시 주간회의가 있습니다.');
  });
  test('요약: 로그아웃(invalidate) 뒤 다른 계정은 이전 요약을 보지 않고, 요청하면 새로 만든다', () async {
    final app = AppApi({'/api/mobile/briefing': (200, {'enabled': true, 'text': 'A의 문장', 'model': 'm', 'at': 'x'})});
    final c = scope(gw: gwRoutes(gwAll), api: app.client);
    final d = await c.read(briefingProvider.future);
    await c.read(summaryProvider.future);
    await c.read(summaryProvider.notifier).ensure(d);
    expect(c.read(summaryProvider).value!.text, 'A의 문장');
    (await SharedPreferences.getInstance()).remove('briefing.summary.v2'); // 로그아웃이 지우는 저장분
    c.invalidate(summaryProvider);
    expect(await c.read(summaryProvider.future), isNull);
    app.routes['/api/mobile/briefing'] = (200, {'enabled': true, 'text': 'B의 문장', 'model': 'm', 'at': 'x'});
    await c.read(summaryProvider.notifier).ensure(d);
    expect(app.calls['/api/mobile/briefing'], 2);
    expect(c.read(summaryProvider).value!.text, 'B의 문장');
  });
  test('요약: 앱을 새로 시작하면(새 컨테이너) 오늘 저장된 문장을 먼저 보여 주고, 서버에 한 번 새로 받아 바꾼다', () async {
    SharedPreferences.setMockInitialValues({'briefing.summary.v2': jsonEncode({'date': ymd(kstNow()), 'text': '아침 문장', 'at': '08:40'})});
    final app = AppApi({'/api/mobile/briefing': (200, {'enabled': true, 'text': '새로 시작한 뒤 문장', 'model': 'm', 'at': 'x'})});
    final c = scope(gw: gwRoutes(gwAll), api: app.client);
    expect((await c.read(summaryProvider.future))!.text, '아침 문장', reason: '받기 전엔 직전 문장');
    final d = await c.read(briefingProvider.future);
    await c.read(summaryProvider.notifier).ensure(d);
    expect(c.read(summaryProvider).value!.text, '새로 시작한 뒤 문장');
    await c.read(summaryProvider.notifier).ensure(d);
    expect(app.calls['/api/mobile/briefing'], 1, reason: '켜져 있는 동안에는 다시 만들지 않는다');
  });
  test('요약: 출근을 기록하면 stale()로 같은 실행 안에서도 한 번 다시 만든다("출근하세요" 문장이 남지 않게)', () async {
    final app = AppApi({'/api/mobile/briefing': (200, {'enabled': true, 'text': '문장', 'model': 'm', 'at': 'x'})});
    final c = scope(gw: gwRoutes(gwAll), api: app.client);
    final d = await c.read(briefingProvider.future);
    await c.read(summaryProvider.notifier).ensure(d);
    await c.read(summaryProvider.notifier).ensure(d);
    expect(app.calls['/api/mobile/briefing'], 1);
    c.read(summaryProvider.notifier).stale();
    await c.read(summaryProvider.notifier).ensure(d);
    expect(app.calls['/api/mobile/briefing'], 2);
  });
  test('요약: 옛 키(briefing.summary)에 남은 오늘 문장은 쓰지 않는다 — 1.1.2 이전 잘린 문장을 버리고 한 번 새로 만든다', () async {
    SharedPreferences.setMockInitialValues({'briefing.summary': jsonEncode({'date': ymd(kstNow()), 'text': '강승', 'at': '22:59'})});
    final app = AppApi({'/api/mobile/briefing': (200, {'enabled': true, 'text': '새 문장입니다.', 'model': 'm', 'at': 'x'})});
    final c = scope(gw: gwRoutes(gwAll), api: app.client);
    expect(await c.read(summaryProvider.future), isNull);
    await c.read(summaryProvider.notifier).ensure(await c.read(briefingProvider.future));
    expect(c.read(summaryProvider).value!.text, '새 문장입니다.');
  });
  test('요약: 서버가 enabled:false거나 실패하면 null 유지, 캐시가 어제 것이면 무시', () async {
    SharedPreferences.setMockInitialValues({'briefing.summary': jsonEncode({'date': '20000101', 'text': '옛날', 'at': '00:00'})});
    final app = AppApi({'/api/mobile/briefing': (200, {'enabled': false})});
    final c = scope(gw: gwRoutes(gwAll), api: app.client);
    expect(await c.read(summaryProvider.future), isNull, reason: '어제 캐시는 버린다');
    final d = await c.read(briefingProvider.future);
    await c.read(summaryProvider.notifier).ensure(d);
    expect(c.read(summaryProvider).value, isNull);
    final app2 = AppApi({'/api/mobile/briefing': (502, {'error': 'x'})});
    final c2 = scope(gw: gwRoutes(gwAll), api: app2.client);
    await c2.read(summaryProvider.notifier).ensure(await c2.read(briefingProvider.future));
    expect(c2.read(summaryProvider).value, isNull);
  });
}
