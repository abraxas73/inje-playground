import 'package:flutter/material.dart';
import '../../app/theme.dart';
import 'home_dashboard.dart';

/// 대시보드에 올릴 위젯 한 종류 — 제목(추가 팔레트용)과 실제 화면.
class DashboardWidgetDef {
  const DashboardWidgetDef(this.title, this.child, {this.defaultW = 6, this.defaultH = 3});
  final String title;
  final Widget child;
  final int defaultW, defaultH;
}

const _rowHeight = 84.0;
const _gap = 12.0;

/// 12칼럼 그리드 대시보드. 편집 모드에서 드래그로 위치 이동·오른쪽 아래 핸들로 크기 조정·삭제, 아래 팔레트로 추가.
/// 자유 좌표 배치라 타일은 고정 높이(내용이 넘치면 타일 안에서 스크롤). 겹치면 아래로 밀어 해소(단순 세로 압축).
class DashboardView extends StatefulWidget {
  const DashboardView({
    super.key,
    required this.layout,
    required this.widgets,
    required this.editing,
    required this.onChanged,
  });

  final List<DashboardTile> layout;
  final Map<String, DashboardWidgetDef> widgets; // id -> 정의(현재 데이터·권한이 있는 것만)
  final bool editing;
  final void Function(List<DashboardTile>) onChanged;

  @override
  State<DashboardView> createState() => _DashboardViewState();
}

class _DashboardViewState extends State<DashboardView> {
  String? _activeId; // 지금 드래그·리사이즈 중인 타일
  bool _resizing = false;
  double _dx = 0, _dy = 0; // 드래그 픽셀 누적(이동) / 리사이즈 픽셀 누적

  // 현재 화면에 그릴 타일(존재하는 위젯만). 편집 중엔 widget.layout을 그대로 쓰고 변경은 onChanged로 올린다.
  List<DashboardTile> get _tiles =>
      widget.layout.where((t) => widget.widgets.containsKey(t.id)).toList();

  double _cellW(double width) => (width + _gap) / dashboardCols;

  void _commit(List<DashboardTile> tiles) => widget.onChanged(_compact(tiles));

  /// 겹침 해소 — 읽기 순서(y,x)로 놓으며 앞선 타일과 겹치면 그 아래로 내린다.
  List<DashboardTile> _compact(List<DashboardTile> tiles) {
    final sorted = [...tiles]..sort((a, b) => a.y != b.y ? a.y - b.y : a.x - b.x);
    final placed = <DashboardTile>[];
    for (final t in sorted) {
      var y = t.y;
      while (placed.any((o) => _overlaps(t.x, y, t.w, t.h, o))) {
        final o = placed.firstWhere((o) => _overlaps(t.x, y, t.w, t.h, o));
        y = o.y + o.h;
      }
      placed.add(t.copyWith(y: y));
    }
    return placed;
  }

  bool _overlaps(int x, int y, int w, int h, DashboardTile o) =>
      x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y;

  void _remove(String id) =>
      _commit(_tiles.where((t) => t.id != id).toList());

  void _add(String id) {
    final def = widget.widgets[id]!;
    final maxY = _tiles.fold<int>(0, (m, t) => t.y + t.h > m ? t.y + t.h : m);
    _commit([..._tiles, DashboardTile(id, 0, maxY, def.defaultW, def.defaultH)]);
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, c) {
      final cellW = _cellW(c.maxWidth);
      final tiles = _tiles;
      final maxBottom = tiles.fold<int>(0, (m, t) => t.y + t.h > m ? t.y + t.h : m);
      final gridHeight = (maxBottom + (widget.editing ? 2 : 0)) * _rowHeight + 8;
      final hidden = widget.widgets.keys.where((id) => !tiles.any((t) => t.id == id)).toList();

      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SizedBox(
          height: gridHeight,
          child: Stack(children: [
            if (widget.editing) _grid(cellW, gridHeight),
            for (final t in tiles) _positioned(context, t, cellW),
          ]),
        ),
        if (widget.editing && hidden.isNotEmpty) ...[
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerLeft,
            child: Text('추가할 위젯', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.muted)),
          ),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final id in hidden)
              ActionChip(
                avatar: const Icon(Icons.add, size: 16),
                label: Text(widget.widgets[id]!.title),
                onPressed: () => _add(id),
              ),
          ]),
        ],
      ]);
    });
  }

  // 편집 모드 배경 격자(칼럼 안내선).
  Widget _grid(double cellW, double height) => Positioned.fill(
        child: CustomPaint(painter: _GridPainter(cellW, _rowHeight)),
      );

  Widget _positioned(BuildContext context, DashboardTile t, double cellW) {
    final active = _activeId == t.id;
    final moving = active && !_resizing;
    final resizing = active && _resizing;
    final left = t.x * cellW + (moving ? _dx : 0);
    final top = t.y * _rowHeight + (moving ? _dy : 0);
    final width = t.w * cellW - _gap + (resizing ? _dx : 0);
    final height = t.h * _rowHeight - _gap + (resizing ? _dy : 0);
    final def = widget.widgets[t.id]!;

    final content = ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: SizedBox.expand(
        child: SingleChildScrollView(
          physics: widget.editing ? const NeverScrollableScrollPhysics() : null,
          child: def.child,
        ),
      ),
    );

    return AnimatedPositioned(
      duration: active ? Duration.zero : const Duration(milliseconds: 150),
      curve: Curves.easeOut,
      left: left,
      top: top,
      width: width.clamp(40, double.infinity),
      height: height.clamp(40, double.infinity),
      child: widget.editing
          ? _editable(context, t, def, content)
          : content,
    );
  }

  Widget _editable(BuildContext context, DashboardTile t, DashboardWidgetDef def, Widget content) {
    return Stack(children: [
      Positioned.fill(
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Brand.blue.withValues(alpha: 0.5), width: 1.5),
          ),
          child: AbsorbPointer(child: Opacity(opacity: 0.96, child: content)),
        ),
      ),
      // 상단 손잡이 바를 잡아 이동(여기만 드래그 — 나머지는 페이지 스크롤과 안 겹친다)
      Positioned(
        left: 0, right: 0, top: 0,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onPanStart: (_) => setState(() { _activeId = t.id; _resizing = false; _dx = 0; _dy = 0; }),
          onPanUpdate: (d) => setState(() { _dx += d.delta.dx; _dy += d.delta.dy; }),
          onPanEnd: (_) => _endMove(t, context),
          child: Container(
            height: 26,
            decoration: BoxDecoration(
              color: Brand.blue.withValues(alpha: 0.9),
              borderRadius: const BorderRadius.only(topLeft: Radius.circular(15), topRight: Radius.circular(15)),
            ),
            child: Row(children: [
              const SizedBox(width: 8),
              const Icon(Icons.drag_indicator, size: 16, color: Colors.white),
              const SizedBox(width: 4),
              Expanded(child: Text(def.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Colors.white))),
              const SizedBox(width: 30), // 삭제 버튼 자리
            ]),
          ),
        ),
      ),
      // 삭제
      Positioned(
        top: 1, right: 4,
        child: _round(Icons.close, () => _remove(t.id)),
      ),
      // 오른쪽 아래 리사이즈 핸들
      Positioned(
        right: 0, bottom: 0,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onPanStart: (_) => setState(() { _activeId = t.id; _resizing = true; _dx = 0; _dy = 0; }),
          onPanUpdate: (d) => setState(() { _dx += d.delta.dx; _dy += d.delta.dy; }),
          onPanEnd: (_) => _endResize(t, context),
          child: Container(
            width: 26, height: 26,
            decoration: BoxDecoration(color: Brand.blue, borderRadius: const BorderRadius.only(topLeft: Radius.circular(10))),
            child: const Icon(Icons.open_in_full, size: 14, color: Colors.white),
          ),
        ),
      ),
    ]);
  }

  Widget _round(IconData icon, VoidCallback onTap) => Material(
        color: Brand.danger,
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: Padding(padding: const EdgeInsets.all(4), child: Icon(icon, size: 16, color: Colors.white)),
        ),
      );

  void _endMove(DashboardTile t, BuildContext context) {
    final cellW = _cellW(context.size!.width);
    final nx = ((t.x * cellW + _dx) / cellW).round().clamp(0, dashboardCols - t.w);
    final ny = ((t.y * _rowHeight + _dy) / _rowHeight).round().clamp(0, 999);
    setState(() { _activeId = null; _dx = 0; _dy = 0; });
    _commit(_tiles.map((e) => e.id == t.id ? e.copyWith(x: nx, y: ny) : e).toList());
  }

  void _endResize(DashboardTile t, BuildContext context) {
    final cellW = _cellW(context.size!.width);
    final nw = (((t.w * cellW - _gap + _dx) + _gap) / cellW).round().clamp(1, dashboardCols - t.x);
    final nh = (((t.h * _rowHeight - _gap + _dy) + _gap) / _rowHeight).round().clamp(1, 40);
    setState(() { _activeId = null; _resizing = false; _dx = 0; _dy = 0; });
    _commit(_tiles.map((e) => e.id == t.id ? e.copyWith(w: nw, h: nh) : e).toList());
  }
}

class _GridPainter extends CustomPainter {
  _GridPainter(this.cellW, this.rowH);
  final double cellW, rowH;
  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = Brand.line.withValues(alpha: 0.6)
      ..strokeWidth = 1;
    for (var x = 0; x <= dashboardCols; x++) {
      final dx = x * cellW;
      canvas.drawLine(Offset(dx, 0), Offset(dx, size.height), p);
    }
    for (var y = 0.0; y <= size.height; y += rowH) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), p);
    }
  }

  @override
  bool shouldRepaint(_GridPainter old) => old.cellW != cellW || old.rowH != rowH;
}
