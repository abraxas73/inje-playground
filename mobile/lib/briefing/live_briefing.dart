import 'briefing_model.dart';

/// 라이브 액티비티(iOS 잠금 화면·다이내믹 아일랜드, Android 상시 알림)에 싣는 브리핑 — 순수 로직, 네트워크·위젯 없음.
/// 회의 시각은 실제 시각(UTC 순간)으로 바꿔 둔다 — 네이티브 카운트다운이 기기 시계와 비교하기 때문(GW 시각은 KST 벽시계).
class LiveBriefing {
  const LiveBriefing({this.meetingTitle = '', this.meetingStart, this.meetingEnd, this.approvals = 0, this.mentions = 0, this.mails = 0, this.notices = 0});
  final String meetingTitle;
  final DateTime? meetingStart, meetingEnd;
  final int approvals, mentions, mails, notices;

  int get total => approvals + mentions + mails + notices;

  /// "결재 2 · Teams 1 · 메일 3" — 0인 항목은 뺀다. 모두 0이면 빈 문자열.
  String get countsLine => [
        if (approvals > 0) '결재 $approvals',
        if (mentions > 0) 'Teams $mentions',
        if (mails > 0) '메일 $mails',
        if (notices > 0) '공지 $notices',
      ].join(' · ');

  Map<String, Object?> toJson() => {
        'meetingTitle': meetingTitle,
        'meetingStart': meetingStart?.millisecondsSinceEpoch,
        'meetingEnd': meetingEnd?.millisecondsSinceEpoch,
        'approvals': approvals,
        'mentions': mentions,
        'mails': mails,
        'notices': notices,
      };

  static LiveBriefing? fromJson(Object? j) {
    if (j is! Map) return null;
    DateTime? t(Object? v) => v is int ? DateTime.fromMillisecondsSinceEpoch(v, isUtc: true) : null;
    int n(Object? v) => v is int ? v : 0;
    return LiveBriefing(
      meetingTitle: j['meetingTitle'] is String ? j['meetingTitle'] as String : '',
      meetingStart: t(j['meetingStart']),
      meetingEnd: t(j['meetingEnd']),
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
LiveBriefing liveBriefingFrom(BriefingData d, {LiveBriefing? prev}) {
  String title = '';
  DateTime? start, end;
  if (d.today != null) {
    for (final e in myMeetings(d)) {
      if (e.allDay || absenceKind(e.title, e.calendar) != null) continue;
      final s = gwTime(e.start), en = gwTime(e.end);
      if (s == null || (en != null && !en.isAfter(d.now)) || (en == null && !s.isAfter(d.now))) continue;
      title = e.title.length > 40 ? '${e.title.substring(0, 40)}…' : e.title;
      start = kstWallToInstant(s);
      end = en == null ? null : kstWallToInstant(en);
      break;
    }
  } else if (prev != null) {
    title = prev.meetingTitle;
    start = prev.meetingStart;
    end = prev.meetingEnd;
  }
  final men = d.mentions;
  return LiveBriefing(
    meetingTitle: title,
    meetingStart: start,
    meetingEnd: end,
    approvals: d.approvals?.$2.length ?? prev?.approvals ?? 0,
    mentions: men == null ? prev?.mentions ?? 0 : (men.connected ? men.items.length : 0),
    mails: d.inbox == null ? prev?.mails ?? 0 : unreadMailsToday(d),
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
