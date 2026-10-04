import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../app/brand.dart';
import '../app/router.dart';
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_creds.dart';
import 'gw_models.dart';

/// 홈 "오늘" 카드 — 아마란스 4개 숫자. 호출은 병렬이고 하나가 실패해도 나머지는 보인다.
class GwTodayCard extends ConsumerStatefulWidget {
  const GwTodayCard({super.key});
  @override
  ConsumerState<GwTodayCard> createState() => _GwTodayCardState();
}

class _Tile {
  _Tile(this.label, this.icon, this.route);
  final String label, route;
  final IconData icon;
  String? value, sub, error;
}

class _GwTodayCardState extends ConsumerState<GwTodayCard> {
  final _tiles = [
    _Tile('미결 결재', Icons.fact_check_outlined, '/gw/approvals'),
    _Tile('출퇴근', Icons.timer_outlined, '/gw/attendance'),
    _Tile('오늘 일정', Icons.event_outlined, '/gw/today'),
    _Tile('메일', Icons.mail_outline, '/gw/mail'),
  ];
  GwApi? _loadedWith;

  Future<void> _load(GwApi api) async {
    _loadedWith = api;
    for (final t in _tiles) {
      t.value = null;
      t.sub = null;
      t.error = null;
    }
    if (mounted) setState(() {});
    final me = api.client.creds().empSeq;
    final day = DateTime.now();
    await Future.wait([
      _fill(_tiles[0], () async {
        final c = await api.approvalCounts();
        return ('${c['pending']}건', null);
      }),
      _fill(_tiles[1], () async {
        final a = await api.attendanceToday();
        return (a.clockedIn ? hm(a.comeTm) : '—', a.clockedOut ? '퇴근 ${hm(a.leaveTm)}' : (a.clockedIn ? '출근' : '미기록'));
      }),
      _fill(_tiles[2], () async {
        final cals = await api.calendars();
        final ev = myEvents(await api.events(day), cals, me);
        final rooms = (await api.reservations(day)).where((r) => r.ownerEmpSeq == me).length;
        return ('${ev.length}건', '회의실 $rooms');
      }),
      _fill(_tiles[3], () async {
        final s = await api.mailSummary();
        return ('${s.unread}통', '미읽음');
      }),
    ]);
  }

  Future<void> _fill(_Tile t, Future<(String, String?)> Function() f) async {
    try {
      final (v, s) = await f();
      t.value = v;
      t.sub = s;
    } catch (e) {
      t.error = '$e';
    }
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final gw = ref.watch(gwProvider).value;
    final api = ref.watch(gwApiProvider);
    ref.listen(tabTapProvider, (_, _) {
      if (api != null) _load(api);
    });
    if (gw == null) return const SizedBox.shrink();
    if (gw.status != GwStatus.connected || api == null) {
      final relogin = gw.status == GwStatus.needsRelogin;
      return Card(
        child: ListTile(
          leading: const TintIcon(Icons.apartment_outlined, size: 40),
          title: Text(relogin ? '아마란스 로그인이 만료되었습니다' : '아마란스를 연결하세요'),
          subtitle: Text(relogin ? '다시 연결하면 이어서 봅니다' : '미결 결재·출퇴근·일정·메일을 여기서 봅니다', style: theme.textTheme.bodySmall),
          trailing: FilledButton(onPressed: () => context.push('/gw/connect'), child: Text(relogin ? '다시 연결' : '연결하기')),
        ),
      );
    }
    if (_loadedWith != api) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _loadedWith != api) _load(api);
      });
    }
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      childAspectRatio: 1.9,
      children: [
        for (final t in _tiles)
          Card(
            child: InkWell(
              onTap: t.error != null ? () => _load(api) : () => context.push(t.route),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 10, 12, 10),
                child: Row(children: [
                  TintIcon(t.icon, size: 36, background: Brand.blueTint, color: Brand.navy),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
                      Text(t.label, style: theme.textTheme.bodySmall?.copyWith(fontSize: 12)),
                      if (t.error != null)
                        const Text('다시 시도', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.dangerText))
                      else
                        Text(t.value ?? '…', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Brand.navy)),
                      if (t.sub != null) Text(t.sub!, style: theme.textTheme.bodySmall?.copyWith(fontSize: 11), maxLines: 1, overflow: TextOverflow.ellipsis),
                    ]),
                  ),
                ]),
              ),
            ),
          ),
      ],
    );
  }
}
