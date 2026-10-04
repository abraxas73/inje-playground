import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/approvals_screen.dart';
import 'package:playground/gw/attendance_screen.dart';
import 'package:playground/gw/board_screen.dart';
import 'package:playground/gw/mail_screen.dart';
import 'package:playground/gw/today_screen.dart';
import 'fakes.dart';

http.Response ok(Object? data) => http.Response.bytes(utf8.encode(jsonEncode({'resultCode': 0, 'resultData': data})), 200, headers: {'content-type': 'application/json; charset=utf-8'}) /* 한글 본문은 latin1 기본 인코딩에서 ArgumentError */;
const session = {'sessionInfo': {'ucUserInfo': {'compSeq': '10', 'deptSeq': '20', 'empName': '홍길동', 'emailAdd': 'hong', 'emailDomain': 'innogrid.com', 'erpEmpSeq': 'E', 'erpDeptSeq': 'D', 'erpCompSeq': 'C'}}};

/// 경로 → 응답(순서 소비) + 호출 수.
class Routes {
  Routes(this.m);
  final Map<String, List<Object?>> m;
  final hits = <String, int>{};
  final bodies = <String, Map<String, dynamic>>{};
  MockClient get client => MockClient((r) async {
        hits[r.url.path] = (hits[r.url.path] ?? 0) + 1;
        if (r.body.startsWith('{')) bodies[r.url.path] = jsonDecode(r.body) as Map<String, dynamic>;
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
  testWidgets('오늘: 기본은 내 일정·내 예약, "전체" 토글로 남의 것도', (tester) async {
    final r = Routes({'/gw/gw050A02': [session],
      '/schres/sc111A02': [{'resultList': [{'mcalSeq': '1', 'calType': 'E', 'empSeq': '7'}, {'mcalSeq': '2', 'calType': 'M', 'empSeq': '9'}]}],
      '/schres/sc111A03': [{'resultList': [{'schSeq': 'a', 'schTitle': '내 회의', 'startDate': '202610041000', 'endDate': '202610041100', 'delYn': 'Y', 'mcalSeq': '2'}, {'schSeq': 'c', 'schTitle': '남의 회의', 'startDate': '202610041200', 'endDate': '202610041300', 'delYn': 'N', 'mcalSeq': '2'}]}],
      '/schres/rs121A01': [{'resultList': [{'resSeq': '45', 'resName': 'A-1'}]}],
      '/schres/rs121A05': [{'resultList': [{'resSeq': '45', 'resName': 'A-1', 'resStartDate': '202610041400', 'resEndDate': '202610041500', 'reqText': '내 예약', 'empName': '홍길동', 'empSeq': '7'}, {'resSeq': '45', 'resName': 'A-1', 'resStartDate': '202610041600', 'resEndDate': '202610041700', 'reqText': '남의 예약', 'empName': '김', 'empSeq': '9'}]}]});
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, child: const TodayScreen()));
    await tester.pumpAndSettle();
    expect(find.text('내 회의'), findsOneWidget);
    expect(find.text('남의 회의'), findsNothing);
    expect(find.text('내 예약'), findsOneWidget);
    expect(find.text('남의 예약'), findsNothing);
    await tester.tap(find.text('전체').first); // 일정 구역
    await tester.pumpAndSettle();
    expect(find.text('남의 회의'), findsOneWidget);
    expect(find.text('남의 예약'), findsNothing); // 구역별 토글
    await tester.tap(find.text('전체').at(1)); // 회의실 구역
    await tester.pumpAndSettle();
    expect(find.text('남의 예약'), findsOneWidget);
  });
  testWidgets('메일: 미읽음 집계와 목록, 미읽음은 굵게, 본문 호출 없음', (tester) async {
    final r = Routes({'/mail/mail000A03': [[{'unreadCount': 2, 'toMeCount': 1, 'totalCount': 9}]], '/mail/mail000A01': [{'list': [{'fullname': 'INBOX', 'mboxSeq': 5}]}], '/mail/mail003A01': [{'Records': [{'muid': 1, 'subject': '안 읽음', 'fromAddrName': '홍', 'rfc822date': '07:10', 'seen': 0}, {'muid': 2, 'subject': '읽음', 'fromAddrName': '김', 'rfc822date': '10-03', 'seen': 1}], 'TotalUnseenCount': 2}]});
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, child: const MailScreen()));
    await tester.pumpAndSettle();
    expect(find.textContaining('미읽음 2'), findsOneWidget);
    expect(find.text('안 읽음'), findsOneWidget);
    expect(tester.widget<Text>(find.text('안 읽음')).style?.fontWeight, FontWeight.w800);
    expect(tester.widget<Text>(find.text('읽음')).style?.fontWeight, isNot(FontWeight.w800));
    await tester.tap(find.text('안 읽음'));
    await tester.pumpAndSettle();
    expect(r.hits.containsKey('/mail/mail002A01'), false);
  });
  testWidgets('[리뷰6] 메일: 집계가 실패하면 영어 클래스 이름이 아니라 서버 메시지를 보여 준다', (tester) async {
    final r = Routes({'/mail/mail000A01': [{'list': [{'fullname': 'INBOX', 'mboxSeq': 5}]}], '/mail/mail003A01': [{'Records': [], 'TotalUnseenCount': 0}]}); // mail000A03 없음 → 999 'unexpected …'
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, child: const MailScreen()));
    await tester.pumpAndSettle();
    expect(find.textContaining('ParallelWaitError'), findsNothing);
    expect(find.textContaining('unexpected'), findsOneWidget);
  });
  testWidgets('아마란스 화면(push 라우트)에는 뒤로 버튼이 있다 — 하단 바가 없어서', (tester) async {
    final r = Routes({'/mail/mail000A03': [[{'unreadCount': 0, 'toMeCount': 0, 'totalCount': 0}]], '/mail/mail000A01': [{'list': [{'fullname': 'INBOX', 'mboxSeq': 5}]}], '/mail/mail003A01': [{'Records': [], 'TotalUnseenCount': 0}]});
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, child: const MailScreen()));
    await tester.pumpAndSettle();
    expect(find.byTooltip('뒤로'), findsOneWidget);
    // 미연결 안내(GwGate)에도
    await tester.pumpWidget(gwScope(http: r.client, child: const MailScreen()));
    await tester.pumpAndSettle();
    expect(find.byTooltip('뒤로'), findsOneWidget);
  });
  testWidgets('오늘 화면: › 를 누르면 다음 날 일정·예약을 다시 불러오고, 오늘 버튼으로 돌아온다', (tester) async {
    final r = Routes({'/gw/gw050A02': [session], '/schres/sc111A02': [{'resultList': []}], '/schres/sc111A03': [{'resultList': []}, {'resultList': []}, {'resultList': []}], '/schres/rs121A01': [{'resultList': []}], '/schres/rs121A05': [{'resultList': []}, {'resultList': []}, {'resultList': []}]});
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, child: const TodayScreen()));
    await tester.pumpAndSettle();
    final today = DateTime.now();
    final tomorrow = today.add(const Duration(days: 1));
    String ymd(DateTime d) => '${d.year}${d.month.toString().padLeft(2, '0')}${d.day.toString().padLeft(2, '0')}';
    expect(r.bodies['/schres/sc111A03']?['startDate'], ymd(today));
    await tester.tap(find.byTooltip('다음 날'));
    await tester.pumpAndSettle();
    expect(r.bodies['/schres/sc111A03']?['startDate'], ymd(tomorrow));
    expect(r.bodies['/schres/rs121A05']?['startDate'], ymd(tomorrow));
    expect(find.text('오늘'), findsWidgets); // 오늘로 돌아가기 버튼
    await tester.tap(find.widgetWithText(TextButton, '오늘'));
    await tester.pumpAndSettle();
    expect(r.bodies['/schres/sc111A03']?['startDate'], ymd(today));
  });
  testWidgets('게시판: 목록 → 항목 → 본문·댓글(ViewPost 1회)', (tester) async {
    final r = Routes({'/board/APIHandler/ViewBoardNewAndNoticeArtList': [{'totalCnt': 2, 'articleList': [
      {'art_seq_no': '1', 'art_title': '10월 전사 공지', 'cat_title': '공지사항', 'mbr_nick': '홍길동', 'dept_name': '경영지원', 'write_date': '2026-10-04 07:10:00', 'read_cnt': '5', 'file_cnt': '1', 'art_read_yn': 'N', 'art_content': '미리보기입니다'},
      {'art_seq_no': '2', 'art_title': '동호회 모집', 'cat_title': '자유게시판', 'mbr_nick': '김민준', 'write_date': '2026-10-03 10:00:00', 'file_cnt': '0', 'art_read_yn': 'Y'}]}],
      '/board/APIHandler/ViewPost': [{'art': {'art_seq_no': '1', 'art_title': '10월 전사 공지', 'mbr_nick': '홍길동', 'write_date': '2026-10-04 07:10:00', 'art_content': '<p>전 직원 필독</p>', 'file_cnt': '1'}, 'board': {'cat_title': '공지사항'}, 'remarkList': [{'mbr_nick': '이서연', 'remark_desc': '확인'}]}]});
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, child: const BoardScreen()));
    await tester.pumpAndSettle();
    expect(find.text('10월 전사 공지'), findsOneWidget);
    expect(find.text('동호회 모집'), findsOneWidget);
    await tester.tap(find.text('10월 전사 공지'));
    await tester.pumpAndSettle();
    expect(find.text('전 직원 필독'), findsOneWidget);
    expect(find.textContaining('이서연'), findsOneWidget);
    expect(find.textContaining('첨부 1'), findsWidgets); // 메타 줄 + 안내 상자
    expect(r.hits['/board/APIHandler/ViewPost'], 1);
  });
}
