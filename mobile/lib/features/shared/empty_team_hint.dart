import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// 내 팀이 비어 있을 때의 안내. 내 팀 구성(앱 사용자 명단에서 고르기)은 앱 안 설정(WebView)에서 되지만,
/// Dooray에서 가져오기는 사내 VPN + Chrome 확장이 필요해 PC 웹에서만 된다.
class EmptyTeamHint extends StatelessWidget {
  const EmptyTeamHint({super.key});
  @override
  Widget build(BuildContext context) => Card(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('내 팀이 비어 있습니다', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Text('설정 → 내 팀에서 구성원을 고르면 사다리·커피 타임·뭐 먹지에서 함께 씁니다. '
                'Dooray에서 가져오기는 사내 VPN이 연결된 PC 웹에서만 되며, 거기서 가져온 명단은 앱에서도 보입니다.',
                style: Theme.of(context).textTheme.bodySmall),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(onPressed: () => context.push('/web?path=${Uri.encodeComponent('/settings')}'), child: const Text('설정에서 내 팀 구성')),
            ),
          ]),
        ),
      );
}
