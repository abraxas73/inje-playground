import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'notifications.dart';

/// 종 버튼을 누르면 뜨는 알림 패널(이노봇 레이어, 즐겨찾기와 같은 자리 방식).
class NotificationPanel extends ConsumerWidget {
  const NotificationPanel({super.key, required this.onOpenPath, required this.maxHeight});
  final void Function(String path) onOpenPath;
  final double maxHeight;

  void _go(WidgetRef ref, NotifItem n) {
    markNotifsRead(ref, [n]); // 읽음 처리(배지·목록에서 빠짐, 아마란스 알림은 서버에도)
    notifOpen.value = false;
    openNotif(n, onOpenPath);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(notifCenterProvider);
    final visible = ref.watch(notifVisibleProvider);
    final body = async.when(
      loading: () => const [Padding(padding: EdgeInsets.all(28), child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))))],
      error: (e, _) => [Padding(padding: EdgeInsets.all(20), child: Text('알림을 불러오지 못했습니다', style: TextStyle(color: Brand.muted, fontSize: 13)))],
      data: (_) => visible.isEmpty
          ? [Padding(padding: EdgeInsets.fromLTRB(20, 8, 20, 24), child: Text('새 알림이 없습니다', style: TextStyle(color: Brand.muted)))]
          : [for (final n in visible) _tile(ref, n)],
    );
    return ConstrainedBox(
      constraints: BoxConstraints(maxWidth: 320, maxHeight: maxHeight),
      child: Material(
        color: Brand.surface,
        elevation: 8,
        borderRadius: BorderRadius.circular(16),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 6, 6),
              child: Row(children: [
                Text('알림', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Brand.navy)),
                const Spacer(),
                if (visible.isNotEmpty)
                  TextButton(onPressed: () => markNotifsRead(ref, visible, all: true), child: const Text('모두 읽음', style: TextStyle(fontSize: 12))),
                IconButton(icon: const Icon(Icons.refresh, size: 18), tooltip: '새로고침', onPressed: () => ref.read(notifCenterProvider.notifier).refresh()),
              ]),
            ),
            const NotifFilterChips(),
            ...body,
            const Divider(height: 1),
            // 인사·부고는 앱 데이터 소스가 없어 링크로(웹 화면 열기)
            ListTile(
              dense: true,
              leading: Icon(Icons.newspaper_outlined, color: Brand.faint, size: 20),
              title: const Text('인사·부고 소식', style: TextStyle(fontSize: 13)),
              trailing: Icon(Icons.chevron_right, size: 18, color: Brand.faint),
              onTap: () {
                notifOpen.value = false;
                onOpenPath('/web?path=${Uri.encodeComponent('/people-news')}');
              },
            ),
          ]),
        ),
      ),
    );
  }

  Widget _tile(WidgetRef ref, NotifItem n) => ListTile(
        dense: true,
        leading: TintIcon(n.icon, size: 34),
        title: Text(n.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
        subtitle: Text(n.subtitle, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: Brand.muted, fontSize: 12)),
        trailing: n.at == null ? null : Text(_hm(n.at!), style: TextStyle(fontSize: 11, color: Brand.faint)),
        onTap: () => _go(ref, n),
      );
}

/// 알림 열기 — 앱 안 경로가 있으면 그 화면, 없으면(일정·게시판 등) 그룹웨어 웹을 브라우저로.
void openNotif(NotifItem n, void Function(String path) onOpenPath) {
  if (n.path.isNotEmpty) {
    onOpenPath(n.path);
  } else if (n.webUrl.isNotEmpty) {
    launchUrl(Uri.parse(n.webUrl), mode: LaunchMode.externalApplication);
  }
}

/// 종류 필터(누르면 그 종류 숨김/보임, 기기에 기억). 패널·홈 위젯 공용.
class NotifFilterChips extends ConsumerWidget {
  const NotifFilterChips({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hidden = ref.watch(notifHiddenKindsProvider);
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 6),
      child: Wrap(spacing: 6, runSpacing: 4, children: [
        for (final e in notifFilterKinds.entries)
          FilterChip(
            label: Text(e.value, style: const TextStyle(fontSize: 11)),
            selected: !hidden.contains(e.key),
            visualDensity: VisualDensity.compact,
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            showCheckmark: false,
            onSelected: (_) => ref.read(notifHiddenKindsProvider.notifier).toggle(e.key),
          ),
      ]),
    );
  }
}

String _hm(DateTime t) {
  final k = t.toUtc().add(const Duration(hours: 9));
  final now = DateTime.now().toUtc().add(const Duration(hours: 9));
  if (k.year == now.year && k.month == now.month && k.day == now.day) {
    return '${k.hour.toString().padLeft(2, '0')}:${k.minute.toString().padLeft(2, '0')}';
  }
  return '${k.month}/${k.day}';
}
