import 'package:flutter/material.dart';
import '../gw/gw_client.dart' show asBool, asStr;
import '../gw/gw_models.dart';

/// 홈 브리핑의 순수 로직 — 수집 결과(BriefingData)에서 섹션 데이터·"지금 필요한 것"·Claude용 압축 payload를 만든다. 네트워크·위젯 없음.

enum AbsenceKind {
  half('반차'), leave('휴가'), trip('출장'), remote('재택'), training('교육');
  const AbsenceKind(this.label);
  final String label;
}

const _absenceWords = <AbsenceKind, List<String>>{
  AbsenceKind.half: ['반차'],
  AbsenceKind.leave: ['연차', '휴가', '병가', '경조'],
  AbsenceKind.trip: ['출장', '외근'],
  AbsenceKind.remote: ['재택'],
  AbsenceKind.training: ['교육'],
};

/// 제목·캘린더명에 근태 키워드가 있으면 그 종류. 반차를 먼저 본다("연차(반차)").
AbsenceKind? absenceKind(String title, String calendar) {
  final s = '$title $calendar';
  for (final e in _absenceWords.entries) {
    if (e.value.any(s.contains)) return e.key;
  }
  return null;
}

class Absence {
  const Absence({required this.who, required this.what, required this.kind});
  final String who, what;
  final AbsenceKind kind;
}

class TeamsMention {
  const TeamsMention({required this.chatId, required this.topic, required this.from, required this.text, required this.at});
  final String chatId, topic, from, text, at;
  factory TeamsMention.fromJson(Map j) => TeamsMention(chatId: asStr(j['chatId']), topic: asStr(j['topic']), from: asStr(j['from']), text: asStr(j['text']), at: asStr(j['at']));
}

class TeamsMentions {
  const TeamsMentions({required this.connected, required this.items});
  final bool connected;
  final List<TeamsMention> items;
  static TeamsMentions parse(dynamic j) {
    if (j is! Map) return const TeamsMentions(connected: false, items: []);
    final raw = j['items'];
    return TeamsMentions(connected: asBool(j['connected']), items: [if (raw is List) for (final x in raw) if (x is Map) TeamsMention.fromJson(x)]);
  }
}

/// 소스별 수집 결과. 실패한 소스는 null + errors[소스]. 수집기가 채우므로 가변.
class BriefingData {
  BriefingData({required this.now, this.name = '', this.empSeq = ''});
  final DateTime now;
  String name, empSeq;
  List<GwEvent>? today, tomorrow;
  List<GwCalendar>? cals;
  (int, List<PendingApproval>)? approvals;
  (int, List<MailItem>)? inbox;
  MailSummary? mailSummary;
  (int, List<GwNotice>)? notices;
  Attendance? attendance;
  TeamsMentions? mentions;
  final errors = <String, String>{};
}

String _digits(String s) => s.replaceAll(RegExp(r'\D'), '');

/// 'YYYYMMDDHHmm'(구분자 있어도 됨) → DateTime. 12자리 미만이면 null.
/// 규약: GW 시각은 KST 벽시계이고 `kstNow()`도 "KST 벽시계 + UTC 플래그"라, 같은 플래그(`DateTime.utc`)로 만들어야 difference·isAfter가 맞다.
/// `DateTime(...)`(local)로 만들면 기기 UTC 오프셋만큼 어긋난다(KST 기기에서 9시간).
DateTime? gwTime(String s) {
  final d = _digits(s);
  if (d.length < 12) return null;
  return DateTime.utc(int.parse(d.substring(0, 4)), int.parse(d.substring(4, 6)), int.parse(d.substring(6, 8)), int.parse(d.substring(8, 10)), int.parse(d.substring(10, 12)));
}

GwEvent _prefixed(GwEvent e, AbsenceKind k) => GwEvent(schSeq: e.schSeq, title: '${k.label}: ${e.title}', start: e.start, end: e.end, allDay: e.allDay, calendar: e.calendar, mcalSeq: e.mcalSeq, mine: e.mine, createName: e.createName, place: e.place);

/// 내 일정(myEvents) 시간순. 내 근태는 빼지 않고 "휴가: " 접두를 붙인다.
List<GwEvent> myMeetings(BriefingData d) {
  final list = [for (final e in myEvents(d.today ?? const [], d.cals ?? const [], d.empSeq)) switch (absenceKind(e.title, e.calendar)) { null => e, AbsenceKind k => _prefixed(e, k) }];
  list.sort((a, b) => a.start.compareTo(b.start));
  return list;
}

/// 내 것이 아닌 일정 중 근태 키워드가 있는 것 — 아마란스 mine 플래그에 섞여 오는 팀원 연차·출장을 분리한다.
List<Absence> teamAbsences(BriefingData d) {
  final mine = {for (final e in myEvents(d.today ?? const [], d.cals ?? const [], d.empSeq)) e.schSeq};
  final out = <Absence>[];
  for (final e in d.today ?? const <GwEvent>[]) {
    if (mine.contains(e.schSeq)) continue;
    final k = absenceKind(e.title, e.calendar);
    if (k != null) out.add(Absence(who: e.createName.isNotEmpty ? e.createName : e.title, what: e.title, kind: k));
  }
  return out;
}

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// 'YYYY-MM-DD…'·'YYYYMMDD…'·RFC822('Mon, 05 Oct 2026 …') 모두 같은 날인지.
bool isSameDay(String s, DateTime now) {
  final t = s.trim();
  final iso = RegExp(r'^(\d{4})-?(\d{2})-?(\d{2})').firstMatch(t);
  if (iso != null) return int.parse(iso[1]!) == now.year && int.parse(iso[2]!) == now.month && int.parse(iso[3]!) == now.day;
  final rfc = RegExp(r'(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})').firstMatch(t);
  if (rfc != null) return int.parse(rfc[3]!) == now.year && _months.indexOf(rfc[2]!) + 1 == now.month && int.parse(rfc[1]!) == now.day;
  return false;
}

int unreadMailsToday(BriefingData d) => (d.inbox?.$2 ?? const <MailItem>[]).where((m) => !m.seen && isSameDay(m.tooltip.isNotEmpty ? m.tooltip : m.date, d.now)).length;

/// 평일 09:30 이후, 휴일 아님, 출근 기록 없음.
bool needsClockIn(Attendance? a, DateTime now) => a != null && !a.holiday && !a.clockedIn && now.weekday <= DateTime.friday && (now.hour > 9 || (now.hour == 9 && now.minute >= 30));

class FocusItem {
  const FocusItem({required this.icon, required this.text, required this.route});
  final IconData icon;
  final String text, route;
}

final teamsRoute = '/web?path=${Uri.encodeComponent('/teams/chat')}';

/// "지금 필요한 것" — 우선순위: 곧 시작하는 회의 → 결재(안 읽음·2일 이상) → Teams 답장 대기 → 오늘 안 읽은 메일 → 출근 미기록 → 새 공지. 최대 4.
List<FocusItem> focusItems(BriefingData d) {
  final out = <FocusItem>[];
  for (final e in myMeetings(d)) {
    if (e.allDay || absenceKind(e.title, e.calendar) != null) continue;
    final s = gwTime(e.start), en = gwTime(e.end);
    if (s == null || s.difference(d.now).inMinutes > 90 || (en != null && !en.isAfter(d.now))) continue;
    out.add(FocusItem(icon: Icons.event, text: '${hm(e.start)} ${e.title}${e.place.isNotEmpty ? ' · ${e.place}' : ''}', route: '/gw/today'));
    break;
  }
  final ap = d.approvals?.$2 ?? const <PendingApproval>[];
  if (ap.any((a) => a.unread || (a.waitingDays(d.now) ?? 0) >= 2)) {
    final oldest = ap.fold(0, (m, a) => (a.waitingDays(d.now) ?? 0) > m ? (a.waitingDays(d.now) ?? 0) : m);
    out.add(FocusItem(icon: Icons.fact_check_outlined, text: '미결 결재 ${ap.length}건${oldest >= 2 ? ' · 가장 오래 $oldest일' : ''}', route: '/gw/approvals'));
  }
  final men = d.mentions;
  if (men != null && men.connected && men.items.isNotEmpty) out.add(FocusItem(icon: Icons.forum_outlined, text: 'Teams 답장 대기 ${men.items.length}건', route: teamsRoute));
  final um = unreadMailsToday(d);
  if (um > 0) out.add(FocusItem(icon: Icons.mail_outline, text: '오늘 받은 안 읽은 메일 $um통', route: '/gw/mail'));
  if (needsClockIn(d.attendance, d.now)) out.add(const FocusItem(icon: Icons.timer_outlined, text: '출근 기록이 없습니다', route: '/gw/attendance'));
  final nn = (d.notices?.$2 ?? const <GwNotice>[]).where((n) => n.isNew && !n.read).length;
  if (nn > 0) out.add(FocusItem(icon: Icons.campaign_outlined, text: '새 공지 $nn건', route: '/gw/board'));
  return out.take(4).toList();
}

String _cut(String s, [int n = 120]) => s.length > n ? '${s.substring(0, n)}…' : s;
String _two(int v) => v.toString().padLeft(2, '0');
const _weekdays = ['월', '화', '수', '목', '금', '토', '일'];

/// Claude에 보내는 압축 JSON — 제목·이름·시각만, 본문 없음. 서버가 다시 자르지만 여기서도 자른다.
Map<String, dynamic> summaryPayload(BriefingData d) {
  final n = d.now;
  return {
    'date': '${n.year}-${_two(n.month)}-${_two(n.day)} (${_weekdays[n.weekday - 1]}) ${_two(n.hour)}:${_two(n.minute)}',
    'name': _cut(d.name, 40),
    'meetings': [for (final e in myMeetings(d).take(8)) {'time': e.allDay ? '종일' : '${hm(e.start)}–${hm(e.end)}', 'title': _cut(e.title), if (e.place.isNotEmpty) 'place': _cut(e.place)}],
    'tomorrow': myEvents(d.tomorrow ?? const [], d.cals ?? const [], d.empSeq).length,
    'absences': [for (final a in teamAbsences(d).take(8)) {'who': _cut(a.who, 40), 'what': _cut(a.what)}],
    'approvals': [for (final a in (d.approvals?.$2 ?? const <PendingApproval>[]).take(8)) {'title': _cut(a.title), 'from': _cut(a.drafter, 40), 'days': a.waitingDays(d.now), 'unread': a.unread}],
    'mails': [for (final m in (d.inbox?.$2 ?? const <MailItem>[]).where((m) => !m.seen).take(8)) {'from': _cut(m.fromName, 40), 'subject': _cut(m.subject), 'when': _cut(m.tooltip.isNotEmpty ? m.tooltip : m.date, 40)}],
    'mentions': [for (final x in (d.mentions?.items ?? const <TeamsMention>[]).take(5)) {'chat': _cut(x.topic, 40), 'from': _cut(x.from, 40), 'text': _cut(x.text, 80)}],
    'notices': [for (final x in (d.notices?.$2 ?? const <GwNotice>[]).take(3)) {'title': _cut(x.title), 'board': _cut(x.board, 40)}],
    'attendance': d.attendance == null ? null : {'clockedIn': d.attendance!.clockedIn, 'holiday': d.attendance!.holiday},
  };
}
