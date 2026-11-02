// 데스크톱 홈 머리줄의 "Tip!" 한 줄 — 잘 모를 만한 기능을 하나씩, [다음]으로 넘긴다.
// 목록·가중치는 관리자가 웹 /admin/settings에서 관리(GET /api/app/tips, 원본 frontend/src/lib/app-tips.ts). 가중치가 클수록 자주 뽑힌다.
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../api/client.dart';
import '../../app/theme.dart';
import '../../assistant/innobot_prefs.dart' show innobotSignedInProvider;

typedef AppTip = ({String text, int weight});

List<AppTip> parseTips(Object? j) => j is Map && j['items'] is List
    ? [
        for (final t in j['items'] as List)
          if (t is Map && t['text'] is String && (t['text'] as String).trim().isNotEmpty && t['weight'] is num && (t['weight'] as num) > 0)
            (text: (t['text'] as String).trim(), weight: (t['weight'] as num).round()),
      ]
    : const [];

/// 가중치 비례로 하나 뽑는다. [not]은 방금 본 팁(둘 이상이면 피함).
int pickTip(List<AppTip> tips, math.Random r, {int? not}) {
  final idx = [for (var i = 0; i < tips.length; i++) if (i != not || tips.length == 1) i];
  var n = r.nextInt(idx.fold(0, (s, i) => s + tips[i].weight));
  for (final i in idx) {
    n -= tips[i].weight;
    if (n < 0) return i;
  }
  return idx.last;
}

final appTipsProvider = FutureProvider<List<AppTip>>((ref) async {
  if (!ref.watch(innobotSignedInProvider)) return const [];
  return parseTips(await ref.read(apiClientProvider).getJson('/api/app/tips'));
});

class TipLine extends ConsumerStatefulWidget {
  const TipLine({super.key, this.random});
  final math.Random? random; // 테스트용
  @override
  ConsumerState<TipLine> createState() => _TipLineState();
}

class _TipLineState extends ConsumerState<TipLine> {
  late final _r = widget.random ?? math.Random();
  List<AppTip>? _tips;
  int _i = 0;

  @override
  Widget build(BuildContext context) {
    final tips = ref.watch(appTipsProvider).value ?? const <AppTip>[];
    if (tips.isEmpty) return const SizedBox.shrink(); // 불러오는 중·실패·목록 없음
    if (!identical(tips, _tips)) {
      _tips = tips;
      _i = pickTip(tips, _r);
    }
    final text = tips[_i].text;
    return Row(children: [
      const Icon(Icons.lightbulb_outline, size: 16, color: Brand.blue),
      const SizedBox(width: 6),
      const Text('Tip!', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.blue)),
      const SizedBox(width: 6),
      Flexible(
        child: Tooltip(
          message: text,
          child: Text(text, key: const ValueKey('tip-text'), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, color: Brand.navy)),
        ),
      ),
      if (tips.length > 1) TextButton(onPressed: () => setState(() => _i = pickTip(tips, _r, not: _i)), child: const Text('다음')),
    ]);
  }
}
