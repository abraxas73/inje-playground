import 'package:flutter/material.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_gate.dart';
import 'gw_models.dart';

class TodayScreen extends StatelessWidget {
  const TodayScreen({super.key});
  @override
  Widget build(BuildContext context) => GwGate(title: '오늘', builder: (_, api) => _Body(api));
}

class _Body extends StatefulWidget {
  const _Body(this.api);
  final GwApi api;
  @override
  State<_Body> createState() => _BodyState();
}

class _BodyState extends State<_Body> {
  bool _allEvents = false, _allRooms = false;
  List<GwEvent>? _events;
  List<GwCalendar>? _cals;
  List<GwReservation>? _rooms;
  String? _eventsError, _roomsError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final day = kstNow();
    await Future.wait([
      () async {
        try {
          final cals = await widget.api.calendars();
          final ev = await widget.api.events(day);
          if (mounted) setState(() { _cals = cals; _events = ev; _eventsError = null; });
        } catch (e) {
          if (mounted) setState(() => _eventsError = '$e');
        }
      }(),
      () async {
        try {
          final rs = await widget.api.reservations(day);
          if (mounted) setState(() { _rooms = rs; _roomsError = null; });
        } catch (e) {
          if (mounted) setState(() => _roomsError = '$e');
        }
      }(),
    ]);
  }

  String _range(String s, String e, bool allDay) => allDay ? '종일' : '${hm(s)}–${hm(e)}';

  @override
  Widget build(BuildContext context) {
    final me = widget.api.client.creds().empSeq;
    final events = _events == null ? null : (_allEvents ? _events! : myEvents(_events!, _cals ?? const [], me));
    final rooms = _rooms == null ? null : (_allRooms ? _rooms! : _rooms!.where((r) => r.ownerEmpSeq == me).toList());
    return Scaffold(
      appBar: const BrandHeader(title: '오늘'),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(20, 4, 20, 24), children: [
          _Section(
            title: '일정', count: events?.length, all: _allEvents, onToggle: (v) => setState(() => _allEvents = v), error: _eventsError, loading: _events == null, empty: '일정이 없습니다',
            items: [
              for (final e in events ?? const <GwEvent>[])
                _Row(time: _range(e.start, e.end, e.allDay), title: e.title, sub: [e.calendar, if (e.place.isNotEmpty) e.place, if (!e.mine && e.createName.isNotEmpty) e.createName].where((s) => s.isNotEmpty).join(' · '), mine: e.mine),
            ],
          ),
          const SizedBox(height: 16),
          _Section(
            title: '회의실', count: rooms?.length, all: _allRooms, onToggle: (v) => setState(() => _allRooms = v), error: _roomsError, loading: _rooms == null, empty: '예약이 없습니다',
            items: [
              for (final r in rooms ?? const <GwReservation>[])
                _Row(time: _range(r.start, r.end, r.allDay), title: r.title.isEmpty ? r.display : r.title, sub: '${r.resName}${r.owner.isEmpty ? '' : ' · ${r.owner}'}', mine: r.ownerEmpSeq == me),
            ],
          ),
        ]),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.count, required this.all, required this.onToggle, required this.error, required this.loading, required this.empty, required this.items});
  final String title, empty;
  final int? count;
  final bool all, loading;
  final String? error;
  final ValueChanged<bool> onToggle;
  final List<Widget> items;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Padding(padding: const EdgeInsets.only(left: 4), child: CountTitle(title, count ?? 0)),
          const Spacer(),
          SegmentedButton<bool>(
            showSelectedIcon: false,
            style: const ButtonStyle(visualDensity: VisualDensity.compact),
            segments: const [ButtonSegment(value: false, label: Text('내 것')), ButtonSegment(value: true, label: Text('전체'))],
            selected: {all},
            onSelectionChanged: (s) => onToggle(s.first),
          ),
        ]),
        const SizedBox(height: 8),
        Card(
          child: error != null
              ? Padding(padding: const EdgeInsets.all(16), child: Text(error!, style: const TextStyle(color: Brand.dangerText)))
              : loading
                  ? const Padding(padding: EdgeInsets.all(24), child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))))
                  : items.isEmpty
                      ? Padding(padding: const EdgeInsets.all(20), child: Center(child: Text(empty, style: const TextStyle(color: Brand.muted))))
                      : Column(children: [for (final (i, w) in items.indexed) ...[if (i > 0) const Divider(height: 1), w]]),
        ),
      ]);
}

class _Row extends StatelessWidget {
  const _Row({required this.time, required this.title, required this.sub, required this.mine});
  final String time, title, sub;
  final bool mine;
  @override
  Widget build(BuildContext context) => ListTile(
        dense: true,
        leading: SizedBox(width: 92, child: Text(time, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: mine ? Brand.blue : Brand.muted))),
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: sub.isEmpty ? null : Text(sub, maxLines: 1, overflow: TextOverflow.ellipsis),
      );
}
