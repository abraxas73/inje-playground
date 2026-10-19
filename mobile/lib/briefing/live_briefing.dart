import 'briefing_model.dart';

/// 잠금 화면에 싣는 한 줄 — 회의(제목·시작·끝), 결재(제목·기안자), 메일(제목·보낸 사람).
class LiveItem {
  const LiveItem(this.title, {this.sub = '', this.start, this.end});
  final String title, sub;
  final DateTime? start, end;

  Map<String, Object?> toJson() => {'title': title, 'sub': sub, 'start': start?.millisecondsSinceEpoch, 'end': end?.millisecondsSinceEpoch};

  static LiveItem? fromJson(Object? j) => j is Map && j['title'] is String
      ? LiveItem(j['title'] as String, sub: j['sub'] is String ? j['sub'] as String : '', start: _instant(j['start']), end: _instant(j['end']))
      : null;
}

DateTime? _instant(Object? v) => v is int ? DateTime.fromMillisecondsSinceEpoch(v, isUtc: true) : null;
List<LiveItem> _itemsFrom(Object? v) => v is List ? v.map(LiveItem.fromJson).whereType<LiveItem>().toList() : const [];
String _cut(String s, [int n = 40]) => s.length > n ? '${s.substring(0, n)}…' : s;

/// 잠금 화면에 보이는 종류별 최대 건수(회의·결재·메일 각 2 — 있는 만큼만)와 전체 줄 수 상한(셋 다 2건이면 마지막 메일이 빠진다)
const liveMaxPerKind = 2, liveMaxLines = 5;

/// 이미 시작한 회의도 이 시간 안이면 보인다(늦게 들어가는 회의)
const liveRecentStart = Duration(minutes: 10);

/// 라이브 액티비티(iOS 잠금 화면·다이내믹 아일랜드, Android 상시 알림)에 싣는 브리핑 — 순수 로직, 네트워크·위젯 없음.
/// 회의 시각은 실제 시각(UTC 순간)으로 바꿔 둔다 — 네이티브 카운트다운이 기기 시계와 비교하기 때문(GW 시각은 KST 벽시계).
class LiveBriefing {
  const LiveBriefing({this.meetings = const [], this.meetingCount = 0, this.approvalItems = const [], this.mailItems = const [], this.approvals = 0, this.mentions = 0, this.mails = 0, this.notices = 0});
  /// 다가오는 회의(최대 [liveMaxPerKind]) — 첫 건이 다이내믹 아일랜드·Android 카운트다운
  final List<LiveItem> meetings, approvalItems, mailItems;
  /// 다가오는 회의 전체 건수(건수 줄 "일정 N")
  final int meetingCount;
  final int approvals, mentions, mails, notices;

  String get meetingTitle => meetings.isEmpty ? '' : meetings.first.title;
  DateTime? get meetingStart => meetings.isEmpty ? null : meetings.first.start;
  DateTime? get meetingEnd => meetings.isEmpty ? null : meetings.first.end;

  /// 다이내믹 아일랜드 합계 — 확인할 항목만(일정 제외)
  int get total => approvals + mentions + mails + notices;

  /// "일정 2 · 결재 2 · Teams 1 · 메일 3" — 0인 항목은 뺀다. 모두 0이면 빈 문자열.
  String get countsLine => [
        if (meetingCount > 0) '일정 $meetingCount',
        if (approvals > 0) '결재 $approvals',
        if (mentions > 0) 'Teams $mentions',
        if (mails > 0) '메일 $mails',
        if (notices > 0) '공지 $notices',
      ].join(' · ');

  /// 잠금 화면 줄(회의 → 결재 → 메일, 최대 [liveMaxLines]줄). iOS 위젯이 kind로 아이콘을 고른다.
  List<Map<String, Object?>> get lockItems => [
        for (final m in meetings) {'kind': 'meeting', ...m.toJson()},
        for (final a in approvalItems) {'kind': 'approval', ...a.toJson()},
        for (final m in mailItems) {'kind': 'mail', ...m.toJson()},
      ].take(liveMaxLines).toList();

  /// Android 펼친 알림 줄 — 회의 시각은 KST로 적는다.
  List<String> get lockLines {
    String hm(DateTime t) {
      final k = t.toUtc().add(const Duration(hours: 9));
      return '${k.hour.toString().padLeft(2, '0')}:${k.minute.toString().padLeft(2, '0')}';
    }
    String line(String icon, LiveItem i) => '$icon ${i.title}${i.sub.isEmpty ? '' : ' · ${i.sub}'}';
    return [
      for (final m in meetings) '📅 ${m.start == null ? '' : '${hm(m.start!)} '}${m.title}',
      for (final a in approvalItems) line('✅', a),
      for (final m in mailItems) line('✉️', m),
    ].take(liveMaxLines).toList();
  }

  Map<String, Object?> toJson() => {
        'meetingTitle': meetingTitle,
        'meetingStart': meetingStart?.millisecondsSinceEpoch,
        'meetingEnd': meetingEnd?.millisecondsSinceEpoch,
        'meetings': [for (final m in meetings) m.toJson()],
        'meetingCount': meetingCount,
        'approvalItems': [for (final a in approvalItems) a.toJson()],
        'mailItems': [for (final m in mailItems) m.toJson()],
        'approvals': approvals,
        'mentions': mentions,
        'mails': mails,
        'notices': notices,
      };

  static LiveBriefing? fromJson(Object? j) {
    if (j is! Map) return null;
    int n(Object? v) => v is int ? v : 0;
    return LiveBriefing(
      meetings: _itemsFrom(j['meetings']),
      meetingCount: n(j['meetingCount']),
      approvalItems: _itemsFrom(j['approvalItems']),
      mailItems: _itemsFrom(j['mailItems']),
      approvals: n(j['approvals']),
      mentions: n(j['mentions']),
      mails: n(j['mails']),
      notices: n(j['notices']),
    );
  }
}

/// KST 벽시계(`DateTime.utc` 플래그) → 실제 순간.
DateTime kstWallToInstant(DateTime wall) => DateTime.utc(wall.year, wall.month, wall.day, wall.hour, wall.minute).subtract(const Duration(hours: 9));

/// 수집 결과 → 라이브 브리핑. 못 받은 소스(null)는 직전 값을 유지한다(백그라운드는 아마란스만 수집).
/// 회의는 지금으로부터 [liveRecentStart] 전 이후에 시작하는 것만(종일·근태 제외) — 오래전에 시작해 진행 중인 회의는 뺀다.
LiveBriefing liveBriefingFrom(BriefingData d, {LiveBriefing? prev}) {
  var meetings = prev?.meetings ?? const <LiveItem>[];
  var meetingCount = prev?.meetingCount ?? 0;
  if (d.today != null) {
    final from = d.now.subtract(liveRecentStart);
    final upcoming = <LiveItem>[];
    for (final e in myMeetings(d)) {
      if (e.allDay || absenceKind(e.title, e.calendar) != null) continue;
      final s = gwTime(e.start), en = gwTime(e.end);
      if (s == null || s.isBefore(from)) continue;
      upcoming.add(LiveItem(_cut(e.title), start: kstWallToInstant(s), end: en == null ? null : kstWallToInstant(en)));
    }
    meetings = upcoming.take(liveMaxPerKind).toList();
    meetingCount = upcoming.length;
  }
  final ap = d.approvals?.$2;
  final mailList = d.inbox == null ? null : unreadMailItemsToday(d);
  final men = d.mentions;
  return LiveBriefing(
    meetings: meetings,
    meetingCount: meetingCount,
    approvalItems: ap == null ? prev?.approvalItems ?? const [] : [for (final a in ap.take(liveMaxPerKind)) LiveItem(_cut(a.title), sub: _cut(a.drafter, 12))],
    mailItems: mailList == null ? prev?.mailItems ?? const [] : [for (final m in mailList.take(liveMaxPerKind)) LiveItem(_cut(m.subject.isEmpty ? '(제목 없음)' : m.subject), sub: _cut(m.fromName, 12))],
    approvals: ap?.length ?? prev?.approvals ?? 0,
    mentions: men == null ? prev?.mentions ?? 0 : (men.connected ? men.items.length : 0),
    mails: mailList?.length ?? prev?.mails ?? 0,
    notices: d.notices == null ? prev?.notices ?? 0 : d.notices!.$2.where((n) => n.isNew && !n.read).length,
  );
}

/// 다이내믹 아일랜드를 펼칠 변경 — 건수가 **늘어난** 항목만, 없으면 null. 직전 값이 없으면(오늘 첫 표시) 알리지 않는다.
String? liveAlert(LiveBriefing? prev, LiveBriefing next) {
  if (prev == null) return null;
  final parts = [
    if (next.approvals > prev.approvals) '결재 ${next.approvals - prev.approvals}건',
    if (next.mentions > prev.mentions) 'Teams 답장 대기 ${next.mentions - prev.mentions}건',
    if (next.mails > prev.mails) '메일 ${next.mails - prev.mails}통',
    if (next.notices > prev.notices) '공지 ${next.notices - prev.notices}건',
  ];
  return parts.isEmpty ? null : '${parts.join(', ')} 새로 도착';
}

/// 표시 기간 — 평일 KST 07:00~18:30.
bool inLiveWindow(DateTime kst) {
  if (kst.weekday > DateTime.friday) return false;
  final m = kst.hour * 60 + kst.minute;
  return m >= 7 * 60 && m < 18 * 60 + 30;
}
