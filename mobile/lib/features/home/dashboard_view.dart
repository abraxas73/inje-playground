import 'package:flutter/material.dart';
import '../../app/brand.dart' show TileMenuSlot, WidgetTitle;
import '../../app/theme.dart';
import 'dashboard_style.dart';
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
            WidgetTitle(title),
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
    this.onPin,
    this.isPinned,
    this.bgOf,
    this.onBg,
  });

  final List<DashboardTile> layout;
  final Map<String, DashboardWidgetDef> widgets; // id -> 정의(현재 데이터·권한이 있는 것만)
  final bool editing;
  final void Function(List<DashboardTile>) onChanged;

  /// 주면 보기 모드 타일 오른쪽 위에 ⋮ 메뉴(마우스를 올리면) — "Always On"(모든 화면 위에 띄우기) 켜기/끄기. size는 지금 타일 크기.
  final void Function(String id, Size size)? onPin;
  final bool Function(String id)? isPinned;

  /// 주면 보기 모드에서 위젯마다 영역(테두리·바탕)을 그리고, ⋮ 메뉴에 배경색 고르기를 둔다. 값은 widgetBgChoices 번호(null = 기본).
  final int? Function(String id)? bgOf;
  final void Function(String id, int? choice)? onBg;

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

  // 편집한 타일(pinned)은 놓은 자리 그대로, 그와 겹치는 타일만 밀어낸다(나머지는 그대로).
  // 지금 안 보이는(데이터·권한이 아직 없는) 타일은 그대로 보존해 함께 올린다 — 편집 한 번에 서버 배치에서 사라지지 않게.
  void _commit(List<DashboardTile> tiles, {String? pinned}) => widget.onChanged([
        ...resolveCollisions(tiles, pinned: pinned),
        ...widget.layout.where((t) => !widget.widgets.containsKey(t.id)),
      ]);

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
          if (_activeId != null && tiles.any((t) => t.id == _activeId)) _dropGuide(_snap(tiles.firstWhere((t) => t.id == _activeId), cellW), cellW),
          for (final t in tiles) _positioned(context, t, cellW),
        ]),
      );
    });
  }

  /// 지금 끌고 있는 타일을 놓으면 들어갈 칸(격자에 맞춘 위치·크기).
  DashboardTile _snap(DashboardTile t, double cellW) {
    if (_resizing) {
      final nw = (((t.w * cellW - _gap + _dx) + _gap) / cellW).round().clamp(1, dashboardCols - t.x);
      final nh = (((t.h * _rowHeight - _gap + _dy) + _gap) / _rowHeight).round().clamp(1, 40);
      return t.copyWith(w: nw, h: nh);
    }
    final nx = ((t.x * cellW + _dx) / cellW).round().clamp(0, dashboardCols - t.w);
    // 아래로 너무 멀리 끌어 놓아도 다른 타일들 바로 아래까지만(거대한 빈 공간 방지)
    final others = _tiles.where((o) => o.id != t.id).fold<int>(0, (m, o) => o.y + o.h > m ? o.y + o.h : m);
    final ny = ((t.y * _rowHeight + _dy) / _rowHeight).round().clamp(0, others);
    return t.copyWith(x: nx, y: ny);
  }

  // 놓을 자리 안내 — 점선 사각형.
  Widget _dropGuide(DashboardTile s, double cellW) => Positioned(
        left: s.x * cellW,
        top: s.y * _rowHeight,
        width: s.w * cellW - _gap,
        height: s.h * _rowHeight - _gap,
        child: IgnorePointer(child: CustomPaint(painter: _DashedRectPainter(Brand.blue))),
      );

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
      key: ValueKey(t.id), // 순서가 바뀌어도 위젯 상태(대화방 목록·로딩)를 다시 만들지 않게
      duration: active ? Duration.zero : const Duration(milliseconds: 150),
      curve: Curves.easeOut,
      left: left,
      top: top,
      width: width.clamp(40, double.infinity),
      height: height.clamp(40, double.infinity),
      child: widget.editing
          ? _editable(context, t, def, content)
          : widget.onPin == null
              ? content
              : _TileMenu(
                  pinned: widget.isPinned?.call(t.id) ?? false,
                  onPin: () => widget.onPin!(t.id, Size(width, height)),
                  bg: widget.bgOf?.call(t.id),
                  onBg: widget.onBg == null ? null : (i) => widget.onBg!(t.id, i),
                  // 위젯마다 영역을 보이게(편집 화면만큼 강하지 않게) — 옅은 테두리 + 바탕
                  child: widget.bgOf == null
                      ? content
                      : Container(
                          decoration: BoxDecoration(color: widgetBgColor(widget.bgOf!(t.id)), borderRadius: BorderRadius.circular(18), border: Border.all(color: Brand.line)),
                          padding: const EdgeInsets.all(4),
                          // 위젯 바깥 카드는 영역 바탕을 그대로 보이게(투명) — 아니면 고른 배경색이 가장자리에만 보인다
                          child: Theme(
                            data: Theme.of(context).copyWith(cardTheme: Theme.of(context).cardTheme.copyWith(color: Colors.transparent, surfaceTintColor: Colors.transparent, elevation: 0, shadowColor: Colors.transparent)),
                            child: content,
                          ),
                        ),
                ),
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
          onPanEnd: (_) => _end(t, context),
          onPanCancel: () => setState(() { _activeId = null; _resizing = false; _dx = 0; _dy = 0; }),
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
          onPanEnd: (_) => _end(t, context),
          onPanCancel: () => setState(() { _activeId = null; _resizing = false; _dx = 0; _dy = 0; }),
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


  // 놓으면 안내선 자리 그대로 배치(겹친 타일만 밀림).
  void _end(DashboardTile t, BuildContext context) {
    final snapped = _snap(t, _cellW(context.size!.width));
    setState(() { _activeId = null; _resizing = false; _dx = 0; _dy = 0; });
    _commit(_tiles.map((e) => e.id == t.id ? snapped : e).toList(), pinned: t.id);
  }
}

/// 편집 모드에서 화면에 떠 있는 위젯 툴바 — 배치 안 된(삭제했거나 아직 안 넣은) 위젯을 칩으로 보여 주고 누르면 추가,
/// 자동 배열·편집 완료. 머리줄을 끌면 툴바 위치를 옮긴다(onDrag).
class DashboardPalette extends StatelessWidget {
  const DashboardPalette({super.key, required this.widgets, required this.layout, required this.onAdd, required this.onDone, this.onArrange, this.onDrag});
  final Map<String, DashboardWidgetDef> widgets;
  final List<DashboardTile> layout;
  final void Function(String id) onAdd;
  final VoidCallback onDone;
  final VoidCallback? onArrange;
  final void Function(Offset delta)? onDrag;

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
          MouseRegion(
            cursor: onDrag == null ? MouseCursor.defer : SystemMouseCursors.move,
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onPanUpdate: onDrag == null ? null : (d) => onDrag!(d.delta),
              child: Row(children: [
                if (onDrag != null) ...[Tooltip(message: '끌어서 툴바 옮기기', child: Icon(Icons.drag_indicator, size: 18, color: Brand.faint)), const SizedBox(width: 2)],
                Icon(Icons.dashboard_customize_outlined, size: 18, color: Brand.blue),
                const SizedBox(width: 6),
                const Text('위젯 추가', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
                const SizedBox(width: 8),
                Text(hidden.isEmpty ? '모두 배치됨' : '${hidden.length}개', style: TextStyle(fontSize: 12, color: Brand.faint)),
                const Spacer(),
                if (onArrange != null) TextButton.icon(onPressed: onArrange, icon: const Icon(Icons.auto_awesome_mosaic_outlined, size: 18), label: const Text('자동 배열')),
                TextButton.icon(onPressed: onDone, icon: const Icon(Icons.check, size: 18), label: const Text('편집 완료')),
              ]),
            ),
          ),
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

class _DashedRectPainter extends CustomPainter {
  _DashedRectPainter(this.color);
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    final rect = RRect.fromRectAndRadius(Offset.zero & size, const Radius.circular(16));
    canvas.drawRRect(rect, Paint()..color = color.withValues(alpha: 0.08));
    final stroke = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    for (final m in (Path()..addRRect(rect)).computeMetrics()) {
      for (var d = 0.0; d < m.length; d += 12) {
        canvas.drawPath(m.extractPath(d, d + 7), stroke);
      }
    }
  }

  @override
  bool shouldRepaint(_DashedRectPainter old) => old.color != color;
}

/// 보기 모드 타일 오른쪽 위 ⋮ — 마우스를 올렸을 때(또는 켜져 있을 때 핀 표시와 함께) 보인다. 내용 위 머리 링크를 가리지 않게 평소엔 숨김.
class _TileMenu extends StatefulWidget {
  const _TileMenu({required this.pinned, required this.onPin, required this.child, this.bg, this.onBg});
  final bool pinned;
  final VoidCallback onPin;
  final int? bg;
  final void Function(int? choice)? onBg;
  final Widget child;
  @override
  State<_TileMenu> createState() => _TileMenuState();
}

class _TileMenuState extends State<_TileMenu> {
  bool _hover = false, _open = false; // 메뉴가 열리면 마우스가 타일을 벗어난 것으로 처리돼도 버튼(=선택 결과 받을 곳)을 유지
  bool _claimed = false; // 위젯 제목(WidgetTitle)이 버튼을 제목 옆에 그리는 중 — 그러면 구석에는 안 그린다
  bool get _visible => _hover || _open || widget.pinned;

  Widget _button() => SizedBox(
        width: 28,
        height: 28,
        child: Material(
          color: Brand.surface.withValues(alpha: 0.95),
          shape: const CircleBorder(),
          elevation: 1,
          child: PopupMenuButton<String>(
            tooltip: '위젯 옵션',
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 300), // 'Always On — …'이 줄바꿈되지 않게
            iconSize: 16,
            icon: Icon(widget.pinned ? Icons.push_pin : Icons.more_vert, size: 16, color: widget.pinned ? Brand.blue : Brand.muted),
            onOpened: () => setState(() => _open = true),
            onCanceled: () => setState(() => _open = false),
            onSelected: (v) {
              setState(() => _open = false);
              if (v == 'pin') widget.onPin();
              if (v.startsWith('bg:')) widget.onBg?.call(v == 'bg:' ? null : int.parse(v.substring(3)));
            },
            itemBuilder: (_) => [
              CheckedPopupMenuItem(value: 'pin', checked: widget.pinned, child: Text(widget.pinned ? 'Always On 끄기' : 'Always On — 모든 화면 위에 띄우기', maxLines: 1, softWrap: false, overflow: TextOverflow.ellipsis)),
              if (widget.onBg != null) ...[
                const PopupMenuDivider(),
                PopupMenuItem(enabled: false, height: 28, child: Text('배경색', style: TextStyle(fontSize: 12, color: Brand.muted))),
                _bgItem('bg:', '기본', Brand.surface, widget.bg == null),
                for (final (i, (name, color)) in widgetBgChoices.indexed) _bgItem('bg:$i', name, color, widget.bg == i),
              ],
            ],
          ),
        ),
      );

  @override
  Widget build(BuildContext context) => MouseRegion(
        onEnter: (_) => setState(() => _hover = true),
        onExit: (_) => setState(() => _hover = false),
        child: Stack(children: [
          Positioned.fill(
            child: TileMenuSlot(
              button: _visible ? _button() : null,
              claim: () { if (mounted && !_claimed) setState(() => _claimed = true); },
              child: widget.child,
            ),
          ),
          // 제목이 없는 위젯(바로 가기 격자 등)만 예전처럼 오른쪽 위 구석에
          if (_visible && !_claimed) Positioned(top: 4, right: 4, child: _button()),
        ]),
      );

  PopupMenuItem<String> _bgItem(String value, String name, Color color, bool selected) => PopupMenuItem(
        value: value,
        height: 36,
        child: Row(children: [
          Container(width: 18, height: 18, decoration: BoxDecoration(color: color, shape: BoxShape.circle, border: Border.all(color: Brand.line))),
          const SizedBox(width: 10),
          Expanded(child: Text(name)),
          if (selected) Icon(Icons.check, size: 16, color: Brand.blue),
        ]),
      );
}
