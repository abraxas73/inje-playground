import 'package:flutter_test/flutter_test.dart';
import 'package:playground/gw/gw_models.dart';

void main() {
  final today = DateTime(2026, 10, 4, 12);
  test('날짜 헬퍼', () {
    expect(ymd(today), '20261004');
    expect(hm('202610040902'), '09:02');
    expect(hm(''), '');
    expect(hm('0902'), '0902');
    expect(daysBetween('20261001', today), 3);
    expect(daysBetween('2026-10-01', today), 3); // 구분자 섞여도 숫자만
    expect(daysBetween('', today), isNull);
  });
  test('미결 문서 행 → 모델, 대기일수', () {
    final p = PendingApproval.fromRow({'DOC_ID': 'D1', 'FORM_ID': 7, 'DOC_TITLE': '휴가', 'FORM_NM': '휴가신청', 'USER_NM': '김', 'DEPT_NM': '팀', 'ARRIVED_DT': '20261001', 'READYN': 'N', 'DOC_STSNM': '진행', 'FILE_CNT': '2'});
    expect((p.docId, p.formId, p.title, p.form, p.drafter, p.dept, p.unread, p.fileCount), ('D1', '7', '휴가', '휴가신청', '김', '팀', true, 2));
    expect(p.waitingDays(today), 3);
    expect(PendingApproval.fromRow({'FORM_NM': '', 'DRAFT_FORM_NM': '초안양식'}).form, '초안양식');
  });
  test('결재 상세: contentsWord 우선, 비면 HTML 본문을 평문으로', () {
    expect(ApprovalDetail.fromData({'docTitle': 't', 'contentsWord': ' 평문 ', 'docContents': '<p>html</p>', 'attachCnt': 1}).content, '평문');
    final d = ApprovalDetail.fromData({'docTitle': 't', 'contentsWord': '', 'docContents': '<p>a&nbsp;b</p><br>c &amp; d', 'lineName': '박'});
    expect(d.content, 'a b c & d');
    expect((d.title, d.currentApprover, d.attachCount), ('t', '박', 0));
  });
  test('미처리 카운트 menuNo → 라벨, 없으면 0, 숫자/문자열 혼용', () {
    expect(parseApprovalCounts({'1001000': '3', '1001100': 12, '1001200': '0', '9999': '1'}), {'pending': 3, 'approved': 12, 'reference': 0, 'sent': 0});
  });
  test('출퇴근: null과 빈 문자열은 미등록', () {
    final a = Attendance.fromData('20261004', {'comeTm': null, 'leaveTm': '', 'holidayYn': 'N'});
    expect((a.comeTm, a.leaveTm, a.clockedIn, a.clockedOut, a.holiday), ('', '', false, false, false));
    final b = Attendance.fromData('20261004', {'comeTm': '202610040902', 'holidayYn': 'Y'});
    expect((b.clockedIn, b.clockedOut, b.holiday, hm(b.comeTm)), (true, false, true, '09:02'));
    expect(Attendance.fromData('20261004', null).clockedIn, false);
  });
  test('캘린더 calList: 빈 calType은 E로 보정, adminYn Y', () {
    final cals = [GwCalendar.fromRow({'mcalSeq': '1', 'calTitle': '개인', 'calType': '', 'empSeq': '7', 'calColor': '#fff'}), GwCalendar.fromRow({'mcalSeq': 2, 'calTitle': '팀', 'calType': 'M', 'empSeq': '9'})];
    expect(calListFor(cals), [{'mcalSeq': '1', 'calType': 'E', 'adminYn': 'Y', 'color': '#fff'}, {'mcalSeq': '2', 'calType': 'M', 'adminYn': 'Y', 'color': ''}]);
  });
  test('일정: delYn Y는 내 일정, myEvents는 내 개인 캘린더 일정도 포함', () {
    final cals = [GwCalendar.fromRow({'mcalSeq': '1', 'calType': 'E', 'empSeq': '7'}), GwCalendar.fromRow({'mcalSeq': '2', 'calType': 'M', 'empSeq': '9'})];
    final all = [
      GwEvent.fromRow({'schSeq': 'a', 'schTitle': '내것', 'startDate': '202610041000', 'endDate': '202610041100', 'delYn': 'Y', 'mcalSeq': '2', 'calTitle': '팀'}),
      GwEvent.fromRow({'schSeq': 'b', 'schTitle': '개인캘린더', 'startDate': '202610040900', 'endDate': '202610040930', 'delYn': 'N', 'mcalSeq': '1', 'alldayYn': 'N'}),
      GwEvent.fromRow({'schSeq': 'c', 'schTitle': '남의것', 'startDate': '202610041200', 'endDate': '202610041300', 'delYn': 'N', 'mcalSeq': '2'}),
    ];
    expect(all[0].mine, true);
    expect(myEvents(all, cals, '7').map((e) => e.schSeq), ['a', 'b']);
  });
  test('회의실 예약: 표시명은 resTitleDisplay 우선, 없으면 [예약자] 회의실', () {
    final r = GwReservation.fromRow({'resSeq': 45, 'resName': 'A-1', 'resStartDate': '202610041400', 'resEndDate': '202610041500', 'reqText': '주간회의', 'empName': '홍', 'empSeq': '7', 'resUserName': '홍, 김', 'alldayYn': 'N'});
    expect((r.display, r.title, r.ownerEmpSeq, hm(r.start)), ('[홍] A-1', '주간회의', '7', '14:00'));
    expect(GwReservation.fromRow({'resTitleDisplay': 'X'}).display, 'X');
  });
  test('메일 집계: 마지막 항목이 계정 전체, 빈 배열이면 0', () {
    final s = MailSummary.fromCounts([{'boxnameSeq': 1, 'count': 2, 'totalCount': 5}, {'unreadCount': '3', 'toMeCount': 1, 'totalCount': 40, 'flaggedCount': 0}]);
    expect((s.unread, s.toMe, s.total), (3, 1, 40));
    expect(MailSummary.fromCounts(const []).unread, 0);
  });
  test('INBOX mboxSeq 탐색: 중첩·대소문자·숫자/문자열', () {
    final tree = {'resultList': [{'name': 'Sent', 'mboxSeq': '2'}, {'children': [{'fullname': 'inbox', 'mboxSeq': 26986}]}]};
    expect(findMboxSeq(tree, 'INBOX'), 26986);
    expect(findMboxSeq(tree, 'SENT'), 2);
    expect(findMboxSeq(tree, 'DRAFTS'), isNull);
  });
  test('메일 항목: seen 0/1 → bool, attach bool', () {
    final m = MailItem.fromRow({'muid': 14531056, 'subject': 's', 'fromAddrName': '홍', 'fromAddrEmail': 'h@x', 'rfc822date': '07:10', 'tooltipDate': '2026-10-04 07:10', 'seen': 0, 'attach': true});
    expect((m.muid, m.seen, m.attach, m.fromName, m.date), ('14531056', false, true, '홍', '07:10'));
    expect(MailItem.fromRow({'seen': '1'}).seen, true);
  });
}
