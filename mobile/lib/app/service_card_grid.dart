import 'dart:math' as math;
import 'package:flutter/material.dart';

/// Keep service cards compact even in wide desktop windows.
class ServiceCardGrid extends StatelessWidget {
  const ServiceCardGrid({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final columns = math.max(2, ((constraints.maxWidth + 8) / 248).floor());
      final textScaler = MediaQuery.textScalerOf(context);
      return GridView.count(
        crossAxisCount: columns,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        mainAxisSpacing: 8,
        crossAxisSpacing: 8,
        mainAxisExtent: 148 + math.max(0, textScaler.scale(30) - 30),
        children: children,
      );
    },
  );
}
