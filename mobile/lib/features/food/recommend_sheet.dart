import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../api/client.dart';
import 'models.dart';
import 'repository.dart';

/// "오늘 뭐 먹지": 검색 결과에서 무작위 1곳 → 다시/결정. 결정은 웹과 같은 /api/food/decide 본문(구성원 = 내 팀 이름, 채널 전송 여부).
Future<void> showRecommendSheet(BuildContext context, WidgetRef ref, List<KakaoPlace> candidates) async {
  var pick = candidates[Random().nextInt(candidates.length)];
  var sendToChannel = true;
  await showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) => Padding(
        padding: EdgeInsets.fromLTRB(20, 16, 20, 20 + MediaQuery.of(ctx).viewInsets.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('오늘은 여기 어때요?', style: Theme.of(ctx).textTheme.titleMedium),
          const SizedBox(height: 8),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(pick.name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
            subtitle: Text('${pick.shortCategory} · ${pick.distanceM}m\n${pick.address}'),
            trailing: pick.placeUrl.isEmpty ? null : IconButton(icon: const Icon(Icons.map_outlined), onPressed: () => launchUrl(Uri.parse(pick.placeUrl), mode: LaunchMode.externalApplication)),
          ),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('팀 채널에 알리기'), value: sendToChannel, onChanged: (v) => setState(() => sendToChannel = v)),
          Row(children: [
            OutlinedButton.icon(onPressed: () => setState(() => pick = candidates[Random().nextInt(candidates.length)]), icon: const Icon(Icons.refresh), label: const Text('다시')),
            const Spacer(),
            FilledButton.icon(
              onPressed: () async {
                try {
                  final members = await recommendMembers(ref);
                  final r = await ref.read(foodRepositoryProvider).decide(place: pick, members: members.isEmpty ? ['나'] : members, sendToChannel: sendToChannel);
                  if (ctx.mounted) {
                    Navigator.pop(ctx);
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(r['webhook_sent'] == true ? '결정했습니다. 채널에 알렸어요.' : '결정했습니다.')));
                  }
                } on ApiException catch (e) {
                  if (ctx.mounted) ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text(e.message)));
                }
              },
              icon: const Icon(Icons.check),
              label: const Text('결정'),
            ),
          ]),
        ]),
      ),
    ),
  );
}

/// 결정 기록의 구성원 이름. Task 13에서 내 팀(TeamRepository.memberNames)으로 교체한다.
Future<List<String>> recommendMembers(WidgetRef ref) async => const <String>[];
