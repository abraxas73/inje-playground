import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/briefing/briefing_provider.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_creds.dart';
import '../gw/fakes.dart';

void main() {
  test('미결 결재만 2분마다 다시 읽어 브리핑 값 대신 쓴다(아마란스에서 처리한 건이 위젯에 남지 않게)', () async {
    var list = <Map<String, Object?>>[
      {'DOC_ID': '9', 'FORM_ID': '41', 'DOC_TITLE': '연차', 'FORM_NM': '연차휴가신청서', 'USER_NM': '박형탁', 'ARRIVED_DT': '20261022', 'DOC_STSNM': '진행', 'READYN': 'N', 'FILE_CNT': 0},
    ];
    final gw = MockClient((r) async {
      if (r.url.path != '/eap/eap105A04') return http.Response('{"resultCode":999}', 200);
      return http.Response.bytes(utf8.encode(jsonEncode({'resultCode': 0, 'resultData': {'map': {'totalCount': list.length, 'list': list}}})), 200, headers: {'content-type': 'application/json; charset=utf-8'});
    });
    final c = ProviderContainer(overrides: [gwStoreProvider.overrideWithValue(FakeGwStore(testCreds)), gwHttpClientProvider.overrideWithValue(gw)]);
    addTearDown(c.dispose);
    await c.read(gwProvider.future);
    final sub = c.listen(approvalsLiveProvider, (_, _) {});
    addTearDown(sub.close);
    expect(c.read(approvalsLiveProvider), isNull); // 처음엔 브리핑 값 사용
    expect(ApprovalsLive.every, const Duration(minutes: 2));

    await c.read(approvalsLiveProvider.notifier).poll();
    expect(c.read(approvalsLiveProvider)?.$2.single.title, '연차');

    list = []; // 아마란스에서 처리됨
    await c.read(approvalsLiveProvider.notifier).poll();
    expect(c.read(approvalsLiveProvider)?.$2, isEmpty);
  });
}
