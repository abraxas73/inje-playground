import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

/// Desktop cards use available window width, not the physical display size.
/// Keep one render parent across resizes so stateful cards retain their state.
class HomeCardLayout extends StatelessWidget {
  const HomeCardLayout({super.key, required this.children});
  final List<Widget> children;

  /// Columns for [width]; the home header uses the same split to line up with the cards.
  static int columnsFor(BuildContext context, double width) {
    final desktop =
        !kIsWeb &&
        switch (defaultTargetPlatform) {
          TargetPlatform.macOS ||
          TargetPlatform.windows ||
          TargetPlatform.linux => true,
          _ => false,
        };
    final minimumWidth =
        380 * math.max(1, MediaQuery.textScalerOf(context).scale(14) / 14);
    return desktop
        ? ((width + 16) / (minimumWidth + 16)).floor().clamp(1, 3)
        : 1;
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        return _HomeCards(
          columns: columnsFor(context, constraints.maxWidth),
          direction: Directionality.of(context),
          children: children,
        );
      },
    );
  }
}

class _HomeCards extends MultiChildRenderObjectWidget {
  const _HomeCards({
    required this.columns,
    required this.direction,
    required super.children,
  });
  final int columns;
  final TextDirection direction;
  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderHomeCards(columns, direction);
  @override
  void updateRenderObject(
    BuildContext context,
    covariant _RenderHomeCards renderObject,
  ) {
    renderObject.configure(columns, direction);
  }
}

class _HomeCardParentData extends ContainerBoxParentData<RenderBox> {}

class _RenderHomeCards extends RenderBox
    with
        ContainerRenderObjectMixin<
          RenderBox,
          ContainerBoxParentData<RenderBox>
        >,
        RenderBoxContainerDefaultsMixin<
          RenderBox,
          ContainerBoxParentData<RenderBox>
        > {
  _RenderHomeCards(this._columns, this._direction);
  int _columns;
  TextDirection _direction;

  void configure(int columns, TextDirection direction) {
    if (_columns == columns && _direction == direction) return;
    _columns = columns;
    _direction = direction;
    markNeedsLayout();
  }

  @override
  void setupParentData(RenderBox child) {
    if (child.parentData is! ContainerBoxParentData<RenderBox>) {
      child.parentData = _HomeCardParentData();
    }
  }

  @override
  void performLayout() {
    final width = constraints.maxWidth;
    final cardWidth = (width - 16 * (_columns - 1)) / _columns;
    final heights = List.filled(_columns, 0.0);
    var child = firstChild;
    while (child != null) {
      child.layout(
        BoxConstraints.tightFor(width: cardWidth),
        parentUsesSize: true,
      );
      var column = 0;
      for (var i = 1; i < _columns; i++) {
        if (heights[i] < heights[column]) column = i;
      }
      final data = child.parentData! as ContainerBoxParentData<RenderBox>;
      final visualColumn = _direction == TextDirection.rtl
          ? _columns - 1 - column
          : column;
      data.offset = Offset(visualColumn * (cardWidth + 16), heights[column]);
      // Sections own their vertical spacing. Hidden (zero-height) sections
      // consume no slot or gap, including asynchronous empty-source results.
      heights[column] += child.size.height;
      child = data.nextSibling;
    }
    size = constraints.constrain(Size(width, heights.reduce(math.max)));
  }

  @override
  void paint(PaintingContext context, Offset offset) =>
      defaultPaint(context, offset);
  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) =>
      defaultHitTestChildren(result, position: position);
}
