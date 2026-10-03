import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../auth/session.dart';
import '../config.dart';
import 'catalog.dart';

const _groupLabel = {'daily': '일상', 'ai': 'AI 사용량', 'work': '업무', 'admin': '관리자'};

class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider).asData?.value;
    if (session == null) return const SizedBox.shrink();
    final groups = <String, List<PageEntry>>{};
    for (final p in visiblePages(session)) {
      (groups[p.group] ??= []).add(p);
    }
    final admin = visibleAdminPages(session);
    void open(String path) => context.push('/web?path=${Uri.encodeComponent(path)}');
    return Scaffold(
      appBar: AppBar(title: const Text('더보기')),
      body: ListView(children: [
        for (final g in ['daily', 'ai', 'work'])
          if (groups[g] != null) ...[
            _header(_groupLabel[g]!),
            for (final p in groups[g]!) ListTile(title: Text(p.label), trailing: const Icon(Icons.chevron_right), onTap: () => open(p.href)),
          ],
        if (admin.isNotEmpty) ...[
          _header('관리자'),
          for (final p in admin) ListTile(title: Text(p.label), trailing: const Icon(Icons.chevron_right), onTap: () => open(p.href)),
        ],
        _header('계정'),
        ListTile(leading: const Icon(Icons.settings_outlined), title: const Text('설정 (내 팀·알림 채널·Microsoft 연결)'), onTap: () => open('/settings')),
        ListTile(leading: const Icon(Icons.person_outline), title: Text(session.email ?? ''), subtitle: Text('역할 ${session.role} · 앱 ${Config.appVersion}')),
        ListTile(leading: const Icon(Icons.logout), title: const Text('로그아웃'), onTap: () => ref.read(sessionProvider.notifier).signOut()),
      ]),
    );
  }

  Widget _header(String t) => Padding(padding: const EdgeInsets.fromLTRB(16, 16, 16, 4), child: Text(t, style: const TextStyle(fontSize: 12, color: Colors.grey, fontWeight: FontWeight.w600)));
}
