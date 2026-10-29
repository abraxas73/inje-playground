import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/brand.dart' show TintIcon, WidgetTitle;
import '../app/theme.dart';
import 'notif_panel.dart' show NotifFilterChips, openNotif;
import 'notifications.dart';

/// 홈 '아마란스 알림' 위젯(예전 '메신저 멘션' 자리, 위젯 id talks 유지) — 알림센터 전체·종류 필터·누르면 그 화면으로 열고 서버 읽음.
/// fill: 대시보드 타일 높이를 채우고 목록은 그 안에서 스크롤. 아니면(모바일 홈) 최근 [maxItems]건.
class GwAlertsCard extends ConsumerWidget {
  const GwAlertsCard({super.key, required this.onOpenPath, this.fill = false, this.maxItems = 5});
  final void Function(String path) onOpenPath;
  final bool fill;
  final int maxItems;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final all = ref.watch(notifVisibleProvider).where((n) => n.isGw).toList();
    final loading = ref.watch(notifCenterProvider).isLoading && all.isEmpty;
    final shown = fill ? all : all.take(maxItems).toList();
    Widget tile(NotifItem n) => ListTile(
          dense: true,
          leading: TintIcon(n.icon, size: 32),
          title: Text(n.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
          subtitle: n.subtitle.isEmpty ? null : Text(n.subtitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12)),
          trailing: n.at == null ? null : Text(_when(n.at!), style: TextStyle(fontSize: 11, color: Brand.faint)),
          onTap: () {
            markNotifsRead(ref, [n]);
            openNotif(n, onOpenPath);
          },
        );
    final empty = Padding(padding: const EdgeInsets.all(20), child: Center(child: Text(loading ? '불러오는 중…' : '새 아마란스 알림이 없습니다', style: TextStyle(color: Brand.muted))));
    final list = shown.isEmpty ? empty : fill ? ListView(padding: EdgeInsets.zero, children: [for (final n in shown) tile(n)]) : Column(children: [for (final n in shown) tile(n)]);
    final count = ref.watch(notifUnreadProvider);
    return Padding(
      padding: EdgeInsets.only(top: fill ? 0 : 14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: fill ? MainAxisSize.max : MainAxisSize.min, children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 2),
          child: Row(children: [
            Expanded(child: WidgetTitle(count > 0 ? '아마란스 알림 $count' : '아마란스 알림')),
            if (all.isNotEmpty) TextButton(onPressed: () => markNotifsRead(ref, all, all: true), child: const Text('모두 읽음')),
            IconButton(icon: const Icon(Icons.refresh, size: 18), tooltip: '새로고침', onPressed: () => ref.read(notifCenterProvider.notifier).refresh()),
          ]),
        ),
        const NotifFilterChips(),
        if (fill) Expanded(child: Card(child: list)) else Card(child: list),
      ]),
    );
  }
}

String _when(DateTime t) {
  final now = DateTime.now();
  final hm = '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
  return t.year == now.year && t.month == now.month && t.day == now.day ? hm : '${t.month}/${t.day} $hm';
}
