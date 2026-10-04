import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/approvals_screen.dart';
import 'package:playground/gw/attendance_screen.dart';
import 'fakes.dart';

http.Response ok(Object? data) => http.Response.bytes(utf8.encode(jsonEncode({'resultCode': 0, 'resultData': data})), 200, headers: {'content-type': 'application/json; charset=utf-8'}) /* 한글 본문은 latin1 기본 인코딩에서 ArgumentError */;
const session = {'sessionInfo': {'ucUserInfo': {'compSeq': '10', 'deptSeq': '20', 'empName': '홍길동', 'emailAdd': 'hong', 'emailDomain': 'innogrid.com', 'erpEmpSeq': 'E', 'erpDeptSeq': 'D', 'erpCompSeq': 'C'}}};

/// 경로 → 응답(순서 소비) + 호출 수.
class Routes {
  Routes(this.m);
  final Map<String, List<Object?>> m;
  final hits = <String, int>{};
  MockClient get client => MockClient((r) async {
        hits[r.url.path] = (hits[r.url.path] ?? 0) + 1;
        final q = m[r.url.path];
        if (q == null || q.isEmpty) return http.Response('{"resultCode":999,"resultMsg":"unexpected ${r.url.path}"}', 200);
        return ok(q.length == 1 ? q.first : q.removeAt(0));
      });
}

void main() {
  testWidgets('미결 결재: 목록을 그리고 항목을 누르면 상세 시트(열람 처리 없음)', (tester) async {
    final r = Routes({'/gw/gw050A02': [session], '/eap/eap105A04': [{'map': {'totalCount': 1, 'list': [{'DOC_ID': 'D1', 'FORM_ID': '7', 'DOC_TITLE': '휴가 신청', 'FORM_NM': '휴가', 'USER_NM': '김민준', 'DEPT_NM': '팀', 'ARRIVED_DT': '20261001', 'READYN': 'N'}]}}], '/eap/eap111A04': [{'docTitle': '휴가 신청', 'contentsWord': '10월 10일 연차', 'empName': '김민준', 'lineName': '홍길동'}]});
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, child: const ApprovalsScreen()));
    await tester.pumpAndSettle();
    expect(find.text('휴가 신청'), findsOneWidget);
    expect(find.textContaining('김민준'), findsWidgets);
    await tester.tap(find.text('휴가 신청'));
    await tester.pumpAndSettle();
    expect(find.text('10월 10일 연차'), findsOneWidget);
    expect(find.textContaining('승인·반려는 아마란스에서'), findsOneWidget);
    expect(r.hits['/eap/eap111A04'], 1);
  });
  testWidgets('출퇴근: 출근 버튼 → 확인 다이얼로그에서 취소하면 기록 호출 없음, 확인하면 기록 후 시각 표시', (tester) async {
    const base = '/human/common/judgeTimeManagement';
    final r = Routes({'/gw/gw050A02': [session], '$base/getTodayComeLeaveInfo': [{'comeTm': '', 'leaveTm': ''}, {'comeTm': '', 'leaveTm': ''}, {'comeTm': '202610040902', 'leaveTm': ''}, {'comeTm': '202610040902', 'leaveTm': ''}], '$base/confirmApplicationStatus': [{}], '$base/getJudgeTimeManagement': [{}]});
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, child: const AttendanceScreen()));
    await tester.pumpAndSettle();
    expect(find.text('출근 기록'), findsOneWidget);
    await tester.tap(find.text('출근 기록'));
    await tester.pumpAndSettle();
    expect(find.textContaining('실제 근태에 반영'), findsOneWidget);
    await tester.tap(find.text('취소'));
    await tester.pumpAndSettle();
    expect(r.hits['$base/getJudgeTimeManagement'], isNull);
    await tester.tap(find.text('출근 기록'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('기록'));
    await tester.pumpAndSettle();
    expect(r.hits['$base/getJudgeTimeManagement'], 1);
    expect(find.text('09:02'), findsWidgets);
    expect(find.textContaining('기록됨'), findsWidgets); // 버튼 라벨 + 안내 문구
  });
}
