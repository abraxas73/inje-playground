// 데스크톱 홈 위젯 "Always On" — 위젯 ⋮ 메뉴에서 켜면 X를 누를 때까지 모든 화면 위에 떠 있는 창으로 보인다(머리줄 끌어 옮기기·오른쪽 아래 모서리로 크기).
// 창 내용은 홈 화면이 만든 위젯 정의(DashboardWidgetDef)를 그대로 그린다 — 홈 탭은 탭 상태 유지(StatefulShellRoute)로 다른 화면에서도 살아 있어
// 데이터 갱신·눌러서 이동이 홈에서와 같게 동작한다. 켠 위젯·위치·크기는 기기에 기억(SharedPreferences).
import 'dart:convert';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../app/theme.dart';
import '../../assistant/innobot_prefs.dart';
import '../../auth/session.dart';
import 'dashboard_view.dart';

const _kPinned = 'dashboard.pinned';
const pinnedMinSize = Size(220, 140);

bool get pinnedWidgetsSupported => !kIsWeb && (defaultTargetPlatform == TargetPlatform.macOS || defaultTargetPlatform == TargetPlatform.windows);

class PinnedTile {
  const PinnedTile(this.id, this.pos, this.size);
  final String id;
  final Offset pos; // 창 왼쪽 위(앱 영역 기준)
  final Size size;
  PinnedTile copyWith({Offset? pos, Size? size}) => PinnedTile(id, pos ?? this.pos, size ?? this.size);
  Map<String, Object> toJson() => {'id': id, 'x': pos.dx, 'y': pos.dy, 'w': size.width, 'h': size.height};
  static PinnedTile? fromJson(Object? j) {
    if (j is! Map || j['id'] is! String) return null;
    double n(Object? v) => v is num ? v.toDouble() : 0;
    return PinnedTile(j['id'] as String, Offset(n(j['x']), n(j['y'])), Size(n(j['w']), n(j['h'])));
  }
}

/// 지금 로그인한 계정(이메일). 바뀌면 떠 있는 창 정의·고정 목록을 비우고 그 계정 것으로 다시 읽는다.
final pinnedAccountProvider = Provider<String?>((ref) => ref.watch(sessionProvider).asData?.value?.email);

/// 홈 화면이 그릴 때마다 올려 두는 위젯 정의(id → 정의). 떠 있는 창이 이걸 읽어 같은 내용을 그린다.
final dashboardDefsProvider = NotifierProvider<DashboardDefs, Map<String, DashboardWidgetDef>>(DashboardDefs.new);

class DashboardDefs extends Notifier<Map<String, DashboardWidgetDef>> {
  @override
  Map<String, DashboardWidgetDef> build() {
    ref.watch(pinnedAccountProvider); // 계정이 바뀌면 이전 사용자의 위젯(데이터·사라진 화면을 잡은 동작)을 버린다
    return const {};
  }
  void publish(Map<String, DashboardWidgetDef> defs) => state = defs;
}

/// Always On으로 켠 위젯 목록(기기 저장).
final pinnedWidgetsProvider = NotifierProvider<PinnedWidgets, List<PinnedTile>>(PinnedWidgets.new);

class PinnedWidgets extends Notifier<List<PinnedTile>> {
  String? _account;
  String get _key => '$_kPinned.${_account ?? ''}'; // 계정별로 따로 기억

  @override
  List<PinnedTile> build() {
    _account = ref.watch(pinnedAccountProvider);
    if (_account != null) _load();
    return const [];
  }

  Future<void> _load() async {
    try {
      final raw = (await SharedPreferences.getInstance()).getString(_key);
      final list = raw == null ? const [] : jsonDecode(raw);
      final tiles = [for (final j in list is List ? list : const []) ?PinnedTile.fromJson(j)];
      if (ref.mounted && state.isEmpty) state = tiles;
    } catch (_) {}
  }

  Future<void> _save() async {
    try {
      if (_account == null) return;
      await (await SharedPreferences.getInstance()).setString(_key, jsonEncode([for (final t in state) t.toJson()]));
    } catch (_) {}
  }

  bool isPinned(String id) => state.any((t) => t.id == id);

  /// 켜기 — 홈 타일 크기로, 오른쪽 위에서 조금씩 비켜 놓는다(창 위치는 그린 뒤 화면 안으로 맞춘다).
  void pin(String id, Size size) {
    if (isPinned(id)) return;
    final n = state.length;
    state = [...state, PinnedTile(id, Offset(100000, 80.0 + 32 * n), Size(math.max(size.width, pinnedMinSize.width), math.max(size.height, pinnedMinSize.height)))];
    _save();
  }

  void unpin(String id) {
    state = state.where((t) => t.id != id).toList();
    _save();
  }

  void toggle(String id, Size size) => isPinned(id) ? unpin(id) : pin(id, size);

  void update(String id, {Offset? pos, Size? size}) {
    state = [for (final t in state) t.id == id ? t.copyWith(pos: pos, size: size) : t];
    _save();
  }
}

const _margin = 8.0;

/// 창 위치·크기를 앱 영역 안으로(머리줄이 항상 보이게).
(Offset, Size) clampPinned(Offset pos, Size size, Size area) {
  final w = math.min(math.max(size.width, pinnedMinSize.width), math.max(pinnedMinSize.width, area.width - _margin * 2));
  final h = math.min(math.max(size.height, pinnedMinSize.height), math.max(pinnedMinSize.height, area.height - _margin * 2));
  final x = pos.dx.clamp(_margin, math.max(_margin, area.width - w - _margin)).toDouble();
  final y = pos.dy.clamp(_margin, math.max(_margin, area.height - 40)).toDouble();
  return (Offset(x, y), Size(w, h));
}

/// main.dart builder의 Stack에 한 번 — Always On 창들. 빈 곳은 눌림을 막지 않는다.
class PinnedWidgetsHost extends ConsumerWidget {
  const PinnedWidgetsHost({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!pinnedWidgetsSupported || !ref.watch(innobotSignedInProvider)) return const SizedBox.shrink();
    final pins = ref.watch(pinnedWidgetsProvider);
    final defs = ref.watch(dashboardDefsProvider);
    if (pins.isEmpty) return const SizedBox.shrink();
    return LayoutBuilder(builder: (context, box) => Stack(children: [
          for (final p in pins)
            if (defs[p.id] != null) PinnedWindow(key: ValueKey(p.id), tile: p, title: defs[p.id]!.title, area: box.biggest),
        ]));
  }
}

class PinnedWindow extends ConsumerStatefulWidget {
  const PinnedWindow({super.key, required this.tile, required this.title, required this.area});
  final PinnedTile tile;
  final String title;
  final Size area;
  @override
  ConsumerState<PinnedWindow> createState() => _PinnedWindowState();
}

class _PinnedWindowState extends ConsumerState<PinnedWindow> {
  Offset? _pos; // 끄는 중에만
  Size? _size;

  @override
  Widget build(BuildContext context) {
    final (pos, size) = clampPinned(_pos ?? widget.tile.pos, _size ?? widget.tile.size, widget.area);
    final notifier = ref.read(pinnedWidgetsProvider.notifier);
    return Positioned(
      left: pos.dx,
      top: pos.dy,
      width: size.width,
      height: size.height,
      child: Material(
        color: Brand.surface,
        elevation: 14,
        borderRadius: BorderRadius.circular(14),
        clipBehavior: Clip.antiAlias,
        child: Stack(children: [
          Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            // 머리줄 — 끌어 옮기기
            MouseRegion(
              cursor: SystemMouseCursors.move,
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onPanUpdate: (d) => setState(() => _pos = (_pos ?? pos) + d.delta),
                onPanEnd: (_) => _commit(notifier, pos: _pos),
                onPanCancel: () => setState(() => _pos = null),
                child: Container(
                  height: 32,
                  color: Brand.blue.withValues(alpha: 0.92),
                  padding: const EdgeInsets.only(left: 10, right: 2),
                  child: Row(children: [
                    const Icon(Icons.push_pin, size: 14, color: Colors.white),
                    const SizedBox(width: 6),
                    Expanded(child: Text(widget.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Colors.white))),
                    // 창은 앱 내비게이터 밖(Overlay 없음)이라 툴팁 달린 IconButton 대신 InkWell
                    Semantics(
                      button: true,
                      label: 'Always On 끄기',
                      child: InkWell(
                        borderRadius: BorderRadius.circular(14),
                        onTap: () => notifier.unpin(widget.tile.id),
                        child: const Padding(padding: EdgeInsets.all(7), child: Icon(Icons.close, size: 16, color: Colors.white)),
                      ),
                    ),
                  ]),
                ),
              ),
            ),
            // 내용 — 창 안 Navigator(위젯 안에서 여는 화면·팝업은 창 안에서), 내용은 홈이 올린 최신 정의를 읽는다
            Expanded(child: HeroControllerScope.none(child: Navigator(onGenerateRoute: (_) => MaterialPageRoute<void>(builder: (_) => _PinnedContent(id: widget.tile.id))))),
          ]),
          // 오른쪽 아래 — 크기 조정
          Positioned(
            right: 0,
            bottom: 0,
            child: MouseRegion(
              cursor: SystemMouseCursors.resizeDownRight,
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onPanUpdate: (d) => setState(() {
                  final s = _size ?? size;
                  _size = Size(s.width + d.delta.dx, s.height + d.delta.dy);
                }),
                onPanEnd: (_) => _commit(notifier, size: _size),
                onPanCancel: () => setState(() => _size = null),
                child: Container(
                  width: 22,
                  height: 22,
                  decoration: BoxDecoration(color: Brand.blue.withValues(alpha: 0.85), borderRadius: const BorderRadius.only(topLeft: Radius.circular(8))),
                  child: const Icon(Icons.open_in_full, size: 12, color: Colors.white),
                ),
              ),
            ),
          ),
        ]),
      ),
    );
  }

  void _commit(PinnedWidgets notifier, {Offset? pos, Size? size}) {
    final (p, s) = clampPinned(pos ?? widget.tile.pos, size ?? widget.tile.size, widget.area);
    notifier.update(widget.tile.id, pos: pos == null ? null : p, size: size == null ? null : s);
    setState(() { _pos = null; _size = null; });
  }
}

class _PinnedContent extends ConsumerWidget {
  const _PinnedContent({required this.id});
  final String id;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final def = ref.watch(dashboardDefsProvider)[id];
    if (def == null) return const SizedBox.shrink();
    return Material(
      color: Brand.ground,
      child: SelectionArea(
        child: (def.fill || def.child is DashboardPlaceholder)
            ? def.child
            : SingleChildScrollView(padding: const EdgeInsets.only(bottom: 16), child: def.child),
      ),
    );
  }
}
