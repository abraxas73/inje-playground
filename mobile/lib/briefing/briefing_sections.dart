import 'package:flutter/material.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import '../features/home/quotes.dart';
import '../gw/gw_models.dart';
import 'briefing_model.dart';

/// 홈 브리핑 섹션 위젯 — 데이터만 받아 그린다(상태·네트워크 없음). 데이터가 비면 SizedBox.shrink().

class SummaryText {
  const SummaryText({required this.text, required this.at});
  final String text, at;
}

/// 네이비 격언 카드 "오늘의 한 줄"(기존 홈 그대로) — 브리핑과 무관하게 언제나 보인다.
class QuoteCard extends StatelessWidget {
  const QuoteCard({super.key, required this.quote});
  final Quote quote;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 14),
        decoration: BoxDecoration(color: Brand.navy, borderRadius: BorderRadius.circular(16)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Row(children: [
            Icon(Icons.format_quote_rounded, size: 18, color: Brand.sky),
            SizedBox(width: 6),
            Text('오늘의 한 줄', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.3, color: Brand.sky)),
          ]),
          const SizedBox(height: 10),
          Text(quote.text, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, height: 1.5, color: Colors.white)),
          const SizedBox(height: 8),
          Align(alignment: Alignment.centerRight, child: Text('— ${quote.source}', style: TextStyle(fontSize: 13, color: Colors.white.withValues(alpha: 0.6)))),
        ]),
      );
}

/// "데일리 브리핑" — Claude가 하루 1회 쓴 2~3문장. 최신 업무 데이터로 다시 생성할 수 있다.
class BriefingCard extends StatelessWidget {
  const BriefingCard({super.key, required this.summary, this.busy = false, this.onClockIn, this.onRefresh});
  final SummaryText? summary;
  final bool busy;
  final VoidCallback? onRefresh;
  /// 출근 기록이 없을 때만 넘긴다 — 문장 아래 "출퇴근 바로 가기"(앱 안 이동).
  final VoidCallback? onClockIn;
  @override
  Widget build(BuildContext context) {
    final s = summary;
    if (s == null && !busy && onRefresh == null) return const SizedBox.shrink();
    return _Section(
      title: '데일리 브리핑',
      trailing: onRefresh == null ? null : IconButton(tooltip: '브리핑 새로고침', onPressed: busy ? null : onRefresh, icon: const Icon(Icons.refresh)),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
        child: s == null
            ? (busy ? const LinearProgressIndicator(minHeight: 2) : const Text('새로고침을 눌러 브리핑을 받아보세요.'))
            : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (busy) const LinearProgressIndicator(minHeight: 2),
                Text(s.text, style: const TextStyle(fontSize: 15, height: 1.6, color: Brand.navy)),
                if (onClockIn != null) ...[
                  const SizedBox(height: 10),
                  FilledButton.tonalIcon(onPressed: onClockIn, icon: const Icon(Icons.login, size: 18), label: const Text('출퇴근 바로 가기')),
                ],
                const SizedBox(height: 8),
                Align(alignment: Alignment.centerRight, child: Text('Claude · ${s.at}', style: const TextStyle(fontSize: 12, color: Brand.muted))),
              ]),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child, this.trailing});
  final String title;
  final Widget child;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(padding: const EdgeInsets.only(left: 4, bottom: 6), child: Row(children: [Text(title, style: Theme.of(context).textTheme.titleSmall), const Spacer(), ?trailing])),
          Card(child: child),
        ]),
      );
}

Widget _more(String label, VoidCallback onTap) => TextButton(onPressed: onTap, child: Text(label));

/// 소스 실패 한 줄 — 누르면 전체 재수집.
class RetryLine extends StatelessWidget {
  const RetryLine({super.key, required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 10),
        child: Row(children: [
          const Icon(Icons.error_outline, size: 16, color: Brand.dangerText),
          const SizedBox(width: 6),
          Text('$label을(를) 불러오지 못했습니다', style: const TextStyle(fontSize: 12, color: Brand.dangerText)),
          const Spacer(),
          TextButton(onPressed: onTap, child: const Text('다시 시도')),
        ]),
      );
}

/// 아마란스 미연결·만료 안내(옛 GwTodayCard의 것).
class GwConnectCard extends StatelessWidget {
  const GwConnectCard({super.key, required this.relogin, required this.onConnect});
  final bool relogin;
  final VoidCallback? onConnect;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 14),
        child: Card(
          child: ListTile(
            leading: const TintIcon(Icons.apartment_outlined, size: 40),
            title: Text(relogin ? '아마란스 로그인이 만료되었습니다' : '아마란스를 연결하세요'),
            subtitle: Text(relogin ? '다시 연결하면 이어서 봅니다' : '일정·결재·메일·공지를 브리핑으로 봅니다', style: Theme.of(context).textTheme.bodySmall),
            trailing: FilledButton(onPressed: onConnect, child: Text(relogin ? '다시 연결' : '연결하기')),
          ),
        ),
      );
}

class FocusSection extends StatelessWidget {
  const FocusSection({super.key, required this.items, required this.onOpen});
  final List<FocusItem> items;
  final void Function(String route) onOpen;
  @override
  Widget build(BuildContext context) => _Section(
        title: '지금 필요한 것',
        child: items.isEmpty
            ? const Padding(padding: EdgeInsets.all(14), child: Text('지금 당장 처리할 것은 없습니다', style: TextStyle(fontSize: 13, color: Brand.muted)))
            : Column(children: [
                for (final (i, it) in items.indexed) ...[
                  if (i > 0) const Divider(height: 1),
                  ListTile(dense: true, leading: TintIcon(it.icon, size: 32, background: Brand.blueTint, color: Brand.navy), title: Text(it.text, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)), trailing: const Icon(Icons.chevron_right, color: Brand.faint), onTap: () => onOpen(it.route)),
                ],
              ]),
      );
}

class MeetingsSection extends StatelessWidget {
  const MeetingsSection({super.key, required this.meetings, required this.tomorrowCount, required this.onMore});
  final List<GwEvent> meetings;
  final int tomorrowCount;
  final VoidCallback onMore;
  @override
  Widget build(BuildContext context) {
    if (meetings.isEmpty && tomorrowCount == 0) return const SizedBox.shrink();
    final shown = meetings.take(6).toList();
    final rest = meetings.length - shown.length;
    return _Section(
      title: '오늘 일정',
      trailing: _more('일정', onMore),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (final e in shown)
          ListTile(dense: true, leading: SizedBox(width: 52, child: Text(e.allDay ? '종일' : hm(e.start), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.navy))), title: Text(e.title, maxLines: 1, overflow: TextOverflow.ellipsis), subtitle: e.place.isEmpty ? null : Text(e.place, style: const TextStyle(fontSize: 12))),
        if (rest > 0 || tomorrowCount > 0)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
            child: Row(children: [if (rest > 0) Text('$rest개 더', style: const TextStyle(fontSize: 12, color: Brand.muted)), const Spacer(), if (tomorrowCount > 0) Text('내일 $tomorrowCount건', style: const TextStyle(fontSize: 12, color: Brand.muted))]),
          ),
      ]),
    );
  }
}

class AbsenceSection extends StatelessWidget {
  const AbsenceSection({super.key, required this.absences, this.title = '팀원 부재'});
  final List<Absence> absences;
  final String title;
  @override
  Widget build(BuildContext context) => absences.isEmpty
      ? const SizedBox.shrink()
      : _Section(
          title: title,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
            child: Wrap(spacing: 8, runSpacing: 8, children: [for (final a in absences) Chip(avatar: InitialBadge(a.who, size: 22, circle: true), label: Text('${a.who} · ${a.what}'))]),
          ),
        );
}

class ApprovalsSection extends StatelessWidget {
  const ApprovalsSection({super.key, required this.total, required this.items, required this.now, required this.onMore});
  final int total;
  final List<PendingApproval> items;
  final DateTime now;
  final VoidCallback onMore;
  @override
  Widget build(BuildContext context) => items.isEmpty
      ? const SizedBox.shrink()
      : _Section(
          title: '미결 결재 $total',
          trailing: _more('더 보기', onMore),
          child: Column(children: [
            for (final a in items.take(3))
              ListTile(dense: true, leading: InitialBadge(a.drafter, size: 32, circle: true), title: Text(a.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: a.unread ? FontWeight.w700 : FontWeight.w500)), subtitle: Text('${a.drafter} · ${a.form}', style: const TextStyle(fontSize: 12)), trailing: Text(a.waitingDays(now) == null ? '' : '${a.waitingDays(now)}일째', style: const TextStyle(fontSize: 12, color: Brand.muted))),
          ]),
        );
}

class MailsSection extends StatelessWidget {
  const MailsSection({super.key, required this.items, required this.unreadTotal, required this.onMore});
  final List<MailItem> items;
  final int unreadTotal;
  final VoidCallback onMore;
  @override
  Widget build(BuildContext context) {
    final unread = items.where((m) => !m.seen).take(3).toList();
    if (unread.isEmpty) return const SizedBox.shrink();
    return _Section(
      title: '안 읽은 메일 $unreadTotal',
      trailing: _more('더 보기', onMore),
      child: Column(children: [
        for (final m in unread) ListTile(dense: true, leading: InitialBadge(m.fromName, size: 32, circle: true), title: Text(m.subject, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)), subtitle: Text('${m.fromName} · ${niceDate(m.tooltip.isNotEmpty ? m.tooltip : m.date)}', style: const TextStyle(fontSize: 12))),
      ]),
    );
  }
}

class TeamsSection extends StatelessWidget {
  const TeamsSection({super.key, required this.mentions, required this.onOpen});
  final TeamsMentions? mentions;
  final VoidCallback onOpen;
  @override
  Widget build(BuildContext context) {
    final m = mentions;
    if (m == null || !m.connected || m.items.isEmpty) return const SizedBox.shrink();
    return _Section(
      title: 'Teams 답장 대기 ${m.items.length}',
      trailing: _more('Teams 열기', onOpen),
      child: Column(children: [
        for (final x in m.items.take(3)) ListTile(dense: true, leading: InitialBadge(x.from, size: 32, circle: true), title: Text(x.text, maxLines: 2, overflow: TextOverflow.ellipsis), subtitle: Text('${x.topic} · ${x.from}', style: const TextStyle(fontSize: 12)), onTap: onOpen),
      ]),
    );
  }
}
