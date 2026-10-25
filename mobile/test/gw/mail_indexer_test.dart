import 'dart:convert';
import 'dart:io';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/gw_api.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_creds.dart';
import 'package:playground/gw/gw_models.dart';
import 'package:playground/gw/mail_indexer.dart';
import 'package:playground/mcp/mcp_tools.dart';
import 'package:playground/mcp/mcp_worker.dart' show McpToolError;
import 'package:shared_preferences/shared_preferences.dart';
import 'fakes.dart';

http.Response _ok(Object? data) => http.Response(jsonEncode({'resultCode': 0, 'resultData': data}), 200, headers: {'content-type': 'application/json'});

Map _row(int muid, String subject, {int seen = 1, String date = '2026-10-09 02:33:09'}) => {'muid': muid, 'subject': subject, 'fromAddrName': '홍', 'fromAddrEmail': 'h@x.com', 'tooltipDate': date, 'rfc822date': date.substring(5, 16), 'seen': seen, 'attach': false, 'size': 1};

/// 경로별 호출 수·요청 본문. mail003A01은 mboxSeq로 메일함을 가른다.
class _Gw {
  _Gw({required this.inbox, this.sent = const []});
  List<Map> inbox, sent;
  final hits = <String, int>{};
  final bodies = <Map<String, dynamic>>[];
  late final api = GwApi(GwClient(httpClient: MockClient((r) async {
    hits[r.url.path] = (hits[r.url.path] ?? 0) + 1;
    final b = r.body.startsWith('{') ? jsonDecode(r.body) as Map<String, dynamic> : <String, dynamic>{};
    if (r.url.path.endsWith('mail003A01')) bodies.add(b);
    return switch (r.url.path) {
      '/mail/mail000A01' => _ok({'list': [{'fullname': 'INBOX', 'mboxSeq': 5}, {'fullname': 'SENT', 'mboxSeq': 6}]}),
      '/mail/mail003A01' => _ok({'Records': b['mboxSeq'] == 5 ? inbox : sent, 'TotalRecordCount': (b['mboxSeq'] == 5 ? inbox : sent).length}),
      '/mail/mail002A01' => _ok({'decodeMime': {'subject': 's', 'from': '홍', 'to': '나 <me@x.com>', 'cc': '', 'date': '2026-10-09 02:33:09'}, 'mime': {'body': {'plain': '본문 ${b['uid']} 결산'}, 'fileList': [{'originalFileName': 'a.pdf', 'fileSize': 4}]}}),
      _ => http.Response('{"resultCode":999,"resultMsg":"unexpected"}', 200),
    };
  }), creds: () => testCreds, now: () => DateTime(2026, 10, 13, 10)), now: () => DateTime(2026, 10, 13, 10));
}

void main() {
  late Directory dir;
  late ProviderContainer c;
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    dir = await Directory.systemTemp.createTemp('mail_index_test');
    c = ProviderContainer(overrides: [mailIndexStoreProvider.overrideWithValue(MailIndexStore(() async => dir)), gwStoreProvider.overrideWithValue(FakeGwStore(testCreds))]);
  });
  tearDown(() async {
    c.dispose();
    if (dir.existsSync()) await dir.delete(recursive: true); // wipe() 테스트는 이미 지웠다
  });

  test('동기화: 받은·보낸 목록을 담고 본문은 읽은 메일만(안 읽은 메일은 mail002A01을 부르지 않는다)', () async {
    final gw = _Gw(inbox: [_row(1, '안 읽음', seen: 0), _row(2, '읽음 결산')], sent: [_row(3, '보낸 것', date: '2026-10-10 08:00:00')]);
    final n = c.read(mailIndexProvider.notifier);
    await n.sync(gw.api);
    final st = c.read(mailIndexProvider);
    expect((st.docs, st.bodies, st.syncing, st.error), (3, 2, false, null));
    expect(gw.hits['/mail/mail002A01'], 2);
    expect(gw.bodies.first['pageSize'], greaterThanOrEqualTo(200));
    expect(n.search('결산').map((h) => h.doc.muid).toList(), ['3', '2']); // 본문 '결산'(최신순), 2는 제목·본문
    expect(n.search('is:unread').single.doc.muid, '1');
    // 다시 동기화: 목록만 다시 읽고 본문은 다시 읽지 않는다
    await n.sync(gw.api);
    expect(gw.hits['/mail/mail002A01'], 2);
    expect(gw.hits['/mail/mail003A01'], 4);
    // 파일에 남아 새 컨테이너가 네트워크 없이 읽는다
    final c2 = ProviderContainer(overrides: [mailIndexStoreProvider.overrideWithValue(MailIndexStore(() async => dir)), gwStoreProvider.overrideWithValue(FakeGwStore(testCreds))]);
    addTearDown(c2.dispose);
    final gw2 = _Gw(inbox: const []);
    await c2.read(mailIndexProvider.notifier).ensureLoaded(gw2.api);
    expect((c2.read(mailIndexProvider).docs, c2.read(mailIndexProvider).bodies), (3, 2));
    expect(gw2.hits, isEmpty);
    expect(dir.listSync().map((f) => f.path.split('/').last).toList(), isNot(contains(testCreds.email!))); // 파일 이름에 이메일 노출 없음
  });

  test('본문 화면이 읽은 메일은 바로 색인되고, 사라진 메일은 전체 다시 색인 때 빠진다', () async {
    final gw = _Gw(inbox: [_row(1, '안 읽음', seen: 0), _row(2, '둘')]);
    final n = c.read(mailIndexProvider.notifier);
    await n.sync(gw.api);
    expect(gw.hits['/mail/mail002A01'], 1);
    final item = MailItem(muid: '1', subject: '안 읽음', fromName: '홍', fromEmail: 'h@x.com', date: '10-09 02:33', tooltip: '2026-10-09 02:33:09', seen: false, attach: false);
    await n.putDetail(gw.api, item, const MailDetail(muid: '1', subject: '안 읽음', from: '홍', to: '나', cc: '', date: '2026-10-09 02:33:09', body: '열어 본 본문', attachments: [(name: 'x.pdf', size: 1, sn: '')], remoteImages: 0));
    expect(n.search('열어 본').single.doc.muid, '1');
    expect(c.read(mailIndexProvider).bodies, 2);
    gw.inbox = [_row(2, '둘')];
    await n.sync(gw.api, full: true);
    expect(c.read(mailIndexProvider).docs, 1);
    expect(gw.hits['/mail/mail002A01'], 1); // 본문은 다시 읽지 않는다
  });

  test('목록 실패는 오류 상태로 남고(내용 없이) 동기화 중 표시가 풀린다 · 색인 지우기', () async {
    final gw = _Gw(inbox: [_row(1, 'a')]);
    final n = c.read(mailIndexProvider.notifier);
    await n.sync(gw.api);
    expect(dir.listSync(), isNotEmpty);
    await n.wipe();
    expect(dir.existsSync() ? dir.listSync() : [], isEmpty);
    expect(c.read(mailIndexProvider).docs, 0);
    final bad = GwApi(GwClient(httpClient: MockClient((r) async => http.Response('{"resultCode":500,"resultMsg":"서버 오류"}', 200)), creds: () => testCreds, now: () => DateTime(2026, 10, 13, 10)));
    await n.sync(bad);
    final st = c.read(mailIndexProvider);
    expect(st.syncing, isFalse);
    expect(st.error, isNotNull);
    expect(st.error, isNot(contains('a')));
  });

  test('MCP 도구 search_mail_index: 색인으로 답하고 오래됐으면 동기화를 띄운다(웹 메일 검색 중계)', () async {
    final gw = _Gw(inbox: [_row(1, '안 읽음 결산', seen: 0), _row(2, '읽음 결산')]);
    final n = c.read(mailIndexProvider.notifier);
    final tools = McpTools(gw: gw.api, appSupportDir: () => dir.path, mailIndex: n);
    final r = jsonDecode(await tools.execute('search_mail_index', {'query': '결산', 'limit': 1})) as Map;
    expect(r['index'], containsPair('syncing', true)); // 첫 호출: 색인 비어 있고 동기화 시작
    await Future<void>.delayed(const Duration(seconds: 1));
    final r2 = jsonDecode(await tools.execute('search_mail_index', {'query': '결산 is:unread'})) as Map;
    expect((r2['total'], (r2['hits'] as List).length), (1, 1));
    expect((r2['hits'] as List).first, containsPair('subject', '안 읽음 결산'));
    expect(r2['index'], containsPair('docs', 2));
    await expectLater(tools.execute('search_mail_index', {}), throwsA(isA<McpToolError>()));
    await expectLater(McpTools(gw: gw.api, appSupportDir: () => dir.path).execute('search_mail_index', {'query': 'x'}), throwsA(isA<McpToolError>()));
  });

  test('저장 위치를 못 얻으면 색인 없이 조용히 비활성(네트워크 호출 없음)', () async {
    final c3 = ProviderContainer(overrides: [mailIndexStoreProvider.overrideWithValue(MailIndexStore(() async => throw StateError('no dir'))), gwStoreProvider.overrideWithValue(FakeGwStore(testCreds))]);
    addTearDown(c3.dispose);
    final gw = _Gw(inbox: [_row(1, 'a')]);
    await c3.read(mailIndexProvider.notifier).sync(gw.api);
    expect(c3.read(mailIndexProvider).available, isFalse);
    expect(gw.hits, isEmpty);
  });
}
