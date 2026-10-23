import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/approvals_screen.dart';
import 'package:playground/gw/gw_api.dart' show approvalNeedsAmaranth;
import 'package:playground/gw/attendance_screen.dart';
import 'package:playground/gw/board_screen.dart';
import 'package:playground/gw/mail_indexer.dart';
import 'package:playground/gw/mail_screen.dart';
import 'package:playground/gw/today_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:playground/api/client.dart';
import 'package:playground/dooray/calendar_screen.dart';
import '../assistant/assistant_session_test.dart' show say;
import '../assistant/chat_brain.dart';
import 'fakes.dart';

String ymdOf(DateTime d) => '${d.year}${d.month.toString().padLeft(2, '0')}${d.day.toString().padLeft(2, '0')}';

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
  setUp(() => SharedPreferences.setMockInitialValues({})); // 출퇴근 확인창이 Teams 알림 설정을 읽는다
  testWidgets('미결 결재: 목록 → 상세 화면(열람 처리 없음·결재선), 승인 차례가 아니면 바로 승인 없음', (tester) async {
    final r = Routes({'/gw/gw050A02': [session], '/eap/eap105A04': [{'map': {'totalCount': 1, 'list': [{'DOC_ID': 'D1', 'FORM_ID': '7', 'DOC_TITLE': '휴가 신청', 'FORM_NM': '휴가', 'USER_NM': '김민준', 'DEPT_NM': '팀', 'ARRIVED_DT': '20261001', 'READYN': 'N'}]}}], '/eap/eap111A04': [{'docTitle': '휴가 신청', 'contentsWord': '10월 10일 연차', 'empName': '김민준', 'lineName': '홍길동', 'line': [{'user_nm': '김팀장', 'act_nm': '결재', 'duty_nm': '팀장', 'action_time': '20261001093000'}, {'user_nm': '홍길동', 'act_nm': '결재', 'action_time': ''}]}]});
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, child: const ApprovalsScreen()));
    await tester.pumpAndSettle();
    expect(find.text('휴가 신청'), findsOneWidget);
    expect(find.textContaining('김민준'), findsWidgets);
    await tester.tap(find.text('휴가 신청'));
    await tester.pumpAndSettle();
    expect(find.text('결재 문서'), findsOneWidget); // 전체 화면
    expect(find.text('10월 10일 연차'), findsOneWidget);
    expect(find.text('결재 · 김팀장 팀장'), findsOneWidget);
    expect(find.text('10-01 09:30'), findsOneWidget);
    expect(find.text('대기'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, '아마란스에서 열기'), findsOneWidget);
    expect(find.text('바로 승인'), findsNothing); // btnApproval 없음
    expect(r.bodies['/eap/eap111A04']?['setReadYn'], 'N');
    expect(approvalWebUrl('D1', '7'), 'https://gw.innogrid.com/#/popup?docID=D1&formId=7&docAuth=0&MicroModuleCode=eap&callComp=UBAP002');
    expect(approvalWebUrl('a b', 'x&y'), contains('docID=a%20b&formId=x%26y'));
  });

  Map<String, Object?> pendingDoc({bool mine = true}) => {'docId': 'D1', 'formId': '7', 'docTitle': '휴가 신청', 'contentsWord': '연차', 'empName': '김민준', 'actId': '3000', 'docLineMSeq': '2', 'docLineSSeq': '0', 'btnList': {'btnApproval': mine ? '1' : '0'}};
  final list = {'map': {'totalCount': 1, 'list': [{'DOC_ID': 'D1', 'FORM_ID': '7', 'DOC_TITLE': '휴가 신청', 'FORM_NM': '휴가', 'USER_NM': '김민준', 'ARRIVED_DT': '20261001'}]}};

  testWidgets('바로 승인: 강한 경고 확인 → 사전 확인(eap110A08) → 승인(eap110A21 docLineSts 30) → 다시 읽어 확인 후 닫고 목록 갱신', (tester) async {
    final r = Routes({'/gw/gw050A02': [session], '/eap/eap105A04': [list, {'map': {'totalCount': 0, 'list': []}}], '/eap/eap111A04': [pendingDoc(), pendingDoc(mine: false)], '/eap/eap110A08': [{'result': {'ea100': '0', 'func': [{'FUNC_NM': 'fnSetPasswd', 'FUNC_PARAM': 'v', 'v': '3000|0▤4000|1'}]}}], '/eap/eap110A21': [{'resultValue': 0}]});
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, child: const ApprovalsScreen()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('휴가 신청'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('바로 승인'));
    await tester.pumpAndSettle();
    expect(find.text('바로 승인 처리가 됩니다. 진행하시겠습니까?'), findsOneWidget);
    await tester.tap(find.text('취소'));
    await tester.pumpAndSettle();
    expect(r.hits['/eap/eap110A21'], isNull); // 취소하면 아무것도 보내지 않는다

    await tester.tap(find.text('바로 승인'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, '승인'));
    await tester.pumpAndSettle();
    expect(r.bodies['/eap/eap110A08'], {'docID': 'D1', 'formID': '7', 'actID': '3000'});
    expect(r.bodies['/eap/eap110A21'], {'docID': 'D1', 'actID': '3000', 'docLineMSeq': '2', 'docLineSSeq': '0', 'docLineSts': '30', 'docComment': '', 'iframeHtml': ''});
    expect(r.hits['/eap/eap111A04'], 2); // 승인 뒤 다시 읽기
    expect(find.text('승인했습니다.'), findsOneWidget);
    expect(find.text('미결 문서가 없습니다'), findsOneWidget); // 닫히고 목록 갱신
  });

  testWidgets('바로 승인: 결재 비밀번호·의견이 필요한 문서는 승인 요청을 보내지 않고 아마란스로 안내', (tester) async {
    final r = Routes({'/gw/gw050A02': [session], '/eap/eap105A04': [list], '/eap/eap111A04': [pendingDoc()], '/eap/eap110A08': [{'result': {'ea100': '0', 'func': [{'FUNC_NM': 'fnSetPasswd', 'FUNC_PARAM': 'v', 'v': '3000|1'}]}}]});
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, child: const ApprovalsScreen()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('휴가 신청'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('바로 승인'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, '승인'));
    await tester.pumpAndSettle();
    expect(r.hits['/eap/eap110A21'], isNull);
    expect(find.textContaining('아마란스에서 승인해 주세요'), findsOneWidget);
    expect(find.text('결재 문서'), findsOneWidget); // 화면은 그대로
  });

  test('approvalNeedsAmaranth — 의견 필수(ea100)·내 actId가 1인 func 항목이면 앱에서 승인하지 않는다', () {
    expect(approvalNeedsAmaranth({'result': {'ea100': '1'}}, '3000'), isTrue);
    expect(approvalNeedsAmaranth({'result': {'func': [{'FUNC_PARAM': 'p', 'p': '4000|0▤3000|1'}]}}, '3000'), isTrue);
    expect(approvalNeedsAmaranth({'result': {'func': [{'FUNC_PARAM': 'p', 'p': '4000|1▤3000|0'}]}}, '3000'), isFalse);
    expect(approvalNeedsAmaranth({'result': {}}, '3000'), isFalse);
    expect(approvalNeedsAmaranth(null, '3000'), isFalse);
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
  testWidgets('일정(기본 일간): 오늘 내 일정·내 예약, "전체" 토글로 남의 것도', (tester) async {
    final d = ymdOf(DateTime.now().toUtc().add(const Duration(hours: 9))); // 일간 보기는 그날 것만 보여 주므로 픽스처는 오늘
    final r = Routes({'/gw/gw050A02': [session],
      '/schres/sc111A02': [{'resultList': [{'mcalSeq': '1', 'calType': 'E', 'empSeq': '7'}, {'mcalSeq': '2', 'calType': 'M', 'empSeq': '9'}]}],
      '/schres/sc111A03': [{'resultList': [{'schSeq': 'a', 'schTitle': '내 회의', 'startDate': '${d}1000', 'endDate': '${d}1100', 'delYn': 'Y', 'mcalSeq': '2'}, {'schSeq': 'c', 'schTitle': '남의 회의', 'startDate': '${d}1200', 'endDate': '${d}1300', 'delYn': 'N', 'mcalSeq': '2'}]}],
      '/schres/rs121A01': [{'resultList': [{'resSeq': '45', 'resName': 'A-1'}]}],
      '/schres/rs121A05': [{'resultList': [{'resSeq': '45', 'resName': 'A-1', 'resStartDate': '${d}1400', 'resEndDate': '${d}1500', 'reqText': '내 예약', 'empName': '홍길동', 'empSeq': '7'}, {'resSeq': '45', 'resName': 'A-1', 'resStartDate': '${d}1600', 'resEndDate': '${d}1700', 'reqText': '남의 예약', 'empName': '김', 'empSeq': '9'}]}]});
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, child: const TodayScreen()));
    await tester.pumpAndSettle();
    expect(find.text('일간'), findsOneWidget);
    expect(find.text('내 회의'), findsOneWidget);
    expect(find.text('10:00–11:00'), findsOneWidget);
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
  testWidgets('메일 검색: 목록을 열면 색인이 동기화되고(읽은 메일 본문만), 검색식으로 찾아 본문을 연다', (tester) async {
    final r = Routes({'/mail/mail000A03': [[{'unreadCount': 1, 'toMeCount': 0, 'totalCount': 2}]], '/mail/mail000A01': [{'list': [{'fullname': 'INBOX', 'mboxSeq': 5}]}],
      '/mail/mail003A01': [{'Records': [{'muid': 1, 'subject': '안 읽음', 'fromAddrName': '홍', 'rfc822date': '07:10', 'tooltipDate': '2026-10-11 07:10:00', 'seen': 0}, {'muid': 2, 'subject': '읽음 결산', 'fromAddrName': '김', 'rfc822date': '10-03', 'tooltipDate': '2026-10-03 09:00:00', 'seen': 1}], 'TotalUnseenCount': 1}],
      '/mail/mail002A01': [{'decodeMime': {'subject': '읽음 결산', 'from': '김', 'to': '나', 'date': '2026-10-03 09:00:00'}, 'mime': {'body': {'plain': '3층 회의실에서 합니다'}}}]});
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, overrides: [mailIndexStoreProvider.overrideWithValue(MemoryMailIndexStore())], child: const MailScreen()));
    await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 300));
    expect(r.hits['/mail/mail002A01'], 1); // 읽은 메일 본문만 색인(안 읽은 메일은 열지 않는다)
    await tester.tap(find.text('메일 검색 · 제목·보낸 사람·본문'));
    await tester.pumpAndSettle();
    expect(find.text('메일 검색'), findsOneWidget);
    expect(find.textContaining('색인 2통 · 본문 1통'), findsOneWidget);
    await tester.enterText(find.byType(TextField), '회의실');
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.textContaining('읽음 결산', findRichText: true), findsOneWidget);
    expect(find.textContaining('3층 회의실', findRichText: true), findsOneWidget); // 본문 발췌
    await tester.enterText(find.byType(TextField), 'is:unread');
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.textContaining('읽음 결산', findRichText: true), findsNothing);
    final hit = find.descendant(of: find.byType(ListTile), matching: find.textContaining('안 읽음', findRichText: true)); // 필터 칩 '안 읽음'과 구분
    expect(hit, findsOneWidget);
    await tester.tap(hit);
    await tester.pumpAndSettle();
    expect(r.hits['/mail/mail002A01'], 2); // 결과를 누르면 본문 화면(열람)
    expect(find.byTooltip('삭제(휴지통으로)'), findsOneWidget);
  });
  testWidgets('메일: 미읽음 집계와 목록, 미읽음은 굵게, 누르면 본문 화면(mail002A01)을 열고 돌아오면 목록을 다시 읽는다', (tester) async {
    final r = Routes({'/mail/mail000A03': [[{'unreadCount': 2, 'toMeCount': 1, 'totalCount': 9}]], '/mail/mail000A01': [{'list': [{'fullname': 'INBOX', 'mboxSeq': 5}]}], '/mail/mail003A01': [{'Records': [{'muid': 1, 'subject': '안 읽음', 'fromAddrName': '홍', 'rfc822date': '07:10', 'seen': 0}, {'muid': 2, 'subject': '읽음', 'fromAddrName': '김', 'rfc822date': '10-03', 'seen': 1}], 'TotalUnseenCount': 2}],
      '/mail/mail002A01': [{'decodeMime': {'subject': '안 읽음', 'from': '홍', 'to': '나', 'cc': '가 &lt;a@x.com&gt;,나 &lt;b@x.com&gt;,"다, 라" &lt;c@x.com&gt;,마 &lt;d@x.com&gt;', 'date': '2026-10-11 07:10:00'}, 'mime': {'body': {'plain': '본문입니다'}, 'fileList': [{'originalFileName': 'a.pdf', 'fileSize': 4000}]}}]});
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, child: const MailScreen()));
    await tester.pumpAndSettle();
    expect(find.textContaining('미읽음 2'), findsOneWidget);
    expect(find.text('안 읽음'), findsOneWidget);
    expect(tester.widget<Text>(find.text('안 읽음')).style?.fontWeight, FontWeight.w800);
    expect(tester.widget<Text>(find.text('읽음')).style?.fontWeight, isNot(FontWeight.w800));
    final listLoads = r.hits['/mail/mail003A01'] ?? 0;
    await tester.tap(find.text('안 읽음'));
    await tester.pumpAndSettle();
    expect(r.hits['/mail/mail002A01'], 1); // 열면 읽음 처리되는 원본 호출
    expect(find.text('본문입니다'), findsOneWidget);
    expect(find.textContaining('a.pdf'), findsOneWidget);
    expect(find.text('외 2명 더보기'), findsOneWidget); // 받는 사람·참조는 2명까지만, 나머지는 펼쳐서
    expect(find.textContaining('마 <d@x.com>'), findsNothing);
    await tester.tap(find.text('외 2명 더보기'));
    await tester.pumpAndSettle();
    expect(find.text('접기'), findsOneWidget);
    expect(find.textContaining('마 <d@x.com>'), findsOneWidget);
    expect(find.text('안 읽음으로 되돌리기'), findsNothing); // 아래 고정 줄 없음(2026-10-22)
    await tester.tap(find.textContaining('a.pdf'));
    await tester.pump();
    expect(find.text('첨부 파일은 아마란스 메일에서 내려받아 주세요.'), findsOneWidget);
    await tester.pumpAndSettle(const Duration(seconds: 5));
    await tester.tap(find.byTooltip('뒤로'));
    await tester.pumpAndSettle();
    expect(r.hits['/mail/mail003A01'], greaterThan(listLoads)); // 돌아오면 목록·미읽음 수를 다시 읽는다
  });
  testWidgets('메일: 본문 화면에서 삭제 → 확인 후 휴지통 이동(mail002A05) 요청, 목록으로 돌아와 다시 읽는다. 취소하면 요청 없음', (tester) async {
    final r = Routes({'/mail/mail000A03': [[{'unreadCount': 0, 'toMeCount': 0, 'totalCount': 1}]], '/mail/mail000A01': [{'list': [{'fullname': 'INBOX', 'mboxSeq': 5}]}],
      '/mail/mail003A01': [{'Records': [{'muid': 7, 'subject': '지울 메일', 'fromAddrName': '홍', 'rfc822date': '07:10', 'seen': 1}], 'TotalUnseenCount': 0}],
      '/mail/mail002A01': [{'decodeMime': {'subject': '지울 메일', 'from': '홍', 'to': '나', 'date': '2026-10-11 07:10:00'}, 'mime': {'body': {'plain': '본문'}}}],
      '/mail/mail002A05': [{}]});
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, overrides: [mailIndexStoreProvider.overrideWithValue(MemoryMailIndexStore())], child: const MailScreen()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('지울 메일'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('삭제(휴지통으로)'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('취소'));
    await tester.pumpAndSettle();
    expect(r.hits['/mail/mail002A05'], isNull);
    final listLoads = r.hits['/mail/mail003A01'] ?? 0;
    await tester.tap(find.byTooltip('삭제(휴지통으로)'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, '삭제'));
    await tester.pumpAndSettle();
    expect(r.hits['/mail/mail002A05'], 1);
    expect(r.bodies['/mail/mail002A05']?.toString(), contains('7')); // 그 메일 muid
    expect(find.text('본문'), findsNothing); // 목록으로 돌아옴
    expect(r.hits['/mail/mail003A01'], greaterThan(listLoads));
  });
  testWidgets('메일: 20통이 꽉 차면 "이전 메일 더 보기" → 40통으로 다시 읽어 과거 메일까지 보여 준다', (tester) async {
    List<Map<String, Object>> recs(int n) => [for (var i = 0; i < n; i++) {'muid': 100 + i, 'subject': '메일 $i', 'fromAddrName': '홍', 'rfc822date': '10-0${i % 9 + 1}', 'seen': 0}]; // 안 읽음 → 색인이 본문을 열지 않음
    final r = Routes({'/mail/mail000A03': [[{'unreadCount': 0, 'toMeCount': 0, 'totalCount': 30}]], '/mail/mail000A01': [{'list': [{'fullname': 'INBOX', 'mboxSeq': 5}]}],
      // 화면 첫 로드(20) → 검색 색인 동기화(같은 목록, 500) → 더 보기(40)
      '/mail/mail003A01': [{'Records': recs(20), 'TotalUnseenCount': 0}, {'Records': recs(20), 'TotalUnseenCount': 0}, {'Records': recs(30), 'TotalUnseenCount': 0}]});
    await tester.binding.setSurfaceSize(const Size(800, 6000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, overrides: [mailIndexStoreProvider.overrideWithValue(MemoryMailIndexStore())], child: const MailScreen()));
    await tester.pumpAndSettle();
    expect(find.text('메일 25'), findsNothing);
    await tester.tap(find.text('이전 메일 더 보기'));
    await tester.pumpAndSettle();
    expect(r.bodies['/mail/mail003A01']?['pageSize'], 40);
    expect(find.text('메일 25'), findsOneWidget);
    expect(find.text('이전 메일 더 보기'), findsNothing); // 30통 < 40 → 끝
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
  testWidgets('일정 주간: 월~일 범위로 한 번에 읽고(회의실은 안 읽음) Dooray 일정을 섞어 보여 준다; 월간 격자에서 날짜를 누르면 일간으로', (tester) async {
    final today = DateTime.now().toUtc().add(const Duration(hours: 9));
    final t0 = DateTime.utc(today.year, today.month, today.day);
    final mon = t0.subtract(Duration(days: t0.weekday - 1)), sun = mon.add(const Duration(days: 6));
    final r = Routes({'/gw/gw050A02': [session], '/schres/sc111A02': [{'resultList': []}],
      '/schres/sc111A03': [{'resultList': []}, {'resultList': [{'schSeq': 'a', 'schTitle': '월요 회의', 'startDate': '${ymdOf(mon)}1000', 'endDate': '${ymdOf(mon)}1100', 'delYn': 'Y', 'mcalSeq': '2'}]}, {'resultList': []}, {'resultList': []}],
      '/schres/rs121A01': [{'resultList': []}], '/schres/rs121A05': [{'resultList': []}, {'resultList': []}]});
    final doorayKeys = <(String, int)>[];
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, child: const TodayScreen(), overrides: [
      doorayRangeProvider.overrideWith((ref, key) async {
        doorayKeys.add(key);
        return {'items': [{'subject': '기기 회의', 'startedAt': '${t0.toIso8601String().substring(0, 10)}T05:00:00Z', 'endedAt': '${t0.toIso8601String().substring(0, 10)}T06:00:00Z', 'wholeDayFlag': false}]};
      }),
    ]));
    await tester.pumpAndSettle();
    expect(find.text('기기 회의'), findsOneWidget); // 일간에도 Dooray 일정(14:00 KST)
    expect(find.text('Dooray'), findsOneWidget);
    expect(doorayKeys.last, (t0.toIso8601String().substring(0, 10), 1));
    await tester.tap(find.text('주간'));
    await tester.pumpAndSettle();
    expect(r.bodies['/schres/sc111A03']?['startDate'], ymdOf(mon));
    expect(r.bodies['/schres/sc111A03']?['endDate'], ymdOf(sun));
    expect(r.hits['/schres/rs121A05'], 1); // 회의실은 일간에서만
    expect(doorayKeys.last, (mon.toIso8601String().substring(0, 10), 7));
    expect(find.text('월요 회의'), findsOneWidget);
    expect(find.text('기기 회의'), findsOneWidget);
    expect(find.text('일정 2'), findsOneWidget);
    await tester.tap(find.text('월간'));
    await tester.pumpAndSettle();
    expect(doorayKeys.last.$2, 42);
    final first = DateTime.utc(t0.year, t0.month, 1);
    expect(r.bodies['/schres/sc111A03']?['startDate'], ymdOf(first.subtract(Duration(days: first.weekday - 1))));
    final pick = DateTime.utc(t0.year, t0.month, 15);
    await tester.tap(find.byKey(ValueKey('cal-cell-${pick.toIso8601String().substring(0, 10)}')));
    await tester.pumpAndSettle();
    expect(find.text('일간'), findsOneWidget);
    expect(r.bodies['/schres/sc111A03']?['startDate'], ymdOf(pick));
    expect(r.bodies['/schres/sc111A03']?['endDate'], ymdOf(pick));
  });
  testWidgets('일정 "추가"를 누르면 이노봇이 그날 아마란스 일정 등록 요청을 들고 열린다', (tester) async {
    final brain = ChatBrain([say('어떤 일정인가요? 제목과 시간을 알려 주세요.')]);
    final r = Routes({'/gw/gw050A02': [session], '/schres/sc111A02': [{'resultList': []}], '/schres/sc111A03': [{'resultList': []}], '/schres/rs121A01': [{'resultList': []}], '/schres/rs121A05': [{'resultList': []}]});
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, child: const TodayScreen(), overrides: [apiClientProvider.overrideWithValue(brain.client)]));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, '추가'));
    await tester.pumpAndSettle();
    expect(brain.received, hasLength(1));
    final sent = '${brain.received.single.last['content']}';
    expect(sent, contains('아마란스 일정 등록해줘'));
    expect(sent, contains('${DateTime.now().toUtc().add(const Duration(hours: 9)).day}일'));
    expect(find.text('어떤 일정인가요? 제목과 시간을 알려 주세요.'), findsOneWidget);
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
