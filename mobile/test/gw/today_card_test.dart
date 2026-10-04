import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/gw_notices_card.dart';
import 'fakes.dart';

http.Response ok(Object? data) => http.Response.bytes(utf8.encode(jsonEncode({'resultCode': 0, 'resultData': data})), 200, headers: {'content-type': 'application/json; charset=utf-8'});
const session = {'sessionInfo': {'ucUserInfo': {'compSeq': '10', 'deptSeq': '20', 'empName': '홍길동', 'emailAdd': 'hong', 'emailDomain': 'innogrid.com', 'erpEmpSeq': 'E', 'erpDeptSeq': 'D', 'erpCompSeq': 'C'}}};
MockClient routes(Map<String, Object?> m) => MockClient((r) async => m.containsKey(r.url.path) ? ok(m[r.url.path]) : http.Response('{"resultCode":999,"resultMsg":"x"}', 200));

void main() {
  testWidgets('홈 공지 카드: 최신 3건 제목 + 더 보기', (tester) async {
    await tester.pumpWidget(gwScope(creds: testCreds, http: routes({'/board/APIHandler/ViewBoardNewAndNoticeArtList': {'totalCnt': 9, 'articleList': [
      {'art_seq_no': '1', 'art_title': '공지 하나', 'cat_title': '공지사항', 'mbr_nick': '홍', 'write_date': '2026-10-04 07:10:00'},
      {'art_seq_no': '2', 'art_title': '공지 둘', 'cat_title': '공지사항', 'mbr_nick': '김', 'write_date': '2026-10-03 07:10:00'},
      {'art_seq_no': '3', 'art_title': '공지 셋', 'cat_title': '자유', 'mbr_nick': '이', 'write_date': '2026-10-02 07:10:00'}]}}), child: const Scaffold(body: GwNoticesCard())));
    await tester.pumpAndSettle();
    for (final t in ['공지 하나', '공지 둘', '공지 셋']) {
      expect(find.text(t), findsOneWidget);
    }
    expect(find.text('더 보기'), findsOneWidget);
  });
  testWidgets('홈 공지 카드: 미연결이면 아무것도 그리지 않는다', (tester) async {
    await tester.pumpWidget(gwScope(http: routes({}), child: const Scaffold(body: GwNoticesCard())));
    await tester.pumpAndSettle();
    expect(find.text('공지사항'), findsNothing);
  });
}
