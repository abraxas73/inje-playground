import 'package:flutter/material.dart';
import '../../app/theme.dart';
import 'home_dashboard.dart';

/// 대시보드에 올릴 위젯 한 종류 — 제목(추가 팔레트용)과 실제 화면.
class DashboardWidgetDef {
  const DashboardWidgetDef(this.title, this.child, {this.defaultW = 6, this.defaultH = 3, this.fill = false});
  final String title;
  final Widget child;
  final int defaultW, defaultH;

  /// true면 타일 높이를 그대로 채운다(스크롤로 감싸지 않음) — 안내 placeholder, 내부에 자체 스크롤/Navigator가 있는 위젯용.
  final bool fill;
}

/// 데이터·연결이 없어 내용을 못 그리는 위젯 자리 — 영역은 그대로 두고 "연결 필요"·안내를 보여 준다.
/// (위젯을 건너뛰어 빈 공간이 생기거나 배치가 밀리지 않게 한다.)
class DashboardPlaceholder extends StatelessWidget {
  const DashboardPlaceholder({super.key, required this.title, required this.message, this.icon = Icons.link_off_rounded, this.onConnect, this.connectLabel = '연결하기'});
  final String title, message, connectLabel;
  final IconData icon;
  final VoidCallback? onConnect;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(title, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.muted)),
            Expanded(
              child: Center(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Icon(icon, size: 22, color: Brand.faint),
                  const SizedBox(height: 6),
                  Text(message, textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: Brand.faint)),
                  if (onConnect != null) ...[
                    const SizedBox(height: 10),
                    FilledButton.tonal(onPressed: onConnect, style: FilledButton.styleFrom(minimumSize: const Size(0, 34), padding: const EdgeInsets.symmetric(horizontal: 14)), child: Text(connectLabel, style: const TextStyle(fontSize: 13))),
                  ],
                ]),
              ),
            ),
          ]),
        ),
      );
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

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, c) {
      final cellW = _cellW(c.maxWidth);
      final tiles = _tiles;
      final maxBottom = tiles.fold<int>(0, (m, t) => t.y + t.h > m ? t.y + t.h : m);
      // 편집 모드에선 아래 여백을 넉넉히(떠 있는 팔레트에 가리지 않게)
      final gridHeight = (maxBottom) * _rowHeight + 8 + (widget.editing ? 180 : 0);

      return SizedBox(
        height: gridHeight,
        child: Stack(children: [
          if (widget.editing) _grid(cellW, gridHeight),
          for (final t in tiles) _positioned(context, t, cellW),
        ]),
      );
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

    // placeholder는 타일 높이를 채워야 하므로(Expanded 사용) 스크롤로 감싸지 않는다.
    // 실제 섹션은 내용이 길 수 있어 스크롤로 감싼다.
    final content = ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: SizedBox.expand(
        child: (def.fill || def.child is DashboardPlaceholder)
            ? def.child
            : SingleChildScrollView(
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

/// 편집 모드에서 화면에 떠 있는 "위젯 추가" 팔레트 — 배치 안 된(삭제했거나 아직 안 넣은) 위젯을 칩으로 보여 주고 누르면 추가.
class DashboardPalette extends StatelessWidget {
  const DashboardPalette({super.key, required this.widgets, required this.layout, required this.onAdd, required this.onDone});
  final Map<String, DashboardWidgetDef> widgets;
  final List<DashboardTile> layout;
  final void Function(String id) onAdd;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    final hidden = widgets.keys.where((id) => !layout.any((t) => t.id == id)).toList();
    return Material(
      color: Brand.surface,
      elevation: 12,
      borderRadius: BorderRadius.circular(18),
      child: Container(
        constraints: const BoxConstraints(maxWidth: 720),
        padding: const EdgeInsets.fromLTRB(16, 12, 12, 14),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(Icons.dashboard_customize_outlined, size: 18, color: Brand.blue),
            const SizedBox(width: 6),
            const Text('위젯 추가', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
            const SizedBox(width: 8),
            Text(hidden.isEmpty ? '모두 배치됨' : '${hidden.length}개', style: TextStyle(fontSize: 12, color: Brand.faint)),
            const Spacer(),
            TextButton.icon(onPressed: onDone, icon: const Icon(Icons.check, size: 18), label: const Text('편집 완료')),
          ]),
          const SizedBox(height: 8),
          if (hidden.isEmpty)
            Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Text('모든 위젯이 홈에 있습니다. 위젯의 ✕로 지우면 여기서 다시 추가할 수 있어요.', style: TextStyle(fontSize: 12, color: Brand.muted)))
          else
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final id in hidden)
                ActionChip(avatar: const Icon(Icons.add, size: 16), label: Text(widgets[id]!.title), onPressed: () => onAdd(id)),
            ]),
        ]),
      ),
    );
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
