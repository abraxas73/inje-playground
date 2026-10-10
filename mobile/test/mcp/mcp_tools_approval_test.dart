// mobile/test/mcp/mcp_tools_approval_test.dart — Task 10·11: list_approvals(8개 함)·결재 첨부·개인결재라인·게시판 첨부(캡처 요청 본문·순서·응답 키).
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:playground/gw/gw_models.dart' as m;
import 'package:playground/mcp/approval_schemas.dart';
import 'package:playground/mcp/mcp_tools.dart';
import 'package:playground/mcp/mcp_worker.dart';
import 'mcp_tools_test.dart' show Gw, cap, expected, hasKeys;

const _fx = 'test/mcp/fixtures/captured';
Map captured(String label) => jsonDecode(File('$_fx/$label.json').readAsStringSync()) as Map;
Map call0(String label, String path) => (captured(label)['calls'] as List).firstWhere((c) => c['path'] == path) as Map;
Map body(String label, String path) => call0(label, path)['body'] as Map;
Map<String, String> form(String raw) => Uri.splitQueryString(raw);

/// 캡처의 본인 empSeq(3060)를 테스트 계정(7)으로.
dynamic me(dynamic v) => jsonDecode(jsonEncode(v).replaceAll('"3060"', '"7"'));

/// 가림 값('x')은 자리(문자열)만, 나머지는 값까지 같다.
void sameShape(Object? got, Object? want, [String at = r'$']) {
  if (want == 'x') {
    expect(got, isA<String>(), reason: at);
  } else if (want is Map) {
    expect(got, isA<Map>(), reason: at);
    expect((got as Map).keys.toSet(), want.keys.toSet(), reason: at);
    for (final k in want.keys) {
      sameShape(got[k], want[k], '$at.$k');
    }
  } else if (want is List) {
    expect(got, isA<List>(), reason: at);
    expect((got as List).length, want.length, reason: at);
    for (var i = 0; i < want.length; i++) {
      sameShape(got[i], want[i], '$at[$i]');
    }
  } else {
    expect(got, want, reason: at);
  }
}

/// ecm form 요청 = 복원된 캡처 body(키 순서까지, authKeyMap은 풀어서 키 순서·sameShape).
void sameForm(String raw, String label, String path) {
  final got = form(raw), want = body(label, path);
  expect(got.keys.toList(), want.keys.toList(), reason: 'form 키 순서');
  final key = jsonDecode(got['authKeyMap']!) as Map, wantKey = want['authKeyMap'] as Map;
  expect(key.keys.toList(), wantKey.keys.toList(), reason: 'authKeyMap 키 순서');
  sameShape(key, wantKey, r'$.authKeyMap');
  sameShape(Map.of(got)..remove('authKeyMap'), Map.of(want)..remove('authKeyMap'));
}

http.Response file(List<int> bytes, {String cd = ''}) =>
    http.Response.bytes(bytes, 200, headers: {'content-type': 'application/octet-stream', if (cd.isNotEmpty) 'content-disposition': cd});

void main() {
  late Directory dir, downloads;
  setUp(() {
    dir = Directory.systemTemp.createTempSync('mcp_approval_test');
    downloads = Directory('${dir.path}/Downloads')..createSync();
  });
  tearDown(() => dir.deleteSync(recursive: true));
  Future<dynamic> run(Gw gw, String tool, Map<String, dynamic> args) async => jsonDecode(await McpTools(
        gw: gw.api(),
        appSupportDir: () => dir.path,
        downloadsDir: () => downloads.path,
        schemas: ApprovalSchemas(loader: (p) => File(p).readAsString()),
      ).execute(tool, args));
  Matcher err(String part) => throwsA(isA<McpToolError>().having((e) => e.message, 'm', contains(part)));
  List<String> gwOrder(Gw gw) => gw.order.where((p) => p != '/gw/gw050A02').toList();

  group('list_approvals', () {
    const boxes = ['sent', 'draft', 'pending', 'approved', 'approved_ongoing', 'approved_done', 'reference', 'enforcement'];
    for (final box in boxes) {
      test('$box — 캡처 본문(기간 제외)·응답 키·값', () async {
        final label = 'list_approvals-$box';
        final call = call0(label, (captured(label)['calls'] as List).single['path'] as String);
        final path = call['path'] as String;
        final gw = Gw({path: (_) => call['response']['resultData']});
        final r = await run(gw, 'list_approvals', {'box_name': box, 'page_size': 3});
        expect(gwOrder(gw), [path]);
        final got = gw.calls[path]!.single, want = call['body'] as Map;
        expect(got.keys.toSet(), want.keys.toSet());
        for (final k in want.keys.where((k) => k != 'sfrDt' && k != 'stoDt')) {
          expect(got[k], want[k], reason: k);
        }
        // 기본 기간: 오늘(KST) ~ 3개월 전 같은 날(그 달에 없으면 말일) — 캡처는 20261010 → 20260710
        final today = m.kstNow(), to8 = got['stoDt'] as String, from8 = got['sfrDt'] as String;
        expect(to8, m.ymd(today));
        final fy = int.parse(from8.substring(0, 4)), fm = int.parse(from8.substring(4, 6)), fd = int.parse(from8.substring(6));
        expect((today.year * 12 + today.month) - (fy * 12 + fm), 3);
        expect(fd, today.day < DateTime.utc(fy, fm + 1, 0).day ? today.day : DateTime.utc(fy, fm + 1, 0).day);

        final tr = captured(label)['toolResult'] as Map;
        expect(r.keys.toSet(), tr.keys.toSet());
        expect((r['box'], r['totalCount']), (tr['box'], tr['totalCount']));
        final docs = r['documents'] as List, wantDocs = tr['documents'] as List;
        expect(docs.length, wantDocs.length);
        for (final (i, d) in docs.indexed) {
          final w = wantDocs[i] as Map;
          expect((d as Map).keys.toSet(), w.keys.toSet());
          for (final k in ['docId', 'docNo', 'formId', 'repDt', 'endDt', 'arrivedDt', 'commentCount', 'fileCount', 'readYn']) {
            expect(d[k], w[k], reason: '$box[$i].$k');
          }
          // toolResult의 currentApprover는 이름·직책·직급이 모두 가려져('x x/x') 형태만 남는다 — 형태는 그것과, 값은 응답 행(직책·직급은 안 가려짐)에서 만든 것과 비교
          final shape = RegExp(r'^\S+ \S+/\S+$');
          expect(w['currentApprover'], matches(shape), reason: '$box[$i] 캡처 형태');
          expect(d['currentApprover'], matches(shape), reason: '$box[$i] 결과 형태');
          final row = (((call['response']['resultData'] as Map).values.first as Map)['list'] as List)[i] as Map;
          expect(d['currentApprover'], '${row['LINE_USER_NM']} ${row['LINE_USER_DUTY']}/${row['LINE_USER_GRADE']}', reason: '$box[$i].currentApprover');
        }
      });
    }

    test('응답 키는 expected 픽스처(sent_3·pending_2·draft_3)와 같다', () async {
      for (final (box, name) in [('sent', 'sent_3'), ('pending', 'pending_2'), ('draft', 'draft_3')]) {
        final call = (captured('list_approvals-$box')['calls'] as List).single as Map;
        final r = await run(Gw({call['path'] as String: (_) => call['response']['resultData']}), 'list_approvals', {'box_name': box, 'page_size': 3});
        final want = expected('list_approvals-$name') as Map;
        expect(r.keys.toSet(), want.keys.toSet());
        if ((want['documents'] as List).isNotEmpty) expect(((r['documents'] as List).first as Map).keys.toSet(), ((want['documents'] as List).first as Map).keys.toSet());
      }
    });

    test('sent-range(from·to)·sent-30(page_size 문자열) — 캡처 본문 그대로', () async {
      final range = call0('list_approvals-sent-range', '/eap/eap107A04');
      var gw = Gw({'/eap/eap107A04': (_) => range['response']['resultData']});
      await run(gw, 'list_approvals', {'box_name': 'sent', 'page_size': '5', 'from': '2026-01-01', 'to': '2026-10-10'});
      expect(gw.calls['/eap/eap107A04']!.single, range['body']);
      final s30 = call0('list_approvals-sent-30', '/eap/eap107A04');
      gw = Gw({'/eap/eap107A04': (_) => s30['response']['resultData']});
      await run(gw, 'list_approvals', {'box_name': 'sent', 'page_size': 30, 'from': '20260710', 'to': '20261010'});
      expect(gw.calls['/eap/eap107A04']!.single, s30['body']);
    });

    test('기본 함은 pending, 모르는 함·뒤집힌 기간은 호출 없이 거절', () async {
      final gw = Gw({'/eap/eap105A04': (_) => cap('list_approvals-pending', '/eap/eap105A04')});
      expect((await run(gw, 'list_approvals', {}))['box'], 'pending');
      expect(gw.calls['/eap/eap105A04']!.single['menuNo'], '1001000');
      expect(gw.calls['/eap/eap105A04']!.single['pageSize'], '30');
      final none = Gw({});
      await expectLater(run(none, 'list_approvals', {'box_name': 'inbox'}), err('box_name'));
      await expectLater(run(none, 'list_approvals', {'box_name': 'sent', 'from': '20261010', 'to': '20261001'}), err('앞설 수 없'));
      expect(none.calls, isEmpty);
    });
  });

  group('결재 첨부', () {
    test('list_approval_attachments — eap111A04(캡처 본문) → files[]', () async {
      final gw = Gw({'/eap/eap111A04': (_) => cap('list_approval_attachments', '/eap/eap111A04')});
      final args = captured('list_approval_attachments')['args'] as Map<String, dynamic>;
      final r = await run(gw, 'list_approval_attachments', args);
      expect(gw.calls['/eap/eap111A04']!.single, body('list_approval_attachments', '/eap/eap111A04'));
      expect(r, captured('list_approval_attachments')['toolResult']);
    });

    test('fileList가 없으면(임시보관 등 미실측) 거절', () async {
      final d = Map.of(cap('list_approval_attachments', '/eap/eap111A04') as Map)..remove('fileList');
      await expectLater(run(Gw({'/eap/eap111A04': (_) => d}), 'list_approval_attachments', {'doc_id': 1, 'form_id': 2}), err('첨부 목록'));
    });

    test('download_approval_attachment — ecm001A03(BOARD·fileIds 1건) → Downloads 저장, 서버 파일명', () async {
      final bytes = List<int>.generate(300, (i) => i % 256);
      final gw = Gw({'/ecm/ecm001A03': (_) => file(bytes, cd: "attachment; filename=\"a.png\"; filename*=UTF-8''%EC%B2%A8%EB%B6%80%20%EC%82%AC%EC%A7%84.png")});
      final c = captured('download_approval_attachment');
      final id = (c['args'] as Map)['file_id'] as String, out = '${downloads.path}/approval.png';
      final r = await run(gw, 'download_approval_attachment', {'file_id': id, 'out_path': out});
      expect(gwOrder(gw), ['/ecm/ecm001A03']);
      final raw = gw.raw['/ecm/ecm001A03']!;
      sameForm(raw, 'download_approval_attachment', '/ecm/ecm001A03');
      expect(jsonDecode(form(raw)['authKeyMap']!), {'fileIds': id}, reason: '가린 fileIds 자리에 인자 그대로');
      // 보조: 캡처 content-length와 같은 길이(같은 file_id)
      expect(raw.length, int.parse((c['calls'] as List).single['headers']['content-length'] as String));
      expect(r.keys.toSet(), (c['toolResult'] as Map).keys.toSet());
      expect((r['ok'], r['bytes'], r['path'], r['serverFileName']), (true, 300, out, '첨부 사진.png'));
      expect(File(out).readAsBytesSync(), bytes);
    });

    test('file_id에 콤마(여러 건)는 호출 없이 거절', () async {
      final gw = Gw({});
      await expectLater(run(gw, 'download_approval_attachment', {'file_id': 'a,b', 'out_path': '${downloads.path}/x.zip'}), err('1건만'));
      expect(gw.order, isEmpty);
    });
  });

  group('개인결재라인', () {
    test('list_approval_lines — eap102A02 {} → lines[](_row 원본)', () async {
      final gw = Gw({'/eap/eap102A02': (_) => cap('list_approval_lines-2b', '/eap/eap102A02')});
      final r = await run(gw, 'list_approval_lines', {});
      expect(gw.calls['/eap/eap102A02']!.single, body('list_approval_lines-2b', '/eap/eap102A02'));
      expect(r, captured('list_approval_lines-2b')['toolResult']);
      final empty = await run(Gw({'/eap/eap102A02': (_) => cap('list_approval_lines', '/eap/eap102A02')}), 'list_approval_lines', {});
      expect(empty, expected('list_approval_lines'));
    });

    test('read_approval_line — eap102A05(lineId·line_id) → members', () async {
      final gw = Gw({'/eap/eap102A05': (_) => cap('read_approval_line', '/eap/eap102A05')});
      final r = await run(gw, 'read_approval_line', {'line_id': 2470});
      expect(gw.calls['/eap/eap102A05']!.single, body('read_approval_line', '/eap/eap102A05'));
      hasKeys(r, captured('read_approval_line')['toolResult']);
      expect((r['count'], r['lineId'], r['kind']), (0, '2470', 'approvalLineMembers'));
      expect(r['members'], isEmpty);
      await expectLater(run(Gw({}), 'read_approval_line', {'line_id': '24,70'}), err('line_id'));
    });

    /// A02는 부를 때마다 lists를 차례로(마지막은 반복). fail은 그 차례(0부터)에서 연결 실패, expire는 401.
    Map<String, Object? Function(Map<String, dynamic>)> saveRoutes({List<String> lists = const ['list_approval_lines-after-save'], int? fail, int? expire}) {
      var n = 0;
      return {
        '/eap/eap102A10': (_) => cap('save_approval_line', '/eap/eap102A10'),
        '/eap/eap102A09': (_) => cap('delete_approval_line', '/eap/eap102A09'),
        '/eap/eap102A02': (_) {
          final i = n++;
          if (i == fail) throw const SocketException('x');
          if (i == expire) return http.Response('', 401);
          return cap(lists[i < lists.length ? i : lists.length - 1], '/eap/eap102A02');
        },
      };
    }

    test('save_approval_line — eap102A10(순서 필드 주입, 캡처 본문) → eap102A02 재조회', () async {
      final gw = Gw(saveRoutes());
      final r = await run(gw, 'save_approval_line', captured('save_approval_line')['args'] as Map<String, dynamic>);
      expect(gwOrder(gw), ['/eap/eap102A10', '/eap/eap102A02']);
      sameShape(me(gw.calls['/eap/eap102A10']!.single), me(body('save_approval_line', '/eap/eap102A10')));
      hasKeys(r, captured('save_approval_line')['toolResult']);
      expect((r['createdLineId'], r['insertDResult'], r['insertFormResult'], r['kind']), (2470, 1, 1, 'approvalLineSaved'));
      expect((r['ok'], r['verified_by_readback']), (true, true));
    });

    test('save — 결재자 여럿은 배열 순서대로 1·2·3, proc_id 지정은 그대로', () async {
      final gw = Gw(saveRoutes());
      await run(gw, 'save_approval_line', {
        'line_nm': 'x', 'form_id': '41', 'proc_id': 2000,
        'detail_line_json': jsonEncode([{'user_id': '31', 'act_id': '3000'}, {'user_id': '41', 'act_id': '4000'}, {'user_id': '51', 'act_id': 3000}]),
      });
      final b = gw.calls['/eap/eap102A10']!.single;
      expect((b['form_id'], b['proc_id'], b['line_id']), (41, '2000', 0));
      expect(b['formList'], [41]);
      expect([for (final d in b['detailLine'] as List) (d['user_id'], d['doc_line_seq'], d['doc_line_m_seq'], d['line_seq'])], [('31', 1, 1, 1), ('41', 2, 2, 2), ('51', 3, 3, 3)]);
    });

    test('save — 재조회 실패는 ok:true·verified false·note, 목록에 없으면 ok:false', () async {
      final args = captured('save_approval_line')['args'] as Map<String, dynamic>;
      var r = await run(Gw(saveRoutes(fail: 0)), 'save_approval_line', args);
      expect((r['ok'], r['verified_by_readback']), (true, false));
      expect(r['note'], contains('재조회'));
      r = await run(Gw(saveRoutes(lists: ['list_approval_lines-after-delete'])), 'save_approval_line', args);
      expect((r['ok'], r['verified_by_readback']), (false, false));
    });

    test('save·delete — 쓰기 뒤 재조회가 401(세션 만료)이면 던지지 않고 ok:true·verified false·만료 안내', () async {
      var gw = Gw(saveRoutes(expire: 0));
      var r = await run(gw, 'save_approval_line', captured('save_approval_line')['args'] as Map<String, dynamic>);
      expect(gwOrder(gw), ['/eap/eap102A10', '/eap/eap102A02']);
      expect((r['ok'], r['verified_by_readback']), (true, false));
      expect(r['note'], allOf(contains('만료'), contains('다시 저장하지')));
      gw = Gw(saveRoutes(expire: 1));
      r = await run(gw, 'delete_approval_line', captured('delete_approval_line')['args'] as Map<String, dynamic>);
      expect(gwOrder(gw), ['/eap/eap102A02', '/eap/eap102A09', '/eap/eap102A02']);
      expect((r['ok'], r['verified_by_readback']), (true, false));
      expect(r['note'], allOf(contains('만료'), contains('다시 삭제하지')));
      // 쓰기 전 401(삭제 전 목록 조회)은 그대로 오류
      gw = Gw(saveRoutes(expire: 0));
      await expectLater(run(gw, 'delete_approval_line', captured('delete_approval_line')['args'] as Map<String, dynamic>), throwsA(isA<McpToolError>()));
      expect(gw.calls.containsKey('/eap/eap102A09'), false);
    });

    test('save — 기존 라인 수정(line_id≠0)·깨진 JSON·act_id 없음은 A10 없이 거절', () async {
      final gw = Gw(saveRoutes());
      final ok = jsonEncode([{'user_id': '31', 'act_id': '3000'}]);
      await expectLater(run(gw, 'save_approval_line', {'line_nm': 'a', 'form_id': 41, 'line_id': 2470, 'detail_line_json': ok}), err('기존 라인 수정'));
      await expectLater(run(gw, 'save_approval_line', {'line_nm': 'a', 'form_id': 41, 'detail_line_json': '[{'}), err('JSON 배열'));
      await expectLater(run(gw, 'save_approval_line', {'line_nm': 'a', 'form_id': 41, 'detail_line_json': '[]'}), err('하나 이상'));
      await expectLater(run(gw, 'save_approval_line', {'line_nm': 'a', 'form_id': 41, 'detail_line_json': jsonEncode([{'user_id': '31'}])}), err('act_id'));
      await expectLater(run(gw, 'save_approval_line', {'line_nm': 'a', 'form_id': '외근', 'detail_line_json': ok}), err('form_id'));
      expect(gw.calls.containsKey('/eap/eap102A10'), false);
    });

    const afterDelete = ['list_approval_lines-after-save', 'list_approval_lines-after-delete'];
    test('delete_approval_line — A02(내 목록에서 행 찾기) → A09(lineIdList:[서버 행]) → A02 재조회', () async {
      final gw = Gw(saveRoutes(lists: afterDelete));
      final r = await run(gw, 'delete_approval_line', captured('delete_approval_line')['args'] as Map<String, dynamic>);
      expect(gwOrder(gw), ['/eap/eap102A02', '/eap/eap102A09', '/eap/eap102A02']);
      sameShape(gw.calls['/eap/eap102A09']!.single, body('delete_approval_line', '/eap/eap102A09'));
      expect(gw.calls['/eap/eap102A09']!.single, {'lineIdList': cap('list_approval_lines-after-save', '/eap/eap102A02')});
      hasKeys(r, captured('delete_approval_line')['toolResult']);
      expect((r['kind'], r['ok'], r['verified_by_readback']), ('approvalLineDeleted', true, true));
      expect(r['resultCount'], {'deleteResult': 1});
    });

    test('delete — 남아 있으면 ok:false, lineId 숫자만 주면 호출 없이 거절', () async {
      final r = await run(Gw(saveRoutes()), 'delete_approval_line', captured('delete_approval_line')['args'] as Map<String, dynamic>);
      expect((r['ok'], r['verified_by_readback']), (false, false));
      final gw = Gw(saveRoutes(lists: afterDelete));
      await expectLater(run(gw, 'delete_approval_line', {'row_json': '2470'}), err('_row'));
      await expectLater(run(gw, 'delete_approval_line', {'row_json': '{"line_nm":"a"}'}), err('_row'));
      expect(gw.order, isEmpty);
    });

    test('delete — row_json의 다른 키(조작)는 요청에 실리지 않고 서버 행만 간다, 내 목록에 없는 line_id는 A09 없이 거절', () async {
      var gw = Gw(saveRoutes(lists: afterDelete));
      await run(gw, 'delete_approval_line', {'row_json': jsonEncode({'line_id': 2470, 'user_nm': '조작', 'emp_seq': '99', 'form_id': 99})});
      final sent = (gw.calls['/eap/eap102A09']!.single['lineIdList'] as List).single as Map;
      expect(sent.containsKey('user_nm'), false);
      expect(sent.containsKey('emp_seq'), false);
      expect(sent['form_id'], 41);
      expect(sent, (cap('list_approval_lines-after-save', '/eap/eap102A02') as List).single);
      gw = Gw(saveRoutes(lists: afterDelete));
      await expectLater(run(gw, 'delete_approval_line', {'row_json': jsonEncode({'line_id': 9999})}), err('내 결재선 목록에 없는'));
      expect(gwOrder(gw), ['/eap/eap102A02']);
    });
  });

  group('숫자 인자 검증(호출 전 거절)', () {
    test('doc_id·form_id·art_seq_no·page·page_size가 숫자가 아니면 거절, 호출 없음', () async {
      final gw = Gw({});
      await expectLater(run(gw, 'list_approval_attachments', {'doc_id': 'abc', 'form_id': 144}), err('doc_id'));
      await expectLater(run(gw, 'list_approval_attachments', {'doc_id': 141373, 'form_id': '1 4'}), err('form_id'));
      await expectLater(run(gw, 'list_notice_attachments', {'art_seq_no': '3068;', 'uid': 'u'}), err('art_seq_no'));
      await expectLater(run(gw, 'download_notice_attachment', {'art_seq_no': 'x', 'uid': 'u', 'out_path': '${downloads.path}/n'}), err('art_seq_no'));
      await expectLater(run(gw, 'list_approvals', {'box_name': 'sent', 'page': 'abc'}), err('page'));
      await expectLater(run(gw, 'list_approvals', {'box_name': 'sent', 'page_size': '3x'}), err('page_size'));
      expect(gw.order, isEmpty);
    });
  });

  group('게시판 첨부', () {
    test('list_notice_attachments — ecm001A04(BOARD·authKeyMap) → files[](fileSn 0-base)', () async {
      final gw = Gw({'/ecm/ecm001A04': (_) => cap('list_notice_attachments', '/ecm/ecm001A04')});
      final c = captured('list_notice_attachments'), args = c['args'] as Map<String, dynamic>;
      final r = await run(gw, 'list_notice_attachments', args);
      final raw = gw.raw['/ecm/ecm001A04']!;
      sameForm(raw, 'list_notice_attachments', '/ecm/ecm001A04');
      final key = jsonDecode(form(raw)['authKeyMap']!) as Map;
      expect((key['empSeq'], key['fileIds']), ('7', args['uid']), reason: '가린 자리: 본인 empSeq·인자 uid');
      expect(r, c['toolResult']);
    });

    test('download_notice_attachment — ecm001A03(같은 authKeyMap·fileSn) → 저장', () async {
      final bytes = utf8.encode('%PDF-1.4 notice');
      final gw = Gw({'/ecm/ecm001A03': (_) => file(bytes, cd: 'attachment; filename="notice.pdf"')});
      final c = captured('download_notice_attachment'), args = Map<String, dynamic>.of(c['args'] as Map<String, dynamic>);
      final out = '${downloads.path}/notice.pdf';
      final r = await run(gw, 'download_notice_attachment', {...args, 'out_path': out});
      expect(gwOrder(gw), ['/ecm/ecm001A03']);
      final raw = gw.raw['/ecm/ecm001A03']!;
      sameForm(raw, 'download_notice_attachment', '/ecm/ecm001A03');
      final key = jsonDecode(form(raw)['authKeyMap']!) as Map;
      expect((key['empSeq'], key['fileIds']), ('7', args['uid']), reason: '가린 자리: 본인 empSeq·인자 uid');
      expect(r.keys.toSet(), (c['toolResult'] as Map).keys.toSet());
      expect((r['ok'], r['bytes'], r['serverFileName']), (true, bytes.length, 'notice.pdf'));
      expect(File(out).readAsBytesSync(), bytes);
    });

    test('file_sn 기본 0·문자열 허용, 음수는 거절', () async {
      final gw = Gw({'/ecm/ecm001A03': (_) => file([1, 2])});
      final r = await run(gw, 'download_notice_attachment', {'art_seq_no': 3068, 'uid': 'u1,u2', 'file_sn': '1', 'out_path': '${downloads.path}/n.bin'});
      expect(form(gw.raw['/ecm/ecm001A03']!)['fileSn'], '1');
      expect(r['serverFileName'], '');
      await run(gw, 'download_notice_attachment', {'art_seq_no': 3068, 'uid': 'u1', 'out_path': '${downloads.path}/n.bin'});
      expect(form(gw.raw['/ecm/ecm001A03']!)['fileSn'], '0');
      await expectLater(run(gw, 'download_notice_attachment', {'art_seq_no': 3068, 'uid': 'u1', 'file_sn': -1, 'out_path': '${downloads.path}/n.bin'}), err('file_sn'));
    });
  });
}
