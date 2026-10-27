import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// 글자 선택 영역 — 고르면(끌기·두 번 클릭·길게 누르기) 클립보드 아이콘 하나를 띄우고, 누르면 복사한다.
/// 모바일·오른쪽 클릭은 SelectableRegion이 메뉴를 띄울 때 [contextMenuBuilder]로 이 아이콘을 그리고,
/// 데스크톱은 끌기·두 번 클릭 뒤 메뉴를 띄우지 않아 선택이 끝날 때(finalized) 같은 아이콘을 직접 띄운다.
class CopySelectionArea extends StatefulWidget {
  const CopySelectionArea({super.key, required this.child});
  final Widget child;
  @override
  State<CopySelectionArea> createState() => _CopySelectionAreaState();
}

class _CopySelectionAreaState extends State<CopySelectionArea> {
  final _menu = ContextMenuController();
  String _text = '';
  bool _secondary = false; // 오른쪽 클릭 — SelectableRegion이 이미 메뉴를 띄웠다
  final _group = Object(); // 영역과 아이콘을 한 탭 묶음으로 — 그 밖을 누르면 아이콘을 닫는다

  static bool get _desktop => switch (defaultTargetPlatform) { TargetPlatform.macOS || TargetPlatform.windows || TargetPlatform.linux => true, _ => false };

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // 다른 화면을 띄우거나 탭을 옮기면(이 화면이 가려지면) 아이콘을 닫는다
    if (ModalRoute.of(context)?.isCurrent == false || !TickerMode.valuesOf(context).enabled) _menu.remove();
  }

  @override
  void dispose() {
    _menu.remove();
    super.dispose();
  }

  /// 데스크톱 선택이 끝났을 때 — 선택 글자가 있고 다른 메뉴(오른쪽 클릭)가 없으면 선택 맨 뒤에 아이콘을 띄운다.
  /// 글자 내용은 두 번 클릭이면 finalized 뒤에 갱신되므로 다음 프레임에 본다.
  void _finalized(BuildContext inner) {
    if (!_desktop) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !inner.mounted || _text.isEmpty || _secondary || Overlay.maybeOf(inner, rootOverlay: true) == null) return;
      final region = inner.findAncestorStateOfType<SelectableRegionState>();
      if (region == null || _selectionEnd(region) == null) return;
      _menu.show(context: inner, contextMenuBuilder: (_) => TapRegion(groupId: _group, child: _copyToolbar(region, _text, onDone: _menu.remove, inOverlay: true)));
    });
    WidgetsBinding.instance.ensureVisualUpdate(); // 선택만 바뀌고 다시 그릴 일이 없어도 다음 프레임이 오게
  }

  @override
  Widget build(BuildContext context) => SelectionArea(
        onSelectionChanged: (c) => _text = c?.plainText ?? '',
        contextMenuBuilder: (context, region) => _copyToolbar(region, _text, onDone: () {
          region.clearSelection(); // 모바일 — 복사하면 선택·손잡이를 거둔다
          region.hideToolbar();
        }),
        child: TapRegion(
          groupId: _group,
          onTapOutside: (_) => _menu.remove(),
          child: Listener(
          onPointerDown: (e) => _secondary = e.buttons & kSecondaryMouseButton != 0,
          child: NotificationListener<ScrollStartNotification>(
            onNotification: (_) {
              _menu.remove(); // 스크롤하면 아이콘이 선택에서 떨어지므로 닫는다
              return false;
            },
            child: _StatusListener(onChanging: _menu.remove, onFinalized: _finalized, child: widget.child),
          ),
        ),
        ),
      );
}

/// 선택의 맨 뒤 글자 끝(전역 좌표)과 그 줄 높이. 끝점이 화면에 없으면(끝점 정보 없음) null — 아이콘을 띄우지 않는다.
({Offset end, double lineHeight})? _selectionEnd(SelectableRegionState region) {
  try {
    final box = region.context.findRenderObject()! as RenderBox;
    final pts = region.selectionEndpoints.map((p) => p.point).toList();
    // 끝점 둘 중 문서상 뒤쪽 — 아래 줄, 같은 줄이면 오른쪽(거꾸로 끌어도 맨 뒤에 붙는다)
    final last = pts.reduce((a, b) => (b.dy - a.dy).abs() > 1 ? (b.dy > a.dy ? b : a) : (b.dx > a.dx ? b : a));
    final isStart = last == pts.first && pts.length > 1 && last != pts.last;
    return (end: box.localToGlobal(last), lineHeight: isStart ? region.startGlyphHeight : region.endGlyphHeight);
  } catch (_) {
    return null;
  }
}

/// 클립보드 아이콘 하나만 감싼 작은 단추를 선택 맨 뒤 글자 바로 옆(데스크톱)·바로 위(모바일 — 아래엔 끝 손잡이)에 띄운다.
/// 누르면 바로 복사하고 잠깐 ✓로 바뀐 뒤 닫힌다.
/// [inOverlay] — 직접 띄운 아이콘(데스크톱)은 Overlay 로컬 좌표로 바꾼다(고정 위젯 창처럼 Overlay가 화면 원점에 없을 수 있다).
/// SelectableRegion이 띄우는 메뉴는 SDK 래퍼가 전역 좌표로 맞춰 준다.
Widget _copyToolbar(SelectableRegionState region, String text, {required VoidCallback onDone, bool inOverlay = false}) {
  final at = _selectionEnd(region);
  if (text.isEmpty || at == null) return const SizedBox.shrink();
  return _CopyChip(end: at.end, lineHeight: at.lineHeight, inOverlay: inOverlay, onCopy: () => Clipboard.setData(ClipboardData(text: text)), onDone: onDone);
}

class _CopyChip extends StatefulWidget {
  const _CopyChip({required this.end, required this.lineHeight, required this.inOverlay, required this.onCopy, required this.onDone});
  final Offset end; // 선택 맨 뒤 글자의 아래 끝(전역)
  final double lineHeight;
  final bool inOverlay;
  final VoidCallback onCopy;
  final VoidCallback onDone;
  static const size = 26.0;
  @override
  State<_CopyChip> createState() => _CopyChipState();
}

class _CopyChipState extends State<_CopyChip> {
  bool _done = false;
  Timer? _close;

  void _tap() {
    if (_done) return;
    widget.onCopy();
    setState(() => _done = true);
    _close = Timer(const Duration(milliseconds: 600), widget.onDone);
  }

  @override
  void dispose() {
    _close?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const s = _CopyChip.size;
    final overlay = widget.inOverlay ? Overlay.of(context).context.findRenderObject() as RenderBox? : null;
    final end = overlay?.globalToLocal(widget.end) ?? widget.end;
    final screen = overlay?.size ?? MediaQuery.sizeOf(context);
    final desktop = _CopySelectionAreaState._desktop;
    final lineTop = end.dy - widget.lineHeight;
    var left = desktop ? end.dx + 4 : end.dx - s / 2;
    var top = desktop ? lineTop + (widget.lineHeight - s) / 2 : lineTop - s - 6;
    left = left.clamp(4.0, (screen.width - s - 4).clamp(4.0, double.infinity));
    if (top < 4) top = end.dy + 6; // 화면 위에 붙으면 줄 아래로
    final scheme = Theme.of(context).colorScheme;
    return Stack(children: [
      Positioned(
        left: left,
        top: top,
        child: TweenAnimationBuilder<double>(
          tween: Tween(begin: 0.6, end: 1),
          duration: const Duration(milliseconds: 140),
          curve: Curves.easeOutBack,
          builder: (_, v, child) => Transform.scale(scale: v, child: Opacity(opacity: v.clamp(0.0, 1.0), child: child)),
          child: Tooltip(
            message: _done ? '복사했습니다' : '복사',
            child: Material(
              color: _done ? scheme.primary : scheme.surface,
              elevation: 3,
              shadowColor: Colors.black38,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(7), side: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.6))),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: _tap,
                mouseCursor: SystemMouseCursors.click,
                child: SizedBox.square(
                  dimension: s,
                  child: Icon(_done ? Icons.check_rounded : Icons.content_paste_rounded, size: 15, color: _done ? scheme.onPrimary : scheme.onSurfaceVariant),
                ),
              ),
            ),
          ),
        ),
      ),
    ]);
  }
}

/// SelectableRegion 안쪽에서 선택 상태(바뀌는 중·끝남)를 듣는다.
class _StatusListener extends StatefulWidget {
  const _StatusListener({required this.onChanging, required this.onFinalized, required this.child});
  final VoidCallback onChanging;
  final void Function(BuildContext inner) onFinalized;
  final Widget child;
  @override
  State<_StatusListener> createState() => _StatusListenerState();
}

class _StatusListenerState extends State<_StatusListener> {
  ValueListenable<SelectableRegionSelectionStatus>? _status;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final s = SelectableRegionSelectionStatusScope.maybeOf(context);
    if (s == _status) return;
    _status?.removeListener(_changed);
    _status = s?..addListener(_changed);
  }

  void _changed() {
    if (_status?.value == SelectableRegionSelectionStatus.finalized) {
      widget.onFinalized(context);
    } else {
      widget.onChanging();
    }
  }

  @override
  void dispose() {
    _status?.removeListener(_changed);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
