// mobile/test/mcp/mcp_tools_mail_test.dart — Task 9: mark_mail_unread·delete_mail·send_mail_from_draft·첨부 업로드·다운로드(캡처 요청 순서·본문·응답 키).
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:playground/mcp/approval_schemas.dart';
import 'package:playground/mcp/mcp_tools.dart';
import 'package:playground/mcp/mcp_worker.dart';
import 'mcp_tools_test.dart' show Gw, org, cap, hasKeys;

const _fx = 'test/mcp/fixtures/captured';
Map captured(String label) => jsonDecode(File('$_fx/$label.json').readAsStringSync()) as Map;
Map body(String label, String path, [int nth = 0]) => ((captured(label)['calls'] as List).where((c) => c['path'] == path).toList()[nth] as Map)['body'] as Map;
Map<String, String> form(String raw) => Uri.splitQueryString(raw);

/// multipart 본문에서 필드 값(비ASCII 값은 http가 content-type 줄을 덧붙인다).
String? part(String raw, String name) => RegExp('name="${RegExp.escape(name)}"(?:\r\n[^\r\n]+)*\r\n\r\n(.*?)\r\n--', dotAll: true).firstMatch(raw)?.group(1);

void main() {
  late Directory dir, downloads;
  setUp(() {
    dir = Directory.systemTemp.createTempSync('mcp_mail_test');
    downloads = Directory('${dir.path}/Downloads')..createSync();
  });
  tearDown(() => dir.deleteSync(recursive: true));
  Future<dynamic> run(Gw gw, String tool, Map<String, dynamic> args) async => jsonDecode(await McpTools(
        gw: gw.api(),
        appSupportDir: () => dir.path,
        downloadsDir: () => downloads.path,
        schemas: ApprovalSchemas(loader: (p) => File(p).readAsString()),
      ).execute(tool, args));

  Map boxes() {
    final b = cap('list_mailboxes', '/mail/mail000A01') as Map;
    final list = (b['mailboxList'] as List).cast<Map>();
    list[0] = {...list[0], 'name': 'INBOX', 'fullname': 'INBOX'};
    list[2] = {...list[2], 'name': 'DRAFTS', 'fullname': 'DRAFTS'};
    return b;
  }

  group('mark_mail_unread', () {
    Map<String, Object? Function(Map<String, dynamic>)> routes({int? seenBefore = 1, int seenAfter = 0}) {
      var n = 0;
      final list = cap('mark_mail_unread', '/mail/mail003A01') as Map;
      Map withSeen(int? s) => {...list, 'Records': [for (final r in list['Records'] as List) r['muid'] == 14874418 ? ({...r, 'seen': s}..removeWhere((k, v) => k == 'seen' && v == null)) : r]};
      return {
        ...org(),
        '/mail/mail000A01': (_) => boxes(),
        '/mail/mail003A01': (_) => withSeen(n++ == 0 ? seenBefore : seenAfter),
        '/mail/mail002A15': (_) => cap('mark_mail_unread', '/mail/mail002A15'),
      };
    }

    test('000A01 → 003A01(200건) → 002A15 → 003A01 재조회, 응답 키', () async {
      final gw = Gw(routes());
      final r = await run(gw, 'mark_mail_unread', {'muid': 14874418});
      expect(gw.order, ['/mail/mail000A01', '/mail/mail003A01', '/mail/mail002A15', '/mail/mail003A01']);
      expect(gw.calls['/mail/mail002A15']!.single, body('mark_mail_unread', '/mail/mail002A15'));
      final list = gw.calls['/mail/mail003A01']!;
      expect((list.first['pageSize'], list.first['mboxSeq'], list.first['boxName'], list.last['pageSize']), (200, 25492, 'INBOX', 200));
      hasKeys(r, captured('mark_mail_unread')['toolResult']);
      expect((r['ok'], r['already'], r['verifiedByReadback'], r['muid']), (true, false, true, '14874418'));
    });

    test('이미 미읽음이면 보내지 않음 · 반영 안 되면 verifiedByReadback false · 200건 밖은 거절', () async {
      final gw = Gw(routes(seenBefore: 0));
      final r = await run(gw, 'mark_mail_unread', {'muid': '14874418'});
      expect((r['already'], r['ok']), (true, true));
      expect(gw.calls.containsKey('/mail/mail002A15'), false);
      final stale = await run(Gw(routes(seenAfter: 1)), 'mark_mail_unread', {'muid': '14874418'});
      expect((stale['ok'], stale['verifiedByReadback']), (true, false));
      await expectLater(run(Gw(routes()), 'mark_mail_unread', {'muid': '1'}), throwsA(isA<McpToolError>().having((e) => e.message, 'm', contains('200'))));
    });

    test('목록 행에 seen이 없으면 already로 보고하지 않고 오류 · 숫자 아닌 muid는 호출 없이 거절', () async {
      final gw = Gw(routes(seenBefore: null));
      await expectLater(run(gw, 'mark_mail_unread', {'muid': '14874418'}), throwsA(isA<McpToolError>().having((e) => e.message, 'm', contains('읽음 상태'))));
      expect(gw.calls.containsKey('/mail/mail002A15'), false);
      final bad = Gw(routes());
      await expectLater(run(bad, 'mark_mail_unread', {'muid': '1:*'}), throwsA(isA<McpToolError>()));
      expect(bad.order, isEmpty);
    });
  });

  test('delete_mail — mail002A05 본문·응답 키', () async {
    final gw = Gw({...org(), '/mail/mail002A05': (_) => cap('delete_mail-inbox', '/mail/mail002A05')});
    final r = await run(gw, 'delete_mail', {'uids': '14874418, 14874424'});
    expect(gw.calls['/mail/mail002A05']!.single, {...body('delete_mail-inbox', '/mail/mail002A05'), 'boxName': '', 'uids': '14874418,14874424'});
    hasKeys(r, captured('delete_mail-inbox')['toolResult']);
    expect((r['ok'], r['deleted'], r['uids']), (true, true, '14874418,14874424'));
    expect(r['note'], captured('delete_mail-inbox')['toolResult']['note']);
  });

  test('delete_mail — 숫자가 아닌 uids("1:*"·"*"·"12,abc")는 서버 호출 없이 거절', () async {
    for (final bad in ['1:*', '*', '12,abc']) {
      final gw = Gw({...org(), '/mail/mail002A05': (_) => {'code': '0'}});
      await expectLater(run(gw, 'delete_mail', {'uids': bad}), throwsA(isA<McpToolError>().having((e) => e.message, 'm', contains('숫자'))), reason: bad);
      expect(gw.order, isEmpty, reason: bad);
    }
  });

  group('첨부 업로드(save_mail_draft·send_mail)', () {
    Map<String, Object? Function(Map<String, dynamic>)> routes() => {
          ...org(),
          '/mail/mail000A01': (_) => boxes(),
          '/mail/mail003A01': (_) => {'Records': [{'muid': 14874412}]},
          '/mail/mail014A01': (_) => cap('save_mail_draft-attach', '/mail/mail014A01'),
          '/mail/mail014A06': (_) => cap('save_mail_draft-attach', '/mail/mail014A06'),
          '/mail/mail014A14': (_) => cap('save_mail_draft-attach', '/mail/mail014A14'),
          '/mail/mail014A04': (_) => {'result': true},
        };

    test('save_mail_draft — A01 → A06(file[]) → A14(uidAuthList·bigFileCnt) → 재조회', () async {
      final f = File('${downloads.path}/attach-test.txt')..writeAsStringSync('MCP 캡처 테스트 첨부');
      final gw = Gw(routes());
      final r = await run(gw, 'save_mail_draft', {'to': 'user@example.com', 'subject': 's', 'html': '<p>b</p>', 'attachments': [f.path]});
      expect(gw.order.where((p) => p.startsWith('/mail')), ['/mail/mail014A01', '/mail/mail014A06', '/mail/mail014A14', '/mail/mail000A01', '/mail/mail003A01']);
      final up = gw.raw['/mail/mail014A06']!;
      expect(up, contains('name="file[]"; filename="attach-test.txt"'));
      expect(up, contains('content-type: application/octet-stream'));
      expect(up, contains('MCP 캡처 테스트 첨부'));
      final a14 = gw.raw['/mail/mail014A14']!;
      expect(part(a14, 'bigFileCnt'), '1');
      final auth = jsonDecode(part(a14, 'uidAuthList')!) as List;
      final fid = (cap('save_mail_draft-attach', '/mail/mail014A06') as Map)['list'][0]['fileId'];
      expect(auth.single, {
        'fileClass': 'icon_txt', 'fileDeleteYN': 'Y', 'fileExtsn': 'txt', 'fileId': fid, 'fileName': 'x', 'filePath': 'attach-test.txt', 'filePublicYn': 'N', 'fileSize': '28 Bytes',
        'fileThumUrl': '', 'fileUrl': '', 'id': 0, 'link': 'N', 'modifyLocalAttach': 'N', 'moduleGbn': 'MAIL', 'noConvertFileSize': 28, 'title': 'x28 Bytes',
      });
      expect(jsonEncode(auth.single).startsWith('{"fileClass":"icon_txt","fileDeleteYN":"Y","fileExtsn":"txt","fileId":'), true, reason: '키 순서·공백 없음은 캡처 그대로');
      hasKeys(r, captured('save_mail_draft-attach')['toolResult']);
      expect((r['ok'], r['sent'], r['attachments'], r['draft_muid'], r['verified_by_readback']), (true, false, 1, '14874412', true));
      expect(r['mail_key'], captured('save_mail_draft-attach')['toolResult']['mail_key'], reason: 'A01 작성 폼 mailkey');
    });

    test('첨부가 Downloads 밖이면 읽지 않고 거절, 업로드 호출 없음', () async {
      final f = File('${dir.path}/outside.txt')..writeAsStringSync('x');
      final gw = Gw(routes());
      await expectLater(run(gw, 'save_mail_draft', {'subject': 's', 'attachments': [f.path]}),
          throwsA(isA<McpToolError>().having((e) => e.message, 'm', allOf(contains('outside.txt'), contains('Downloads')))));
      await expectLater(run(gw, 'save_mail_draft', {'subject': 's', 'attachments': ['${downloads.path}/../outside.txt']}), throwsA(isA<McpToolError>()));
      expect(gw.calls.containsKey('/mail/mail014A06'), false);
      expect(gw.calls.containsKey('/mail/mail014A14'), false);
    });

    test('첨부 2개에 업로드 응답 1건이면 A14를 부르지 않음', () async {
      final f1 = File('${downloads.path}/a.txt')..writeAsStringSync('a'), f2 = File('${downloads.path}/b.txt')..writeAsStringSync('b');
      final gw = Gw(routes());
      await expectLater(run(gw, 'save_mail_draft', {'subject': 's', 'attachments': [f1.path, f2.path]}), throwsA(isA<McpToolError>().having((e) => e.message, 'm', contains('업로드'))));
      expect(gw.calls.containsKey('/mail/mail014A06'), true);
      expect(gw.calls.containsKey('/mail/mail014A14'), false);
    });

    test('send_mail + 첨부는 미실측이라 거절(초안 → send_mail_from_draft 안내), 서버 호출 없음 · 없는 파일은 Downloads 안내', () async {
      final f = File('${downloads.path}/a.pdf')..writeAsBytesSync([1, 2, 3]);
      final gw = Gw(routes());
      await expectLater(run(gw, 'send_mail', {'subject': 's', 'to': 'a@x.com', 'attachments': [f.path]}),
          throwsA(isA<McpToolError>().having((e) => e.message, 'm', '첨부가 있는 메일은 save_mail_draft로 초안을 만든 뒤 send_mail_from_draft로 보내세요.')));
      expect(gw.order, isEmpty);
      final miss = Gw(routes());
      await expectLater(run(miss, 'save_mail_draft', {'subject': 's', 'attachments': ['${downloads.path}/none.txt']}),
          throwsA(isA<McpToolError>().having((e) => e.message, 'm', allOf(contains('none.txt'), contains('Downloads')))));
      expect(miss.calls.containsKey('/mail/mail014A14'), false);
    });
  });

  group('send_mail_from_draft', () {
    // 정제 캡처는 calls를 3개에서 잘라 A08·A04·A07 응답이 없다 — 원본 흐름의 형상(개인정보 가림)으로 둔다
    final a08 = {
      'list': [
        {
          'filePath': '/home/upload/mail/storage//', 'fileName': 'x.txt', 'originalFileName': 'x', 'fileExtsn': 'txt', 'fileSize': '42', 'createdAt': '1791625965013', 'fileKey': null, 'fileId': 'FID',
          'muid': '14874412', 'email': 'user@example.com', 'encoding': 'base64', 'moduleGbn': 'MAIL', 'offset': '10061', 'authKeyMap': {'muid': '14874412'}, 'fileSn': '',
        },
      ],
    };
    Map<String, Object? Function(Map<String, dynamic>)> routes({Map Function(Map)? draft, bool deleteFails = false, Object? a07, bool a04Fails = false, bool a08Fails = false}) => {
          ...org(),
          '/mail/mail000A01': (_) => boxes(),
          '/mail/mail003A01': (_) => cap('send_mail_from_draft', '/mail/mail003A01'),
          '/mail/mail014A01': (_) {
            final d = cap('send_mail_from_draft', '/mail/mail014A01') as Map;
            return draft == null ? d : draft(d);
          },
          '/mail/mail014A08': (_) => a08Fails ? http.Response('{"resultCode":422,"resultMsg":"거절"}', 200) : a08,
          '/mail/mail014A04': (_) => a04Fails
              ? http.Response('{"resultCode":500,"resultMsg":"발송 실패"}', 200)
              : {'emails': 'x', 'result': true, 'muid': '14874412', 'code': '0', 'mail_kind': 'draft', 'resultMessage': 'SUCCESS'},
          '/mail/mail002A07': (_) => deleteFails ? http.Response('{"resultCode":500,"resultMsg":"실패"}', 200) : a07 ?? {'msg': 'SUCCESS', 'code': '0'},
        };

    test('목록 확인 → A01(draft) → A08 → A04(draft 승계) → A07 원본 삭제, 응답 키', () async {
      final gw = Gw(routes());
      final r = await run(gw, 'send_mail_from_draft', {'draft_muid': 14874412});
      expect(gw.order.where((p) => p.startsWith('/mail')), ['/mail/mail000A01', '/mail/mail003A01', '/mail/mail014A01', '/mail/mail014A08', '/mail/mail014A04', '/mail/mail002A07']);
      expect(gw.calls['/mail/mail014A01']!.single, body('send_mail_from_draft', '/mail/mail014A01'));
      expect((gw.calls['/mail/mail003A01']!.single['boxName'], gw.calls['/mail/mail003A01']!.single['mboxSeq']), ('INBOX', 25498), reason: '캡처: DRAFTS seq + boxName INBOX');
      final init = cap('send_mail_from_draft', '/mail/mail014A01') as Map;
      final file = (init['mailInfo']['mime']['fileList'] as List).single as Map;
      final a08 = form(gw.raw['/mail/mail014A08']!);
      expect((a08['moduleGbn'], a08['condition'], a08['fileSn']), ('MAIL', '99', file['fileSn']));
      expect(jsonDecode(a08['authKeyMap']!), {'email': 'hong@innogrid.com', 'empSeq': '7', 'muid': '14874412'});
      final a04 = gw.raw['/mail/mail014A04']!;
      expect((part(a04, 'mail_kind'), part(a04, 'muid'), part(a04, 'to'), part(a04, 'bigFileCnt'), part(a04, 'fwFile'), part(a04, 'htmlContents')),
          ('draft', '14874412', 'x <user@example.com>', '1', 'x', 'x'));
      expect(jsonDecode(part(a04, 'mimeHeader')!), init['mailInfo']['mime']['header']);
      expect(part(a04, 'mimeHeader')!.startsWith('{"cc":'), true, reason: '키 정렬');
      final auth = (jsonDecode(part(a04, 'uidAuthList')!) as List).single as Map;
      expect((auth['fileSn'], auth['fileId'], auth['fileName'], auth['serverFile'], auth['useDownView'], auth['fileSize'], auth['noConvertFileSize'], auth['offset']), (file['fileSn'], 'FID', 'x.txt', 'Y', 'N', '42 Bytes', 42, '10061'));
      expect(jsonDecode(auth['authKeyMap'] as String), {'email': 'hong@innogrid.com', 'empSeq': '7', 'muid': '14874412'});
      expect(gw.calls['/mail/mail002A07']!.single, {'beforeMUID': 14874412, 'mailKey': init['mailkey']});
      expect(init['mailkey'], endsWith('.eml'));
      hasKeys(r, captured('send_mail_from_draft')['toolResult']);
      expect((r['sent'], r['draft_deleted'], r['attachments'], r['draft_muid'], r['to'], r['cc'], r['bcc']), (true, true, 1, '14874412', 'x <user@example.com>', '', ''));
    });

    test('to 인자는 수신자만 덮어쓰기 · 원본 삭제 실패는 sent:true·draft_deleted:false', () async {
      final gw = Gw(routes(deleteFails: true));
      final r = await run(gw, 'send_mail_from_draft', {'draft_muid': '14874412', 'to': 'a@x.com'});
      expect(part(gw.raw['/mail/mail014A04']!, 'to'), 'a@x.com');
      expect((r['sent'], r['draft_deleted']), (true, false));
      expect(r['note'], contains('임시보관함'));
    });

    test('A07 응답 code가 0이 아니면 draft_deleted:false, note에 서버 msg', () async {
      final r = await run(Gw(routes(a07: {'msg': '삭제 거부', 'code': '9'})), 'send_mail_from_draft', {'draft_muid': '14874412'});
      expect((r['sent'], r['draft_deleted']), (true, false));
      expect(r['note'], contains('삭제 거부'));
    });

    test('A04 실패면 A07(원본 삭제)을 부르지 않음 · A08 실패면 A04를 부르지 않음', () async {
      final f4 = Gw(routes(a04Fails: true));
      await expectLater(run(f4, 'send_mail_from_draft', {'draft_muid': '14874412'}), throwsA(isA<McpToolError>()));
      expect(f4.calls.containsKey('/mail/mail014A04'), true);
      expect(f4.calls.containsKey('/mail/mail002A07'), false);
      final f8 = Gw(routes(a08Fails: true));
      await expectLater(run(f8, 'send_mail_from_draft', {'draft_muid': '14874412'}), throwsA(isA<McpToolError>()));
      expect(f8.calls.containsKey('/mail/mail014A04'), false);
      expect(f8.calls.containsKey('/mail/mail002A07'), false);
    });

    test('숫자가 아닌 draft_muid는 서버 호출 없이 거절', () async {
      for (final bad in ['1:*', '*', '12,abc']) {
        final gw = Gw(routes());
        await expectLater(run(gw, 'send_mail_from_draft', {'draft_muid': bad}), throwsA(isA<McpToolError>()), reason: bad);
        expect(gw.order, isEmpty, reason: bad);
      }
    });

    Map edit(Map d, void Function(Map mailInfo) f) {
      final c = jsonDecode(jsonEncode(d)) as Map;
      f(c['mailInfo'] as Map);
      return c;
    }

    for (final (why, tweak, msg) in <(String, Map Function(Map), String)>[
      ('본문 없음', (d) => edit(d, (mi) => (mi['mime']['body'] as Map).remove('html')), '본문'),
      ('파일명 콤마', (d) => edit(d, (mi) => mi['mime']['fileList'][0]['originalFileName'] = 'a,b'), '콤마'),
      ('같은 이름 첨부', (d) => edit(d, (mi) => mi['mime']['fileList'] = [mi['mime']['fileList'][0], mi['mime']['fileList'][0]]), '같은 이름'),
      ('대용량 첨부', (d) => edit(d, (mi) => mi['mime']['bigFileList'] = [{'name': 'big.zip'}]), '대용량'),
      ('참조 읽기 불가', (d) => edit(d, (mi) => (mi['mime']['header'] as Map).remove('cc')), '참조'),
    ]) {
      test('제약: $why → 보내지 않음', () async {
        final gw = Gw(routes(draft: tweak));
        await expectLater(run(gw, 'send_mail_from_draft', {'draft_muid': '14874412'}), throwsA(isA<McpToolError>().having((e) => e.message, 'm', contains(msg))));
        expect(gw.calls.containsKey('/mail/mail014A04'), false);
      });
    }

    test('제약: 최근 20건에 없는 초안 → A01도 부르지 않음', () async {
      final gw = Gw(routes());
      await expectLater(run(gw, 'send_mail_from_draft', {'draft_muid': '1'}), throwsA(isA<McpToolError>().having((e) => e.message, 'm', contains('20건'))));
      expect(gw.calls.containsKey('/mail/mail014A01'), false);
    });
  });

  group('다운로드', () {
    final pdf = List<int>.generate(300, (i) => i % 256);
    Map<String, Object? Function(Map<String, dynamic>)> routes() => {
          ...org(),
          '/mail/mail014A08': (_) => cap('download_mail_attachment', '/mail/mail014A08'),
          '/ecm/ecm001A03': (_) => http.Response.bytes(pdf, 200, headers: {'content-type': 'application/octet-stream'}),
          '/upload/img.png': (_) => http.Response.bytes([9, 9], 200, headers: {'content-type': 'image/png'}),
        };

    test('download_mail_attachment — A08(fileSn) → ecm001A03(fileId·condition 99) → 저장', () async {
      final gw = Gw(routes());
      final out = '${downloads.path}/out/a.pdf';
      final r = await run(gw, 'download_mail_attachment', {'muid': 14858746, 'file_sn': 'TOKEN+/=', 'out_path': out});
      expect(gw.order.where((p) => p != '/gw/gw050A02'), ['/mail/mail014A08', '/ecm/ecm001A03']);
      final a08 = form(gw.raw['/mail/mail014A08']!);
      expect(a08.keys.toSet(), {'moduleGbn', 'authKeyMap', 'fileSn'});
      expect((a08['moduleGbn'], a08['fileSn']), ('MAIL', 'TOKEN+/=')); expect(jsonDecode(a08['authKeyMap']!), {'email': 'hong@innogrid.com', 'empSeq': '7', 'muid': '14858746'});
      final ecm = form(gw.raw['/ecm/ecm001A03']!);
      final fid = (cap('download_mail_attachment', '/mail/mail014A08') as Map)['list'][0]['fileId'];
      expect((ecm['moduleGbn'], ecm['fileSn'], ecm['condition'], ecm['authKeyMap']), ('MAIL', fid, '99', a08['authKeyMap']));
      hasKeys(r, captured('download_mail_attachment')['toolResult']);
      expect((r['ok'], r['bytes'], r['path'], r.containsKey('savedPath')), (true, 300, out, false));
      expect(File(out).readAsBytesSync(), pdf);
    });

    test('out_path에 못 쓰면 Downloads/<이름>에 저장하고 savedPath', () async {
      final blocker = File('${downloads.path}/blocker')..writeAsStringSync('');
      final r = await run(Gw(routes()), 'download_mail_attachment', {'muid': '1', 'file_sn': 't', 'out_path': '${blocker.path}/sub/a.pdf'});
      expect((r['ok'], r['savedPath']), (true, '${downloads.path}/a.pdf'));
      expect(File('${downloads.path}/a.pdf').readAsBytesSync(), pdf);
    });

    test('out_path가 Downloads 밖이면 쓰지 않고 Downloads로, 같은 이름이 있으면 (1)·(2)', () async {
      final outside = '${dir.path}/out/a.pdf';
      File('${downloads.path}/a.pdf').writeAsStringSync('기존 파일');
      final r1 = await run(Gw(routes()), 'download_mail_attachment', {'muid': '1', 'file_sn': 't', 'out_path': outside});
      expect((r1['path'], r1['savedPath']), (outside, '${downloads.path}/a (1).pdf'));
      expect(File(outside).existsSync(), false);
      expect(File('${downloads.path}/a.pdf').readAsStringSync(), '기존 파일', reason: '덮어쓰지 않는다');
      final r2 = await run(Gw(routes()), 'download_mail_attachment', {'muid': '1', 'file_sn': 't', 'out_path': '${downloads.path}/../a.pdf'});
      expect(r2['savedPath'], '${downloads.path}/a (2).pdf');
    });

    test('파일 대신 text/html이 오면 저장하지 않고 오류', () async {
      final gw = Gw({...routes(), '/ecm/ecm001A03': (_) => http.Response('<html>login</html>', 200, headers: {'content-type': 'text/html; charset=utf-8'})});
      final out = '${downloads.path}/h.pdf';
      await expectLater(run(gw, 'download_mail_attachment', {'muid': '1', 'file_sn': 't', 'out_path': out}), throwsA(isA<McpToolError>().having((e) => e.message, 'm', contains('웹 페이지'))));
      expect(File(out).existsSync(), false);
    });

    test('download_body_image — gw 호스트·상대경로만 서명 GET, 외부 호스트 거절', () async {
      final gw = Gw(routes());
      final out = '${downloads.path}/img.png';
      final r = await run(gw, 'download_body_image', {'src': 'https://gw.innogrid.com/upload/img.png', 'out_path': out});
      expect((r['ok'], r['bytes'], r['path']), (true, 2, out));
      expect(File(out).readAsBytesSync(), [9, 9]);
      final rel = await run(gw, 'download_body_image', {'src': 'upload/img.png', 'out_path': out});
      expect(rel['ok'], true);
      expect(gw.order.where((p) => p == '/upload/img.png').length, 2);
      await expectLater(run(gw, 'download_body_image', {'src': 'https://www.example.com/upload/img.png', 'out_path': out}),
          throwsA(isA<McpToolError>().having((e) => e.message, 'm', contains('외부'))));
      await expectLater(run(gw, 'download_body_image', {'src': 'data:image/png;base64,AA', 'out_path': out}), throwsA(isA<McpToolError>()));
    });
  });
}
