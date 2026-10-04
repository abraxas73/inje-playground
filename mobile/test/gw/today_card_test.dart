import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/gw_today_card.dart';
import 'fakes.dart';

http.Response ok(Object? data) => http.Response.bytes(utf8.encode(jsonEncode({'resultCode': 0, 'resultData': data})), 200, headers: {'content-type': 'application/json; charset=utf-8'});
const session = {'sessionInfo': {'ucUserInfo': {'compSeq': '10', 'deptSeq': '20', 'empName': '홍길동', 'emailAdd': 'hong', 'emailDomain': 'innogrid.com', 'erpEmpSeq': 'E', 'erpDeptSeq': 'D', 'erpCompSeq': 'C'}}};
MockClient routes(Map<String, Object?> m) => MockClient((r) async => m.containsKey(r.url.path) ? ok(m[r.url.path]) : http.Response('{"resultCode":999,"resultMsg":"x"}', 200));

void main() {
  testWidgets('미연결: 연결 안내 카드', (tester) async {
    await tester.pumpWidget(gwScope(http: routes({}), child: const Scaffold(body: GwTodayCard())));
    await tester.pumpAndSettle();
    expect(find.text('연결하기'), findsOneWidget);
  });
  testWidgets('연결됨: 4개 타일 숫자, 하나가 실패해도 나머지는 보인다', (tester) async {
    await tester.pumpWidget(gwScope(creds: testCreds, http: routes({
      '/gw/gw050A02': session, '/eap/api/getMenuCountInfo': {'1001000': '3'}, '/human/common/judgeTimeManagement/getTodayComeLeaveInfo': {'comeTm': '202610040902', 'leaveTm': ''},
      '/schres/sc111A02': {'resultList': [{'mcalSeq': '1', 'calType': 'E', 'empSeq': '7'}]}, '/schres/sc111A03': {'resultList': [{'schSeq': 'a', 'startDate': '202610041000', 'endDate': '202610041100', 'delYn': 'Y', 'mcalSeq': '1'}]},
      '/schres/rs121A01': {'resultList': []}, '/schres/rs121A05': {'resultList': []},
      // 메일은 라우트 없음 → 999 실패
    }), child: const Scaffold(body: GwTodayCard())));
    await tester.pumpAndSettle();
    expect(find.text('3건'), findsOneWidget);
    expect(find.text('09:02'), findsOneWidget);
    expect(find.text('1건'), findsOneWidget); // 일정 1 · 회의실 0 → "1건"은 일정
    expect(find.textContaining('다시 시도'), findsOneWidget); // 메일 타일만 오류
  });
}
