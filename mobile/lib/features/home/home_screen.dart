import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../app/brand.dart';
import '../../app/theme.dart';
import '../../auth/session.dart';
import '../../gw/gw_notices_card.dart';
import '../../gw/gw_today_card.dart';
import '../../more/catalog.dart';
import '../../more/service_grid.dart';
import 'greeting.dart';
import 'quotes.dart';
import '../../release/update_banner.dart';

/// 로그인 뒤 첫 화면(웰컴): 시간·날짜 인사, 오늘의 한 줄, 네이티브 기능 바로 가기, 사내 서비스(WebView) 카드.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key, this.now});
  final DateTime? now; // 테스트에서 고정
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider).asData?.value;
    final t = now ?? DateTime.now();
    final g = greetingFor(t, name: session?.name);
    final q = dailyQuote(t);
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: ListView(padding: const EdgeInsets.fromLTRB(20, 12, 20, 24), children: [
          const Align(alignment: Alignment.centerLeft, child: BrandLogo(width: 86, opacity: 0.8)),
          const SizedBox(height: 14),
          const UpdateBanner(),
          Text(g.title, style: theme.textTheme.headlineSmall),
          const SizedBox(height: 4),
          Text(g.subtitle, style: theme.textTheme.bodySmall),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 14),
            decoration: BoxDecoration(color: Brand.navy, borderRadius: BorderRadius.circular(16)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Row(children: [
                Icon(Icons.format_quote_rounded, size: 18, color: Brand.sky),
                SizedBox(width: 6),
                Text('오늘의 한 줄', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.3, color: Brand.sky)),
              ]),
              const SizedBox(height: 10),
              Text(q.text, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, height: 1.5, color: Colors.white)),
              const SizedBox(height: 8),
              Align(alignment: Alignment.centerRight, child: Text('— ${q.source}', style: TextStyle(fontSize: 13, color: Colors.white.withValues(alpha: 0.6)))),
            ]),
          ),
          const SizedBox(height: 12),
          const GwTodayCard(),
          const GwNoticesCard(),
          const SizedBox(height: 20),
          Padding(padding: const EdgeInsets.only(left: 4, bottom: 8), child: Text('바로 가기', style: theme.textTheme.titleSmall)),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 8,
            crossAxisSpacing: 8,
            childAspectRatio: 1.5,
            children: [
              // Teams 채팅이 맨 앞(사용자 요청) — 권한이 있을 때만. WebView로 연다.
              if (session != null && canUsePage(session, teamsChatEntry))
                _quick(context, Icons.forum_outlined, 'Teams 채팅', '내가 속한 채팅 읽기·보내기', () => context.push('/web?path=${Uri.encodeComponent('/teams/chat')}'), Brand.tints[3]),
              _quick(context, Icons.restaurant, '뭐 먹지', '주변 식당·카페', () => context.go('/food'), Brand.tints[2]),
              _quick(context, Icons.stairs, '사다리', '순서·당번 정하기', () => context.go('/ladder'), Brand.tints[0]),
              _quick(context, Icons.coffee, '커피 타임', '팀 나누기·법카', () => context.go('/team'), Brand.tints[1]),
            ],
          ),
          if (session != null && webServices(session).isNotEmpty) ...[
            const SizedBox(height: 20),
            Padding(padding: const EdgeInsets.only(left: 4, bottom: 8), child: Text('사내 서비스', style: theme.textTheme.titleSmall)),
            ServiceGrid(session: session),
          ],
        ]),
      ),
    );
  }

  Widget _quick(BuildContext context, IconData icon, String label, String desc, VoidCallback onTap, Color tint) => Card(
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              TintIcon(icon, size: 40, background: tint, color: Brand.navy),
              const Spacer(),
              Text(label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 2),
              Text(desc, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis),
            ]),
          ),
        ),
      );
}
