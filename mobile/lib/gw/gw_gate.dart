import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_creds.dart';

/// 아마란스 화면의 공통 입구: 미연결·재연결 필요·로딩이면 안내를, 연결돼 있으면 [builder]를 그린다.
class GwGate extends ConsumerWidget {
  const GwGate({super.key, required this.title, required this.builder});
  final String title;
  final Widget Function(BuildContext context, GwApi api) builder;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final st = ref.watch(gwProvider);
    final api = ref.watch(gwApiProvider);
    final state = st.value;
    if (state == null) return Scaffold(appBar: BrandHeader(title: title, showBack: true), body: const Center(child: CircularProgressIndicator()));
    if (state.status == GwStatus.connected && api != null) return builder(context, api);
    final relogin = state.status == GwStatus.needsRelogin;
    return Scaffold(
      appBar: BrandHeader(title: title, showBack: true),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            TintIcon(relogin ? Icons.lock_reset : Icons.apartment_outlined, size: 56),
            const SizedBox(height: 16),
            Text(relogin ? '아마란스 로그인이 만료되었습니다' : '아마란스를 연결하면 여기서 바로 봅니다', style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
            const SizedBox(height: 6),
            Text(relogin ? '다시 로그인하면 이어서 쓸 수 있습니다.' : '미결 결재 · 출퇴근 · 오늘 일정과 회의실 · 메일 미읽음. 토큰은 이 기기에만 저장됩니다.', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Brand.muted), textAlign: TextAlign.center),
            const SizedBox(height: 20),
            FilledButton.icon(onPressed: () => context.push('/gw/connect'), icon: const Icon(Icons.login, size: 18), label: Text(relogin ? '다시 연결' : '아마란스 연결하기')),
          ]),
        ),
      ),
    );
  }
}
