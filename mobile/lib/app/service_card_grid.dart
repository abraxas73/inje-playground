import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'brand.dart';
import 'theme.dart';

/// 카드 격자 — 넓은 데스크톱 창에서도 칸이 커지지 않게 칸 폭을 160px 안팎으로, 높이는 카드 내용(아이콘·이름·설명 두 줄)만큼.
class ServiceCardGrid extends StatelessWidget {
  const ServiceCardGrid({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final columns = math.max(2, ((constraints.maxWidth + 8) / 168).floor());
      final ts = MediaQuery.textScalerOf(context);
      return GridView.count(
        crossAxisCount: columns,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        mainAxisSpacing: 8,
        crossAxisSpacing: 8,
        // 안쪽 여백 24 + 아이콘 32 + 간격 4 + 이름 한 줄 + 설명 두 줄 자리(한 줄이면 위 한 줄은 빈 줄) + 카드 여백
        mainAxisExtent: 68 + ts.scale(14) * _lineHeight + ts.scale(12) * _lineHeight * 2,
        children: children,
      );
    },
  );
}

const _lineHeight = 1.35;

/// 카드 한 장: 아이콘 → 바로 아래 이름 → 빈 줄 → 설명(두 줄까지, 두 줄이면 빈 줄 자리부터).
class ServiceCard extends StatelessWidget {
  const ServiceCard({super.key, required this.icon, required this.tint, required this.label, required this.desc, required this.onTap});
  final IconData icon;
  final Color tint;
  final String label;
  final String desc;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Card(
    child: InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          TintIcon(icon, size: 32, background: tint, color: Brand.navy),
          const SizedBox(height: 4),
          Text(label, style: const TextStyle(fontSize: 14, height: _lineHeight, fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
          const Spacer(),
          Text(desc, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 12, height: _lineHeight), maxLines: 2, overflow: TextOverflow.ellipsis),
        ]),
      ),
    ),
  );
}
