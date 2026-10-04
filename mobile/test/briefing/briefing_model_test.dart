import 'package:flutter_test/flutter_test.dart';
import 'package:playground/briefing/briefing_model.dart';
import 'package:playground/gw/gw_models.dart';

GwEvent ev(String id, String title, {String start = '202610051000', String end = '202610051100', bool mine = true, String who = '', String cal = '내 캘린더', String mcal = '1', bool allDay = false, String place = ''}) =>
    GwEvent(schSeq: id, title: title, start: start, end: end, allDay: allDay, calendar: cal, mcalSeq: mcal, mine: mine, createName: who, place: place);
PendingApproval ap(String title, {String arrived = '20261002', bool unread = false}) =>
    PendingApproval(docId: title, formId: 'f', title: title, form: 'f', drafter: '이서연', dept: '팀', arrivedDt: arrived, status: '진행', unread: unread, fileCount: 0);
MailItem mail(String subject, {String tooltip = '2026-10-05 09:12:00', String date = '', bool seen = false}) =>
    MailItem(muid: subject, subject: subject, fromName: '박지훈', fromEmail: 'p@x', date: date, tooltip: tooltip, seen: seen, attach: false);
final now = DateTime.utc(2026, 10, 5, 8, 40); // 월요일 — 운영과 같은 규약: kstNow()는 KST 벽시계 + UTC 플래그

BriefingData data({List<GwEvent>? today, List<PendingApproval>? approvals, List<MailItem>? inbox, Attendance? att, TeamsMentions? mentions, List<GwNotice>? notices, DateTime? at}) {
  final d = BriefingData(now: at ?? now, name: '강승욱', empSeq: '7');
  d.today = today; d.cals = const [GwCalendar(mcalSeq: '1', title: '내 캘린더', calType: 'E', ownerEmpSeq: '7', color: '')];
  if (approvals != null) d.approvals = (approvals.length, approvals);
  if (inbox != null) d.inbox = (inbox.length, inbox);
  if (notices != null) d.notices = (notices.length, notices);
  d.attendance = att; d.mentions = mentions;
  return d;
}

void main() {
  test('absenceKind — 제목·캘린더명 키워드, 반차는 연차보다 먼저', () {
    expect(absenceKind('김민준 연차', ''), AbsenceKind.leave);
    expect(absenceKind('연차(반차)', ''), AbsenceKind.half);
    expect(absenceKind('부산 출장', ''), AbsenceKind.trip);
    expect(absenceKind('재택', ''), AbsenceKind.remote);
    expect(absenceKind('주간회의', '휴가 캘린더'), AbsenceKind.leave);
    expect(absenceKind('주간회의', '팀 캘린더'), isNull);
  });
  test('gwTime — YYYYMMDDHHmm만, 다른 형식은 null', () {
    expect(gwTime('202610051030'), DateTime.utc(2026, 10, 5, 10, 30)); // kstNow()와 같은 플래그여야 difference가 맞다
    expect(gwTime('2026-10-05 10:30'), DateTime.utc(2026, 10, 5, 10, 30));
    expect(gwTime('20261005'), isNull);
  });
  test('myMeetings는 내 것만 시간순·부재는 접두 표시, teamAbsences는 남의 근태만', () {
    final d = data(today: [ev('b', '점심', start: '202610051200', end: '202610051300'), ev('a', '주간회의'), ev('x', '김민준 연차', mine: false, who: '김민준', mcal: '9'), ev('y', '출장(부산)', mine: false, who: '', mcal: '9'), ev('z', '내 반차', start: '202610051400', end: '202610051800'), ev('w', '남의 회의', mine: false, mcal: '9')]);
    expect(myMeetings(d).map((e) => e.title).toList(), ['주간회의', '점심', '반차: 내 반차']);
    final abs = teamAbsences(d);
    expect(abs.map((a) => '${a.who}|${a.kind.name}').toList(), ['김민준|leave', '출장(부산)|trip']);
  });
  test('isSameDay — ISO·숫자·RFC822 형식 모두, 다른 날은 false', () {
    expect(isSameDay('2026-10-05 09:12:00', now), isTrue);
    expect(isSameDay('20261005091200', now), isTrue);
    expect(isSameDay('Mon, 05 Oct 2026 09:12:00 +0900', now), isTrue);
    expect(isSameDay('2026-10-04 23:59:00', now), isFalse);
    expect(isSameDay('', now), isFalse);
  });
  test('unreadMailsToday·needsClockIn', () {
    final d = data(inbox: [mail('a'), mail('b', seen: true), mail('c', tooltip: '2026-10-04 09:00:00'), mail('d', tooltip: '', date: 'Mon, 05 Oct 2026 07:00:00 +0900')]);
    expect(unreadMailsToday(d), 2);
    const none = Attendance(workDt: '20261005', comeTm: '', leaveTm: '', holiday: false);
    expect(needsClockIn(none, now), isFalse, reason: '09:30 전');
    expect(needsClockIn(none, DateTime(2026, 10, 5, 9, 30)), isTrue);
    expect(needsClockIn(const Attendance(workDt: '', comeTm: '202610050850', leaveTm: '', holiday: false), DateTime(2026, 10, 5, 10)), isFalse);
    expect(needsClockIn(const Attendance(workDt: '', comeTm: '', leaveTm: '', holiday: true), DateTime(2026, 10, 5, 10)), isFalse);
    expect(needsClockIn(none, DateTime(2026, 10, 4, 10)), isFalse, reason: '일요일');
    expect(needsClockIn(null, DateTime(2026, 10, 5, 10)), isFalse);
  });
  test('focusItems — 규칙 6개 우선순위·최대 4·ARRIVED_DT 없는 결재는 안 읽음으로만', () {
    final d = data(
      today: [ev('a', '주간회의', start: '202610050930', end: '202610051030', place: '3층'), ev('late', '오후 회의', start: '202610051500', end: '202610051600')],
      approvals: [ap('휴가 신청', arrived: '20261002'), ap('지출 결의', arrived: '', unread: true)],
      inbox: [mail('견적')],
      att: const Attendance(workDt: '', comeTm: '', leaveTm: '', holiday: false),
      mentions: const TeamsMentions(connected: true, items: [TeamsMention(chatId: 'c', topic: '센터', from: '김민준', text: '확인', at: '2026-10-05T00:00:00Z')]),
      notices: [GwNotice(artSeqNo: '1', title: '보안 교육', board: '공지', boardId: '', writer: '', dept: '', writeDate: '', readCnt: 0, fileCnt: 0, attachmentUid: '', isNew: true, read: false, preview: '')],
      at: DateTime.utc(2026, 10, 5, 9, 40),
    );
    final items = focusItems(d);
    expect(items.map((i) => i.text).toList(), ['09:30 주간회의 · 3층', '미결 결재 2건 · 가장 오래 3일', 'Teams 답장 대기 1건', '오늘 받은 안 읽은 메일 1통']);
    expect(items.map((i) => i.route).toList(), ['/gw/today', '/gw/approvals', teamsRoute, '/gw/mail']);
    expect(focusItems(data()), isEmpty);
    final onlyUnread = focusItems(data(approvals: [ap('지출', arrived: '', unread: true)]));
    expect(onlyUnread.single.text, '미결 결재 1건');
    expect(focusItems(data(approvals: [ap('어제 것', arrived: '20261004')])), isEmpty, reason: '1일·읽음은 급하지 않음');
  });
  test('summaryPayload — 제목 수준만, 목록 상한, 120자 절단, 본문 없음', () {
    final d = data(
      today: [for (var i = 0; i < 10; i++) ev('m$i', '회의 ${'제'.padRight(200, '목')}', start: '20261005${(9 + i).toString().padLeft(2, '0')}00', end: '202610051800')],
      approvals: [ap('휴가 신청', unread: true)], inbox: [mail('견적'), mail('읽은 것', seen: true)],
      mentions: const TeamsMentions(connected: true, items: [TeamsMention(chatId: 'c', topic: '센터', from: '김민준', text: '확인 부탁', at: '')]),
      att: const Attendance(workDt: '', comeTm: '202610050850', leaveTm: '', holiday: false),
    );
    final p = summaryPayload(d);
    expect(p['date'], '2026-10-05 (월) 08:40');
    expect(p['name'], '강승욱');
    expect((p['meetings'] as List).length, 8);
    expect(((p['meetings'] as List).first as Map)['title'].toString().length, 121);
    expect((p['meetings'] as List).first, containsPair('time', '09:00–18:00'));
    expect(p['approvals'], [{'title': '휴가 신청', 'from': '이서연', 'days': 3, 'unread': true}]);
    expect((p['mails'] as List).length, 1, reason: '안 읽은 것만');
    expect(p['mentions'], [{'chat': '센터', 'from': '김민준', 'text': '확인 부탁'}]);
    expect(p['attendance'], {'clockedIn': true, 'holiday': false});
    expect(p.toString(), isNot(contains('preview')));
  });
  test('TeamsMentions.parse — 형식 오류는 미연결로', () {
    expect(TeamsMentions.parse({'connected': true, 'items': [{'chatId': 'c', 'topic': 't', 'from': 'f', 'text': 'x', 'at': 'a'}, 'junk']}).items.length, 1);
    expect(TeamsMentions.parse('nope').connected, isFalse);
    expect(TeamsMentions.parse({'connected': false}).items, isEmpty);
  });
}
