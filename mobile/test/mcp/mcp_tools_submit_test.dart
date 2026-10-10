// mobile/test/mcp/mcp_tools_submit_test.dart — Task 11b: submit_approval(7호출 순서·본문)·cancel_approval(상태별 순차·재조회)·delete_temp_approval(SSE GET·draft 재조회).
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:playground/mcp/approval_schemas.dart';
import 'package:playground/mcp/mcp_tools.dart';
import 'package:playground/mcp/mcp_worker.dart';
import 'mcp_tools_approval_test.dart' show captured, me;
import 'mcp_tools_test.dart' show Gw;

const _hp = ['/human/attendapplication/0hr00011', '/human/attendapplication/create'];
const _flow = [..._hp, '/eap/eap110A03', '/system/apiUtilEap/GetLinkKey', '/personal/hpd0110/saveAttendApplicationLinkKey', '/system/apiUtilEap/SetEnageGroup', '/eap/eap110A06'];
const _identity = {'/gw/gw050A02', '/gw/APIHandler/gw102A02'};

List<Map> calls(String label) => (captured(label)['calls'] as List).cast<Map>();

/// 그 경로 n번째 호출(캡처)의 resultData.
Object? res(String label, String path, [int nth = 0]) => calls(label).where((c) => c['path'] == path).elementAt(nth)['response']['resultData'];

/// 캡처 계정의 세션(gw050A02)·부서원 행(gw102A02) — 신원은 테스트 계정 empSeq 7(creds), 코드는 캡처 그대로, 이름·부서·직책·직급은 구분되는 테스트 값.
/// resolved false면 부서원 행에 본인이 없다(profileResolved false).
Map<String, Object? Function(Map<String, dynamic>)> identity({bool resolved = true}) => {
      '/gw/gw050A02': (_) => {'sessionInfo': {'ucUserInfo': {'compSeq': '1000', 'deptSeq': '2989', 'empName': '테스트기안자', 'emailAdd': 'u', 'emailDomain': 'example.com', 'erpEmpSeq': '10995', 'erpDeptSeq': 'AA120', 'erpCompSeq': '1000'}}},
      '/gw/APIHandler/gw102A02': (_) => [if (resolved) {'empSeq': '7', 'deptName': '테스트부서', 'dutyName': '테스트직책', 'positionName': '테스트직급'}],
    };

/// 테스트 신원 값 → 캡처 가림 값 'x'(캡처 본문과 직접 비교용 — 신원 값이 들어갔는지는 따로 단정).
dynamic unmask(Object? v) => jsonDecode(['테스트기안자', '테스트부서', '테스트직책', '테스트직급'].fold(jsonEncode(v), (s, w) => s.replaceAll(w, 'x')));

final _approkey = RegExp(r'^ERP_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

/// approkey·approKey 값을 캡처 가림 값으로(형식은 따로 단정).
Map<String, dynamic> masked(Map<String, dynamic> b) => {for (final e in b.entries) e.key: (e.key == 'approkey' || e.key == 'approKey') ? 'ERP_x' : e.value};

void main() {
  late Directory dir;
  setUp(() => dir = Directory.systemTemp.createTempSync('mcp_submit_test'));
  tearDown(() => dir.deleteSync(recursive: true));
  Future<dynamic> run(Gw gw, String tool, Map<String, dynamic> args) async =>
      jsonDecode(await McpTools(gw: gw.api(), appSupportDir: () => dir.path, schemas: ApprovalSchemas(loader: (p) => File(p).readAsString())).execute(tool, args));
  Matcher err(String part) => throwsA(isA<McpToolError>().having((e) => e.message, 'm', contains(part)));
  List<String> flow(Gw gw) => gw.order.where((p) => !_identity.contains(p)).toList();

  group('submit_approval', () {
    Map<String, Object? Function(Map<String, dynamic>)> routes(String label, {Object? Function(Map)? a03, Object? a06}) => {
          ...identity(),
          for (final p in _flow) p: (_) => res(label, p),
          if (a03 != null) '/eap/eap110A03': (_) => a03(res(label, '/eap/eap110A03') as Map),
          if (a06 != null) '/eap/eap110A06': (_) => a06,
        };

    for (final label in ['submit_approval', 'submit_approval-3d']) {
      test('$label — 7호출 순서·본문(approkey·rep_dt 제외 캡처 그대로)·응답 키', () async {
        final gw = Gw(routes(label));
        final args = captured(label)['args'] as Map<String, dynamic>;
        final r = await run(gw, 'submit_approval', args);
        expect(flow(gw), _flow);
        for (final p in _flow.where((p) => p != '/eap/eap110A06')) {
          final got = gw.calls[p]!.single, want = calls(label).firstWhere((c) => c['path'] == p)['body'] as Map;
          expect(masked(unmask(got) as Map<String, dynamic>), want, reason: p);
          for (final k in ['approkey', 'approKey'].where(got.containsKey)) {
            expect(got[k], matches(_approkey), reason: '$p.$k');
          }
        }
        // 같은 approkey가 A03·GetLinkKey·SetEnageGroup·A06에 실린다
        final key = gw.calls['/eap/eap110A03']!.single['approkey'];
        expect([gw.calls['/system/apiUtilEap/GetLinkKey']!.single['approKey'], gw.calls['/system/apiUtilEap/SetEnageGroup']!.single['approKey']], [key, key]);

        final got = unmask(gw.calls['/eap/eap110A06']!.single) as Map, want = me(calls(label).firstWhere((c) => c['path'] == '/eap/eap110A06')['body']) as Map;
        expect(got.keys.toSet(), want.keys.toSet());
        expect(got['pageCode'], want['pageCode']);
        final item = got['paramItem'] as Map, wantItem = want['paramItem'] as Map;
        expect(item.keys.toSet(), wantItem.keys.toSet());
        expect(item.length, 65);
        for (final k in wantItem.keys.where((k) => k != 'approkey' && k != 'rep_dt')) {
          expect(item[k], wantItem[k], reason: 'paramItem.$k');
        }
        expect(item['approkey'], key);
        expect(item['rep_dt'], matches(RegExp(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$')));
        // bindData는 정렬 키 JSON 문자열을 한 번 더 JSON 문자열로(이중 인코딩)
        expect(jsonDecode(jsonDecode(item['bindData'] as String) as String), isA<Map>());

        final tr = captured(label)['toolResult'] as Map;
        expect((r as Map).keys.toSet(), tr.keys.toSet());
        for (final k in ['docId', 'formId', 'kind', 'lineCount', 'ok', 'referCount', 'title']) {
          expect(r[k], tr[k], reason: k);
        }
      });
    }

    test('신원 값은 입력 예시가 남이어도 로그인 사용자 값으로 덮어쓴다(HP·bindData)', () async {
      final gw = Gw(routes('submit_approval'));
      await run(gw, 'submit_approval', captured('submit_approval')['args'] as Map<String, dynamic>);
      final hp = gw.calls['/human/attendapplication/0hr00011']!.single;
      final app = (hp['applicationList'] as List).single as Map, emp = (hp['employeeList'] as List).single as Map;
      expect((app['empCd'], app['deptCd'], app['coCd'], emp['empCd'], emp['deptCd']), ('10995', 'AA120', '1000', '10995', 'AA120'));
      expect(jsonEncode(captured('submit_approval')['args']), contains('99999'), reason: '입력은 다른 사람 코드');
      expect((app['empNm'], app['deptNm'], emp['korNm'], emp['deptNm']), ('테스트기안자', '테스트부서', '테스트기안자', '테스트부서'));
      final item = gw.calls['/eap/eap110A06']!.single['paramItem'] as Map;
      expect(item['bindData'], isNot(contains('99999')));
      expect((item['user_nm'], item['dept_nm']), ('테스트기안자', '테스트부서'));
      final bind = jsonDecode(jsonDecode(item['bindData'] as String) as String) as Map;
      final items = (((bind['TABLE'] as Map)['dbTable1'] as Map)['group'] as List).single['items'] as Map;
      expect((items['empNm'], items['deptNm'], items['empCd']), ('테스트기안자', '테스트부서', '10995'));
    });

    for (final n in [36, 40, 43]) {
      test('가이드 $n 예시 그대로 — 예시 인물의 이름·부서·직책·직급·사번이 남지 않고 로그인 사용자 값으로', () async {
        final help = (jsonDecode(File('assets/mcp/approval_submission_guide_$n.json').readAsStringSync())['guide'] as Map)['draftHelp'] as Map;
        final gw = Gw(routes('submit_approval'));
        await run(gw, 'submit_approval', {
          'form_id': n, 'doc_title': 't', 'line_id': 2485, 'doc_contents_html': '<div>t</div>',
          'hp_application_json': jsonEncode(help['hpApplicationExample']), 'bind_data_json': jsonEncode(help['bindDataExample']),
        });
        expect(flow(gw), _flow);
        final item = gw.calls['/eap/eap110A06']!.single['paramItem'] as Map;
        final sent = [jsonEncode(gw.calls[_hp[0]]!.single), jsonEncode(gw.calls[_hp[1]]!.single), jsonDecode(item['bindData'] as String) as String];
        for (final body in sent) {
          for (final bad in ['팀원', '책임연구원', '이재학', '네이티브 플랫폼팀', '"11097"', '"AA121"']) {
            expect(body, isNot(contains(bad)), reason: '$n: $bad');
          }
          expect(body, contains('테스트기안자'), reason: '$n');
        }
        if (n == 43) {
          final app = (help['hpApplicationExample']['applicationList'] as List).single as Map;
          expect(app['groupByKey'], '1109720260803', reason: '예시는 남의 사번');
          for (final p in _hp) {
            final row = (gw.calls[p]!.single['applicationList'] as List).single as Map;
            expect(row['groupByKey'], '10995${app['dueDt']}', reason: p);
            expect(row['groupByKey'], '1099520260803', reason: p);
          }
        }
        final bind = jsonDecode(sent[2]) as Map;
        if (n == 40) {
          final it = bind['ITEMS'] as Map;
          expect((it['singleDeptNm'], it['singleDutyNm'], it['singlePositionNm'], it['empNmDutyNm'], it['employees']), ('테스트부서', '테스트직책', '테스트직급', '테스트기안자 테스트직책', '테스트기안자 테스트직급'));
        } else {
          expect(sent[2], allOf(contains('"dutyNm":"테스트직책"'), contains('"positionNm":"테스트직급"'), contains('"hrspNm":"테스트직책"')));
        }
      });
    }

    test('로그인 사용자 직책·직급을 확인하지 못하면(profileResolved false) 호출 없이 거절', () async {
      final gw = Gw({...routes('submit_approval'), ...identity(resolved: false)});
      await expectLater(run(gw, 'submit_approval', captured('submit_approval')['args'] as Map<String, dynamic>), err('직책·직급'));
      expect(flow(gw), isEmpty);
    });

    test('create가 연결 끊김이면 "생성됐을 수 있음" 안내, 그 뒤 호출 없음', () async {
      final gw = Gw({...routes('submit_approval'), _hp[1]: (_) => throw const SocketException('x')});
      await expectLater(run(gw, 'submit_approval', captured('submit_approval')['args'] as Map<String, dynamic>), err('근태 신청이 생성됐을 수 있습니다'));
      expect(flow(gw), _hp);
    });

    test('A06 연결 끊김은 "상신됐을 수 있음 — sent에 없을 때만 삭제", 그 전 단계 서버 오류는 "삭제 필요"', () async {
      final args = captured('submit_approval')['args'] as Map<String, dynamic>;
      var gw = Gw({...routes('submit_approval'), '/eap/eap110A06': (_) => throw const SocketException('x')});
      await expectLater(run(gw, 'submit_approval', args),
          throwsA(isA<McpToolError>().having((e) => e.message, 'm', allOf(contains('상신됐을 수 있음'), contains('sent'), isNot(contains('삭제 필요'))))));
      gw = Gw({...routes('submit_approval'), '/system/apiUtilEap/GetLinkKey': (_) => http.Response.bytes(utf8.encode('{"resultCode":500,"resultMsg":"연동 오류"}'), 200)});
      await expectLater(run(gw, 'submit_approval', args),
          throwsA(isA<McpToolError>().having((e) => e.message, 'm', allOf(contains('연동 오류'), contains('근태 신청 1건(appSq 35119)이 생성됨 — 아마란스 웹 근태신청에서 삭제 필요')))));
      expect(gw.calls.containsKey('/eap/eap110A06'), false);
    });

    test('응답 형식이 어긋난 예외(TypeError 등)도 근태 신청 안내를 붙인 오류로', () async {
      final gw = Gw(routes('submit_approval', a03: (d) => {...d, 'resultMap': {...d['resultMap'] as Map, 'kyuljaeResult': 'bad'}}));
      await expectLater(run(gw, 'submit_approval', captured('submit_approval')['args'] as Map<String, dynamic>),
          throwsA(isA<McpToolError>().having((e) => e.message, 'm', allOf(contains('상신 처리 중 오류'), contains('삭제 필요')))));
      expect(gw.calls.containsKey('/eap/eap110A06'), false);
    });

    test('A03 kyuljaeResult가 비면 상신 전 중단 — interlock·A06 없음, HP 신청 생성 안내', () async {
      final gw = Gw(routes('submit_approval', a03: (d) => {...d, 'resultMap': {...d['resultMap'] as Map, 'kyuljaeResult': []}}));
      await expectLater(run(gw, 'submit_approval', captured('submit_approval')['args'] as Map<String, dynamic>),
          throwsA(isA<McpToolError>().having((e) => e.message, 'm', allOf(contains('결재선이 비어'), contains('근태 신청 1건'), contains('35119')))));
      expect(flow(gw), _flow.take(3));
    });

    test('A06 응답에 docId(result)가 없으면 오류', () async {
      final gw = Gw(routes('submit_approval', a06: {'fileAttachInfo': []}));
      await expectLater(run(gw, 'submit_approval', captured('submit_approval')['args'] as Map<String, dynamic>),
          throwsA(isA<McpToolError>().having((e) => e.message, 'm', allOf(contains('docId'), contains('상신됐을 수 있음'), isNot(contains('삭제 필요'))))));
      expect(flow(gw), _flow);
    });

    test('미실측 경로(비근태·첨부)·깨진 JSON·숫자 아닌 ID는 호출 없이 거절', () async {
      final base = captured('submit_approval')['args'] as Map<String, dynamic>;
      final gw = Gw(routes('submit_approval'));
      await expectLater(run(gw, 'submit_approval', {...base, 'hp_application_json': ''}), err('근태'));
      await expectLater(run(gw, 'submit_approval', {...base, 'attachments': ['/tmp/a.pdf']}), err('첨부'));
      await expectLater(run(gw, 'submit_approval', {...base, 'hp_application_json': '{"applicationList":'}), err('hp_application_json'));
      await expectLater(run(gw, 'submit_approval', {...base, 'hp_application_json': '{"applicationList":[],"employeeList":[]}'}), err('applicationList'));
      await expectLater(run(gw, 'submit_approval', {...base, 'line_id': 'abc'}), err('line_id'));
      await expectLater(run(gw, 'submit_approval', {...base, 'form_id': '4 1'}), err('form_id'));
      expect(flow(gw), isEmpty);
    });
  });

  group('cancel_approval', () {
    /// A98은 부를 때마다 차례로(sts 목록). readFail이면 두 번째 A98이 연결 실패.
    Map<String, Object? Function(Map<String, dynamic>)> routes(String label, {List<String>? sts, bool readFail = false, int a18 = 1, String? owner}) {
      var n = 0;
      return {
        '/eap/eap110A98': (_) {
          final i = n++;
          if (readFail && i > 0) throw const SocketException('x');
          final d = me(res(label, '/eap/eap110A98', i == 0 ? 0 : 1)) as Map;
          return {...d, if (sts != null) 'doc_sts': sts[i < sts.length ? i : sts.length - 1], 'user_id': ?owner};
        },
        '/eap/eap110A18': (_) => {'returnValue': a18},
        '/eap/eap110A19': (_) => {'returnValue': 1},
      };
    }

    for (final (label, purge) in [('cancel_approval', true), ('cancel_approval-nopurge', false)]) {
      test('$label — 호출 순서·본문·응답이 캡처와 같다(purge=$purge)', () async {
        final gw = Gw(routes(label));
        final r = await run(gw, 'cancel_approval', captured(label)['args'] as Map<String, dynamic>);
        expect(gw.order, [for (final c in calls(label)) c['path']]);
        final want = calls(label);
        for (final (i, p) in gw.order.indexed) {
          final nth = gw.order.take(i).where((q) => q == p).length;
          expect(gw.calls[p]![nth], want[i]['body'], reason: p);
        }
        expect(r, captured(label)['toolResult']);
      });
    }

    test('doc_sts 10이면 A18 없이 purge면 A19만, purge 없으면 거절', () async {
      var gw = Gw(routes('cancel_approval', sts: ['10', '999']));
      final r = await run(gw, 'cancel_approval', {'doc_id': '152977', 'purge': true});
      expect(gw.order, ['/eap/eap110A98', '/eap/eap110A19', '/eap/eap110A98']);
      expect((r['ok'], r['preDocSts'], r['postDocSts'], (r['steps'] as List).single['api']), (true, '10', '999', 'eap110A19'));
      gw = Gw(routes('cancel_approval', sts: ['10']));
      await expectLater(run(gw, 'cancel_approval', {'doc_id': 152977}), err('임시보관'));
      expect(gw.order, ['/eap/eap110A98']);
    });

    test('doc_sts 30(결재 진행중)·999·그 밖의 상태·남의 문서·없는 문서는 실행 없이 거절', () async {
      for (final (sts, msg) in [('30', '결재 진행중'), ('999', '이미 삭제'), ('90', '취소할 수 없는'), ('', '찾지 못했')]) {
        final gw = Gw(routes('cancel_approval', sts: [sts]));
        await expectLater(run(gw, 'cancel_approval', {'doc_id': 152977, 'form_id': 41, 'purge': true}), err(msg), reason: sts);
        expect(gw.order, ['/eap/eap110A98'], reason: sts);
      }
      final other = Gw(routes('cancel_approval', owner: '2096'));
      await expectLater(run(other, 'cancel_approval', {'doc_id': 152977}), err('본인'));
      expect(other.order, ['/eap/eap110A98']);
      final none = Gw({});
      await expectLater(run(none, 'cancel_approval', {'doc_id': '15 2977'}), err('doc_id'));
      expect(none.order, isEmpty);
    });

    test('재조회 실패는 ok:true·verified false·note, 상신취소 실패(returnValue≠1)는 A19 없이 ok:false', () async {
      var gw = Gw(routes('cancel_approval', readFail: true));
      var r = await run(gw, 'cancel_approval', {'doc_id': 152977, 'purge': true});
      expect(gw.order, ['/eap/eap110A98', '/eap/eap110A18', '/eap/eap110A19', '/eap/eap110A98']);
      expect((r['ok'], r['verified_by_readback'], r['postState']), (true, false, 'readback_failed'));
      expect(r['note'], contains('다시 취소하지'));
      gw = Gw(routes('cancel_approval', sts: ['20'], a18: 0));
      r = await run(gw, 'cancel_approval', {'doc_id': 152977, 'purge': true});
      expect(gw.order, ['/eap/eap110A98', '/eap/eap110A18', '/eap/eap110A98']);
      expect((r['ok'], r['verified_by_readback'], r['postDocSts'], (r['steps'] as List).single['ok']), (false, false, '20', false));
    });
  });

  group('delete_temp_approval', () {
    http.Response sse(Map data) => http.Response.bytes(utf8.encode('data:${jsonEncode(data)}\n\ndata: complete\n\n'), 200, headers: {'content-type': 'text/event-stream'});
    Map ok(List<String> ids, {int fail = 0}) =>
        {'resultCode': 0, 'resultData': {'failCnt': fail, 'returnValue': 1, 'docInfoArr': [for (final i in ids) {'DOC_ID': i}], 'docId': ids.join(','), 'pageSize': ids.length}, 'resultMsg': '성공'};
    Map<String, Object? Function(Map<String, dynamic>)> routes({Map? sseBody, String draft = 'list_approvals-draft-after-delete'}) => {
          '/eap/sse/eap107A25': (_) => sse(sseBody ?? ok(['152980'])),
          '/eap/eap107A06': (_) => res(draft, '/eap/eap107A06'),
        };

    test('캡처 — GET /eap/sse/eap107A25?docIdList=… (본문 없음) → draft 재조회 → 응답 키', () async {
      final gw = Gw(routes());
      final r = await run(gw, 'delete_temp_approval', captured('delete_temp_approval')['args'] as Map<String, dynamic>);
      final c = calls('delete_temp_approval').single;
      expect(gw.urls, ['${c['method']} ${c['path']}', 'POST /eap/eap107A06']);
      expect(gw.raw['/eap/sse/eap107A25'], '');
      final tr = captured('delete_temp_approval')['toolResult'] as Map;
      expect((r as Map).keys.toSet(), {...tr.keys, 'ok', 'verified_by_readback'});
      for (final k in tr.keys.where((k) => k != 'note')) {
        expect(r[k], tr[k], reason: k);
      }
      expect((r['ok'], r['verified_by_readback']), (true, true));
    });

    test('여러 건은 콤마 그대로 쿼리로, 남아 있으면 ok:false', () async {
      final gw = Gw(routes(sseBody: ok(['152980', '152981']), draft: 'list_approvals-draft-after-nopurge'));
      final r = await run(gw, 'delete_temp_approval', {'doc_ids': ' 152980, 152981 '});
      expect(gw.urls.first, 'GET /eap/sse/eap107A25?docIdList=152980,152981');
      expect((r['ok'], r['verified_by_readback']), (false, false));
      expect(r['deletedDocIds'], ['152980', '152981']);
    });

    test('임시보관함이 200건 이상이라 한 쪽에 다 못 담기면 verified false·note', () async {
      final gw = Gw({...routes(), '/eap/eap107A06': (_) => {'list': {'startCount': 0, 'list': [], 'totalCount': 250}}});
      final r = await run(gw, 'delete_temp_approval', {'doc_ids': '152980'});
      expect((r['ok'], r['verified_by_readback']), (true, false));
      expect(r['note'], contains('200건'));
    });

    test('숫자 아닌 docId는 호출 없이 거절, SSE 오류 봉투는 오류', () async {
      final gw = Gw(routes());
      await expectLater(run(gw, 'delete_temp_approval', {'doc_ids': '152980,abc'}), err('doc_ids'));
      await expectLater(run(gw, 'delete_temp_approval', {'doc_ids': ''}), err('doc_ids'));
      expect(gw.order, isEmpty);
      final bad = Gw(routes(sseBody: {'resultCode': 500, 'resultMsg': '삭제 권한이 없습니다'}));
      await expectLater(run(bad, 'delete_temp_approval', {'doc_ids': 1}), err('삭제 권한'));
      expect(bad.order, ['/eap/sse/eap107A25']);
    });
  });
}
