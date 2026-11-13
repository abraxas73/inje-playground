// 회의실 예약 창 — 일정 일간 타임라인의 빈 칸(또는 [예약])을 누르면 그 회의실·시각으로 열린다.
// 예약은 이노봇 reserve_room과 같은 rs121A06 → rs121A10 read-back(gw_assistant_api.dart reserveRoom).
// editing을 주면 내 예약 수정 창(회의실은 고정, 제목·시각만) — updateMyReservation(rs121A12).
import 'package:flutter/material.dart';
import '../app/theme.dart';
import '../assistant/gw_assistant_api.dart' show GwAssistantApi, gwStamp;
import 'gw_api.dart';
import 'gw_client.dart' show GwException;
import 'gw_models.dart';
import 'room_timeline.dart' show roomMinute;

String _hm(int m) => '${(m ~/ 60).toString().padLeft(2, '0')}:${(m % 60).toString().padLeft(2, '0')}';

/// 같은 회의실에서 [start,end)와 겹치는 예약(종일 포함). 없으면 null.
GwReservation? roomConflict(List<GwReservation> all, String resSeq, int start, int end, DateTime day) {
  for (final r in all) {
    if (r.resSeq != resSeq) continue;
    final s = r.allDay ? 0 : roomMinute(r.start, day), e = r.allDay ? 1440 : roomMinute(r.end, day);
    if (s < end && start < e) return r;
  }
  return null;
}

/// 예약(수정)하면 true(목록을 다시 읽을 것). day는 KST 벽시계 날짜, now는 지난 시각 판정용.
Future<bool> showRoomReserveDialog(BuildContext context, {required GwApi api, required DateTime day, required List<GwResource> rooms, required List<GwReservation> reservations, required GwResource room, required int start, required DateTime now, GwReservation? editing}) async =>
    await showDialog<bool>(context: context, builder: (_) => _ReserveDialog(api: api, day: day, rooms: rooms, reservations: reservations, room: room, start: start, now: now, editing: editing)) ?? false;

class _ReserveDialog extends StatefulWidget {
  const _ReserveDialog({required this.api, required this.day, required this.rooms, required this.reservations, required this.room, required this.start, required this.now, this.editing});
  final GwApi api;
  final GwReservation? editing;
  final DateTime day, now;
  final List<GwResource> rooms;
  final List<GwReservation> reservations;
  final GwResource room;
  final int start;
  @override
  State<_ReserveDialog> createState() => _ReserveDialogState();
}

class _ReserveDialogState extends State<_ReserveDialog> {
  late String _room = widget.room.resSeq;
  late final GwReservation? _edit = widget.editing;
  late int _start = _edit != null ? roomMinute(_edit.start, widget.day) : widget.start.clamp(0, 1410),
      _end = _edit != null ? roomMinute(_edit.end, widget.day) : (widget.start + 60).clamp(30, 1440);
  late final int _origStart = _start;
  late final _title = TextEditingController(text: _edit?.title ?? '');
  bool _busy = false;
  String? _error;

  bool get _today => widget.now.year == widget.day.year && widget.now.month == widget.day.month && widget.now.day == widget.day.day;

  /// 지금 고른 값의 문제(없으면 null) — 버튼을 누르기 전에도 보여 준다.
  String? get _problem {
    if (_end <= _start) return '끝나는 시각이 시작보다 늦어야 합니다';
    // 수정 때 시작을 그대로 두면(진행 중 회의 연장 등) 지난 시각이어도 허용
    if (_today && (_edit == null || _start != _origStart) && _start < widget.now.hour * 60 + widget.now.minute - 29) return '이미 지난 시각입니다';
    final c = roomConflict([for (final r in widget.reservations) if (_edit == null || !r.sameAs(_edit)) r], _room, _start, _end, widget.day);
    if (c != null) return '이미 예약이 있습니다: ${c.title.isEmpty ? c.display : '[${c.owner}] ${c.title}'}';
    return null;
  }

  Future<void> _submit() async {
    final title = _title.text.trim();
    if (title.isEmpty) return setState(() => _error = '예약명을 입력하세요');
    if (_problem != null || _busy) return;
    setState(() { _busy = true; _error = null; });
    DateTime at(int m) => DateTime(widget.day.year, widget.day.month, widget.day.day).add(Duration(minutes: m));
    try {
      final e = _edit;
      final r = e == null
          ? await widget.api.reserveRoom(resSeq: _room, start: gwStamp(at(_start)), end: gwStamp(at(_end)), title: title)
          : await widget.api.updateMyReservation(e.resSeq, e.seqNum, e.resIdx, title: title, start: gwStamp(at(_start)), end: gwStamp(at(_end)));
      if (!mounted) return;
      final messenger = ScaffoldMessenger.maybeOf(context);
      Navigator.pop(context, true);
      final what = e == null ? '예약' : '수정';
      messenger?.showSnackBar(SnackBar(content: Text(r['ok'] == true ? (e == null ? '예약했습니다' : '수정했습니다') : '$what은 보냈지만 결과를 확인하지 못했습니다. 목록에서 확인하세요')));
    } on GwException catch (e) {
      if (!mounted) return;
      // 응답 직전에 끊겼으면 이미 예약됐을 수 있다 — 다시 누르기 전에 목록을 보게
      setState(() { _busy = false; _error = e.status == 0 ? '${e.message} — 이미 ${_edit == null ? '예약' : '수정'}됐을 수 있습니다. 닫고 목록을 확인하세요' : e.message; });
    } catch (e) {
      if (mounted) setState(() { _busy = false; _error = '${_edit == null ? '예약하지' : '수정하지'} 못했습니다 (${e.runtimeType})'; });
    }
  }

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  Widget _time(String label, int value, List<int> options, ValueChanged<int> on) => Expanded(
        child: DropdownButtonFormField<int>(
          initialValue: value,
          decoration: InputDecoration(labelText: label, isDense: true),
          // 아마란스에서 9:15처럼 30분 단위가 아니게 잡은 예약도 수정 창에 그 값이 보이게
          items: [for (final m in ({...options, value}.toList()..sort())) DropdownMenuItem(value: m, child: Text(_hm(m)))],
          onChanged: _busy ? null : (v) => setState(() => on(v!)),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final problem = _problem;
    final d = widget.day;
    return AlertDialog(
      title: Text('회의실 ${_edit == null ? '예약' : '예약 수정'} · ${d.month}월 ${d.day}일'),
      content: SizedBox(
        width: 380,
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          DropdownButtonFormField<String>(
            key: const ValueKey('reserve-room'),
            initialValue: _room,
            isExpanded: true,
            decoration: const InputDecoration(labelText: '회의실', isDense: true),
            items: [for (final r in widget.rooms) DropdownMenuItem(value: r.resSeq, child: Text(r.attrName.isEmpty ? r.resName : '${r.resName} · ${r.attrName}', overflow: TextOverflow.ellipsis))],
            onChanged: _busy || _edit != null ? null : (v) => setState(() => _room = v!), // 수정은 같은 회의실 안에서만(rs121A12)
          ),
          const SizedBox(height: 12),
          Row(children: [
            _time('시작', _start, [for (var m = 0; m < 1440; m += 30) m], (v) { _start = v; if (_end <= v) _end = (v + 60).clamp(30, 1440); }),
            const SizedBox(width: 12),
            _time('끝', _end, [for (var m = 30; m <= 1440; m += 30) m], (v) => _end = v),
          ]),
          const SizedBox(height: 12),
          TextField(
            key: const ValueKey('reserve-title'),
            controller: _title,
            enabled: !_busy,
            autofocus: true,
            maxLength: 100,
            decoration: const InputDecoration(labelText: '예약명', hintText: '예: 주간회의', isDense: true),
            onSubmitted: (_) => _submit(),
          ),
          if ((_error ?? problem) != null) Text(_error ?? problem!, style: const TextStyle(fontSize: 12, color: Brand.dangerText)),
        ]),
      ),
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.pop(context, false), child: Text(_edit == null ? '취소' : '닫기')),
        FilledButton(onPressed: _busy || problem != null ? null : _submit, child: Text(_edit == null ? (_busy ? '예약하는 중…' : '예약') : (_busy ? '저장하는 중…' : '저장'))),
      ],
    );
  }
}
