import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import '../assistant/assistant_session.dart' show assistantAvailableProvider;
import '../assistant/assistant_sheet.dart';
import '../calendar/calendar_model.dart';
import '../calendar/calendar_view.dart';
import '../dooray/calendar_screen.dart' show doorayRangeProvider, doorayDay;
import '../dooray/calendar_session.dart' show doorayCalendarTransportProvider;
import 'gw_api.dart';
import 'gw_gate.dart';
import 'gw_models.dart';
import 'room_timeline.dart';
import '../app/copy_selection_area.dart';

/// 일정 — 아마란스 일정(+ 이 기기에 Dooray가 연결돼 있으면 Dooray 일정도)을 일간·주간·월간 캘린더로(기본 일간).
/// 회의실 예약은 일간 보기에서 그날 것만. "추가"는 이노봇을 불러 아마란스 일정 등록을 맡긴다(비서가 꺼져 있으면 버튼 없음).
class TodayScreen extends StatelessWidget {
  const TodayScreen({super.key});
  @override
  Widget build(BuildContext context) => GwGate(title: '일정', builder: (_, api) => _Body(api));
}

class _Body extends ConsumerStatefulWidget {
  const _Body(this.api);
  final GwApi api;
  @override
  ConsumerState<_Body> createState() => _BodyState();
}

class _BodyState extends ConsumerState<_Body> {
  CalMode _mode = CalMode.day;
  DateTime _day = kstNow();
  bool _allEvents = false, _allRooms = true; // 회의실은 전체가 기본(아마란스 자원 HOME처럼, 2026-10-28)
  List<GwEvent>? _events;
  List<GwCalendar>? _cals;
  List<GwReservation>? _rooms;
  List<GwResource> _resources = const [];
  String? _eventsError, _roomsError;
  int _loadSeq = 0; // 보기·날짜를 바꾸면 먼저 보낸 요청의 늦은 응답은 버린다

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _go(DateTime d, [CalMode? mode]) {
    setState(() { _day = d; if (mode != null) _mode = mode; _events = null; _rooms = null; _eventsError = null; _roomsError = null; });
    _load();
  }

  Future<void> _load() async {
    final seq = ++_loadSeq;
    final (start, endEx) = calRange(_mode, _day);
    final end = endEx.subtract(const Duration(days: 1));
    final day = _day;
    await Future.wait([
      () async {
        try {
          final cals = await widget.api.calendars();
          final ev = await widget.api.events(start, end: end);
          if (mounted && seq == _loadSeq) setState(() { _cals = cals; _events = ev; _eventsError = null; });
        } catch (e) {
          if (mounted && seq == _loadSeq) setState(() => _eventsError = '$e');
        }
      }(),
      if (_mode == CalMode.day) () async {
        try {
          final rs = await widget.api.reservations(day);
          final res = await widget.api.resources(); // reservations가 이미 받아 둔 캐시
          if (mounted && seq == _loadSeq) setState(() { _rooms = rs; _resources = res; _roomsError = null; });
        } catch (e) {
          if (mounted && seq == _loadSeq) setState(() => _roomsError = '$e');
        }
      }(),
    ]);
  }

  void _add() => showAssistantSheet(context, seed: '${calLabel(CalMode.day, _day)}에 아마란스 일정 등록해줘. 제목·시간·장소를 물어봐 줘.');

  @override
  Widget build(BuildContext context) {
    final me = widget.api.client.creds().empSeq;
    final gw = _events == null ? null : (_allEvents ? _events! : myEvents(_events!, _cals ?? const [], me));
    final (start, endEx) = calRange(_mode, _day);
    final doorayOn = ref.watch(doorayCalendarTransportProvider) != null;
    final dooray = ref.watch(doorayRangeProvider((doorayDay(start), endEx.difference(start).inDays)));
    final doorayItems = dooray.value?['items'];
    final events = [
      for (final e in gw ?? const <GwEvent>[]) ?calFromGw(e),
      if (doorayItems is List) for (final x in doorayItems) if (x is Map) ?calFromDooray(x),
    ];
    final doorayNote = !doorayOn ? null : dooray.hasError ? 'Dooray 일정을 불러오지 못했습니다. Dooray 화면에서 다시 로그인해 주세요.' : dooray.isLoading ? 'Dooray 일정을 불러오는 중…' : null;
    final rooms = _rooms == null ? null : (_allRooms ? _rooms! : _rooms!.where((r) => r.ownerEmpSeq == me).toList());
    return Scaffold(
      appBar: BrandHeader(title: '일정', showBack: true, favoritePath: '/gw/today', onRefresh: _load),
      // 화면 자체 SelectionArea — 앱 전체 SelectAllText만으로는 데스크톱 실기기에서 끌어 선택이 바로 풀린다(메신저·메일·게시판과 같은 처리, 2026-10-26)
      body: CopySelectionArea(child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(20, 4, 20, 24), children: [
          CalendarView(
            mode: _mode, day: _day, events: events, loading: _events == null && _eventsError == null, error: _eventsError, note: doorayNote,
            onMode: (m) => _go(_day, m), onDay: _go, onPickDay: (d) => _go(d, CalMode.day),
            actions: [
              SegmentedButton<bool>(
                showSelectedIcon: false,
                style: const ButtonStyle(visualDensity: VisualDensity.compact),
                segments: const [ButtonSegment(value: false, label: Text('내 것')), ButtonSegment(value: true, label: Text('전체'))],
                selected: {_allEvents},
                onSelectionChanged: (s) => setState(() => _allEvents = s.first),
              ),
              if (ref.watch(assistantAvailableProvider)) FilledButton.tonalIcon(onPressed: _add, icon: const Icon(Icons.add, size: 18), label: const Text('추가')),
            ],
          ),
          if (_mode == CalMode.day) ...[
            const SizedBox(height: 16),
            _Section(
              title: '회의실', count: rooms?.length, all: _allRooms, onToggle: (v) => setState(() => _allRooms = v), error: _roomsError, loading: _rooms == null, empty: '예약이 없습니다',
              // 아마란스 자원 HOME 일간처럼 회의실 × 24시간 타임라인(2026-10-28). 내 것은 내 예약이 있는 회의실만, 전체는 모든 회의실
              items: [
                if (rooms != null && (_allRooms ? (_resources.isNotEmpty || rooms.isNotEmpty) : rooms.isNotEmpty))
                  RoomTimeline(
                    key: ValueKey('rooms-${ymd(_day)}-$_allRooms'),
                    day: _day,
                    rooms: _allRooms ? _resources : [for (final r in _resources) if (rooms.any((x) => x.resSeq == r.resSeq)) r],
                    reservations: rooms,
                    me: me,
                  ),
              ],
            ),
          ],
        ]),
      )),
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
            segments: const [ButtonSegment(value: true, label: Text('전체')), ButtonSegment(value: false, label: Text('내 것'))],
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
                      ? Padding(padding: const EdgeInsets.all(20), child: Center(child: Text(empty, style: TextStyle(color: Brand.muted))))
                      : Column(children: [for (final (i, w) in items.indexed) ...[if (i > 0) const Divider(height: 1), w]]),
        ),
      ]);
}
