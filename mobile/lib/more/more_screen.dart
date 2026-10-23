import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import '../app/theme_mode.dart';
import '../auth/session.dart';
import '../briefing/briefing_provider.dart';
import '../briefing/live_activity.dart';
import '../release/update_banner.dart';
import '../gw/gw_creds.dart';
import '../gw/gw_settings_sheet.dart';
import '../mcp/mcp_settings_sheet.dart';
import '../assistant/innobot_prefs.dart';
import 'catalog.dart';
import 'profile.dart';
import '../app/platform.dart';

class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider).asData?.value;
    if (session == null) return const SizedBox.shrink();
    final admin = visibleAdminPages(session);
    final gw = ref.watch(gwProvider).value;
    final email = session.email ?? '';
    final name = profileDisplayName(organizationName: gw?.creds?.empName, accountName: session.name);
    final photo = ref.watch(profilePhotoProvider).asData?.value;
    final fallbackAvatar = Center(child: Text(name.characters.first.toUpperCase(), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Colors.white)));
    Future<void> open(String path) async {
      await context.push('/web?path=${Uri.encodeComponent(path)}');
      if (context.mounted) {
        ref.invalidate(profilePhotoProvider);
        if (path == '/settings') await ref.read(briefingProvider.notifier).refresh();
      }
    }
    return Scaffold(
      body: ListView(padding: EdgeInsets.zero, children: [
        Container(
          padding: EdgeInsets.fromLTRB(20, MediaQuery.paddingOf(context).top + 12, 20, 20),
          decoration: BoxDecoration(color: Brand.hero, borderRadius: BorderRadius.vertical(bottom: Radius.circular(28))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const BrandLogo(width: 86, white: true, opacity: 0.85),
            const SizedBox(height: 16),
            Row(children: [
              Container(
                width: 56,
                height: 56,
                alignment: Alignment.center,
                decoration: const BoxDecoration(color: Brand.blue, shape: BoxShape.circle),
                child: ClipOval(child: photo == null ? fallbackAvatar : Image.memory(photo, width: 56, height: 56, fit: BoxFit.cover, gaplessPlayback: false, errorBuilder: (_, _, _) => fallbackAvatar)),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Flexible(child: Text(name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Colors.white), overflow: TextOverflow.ellipsis)),
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
                    ListTile(title: Text(p.label), trailing: Icon(Icons.chevron_right, color: Brand.faint), onTap: () => open(p.href)),
                  ],
                ]),
              ),
              const SizedBox(height: 14),
            ],
            _label(context, '계정'),
            Card(
              child: Column(children: [
                _GwRow(gw: gw, onTap: () => showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (_) => const GwSettingsSheet())),
                if (isDesktopPlatform) ...[
                  const Divider(),
                  ListTile(
                    leading: const Icon(Icons.hub_outlined),
                    title: const Text('Claude 커넥터'),
                    subtitle: const Text('claude.ai·Claude Code 요청을 이 앱이 실행'),
                    trailing: Icon(Icons.chevron_right, color: Brand.faint),
                    onTap: () => showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (_) => const McpSettingsSheet()),
                  ),
                ],
                const Divider(),
                if (session.isAdmin || session.permissions['dooray'] != false) ListTile(leading: const Icon(Icons.calendar_month), title: const Text('Dooray 일정·메일'), subtitle: const Text('이 기기에서 로그인·연결 관리'), trailing: const Icon(Icons.chevron_right), onTap: () => context.push('/dooray/calendar')),
                ListTile(
                  leading: const Icon(Icons.settings_outlined),
                  title: const Text('설정'),
                  subtitle: const Text('내 팀 · 알림 채널 · Microsoft·Atlassian 연결'),
                  trailing: Icon(Icons.chevron_right, color: Brand.faint),
                  onTap: () => open('/settings'),
                ),
                const Divider(),
                const _InnobotSwitch(),
                const Divider(),
                if (liveActivitySupported) ...[const _LiveBriefingSwitch(), const Divider()],
                const _ThemeModeTile(),
                const Divider(),
                const ListTile(leading: Icon(Icons.info_outline), title: Text('앱 버전'), trailing: VersionTrailing()),
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

/// 계정 카드의 아마란스 연결 상태 행 — 누르면 설정 시트(연결·해제·자동 로그인).
class _GwRow extends StatelessWidget {
  const _GwRow({required this.gw, required this.onTap});
  final GwState? gw;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final status = gw?.status ?? GwStatus.none;
    final c = gw?.creds;
    return ListTile(
      leading: const Icon(Icons.apartment_outlined),
      title: const Text('아마란스'),
      subtitle: Text(switch (status) {
        GwStatus.none => '연결하면 미결 결재·출퇴근·일정·메일을 앱에서 봅니다',
        GwStatus.connected => '${c?.empName ?? ''} · ${c?.email ?? ''}',
        GwStatus.needsRelogin => '로그인이 만료되었습니다 — 다시 연결하세요',
      }),
      trailing: status == GwStatus.none ? TextButton(onPressed: onTap, child: const Text('연결하기')) : Icon(Icons.chevron_right, color: Brand.faint),
      onTap: onTap,
    );
  }
}

/// 잠금 화면 브리핑(iOS 라이브 액티비티·Android 상시 알림) — 이 기기에만 저장.
class _LiveBriefingSwitch extends StatefulWidget {
  const _LiveBriefingSwitch();
  @override
  State<_LiveBriefingSwitch> createState() => _LiveBriefingSwitchState();
}

class _LiveBriefingSwitchState extends State<_LiveBriefingSwitch> {
  bool _on = true;
  @override
  void initState() {
    super.initState();
    liveActivityEnabled().then((v) { if (mounted) setState(() => _on = v); });
  }

  @override
  Widget build(BuildContext context) => SwitchListTile(
        secondary: const Icon(Icons.lock_clock_outlined),
        title: const Text('잠금 화면 브리핑'),
        subtitle: const Text('평일 07:00~18:30 다음 회의와 결재·메일 건수 · 새로 도착하면 알림'),
        value: _on,
        onChanged: (v) {
          setState(() => _on = v);
          setLiveActivityEnabled(v).catchError((_) {});
        },
      );
}

/// 화면 테마(라이트·다크·시스템 따라가기) — 기기별 설정(SharedPreferences), 더보기에서 바꾼다.
class _ThemeModeTile extends ConsumerWidget {
  const _ThemeModeTile();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mode = ref.watch(themeModeProvider);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 12, 10),
      child: Row(children: [
        Icon(Icons.brightness_6_outlined, size: 22, color: Brand.muted),
        const SizedBox(width: 20),
        const Text('화면 테마', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
        const Spacer(),
        SegmentedButton<ThemeMode>(
          segments: const [
            ButtonSegment(value: ThemeMode.system, label: Text('시스템')),
            ButtonSegment(value: ThemeMode.light, label: Text('라이트')),
            ButtonSegment(value: ThemeMode.dark, label: Text('다크')),
          ],
          selected: {mode},
          showSelectedIcon: false,
          onSelectionChanged: (s) => ref.read(themeModeProvider.notifier).set(s.first),
        ),
      ]),
    );
  }
}

/// 떠 있는 이노봇 버튼 표시 — 계정 설정(user_settings.innobot_button)이라 모든 기기의 앱에 적용. 저장 실패면 되돌리고 알린다.
class _InnobotSwitch extends ConsumerWidget {
  const _InnobotSwitch();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final on = ref.watch(innobotButtonPrefProvider).value ?? true;
    return SwitchListTile(
      secondary: const Icon(Icons.smart_toy_outlined),
      title: const Text('이노봇 버튼 표시'),
      subtitle: const Text('화면에 떠 있는 이노봇 버튼 · 모든 기기에 적용'),
      value: on,
      onChanged: (v) async {
        final ok = await ref.read(innobotButtonPrefProvider.notifier).set(v);
        if (!ok && context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('설정을 저장하지 못했습니다. 다시 시도해 주세요.')));
      },
    );
  }
}
