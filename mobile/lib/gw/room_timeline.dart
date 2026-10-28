// 회의실 일간 타임라인 — 아마란스 자원 HOME 일간 보기처럼 왼쪽 자원 리스트(자원 종류별 묶음) + 오른쪽 24시간 격자(가로 스크롤).
// 자원 종류(attrSeq)별로 묶고 머리글을 누르면 접힌다(처음엔 모두 펼침). 막대 색은 아마란스가 자원에 정한 색. 처음 위치는 오늘이면 지금 1시간 전, 다른 날은 첫 예약(없으면 9시). 예약 막대를 누르면 아래에 상세가 펼쳐진다.
import 'package:flutter/material.dart';
import '../app/theme.dart';
import 'gw_models.dart';

class RoomTimeline extends StatefulWidget {
  const RoomTimeline({super.key, required this.day, required this.rooms, required this.reservations, required this.me, this.now});
  final DateTime day;
  /// 표시할 자원(아마란스 rs121A01 순서). 예약은 있는데 목록에 없는 회의실은 '기타'로 덧붙인다.
  final List<GwResource> rooms;
  final List<GwReservation> reservations;
  final String me;
  /// 테스트용 지금(KST 벽시계). 기본 kstNow.
  final DateTime? now;

  static const hourWidth = 80.0, nameWidth = 150.0, rowHeight = 38.0, groupHeight = 32.0, headHeight = 36.0;
  // 아마란스 일간 막대와 비슷한 색 — 회의실 줄마다 돌려 쓴다
  static const palette = [Color(0xFF6F8EF2), Color(0xFFEE8585), Color(0xFFF5D35E), Color(0xFF5FC596), Color(0xFF63C3DB), Color(0xFF6E8B3D)];

  @override
  State<RoomTimeline> createState() => _RoomTimelineState();
}

/// yyyyMMddHHmm → 그날 0시부터 분(그날 밖이면 0 또는 1440으로 자름).
int roomMinute(String s, DateTime day) {
  final d = s.replaceAll(RegExp(r'\D'), '');
  if (d.length < 12) return 0;
  final key = d.substring(0, 8), today = '${day.year}${day.month.toString().padLeft(2, '0')}${day.day.toString().padLeft(2, '0')}';
  if (key.compareTo(today) < 0) return 0;
  if (key.compareTo(today) > 0) return 1440;
  return (int.parse(d.substring(8, 10)) * 60 + int.parse(d.substring(10, 12))).clamp(0, 1440);
}

class _RoomTimelineState extends State<RoomTimeline> {
  late final ScrollController _h;
  GwReservation? _sel;
  final _folded = <String>{}; // 접은 자원 종류(attrSeq)

  bool get _isToday {
    final n = widget.now ?? kstNow();
    return n.year == widget.day.year && n.month == widget.day.month && n.day == widget.day.day;
  }

  @override
  void initState() {
    super.initState();
    final n = widget.now ?? kstNow();
    final first = widget.reservations.where((r) => !r.allDay).map((r) => roomMinute(r.start, widget.day)).fold<int?>(null, (a, b) => a == null || b < a ? b : a);
    final hour = _isToday ? n.hour - 1 : (first == null ? 9 : first ~/ 60);
    _h = ScrollController(initialScrollOffset: hour.clamp(0, 23) * RoomTimeline.hourWidth);
  }

  @override
  void dispose() {
    _h.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // 줄 = 자원 종류 머리글(null 자원) 또는 회의실
    final known = {for (final r in widget.rooms) r.resSeq};
    final extra = <String, GwResource>{
      for (final r in widget.reservations)
        if (!known.contains(r.resSeq)) r.resSeq: GwResource(resSeq: r.resSeq, resName: r.resName, attrSeq: '', attrName: '기타'),
    };
    // 아마란스 rs121A01은 표시 순서(orderNum)라 종류가 섞여 온다 — 종류(attrSeq 숫자 순)별로 모으고, 종류 안에서는 받은 순서
    final groups = <String, List<GwResource>>{};
    for (final r in [...widget.rooms, ...extra.values]) {
      (groups[r.attrSeq] ??= []).add(r);
    }
    final order = groups.keys.toList()..sort((a, b) => (int.tryParse(a) ?? 1 << 30).compareTo(int.tryParse(b) ?? 1 << 30));
    final lines = <({String group, String key, GwResource? room})>[];
    for (final k in order) {
      final first = groups[k]!.first;
      lines.add((group: first.attrName.isEmpty ? '회의실' : first.attrName, key: k, room: null));
      if (!_folded.contains(k)) {
        for (final r in groups[k]!) {
          lines.add((group: '', key: k, room: r));
        }
      }
    }
    final byRoom = <String, List<GwReservation>>{};
    for (final r in widget.reservations) {
      (byRoom[r.resSeq] ??= []).add(r);
    }
    double h(({String group, String key, GwResource? room}) l) => l.room == null ? RoomTimeline.groupHeight : RoomTimeline.rowHeight;
    const gridW = 24 * RoomTimeline.hourWidth;
    final n = widget.now ?? kstNow();
    var roomIdx = -1;
    final colors = <String, Color>{
      for (final r in groups.values.expand((g) => g)) r.resSeq: _hex(r.color) ?? RoomTimeline.palette[++roomIdx % RoomTimeline.palette.length],
    };

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // 왼쪽: 자원 리스트(고정)
        SizedBox(
          width: RoomTimeline.nameWidth,
          child: Column(children: [
            Container(height: RoomTimeline.headHeight, alignment: Alignment.center, decoration: BoxDecoration(color: Brand.blueTint, border: Border(bottom: BorderSide(color: Brand.hairline))), child: Text('자원 리스트', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Brand.navy))),
            for (final l in lines)
              InkWell(
                key: l.room == null ? ValueKey('room-group-${l.key}') : null,
                onTap: l.room != null ? null : () => setState(() => _folded.contains(l.key) ? _folded.remove(l.key) : _folded.add(l.key)),
                child: Container(
                  height: h(l),
                  padding: EdgeInsets.only(left: l.room == null ? 4 : 10, right: 6),
                  alignment: Alignment.centerLeft,
                  decoration: BoxDecoration(color: l.room == null ? Brand.blueTint.withValues(alpha: 0.6) : null, border: Border(bottom: BorderSide(color: Brand.hairline), right: BorderSide(color: Brand.hairline))),
                  child: Row(children: [
                    if (l.room == null) Icon(_folded.contains(l.key) ? Icons.expand_more : Icons.expand_less, size: 18, color: Brand.muted),
                    if (l.room == null) const SizedBox(width: 4),
                    Expanded(child: Text(l.room?.resName ?? l.group, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, fontWeight: l.room == null ? FontWeight.w700 : FontWeight.w500, color: Brand.navy))),
                  ]),
                ),
              ),
          ]),
        ),
        // 오른쪽: 24시간 격자(가로 스크롤)
        Expanded(
          child: Scrollbar(
            controller: _h,
            thumbVisibility: true,
            child: SingleChildScrollView(
              key: const ValueKey('room-timeline-scroll'),
              controller: _h,
              scrollDirection: Axis.horizontal,
              child: SizedBox(
                width: gridW,
                child: Stack(children: [
                  Column(children: [
                    Container(
                      height: RoomTimeline.headHeight,
                      decoration: BoxDecoration(color: Brand.blueTint, border: Border(bottom: BorderSide(color: Brand.hairline))),
                      child: Row(children: [
                        for (var i = 0; i < 24; i++) SizedBox(width: RoomTimeline.hourWidth, child: Center(child: Text('$i시', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Brand.navy)))),
                      ]),
                    ),
                    for (final l in lines)
                      SizedBox(
                        height: h(l),
                        child: l.room == null
                            ? DecoratedBox(decoration: BoxDecoration(color: Brand.blueTint.withValues(alpha: 0.6), border: Border(bottom: BorderSide(color: Brand.hairline))))
                            : CustomPaint(
                                painter: _GridPainter(Brand.hairline),
                                child: Stack(children: [
                                  for (final r in byRoom[l.room!.resSeq] ?? const <GwReservation>[]) _bar(r, colors[l.room!.resSeq]!),
                                ]),
                              ),
                      ),
                  ]),
                  if (_isToday)
                    Positioned(
                      left: (n.hour * 60 + n.minute) / 60 * RoomTimeline.hourWidth,
                      top: RoomTimeline.headHeight,
                      bottom: 0,
                      child: IgnorePointer(child: Container(width: 2, color: Brand.danger.withValues(alpha: 0.8))),
                    ),
                ]),
              ),
            ),
          ),
        ),
      ]),
      if (_sel != null) _details(_sel!),
    ]);
  }

  static Color? _hex(String s) {
    final v = int.tryParse(s.replaceFirst('#', ''), radix: 16);
    return v == null || s.replaceFirst('#', '').length != 6 ? null : Color(0xFF000000 | v);
  }

  Widget _bar(GwReservation r, Color c) {
    final s = r.allDay ? 0 : roomMinute(r.start, widget.day), e = r.allDay ? 1440 : roomMinute(r.end, widget.day);
    final left = s / 60 * RoomTimeline.hourWidth, width = ((e - s) / 60 * RoomTimeline.hourWidth).clamp(6.0, double.infinity);
    final selected = identical(_sel, r);
    final dark = c.computeLuminance() > 0.5;
    final label = r.title.isEmpty ? r.display : '[${r.owner}] ${r.title}';
    return Positioned(
      left: left,
      width: width,
      top: 2,
      bottom: 2,
      child: Tooltip(
        message: '${r.allDay ? '종일' : '${hm(r.start)}–${hm(r.end)}'} · ${r.resName}\n$label',
        child: InkWell(
          onTap: () => setState(() => _sel = selected ? null : r),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            alignment: Alignment.centerLeft,
            decoration: BoxDecoration(
              color: c,
              border: Border.all(color: selected ? Brand.navy : r.ownerEmpSeq == widget.me ? Colors.white : Colors.transparent, width: selected ? 2 : 1),
            ),
            child: Text(label, maxLines: 1, overflow: TextOverflow.clip, softWrap: false, style: TextStyle(fontSize: 12, color: dark ? Brand.navy : Colors.white, fontWeight: FontWeight.w600)),
          ),
        ),
      ),
    );
  }

  Widget _details(GwReservation r) => Container(
        key: const ValueKey('room-timeline-detail'),
        margin: const EdgeInsets.all(8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Brand.blueTint, borderRadius: BorderRadius.circular(10)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          for (final (k, v) in [
            ('일시', r.allDay ? '종일' : '${hm(r.start)}–${hm(r.end)}'),
            ('회의실', r.resName),
            ('내용', r.title.isEmpty ? r.display : r.title),
            if (r.owner.isNotEmpty) ('예약자', r.owner),
            if (r.attendees.isNotEmpty) ('참석자', r.attendees),
          ])
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                SizedBox(width: 52, child: Text(k, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Brand.muted))),
                Expanded(child: Text(v, style: TextStyle(fontSize: 13, color: Brand.navy, height: 1.4))),
              ]),
            ),
        ]),
      );
}

/// 30분 칸 격자 — 정시는 진하게.
class _GridPainter extends CustomPainter {
  const _GridPainter(this.color);
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()..color = color..strokeWidth = 1;
    final half = Paint()..color = color.withValues(alpha: 0.5)..strokeWidth = 1;
    for (var i = 0; i <= 48; i++) {
      final x = i * RoomTimeline.hourWidth / 2;
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), i.isEven ? p : half);
    }
    canvas.drawLine(Offset(0, size.height - 0.5), Offset(size.width, size.height - 0.5), p);
  }

  @override
  bool shouldRepaint(_GridPainter old) => old.color != color;
}
