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
}
