import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'gw_attend_range.dart';
import 'gw_client.dart';

/// 근태 — 전사 근태(연차·출장·재택 등)를 기간 프리셋(오늘·이번주·과거/미래 일주일)·조직(우리팀·센터·본부)·검색(이름·조직명)으로.
class AttendScreen extends ConsumerStatefulWidget {
  const AttendScreen({super.key});
  @override
  ConsumerState<AttendScreen> createState() => _AttendScreenState();
}

class _AttendScreenState extends ConsumerState<AttendScreen> {
  var _preset = AttendPreset.today;
  var _scope = AttendScope.all;
  var _query = '';

  Future<void> _refresh() async {
    ref.invalidate(attendRangeProvider((_preset, _scope)));
    await ref.read(attendRangeProvider((_preset, _scope)).future).catchError((_) => const AttendRange(entries: [], futureSkipped: false));
  }

  @override
  Widget build(BuildContext context) {
    final scopes = ref.watch(attendScopeDeptsProvider).value ?? const {};
    final data = ref.watch(attendRangeProvider((_preset, _scope)));
    return Scaffold(
      appBar: BrandHeader(compact: WidgetChrome.of(context), title: '근태', showBack: true, favoritePath: '/gw/attend', onRefresh: _refresh),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
          child: Wrap(spacing: 6, runSpacing: 6, children: [
            for (final p in AttendPreset.values) ChoiceChip(label: Text(p.label), selected: _preset == p, onSelected: (_) => setState(() => _preset = p)),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
          child: Wrap(spacing: 6, runSpacing: 6, children: [
            for (final s in AttendScope.values)
              if (s == AttendScope.all || scopes.containsKey(s)) FilterChip(label: Text(s.label), selected: _scope == s, onSelected: (_) => setState(() => _scope = s)),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: TextField(
            decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: '이름 또는 조직명', isDense: true, border: OutlineInputBorder()),
            onChanged: (v) => setState(() => _query = v),
          ),
        ),
        Expanded(
          child: data.when(
            skipLoadingOnRefresh: true,
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Center(child: TextButton(onPressed: _refresh, child: Text(['근태를 불러오지 못했습니다 · 다시 시도', if (e is GwException) e.message].join('\n'), textAlign: TextAlign.center))),
            data: (r) => RefreshIndicator(onRefresh: _refresh, child: AttendList(range: r, query: _query, today: _preset == AttendPreset.today)),
          ),
        ),
      ]),
    );
  }
}

/// 근태 목록 — 오늘은 지금 유효한 근태 먼저, 기간이면 날짜별 묶음(이름순).
class AttendList extends StatelessWidget {
  const AttendList({super.key, required this.range, this.query = '', this.today = false});
  final AttendRange range;
  final String query;
  final bool today;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final list = filterAttend(range.entries, query: query)
      ..sort((a, b) {
        if (!today && a.date != b.date) return a.date.compareTo(b.date);
        final av = a.activeAt(now), bv = b.activeAt(now);
        if (av != bv) return av ? -1 : 1;
        return a.name.compareTo(b.name);
      });
    final note = range.futureSkipped ? '내일 이후 근태는 우리팀·우리센터·우리본부를 고르면 보입니다.' : null;
    if (list.isEmpty) {
      return ListView(children: [
        const SizedBox(height: 100),
        Center(child: Text(query.isEmpty ? '등록된 근태가 없습니다' : '검색 결과가 없습니다', style: TextStyle(color: Brand.muted))),
        if (note != null) Padding(padding: const EdgeInsets.all(16), child: Text(note, textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: Brand.muted))),
      ]);
    }
    final rows = <Widget>[
      if (note != null) Padding(padding: const EdgeInsets.fromLTRB(16, 4, 16, 4), child: Text(note, style: TextStyle(fontSize: 12, color: Brand.muted))),
    ];
    String? day;
    for (final a in list) {
      if (!today && a.date != day) {
        day = a.date;
        rows.add(Padding(padding: const EdgeInsets.fromLTRB(16, 14, 16, 4), child: Text(attendDayLabel(a.date), style: const TextStyle(fontWeight: FontWeight.w700))));
      }
      rows.add(_tile(a, now));
    }
    return ListView(children: rows);
  }

  Widget _tile(AttendEntry a, DateTime now) {
    final active = a.activeAt(now);
    final time = [a.startTm, a.endTm].where((s) => s.isNotEmpty).join(' ~ ');
    final sub = [a.dept, time].where((s) => s.isNotEmpty).join(' · ');
    return ListTile(
      leading: InitialBadge(a.name.isEmpty ? '?' : a.name),
      title: Text(a.name, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: sub.isEmpty ? null : Text(sub, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: Brand.muted)),
      trailing: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(color: active ? Brand.blueTint : Brand.ground, borderRadius: BorderRadius.circular(12)),
        child: Text(a.kind, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: active ? Brand.navy : Brand.muted)),
      ),
    );
  }
}
