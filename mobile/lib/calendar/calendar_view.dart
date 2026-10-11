// 일정 캘린더 위젯 — 머리글(이전·다음·오늘, 일간/주간/월간 전환, 부모가 주는 동작 버튼) + 본문(일간 목록 / 주간 날짜별 목록 / 월간 6주 격자).
// 데이터는 부모가 CalEvent로 넘긴다(아마란스·Dooray 섞어서). 날짜는 calendar_model.dart와 같이 "KST 벽시계 + UTC 플래그".
import 'package:flutter/material.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import '../gw/gw_models.dart' show kstNow;
import 'calendar_model.dart';

class CalendarView extends StatelessWidget {
  const CalendarView({
    super.key, required this.mode, required this.day, required this.events, required this.onMode, required this.onDay, required this.onPickDay,
    this.loading = false, this.error, this.note, this.actions = const [], this.today,
  });
  final CalMode mode;
  final DateTime day;
  final List<CalEvent> events;
  final bool loading;
  /// [error]는 본문 전체를 대신하는 오류, [note]는 본문 아래 한 줄 안내(예: Dooray만 못 읽음).
  final String? error, note;
  final ValueChanged<CalMode> onMode;
  /// 이전·다음·오늘 이동. [onPickDay]는 월간 격자의 날짜를 눌렀을 때(부모가 일간으로 바꾸는 식).
  final ValueChanged<DateTime> onDay, onPickDay;
  final List<Widget> actions;
  /// 테스트용 '오늘' 고정(기본 kstNow).
  final DateTime? today;

  static Color colorOf(CalEvent e) => e.source == CalSource.dooray ? Brand.success : e.mine ? Brand.blue : Brand.muted;

  @override
  Widget build(BuildContext context) {
    final t = today ?? kstNow();
    final t0 = DateTime.utc(t.year, t.month, t.day);
    final (s, e) = calRange(mode, day);
    final hasToday = !t0.isBefore(s) && t0.isBefore(e);
    final days = [for (var d = s; d.isBefore(e); d = d.add(const Duration(days: 1))) d];
    final count = events.where((ev) => days.any(ev.on)).length;
    final (prevTip, nextTip) = switch (mode) { CalMode.day => ('이전 날', '다음 날'), CalMode.week => ('이전 주', '다음 주'), CalMode.month => ('이전 달', '다음 달') };
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        IconButton(icon: const Icon(Icons.chevron_left), tooltip: prevTip, onPressed: () => onDay(calStep(mode, day, -1))),
        Expanded(child: Center(child: Text(calLabel(mode, day), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Brand.navy)))),
        IconButton(icon: const Icon(Icons.chevron_right), tooltip: nextTip, onPressed: () => onDay(calStep(mode, day, 1))),
        if (!hasToday) TextButton(onPressed: () => onDay(t0), child: const Text('오늘')),
      ]),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
          SegmentedButton<CalMode>(
            showSelectedIcon: false,
            style: const ButtonStyle(visualDensity: VisualDensity.compact),
            segments: const [ButtonSegment(value: CalMode.day, label: Text('일간')), ButtonSegment(value: CalMode.week, label: Text('주간')), ButtonSegment(value: CalMode.month, label: Text('월간'))],
            selected: {mode},
            onSelectionChanged: (v) => onMode(v.first),
          ),
          ...actions,
        ]),
      ),
      const SizedBox(height: 10),
      Padding(padding: const EdgeInsets.only(left: 4), child: CountTitle('일정', count)),
      const SizedBox(height: 8),
      Card(
        clipBehavior: Clip.antiAlias,
        child: error != null
            ? Padding(padding: const EdgeInsets.all(16), child: Text(error!, style: const TextStyle(color: Brand.dangerText)))
            : loading
                ? const Padding(padding: EdgeInsets.all(24), child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))))
                : switch (mode) {
                    CalMode.day => _DayList(items: calOn(events, day)),
                    CalMode.week => _WeekList(days: days, events: events, today: t0),
                    CalMode.month => _MonthGrid(days: days, events: events, today: t0, selected: day, month: day.month, onPick: onPickDay),
                  },
      ),
      if (note != null) Padding(padding: const EdgeInsets.fromLTRB(4, 8, 4, 0), child: Text(note!, style: const TextStyle(fontSize: 12, color: Brand.muted))),
    ]);
  }
}

class _DayList extends StatelessWidget {
  const _DayList({required this.items});
  final List<CalEvent> items;
  @override
  Widget build(BuildContext context) => items.isEmpty
      ? const Padding(padding: EdgeInsets.all(20), child: Center(child: Text('일정이 없습니다', style: TextStyle(color: Brand.muted))))
      : Column(children: [for (final (i, e) in items.indexed) ...[if (i > 0) const Divider(height: 1), _EventRow(e)]]);
}

class _WeekList extends StatelessWidget {
  const _WeekList({required this.days, required this.events, required this.today});
  final List<DateTime> days;
  final List<CalEvent> events;
  final DateTime today;
  @override
  Widget build(BuildContext context) => Column(children: [
        for (final (i, d) in days.indexed) ...[
          if (i > 0) const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 2),
            child: Align(alignment: Alignment.centerLeft, child: Text('${d.day}일 (${calWeekdays[d.weekday - 1]})', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: d == today ? Brand.blue : d.weekday == 7 ? Brand.danger : Brand.navy))),
          ),
          for (final e in calOn(events, d)) _EventRow(e),
          if (calOn(events, d).isEmpty) const Padding(padding: EdgeInsets.fromLTRB(16, 0, 16, 10), child: Align(alignment: Alignment.centerLeft, child: Text('일정 없음', style: TextStyle(fontSize: 12, color: Brand.faint)))),
        ],
      ]);
}

class _MonthGrid extends StatelessWidget {
  const _MonthGrid({required this.days, required this.events, required this.today, required this.selected, required this.month, required this.onPick});
  final List<DateTime> days;
  final List<CalEvent> events;
  final DateTime today, selected;
  final int month;
  final ValueChanged<DateTime> onPick;
  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
        final wide = box.maxWidth / 7 >= 110; // 데스크톱·태블릿은 제목까지, 폰은 점만
        final sel = DateTime.utc(selected.year, selected.month, selected.day);
        return Column(children: [
          Row(children: [
            for (final (i, w) in calWeekdays.indexed)
              Expanded(child: Center(child: Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Text(w, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: i == 6 ? Brand.danger : i == 5 ? Brand.blue : Brand.muted))))),
          ]),
          const Divider(height: 1),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 7, mainAxisExtent: wide ? 96 : 60),
            itemCount: days.length,
            itemBuilder: (context, i) {
              final d = days[i];
              final key = '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
              final items = calOn(events, d);
              final inMonth = d.month == month;
              final isToday = d == today;
              return InkWell(
                key: ValueKey('cal-cell-$key'),
                onTap: () => onPick(d),
                child: Container(
                  decoration: BoxDecoration(color: d == sel && !isToday ? Brand.blueTint : null, border: Border(top: BorderSide(color: i < 7 ? Colors.transparent : Brand.hairline), left: BorderSide(color: i % 7 == 0 ? Colors.transparent : Brand.hairline))),
                  padding: const EdgeInsets.fromLTRB(3, 4, 3, 2),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Container(
                      width: 22, height: 22, alignment: Alignment.center,
                      decoration: isToday ? const BoxDecoration(color: Brand.blue, shape: BoxShape.circle) : null,
                      child: Text('${d.day}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: isToday ? Colors.white : !inMonth ? Brand.faint : d.weekday == 7 ? Brand.danger : Brand.navy)),
                    ),
                    if (wide) ...[
                      for (final e in items.take(3)) Text(e.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: CalendarView.colorOf(e))),
                      if (items.length > 3) Text('+${items.length - 3}', style: const TextStyle(fontSize: 10, color: Brand.muted)),
                    ] else if (items.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 4, left: 2),
                        child: Row(children: [
                          for (final (k, e) in items.take(3).indexed)
                            Container(key: ValueKey('cal-dot-$key-$k'), width: 6, height: 6, margin: const EdgeInsets.only(right: 3), decoration: BoxDecoration(color: CalendarView.colorOf(e), shape: BoxShape.circle)),
                          if (items.length > 3) const Text('+', style: TextStyle(fontSize: 9, color: Brand.muted, height: 1)),
                        ]),
                      ),
                  ]),
                ),
              );
            },
          ),
        ]);
      });
}

/// 한 줄 일정 — 시간(출처·내 것에 따라 색) · 제목 · 보조 문구, Dooray는 꼬리표.
class _EventRow extends StatelessWidget {
  const _EventRow(this.e);
  final CalEvent e;
  @override
  Widget build(BuildContext context) => ListTile(
        dense: true,
        leading: SizedBox(width: 92, child: Text(e.timeLabel, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: CalendarView.colorOf(e)))),
        title: Text(e.title, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: e.sub.isEmpty ? null : Text(e.sub, maxLines: 1, overflow: TextOverflow.ellipsis),
        trailing: e.source == CalSource.dooray
            ? Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(color: Brand.success.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                child: const Text('Dooray', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: Brand.success)),
              )
            : null,
      );
}
