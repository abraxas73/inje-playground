import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'brand.dart';
import 'theme.dart';

/// 정사각형 카드 격자 — 넓은 데스크톱 창에서도 칸이 커지지 않게 칸 폭을 140px 안팎으로 맞춘다.
class ServiceCardGrid extends StatelessWidget {
  const ServiceCardGrid({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final columns = math.max(2, ((constraints.maxWidth + 8) / 148).floor());
      final cell = (constraints.maxWidth - 8 * (columns - 1)) / columns;
      final textScaler = MediaQuery.textScalerOf(context);
      return GridView.count(
        crossAxisCount: columns,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        mainAxisSpacing: 8,
        crossAxisSpacing: 8,
        // 정사각형, 글자를 키우면 넘치지 않을 만큼만 세로로 늘린다
        mainAxisExtent: math.max(cell, 72 + textScaler.scale(30)),
        children: children,
      );
    },
  );
}

/// 카드 한 장: 첫 줄 왼쪽 아이콘·오른쪽 이름, 아래 오른쪽 정렬 한 줄 설명.
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
        child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Row(children: [
            TintIcon(icon, size: 32, background: tint, color: Brand.navy),
            const SizedBox(width: 8),
            Expanded(child: Text(label, textAlign: TextAlign.right, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis)),
          ]),
          const Spacer(),
          Text(desc, textAlign: TextAlign.right, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis),
        ]),
      ),
    ),
  );
}
