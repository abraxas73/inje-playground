import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import '../auth/session.dart';
import '../config.dart';
import 'catalog.dart';

class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider).asData?.value;
    if (session == null) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final admin = visibleAdminPages(session);
    final email = session.email ?? '';
    final handle = email.contains('@') ? email.substring(0, email.indexOf('@')) : email;
    void open(String path) => context.push('/web?path=${Uri.encodeComponent(path)}');
    return Scaffold(
      body: ListView(padding: EdgeInsets.zero, children: [
        Container(
          padding: EdgeInsets.fromLTRB(20, MediaQuery.paddingOf(context).top + 12, 20, 20),
          decoration: const BoxDecoration(color: Brand.navy, borderRadius: BorderRadius.vertical(bottom: Radius.circular(28))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const BrandLogo(width: 86, white: true, opacity: 0.85),
            const SizedBox(height: 16),
            Row(children: [
              Container(
                width: 56,
                height: 56,
                alignment: Alignment.center,
                decoration: const BoxDecoration(color: Brand.blue, shape: BoxShape.circle),
                child: Text(handle.isEmpty ? '?' : handle.characters.first.toUpperCase(), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Colors.white)),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Flexible(child: Text(handle, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Colors.white), overflow: TextOverflow.ellipsis)),
                    const SizedBox(width: 8),
                    Container(
                      height: 22,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      alignment: Alignment.center,
                      decoration: BoxDecoration(color: Brand.sky.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(999)),
                      child: Text(session.isAdmin ? '관리자' : '사용자', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Brand.sky)),
                    ),
                  ]),
                  const SizedBox(height: 4),
                  Text(email, style: TextStyle(fontSize: 13, color: Colors.white.withValues(alpha: 0.65)), overflow: TextOverflow.ellipsis),
                ]),
              ),
            ]),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (admin.isNotEmpty) ...[
              _label(context, '관리자'),
              Card(
                child: Column(children: [
                  for (final (i, p) in admin.indexed) ...[
                    if (i > 0) const Divider(),
                    ListTile(title: Text(p.label), trailing: const Icon(Icons.chevron_right, color: Brand.faint), onTap: () => open(p.href)),
                  ],
                ]),
              ),
              const SizedBox(height: 14),
            ],
            _label(context, '계정'),
            Card(
              child: Column(children: [
                ListTile(
                  leading: const Icon(Icons.settings_outlined),
                  title: const Text('설정'),
                  subtitle: const Text('내 팀 · 알림 채널 · Microsoft 연결'),
                  trailing: const Icon(Icons.chevron_right, color: Brand.faint),
                  onTap: () => open('/settings'),
                ),
                const Divider(),
                ListTile(leading: const Icon(Icons.info_outline), title: const Text('앱 버전'), trailing: Text(Config.appVersion, style: theme.textTheme.bodySmall)),
              ]),
            ),
            const SizedBox(height: 14),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(foregroundColor: Brand.dangerText, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
              onPressed: () => ref.read(sessionProvider.notifier).signOut(),
              icon: const Icon(Icons.logout, size: 18),
              label: const Text('로그아웃'),
            ),
          ]),
        ),
      ]),
    );
  }

  Widget _label(BuildContext context, String t) => Padding(padding: const EdgeInsets.fromLTRB(4, 0, 0, 8), child: Text(t, style: Theme.of(context).textTheme.titleSmall));
}
