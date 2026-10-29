// 데스크톱(macOS·Windows) 이노봇 창 — 앱 위에 떠 있는 창. 머리글을 끌어 원하는 곳에 두고, 네 변·네 모서리를 끌어 크기를 바꾼다(위치·크기는 기기에 기억). 뒤 화면도 그대로 쓴다.
// 라우터 내비게이터 위 전용 Overlay(main.dart assistantWindowOverlay)에 띄워 화면을 이동해도 가려지지 않는다.
// 창 안의 대화 기록 등 팝업은 창 안 Navigator에서 열린다.
import '../app/copy_selection_area.dart';
import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../app/theme.dart';
import 'assistant_sheet.dart';
import 'innobot_prefs.dart';
import '../app/platform.dart';

/// main.dart builder의 Stack에 둔 빈 Overlay(이노봇 버튼 레이어 아래).
final assistantWindowOverlay = GlobalKey<OverlayState>();

bool get assistantUsesWindow => isDesktopPlatform;

const _kPos = 'innobot.window.pos', _kSize = 'innobot.window.size';
const assistantWindowSize = Size(440, 680), assistantWindowMinSize = Size(340, 420);
const _margin = 16.0;

OverlayEntry? _entry;
Completer<void>? _closed;

void _close() {
  final e = _entry;
  if (e == null) return;
  _entry = null;
  e.remove();
  innobotPopups.value = math.max(0, innobotPopups.value - 1);
  _closed?.complete();
  _closed = null;
}

/// 이미 열려 있으면 그대로 둔다. [seed]가 있으면(일정 "추가" 등) 새로 열어 그 문장을 보낸다.
Future<void> showAssistantWindow({String? seed}) {
  final overlay = assistantWindowOverlay.currentState;
  if (overlay == null) return Future.value();
  if (_entry != null) {
    if (seed == null) return _closed!.future;
    _close();
  }
  final closed = _closed = Completer<void>();
  _entry = OverlayEntry(builder: (_) => AssistantWindow(seed: seed, onClose: _close));
  overlay.insert(_entry!);
  innobotPopups.value += 1;
  return closed.future;
}

/// 창 위치(왼쪽 위) — 화면 안으로 자른다. 저장값이 없으면 오른쪽 위.
Offset clampWindow(Offset? want, Size screen, Size window) {
  final maxX = math.max(_margin, screen.width - window.width - _margin), maxY = math.max(_margin, screen.height - window.height - _margin);
  final p = want ?? Offset(maxX, _margin + 40);
  return Offset(p.dx.clamp(_margin, maxX), p.dy.clamp(_margin, maxY));
}

/// 창 크기 — 최소 크기와 화면(여백 제외) 사이로 자른다. 저장값이 없으면 기본 크기. 화면이 최소보다 작으면 화면에 맞춘다.
Size clampWindowSize(Size? want, Size screen) {
  final w = want ?? assistantWindowSize, maxW = screen.width - _margin * 2, maxH = screen.height - _margin * 2;
  return Size(math.min(math.max(w.width, assistantWindowMinSize.width), maxW), math.min(math.max(w.height, assistantWindowMinSize.height), maxH));
}

/// 변·모서리 끌기 한 번 — [r]의 끌린 변(left/top/right/bottom)만 [d]만큼 옮긴다. 최소 크기에서 멈추고 화면 여백 밖으로는 안 나간다.
Rect resizeWindow(Rect r, Offset d, Size screen, {bool left = false, bool top = false, bool right = false, bool bottom = false}) {
  final min = assistantWindowMinSize;
  var l = r.left, t = r.top, rr = r.right, b = r.bottom;
  if (left) l = (l + d.dx).clamp(_margin, math.max(_margin, rr - min.width));
  if (right) rr = (rr + d.dx).clamp(math.min(l + min.width, screen.width - _margin), screen.width - _margin);
  if (top) t = (t + d.dy).clamp(_margin, math.max(_margin, b - min.height));
  if (bottom) b = (b + d.dy).clamp(math.min(t + min.height, screen.height - _margin), screen.height - _margin);
  return Rect.fromLTRB(l, t, rr, b);
}

class AssistantWindow extends StatefulWidget {
  const AssistantWindow({super.key, this.seed, required this.onClose, this.body});
  final String? seed;
  final VoidCallback onClose;
  /// 테스트용 내용(기본은 AssistantSheet)
  final Widget? body;
  @override
  State<AssistantWindow> createState() => _AssistantWindowState();
}

class _AssistantWindowState extends State<AssistantWindow> {
  Offset? _pos;
  Size? _size;
  bool _dragging = false;

  static List<double>? _pair(SharedPreferences p, String key) {
    final v = p.getStringList(key);
    final a = v == null || v.length != 2 ? null : double.tryParse(v[0]), b = v == null || v.length != 2 ? null : double.tryParse(v[1]);
    return a == null || b == null ? null : [a, b];
  }

  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance().then((p) {
      final pos = _pair(p, _kPos), size = _pair(p, _kSize);
      if (!mounted) return;
      setState(() {
        if (pos != null && _pos == null) _pos = Offset(pos[0], pos[1]);
        if (size != null && _size == null) _size = Size(size[0], size[1]);
      });
    }).catchError((_) {});
  }

  void _save() {
    final p = _pos;
    if (p == null) return;
    final z = _size;
    SharedPreferences.getInstance().then((s) async {
      await s.setStringList(_kPos, [p.dx.toStringAsFixed(0), p.dy.toStringAsFixed(0)]);
      if (z != null) await s.setStringList(_kSize, [z.width.toStringAsFixed(0), z.height.toStringAsFixed(0)]);
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
        final screen = box.biggest;
        final size = clampWindowSize(_size, screen);
        final pos = clampWindow(_pos, screen, size);
        return Stack(children: [
          Positioned(
            left: pos.dx, top: pos.dy, width: size.width, height: size.height,
            child: Material(
              key: const ValueKey('innobot-window'),
              elevation: 16,
              color: Brand.ground,
              borderRadius: BorderRadius.circular(16),
              clipBehavior: Clip.antiAlias,
              child: Column(children: [
                MouseRegion(
                  cursor: _dragging ? SystemMouseCursors.grabbing : SystemMouseCursors.grab,
                  child: GestureDetector(
                    key: const ValueKey('innobot-window-drag'),
                    behavior: HitTestBehavior.opaque,
                    onPanStart: (_) => setState(() { _dragging = true; _pos = pos; }),
                    onPanUpdate: (d) => setState(() => _pos = clampWindow((_pos ?? pos) + d.delta, screen, size)),
                    onPanEnd: (_) { setState(() => _dragging = false); _save(); },
                    child: Container(
                      height: 36,
                      padding: const EdgeInsets.only(left: 14, right: 4),
                      color: Brand.botViolet.withValues(alpha: 0.08),
                      child: Row(children: [
                        Icon(Icons.drag_indicator, size: 18, color: Brand.muted),
                        const SizedBox(width: 6),
                        Text('비서 이노봇', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.navy)),
                        const Spacer(),
                        IconButton(tooltip: '닫기', iconSize: 18, visualDensity: VisualDensity.compact, icon: const Icon(Icons.close), onPressed: widget.onClose),
                      ]),
                    ),
                  ),
                ),
                // 창 안 팝업(대화 기록·확인 대화상자)이 창 안에서 열리도록 작은 Navigator를 둔다. 창은 앱 글자 선택 영역 밖이라 따로 씌운다.
                Expanded(child: CopySelectionArea(child: Navigator(onGenerateRoute: (_) => MaterialPageRoute<void>(builder: (_) => widget.body ?? AssistantSheet(seed: widget.seed))))),
              ]),
            ),
          ),
          // 네 변(6px)·네 모서리(16px)를 끌어 크기 조절 — 끌린 변만 움직이고 반대편은 그대로
          for (final (key, l, t, r, b, cursor) in const [
            ('top', false, true, false, false, SystemMouseCursors.resizeUpDown),
            ('bottom', false, false, false, true, SystemMouseCursors.resizeUpDown),
            ('left', true, false, false, false, SystemMouseCursors.resizeLeftRight),
            ('right', false, false, true, false, SystemMouseCursors.resizeLeftRight),
            ('top-left', true, true, false, false, SystemMouseCursors.resizeUpLeftDownRight),
            ('bottom-right', false, false, true, true, SystemMouseCursors.resizeUpLeftDownRight),
            ('top-right', false, true, true, false, SystemMouseCursors.resizeUpRightDownLeft),
            ('bottom-left', true, false, false, true, SystemMouseCursors.resizeUpRightDownLeft),
          ])
            _handle(Rect.fromLTWH(pos.dx, pos.dy, size.width, size.height), screen, key, l, t, r, b, cursor),
        ]);
      });

  Widget _handle(Rect win, Size screen, String key, bool l, bool t, bool r, bool b, MouseCursor cursor) {
    const edge = 6.0, corner = 16.0;
    final isCorner = (l || r) && (t || b);
    final w = isCorner ? corner : (l || r ? edge : win.width - corner * 2), h = isCorner ? corner : (t || b ? edge : win.height - corner * 2);
    final x = l ? win.left - (isCorner ? 0 : edge / 2) : r ? win.right - (isCorner ? corner : edge / 2) : win.left + corner;
    final y = t ? win.top - (isCorner ? 0 : edge / 2) : b ? win.bottom - (isCorner ? corner : edge / 2) : win.top + corner;
    return Positioned(
      left: x, top: y, width: w, height: h,
      child: MouseRegion(
        cursor: cursor,
        child: GestureDetector(
          key: ValueKey(key == 'bottom-right' ? 'innobot-window-resize' : 'innobot-window-resize-$key'),
          behavior: HitTestBehavior.opaque,
          onPanStart: (_) => setState(() { _pos = win.topLeft; _size = win.size; }),
          onPanUpdate: (d) => setState(() {
            final next = resizeWindow(Rect.fromLTWH(_pos!.dx, _pos!.dy, _size!.width, _size!.height), d.delta, screen, left: l, top: t, right: r, bottom: b);
            _pos = next.topLeft;
            _size = next.size;
          }),
          onPanEnd: (_) => _save(),
          child: key == 'bottom-right' ? Align(alignment: Alignment.bottomRight, child: Padding(padding: const EdgeInsets.all(2), child: Icon(Icons.south_east, size: 14, color: Brand.muted))) : null,
        ),
      ),
    );
  }
}
