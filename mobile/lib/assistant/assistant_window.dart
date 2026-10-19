// 데스크톱(macOS·Windows) 이노봇 창 — 앱 위에 떠 있는 창. 머리글을 끌어 원하는 곳에 두고(위치는 기기에 기억), 뒤 화면도 그대로 쓴다.
// 라우터 내비게이터 위 전용 Overlay(main.dart assistantWindowOverlay)에 띄워 화면을 이동해도 가려지지 않는다.
// 창 안의 대화 기록 등 팝업은 창 안 Navigator에서 열린다.
import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../app/theme.dart';
import 'assistant_sheet.dart';
import 'innobot_prefs.dart';

/// main.dart builder의 Stack에 둔 빈 Overlay(이노봇 버튼 레이어 아래).
final assistantWindowOverlay = GlobalKey<OverlayState>();

bool get assistantUsesWindow => !kIsWeb && (defaultTargetPlatform == TargetPlatform.macOS || defaultTargetPlatform == TargetPlatform.windows);

const _kPos = 'innobot.window.pos';
const assistantWindowSize = Size(440, 680);
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
  bool _dragging = false;

  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance().then((p) {
      final v = p.getStringList(_kPos);
      final x = v == null || v.length != 2 ? null : double.tryParse(v[0]), y = v == null || v.length != 2 ? null : double.tryParse(v[1]);
      if (mounted && x != null && y != null && _pos == null) setState(() => _pos = Offset(x, y));
    }).catchError((_) {});
  }

  void _save() {
    final p = _pos;
    if (p == null) return;
    SharedPreferences.getInstance().then((s) => s.setStringList(_kPos, [p.dx.toStringAsFixed(0), p.dy.toStringAsFixed(0)])).catchError((_) => false);
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
        final screen = box.biggest;
        final size = Size(math.min(assistantWindowSize.width, screen.width - _margin * 2), math.min(assistantWindowSize.height, screen.height - _margin * 2));
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
                        const Icon(Icons.drag_indicator, size: 18, color: Brand.muted),
                        const SizedBox(width: 6),
                        const Text('비서 이노봇', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.navy)),
                        const Spacer(),
                        IconButton(tooltip: '닫기', iconSize: 18, visualDensity: VisualDensity.compact, icon: const Icon(Icons.close), onPressed: widget.onClose),
                      ]),
                    ),
                  ),
                ),
                // 창 안 팝업(대화 기록·확인 대화상자)이 창 안에서 열리도록 작은 Navigator를 둔다. 창은 앱 글자 선택 영역 밖이라 따로 씌운다.
                Expanded(child: SelectionArea(child: Navigator(onGenerateRoute: (_) => MaterialPageRoute<void>(builder: (_) => widget.body ?? AssistantSheet(seed: widget.seed))))),
              ]),
            ),
          ),
        ]);
      });
}
