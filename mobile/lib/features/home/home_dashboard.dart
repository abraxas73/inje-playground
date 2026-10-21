import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../api/client.dart';
import '../../assistant/innobot_prefs.dart';

/// 홈 대시보드(데스크톱 전용) — 12칼럼 그리드에 홈 위젯을 자유 배치. 계정 단위 서버 저장
/// (user_settings `home_dashboard`, `GET·PUT /api/users/home-dashboard`). 모바일은 쓰지 않는다.

const dashboardCols = 12;

/// 그리드 한 칸 배치. x·w는 칼럼(0..11, w 1..12, x+w<=12), y·h는 행 단위(행 높이는 뷰가 정함).
class DashboardTile {
  const DashboardTile(this.id, this.x, this.y, this.w, this.h);
  final String id;
  final int x, y, w, h;

  DashboardTile copyWith({int? x, int? y, int? w, int? h}) =>
      DashboardTile(id, x ?? this.x, y ?? this.y, w ?? this.w, h ?? this.h);

  Map<String, Object> toJson() => {'id': id, 'x': x, 'y': y, 'w': w, 'h': h};

  static DashboardTile? fromJson(Object? j) {
    if (j is! Map) return null;
    final id = j['id'];
    final x = j['x'], y = j['y'], w = j['w'], h = j['h'];
    if (id is! String || x is! int || y is! int || w is! int || h is! int) return null;
    return DashboardTile(id, x, y, w, h);
  }
}

/// 서버에 아무 배치도 없을 때의 기본 배치. 데이터·연결 없는 위젯은 그 자리에 "연결 필요" 안내로 그려진다.
/// 맨 위는 인사+오늘의 한 줄 결합 위젯(greeting) — 홈 전체가 위젯 영역.
const defaultDashboard = <DashboardTile>[
  DashboardTile('greeting', 0, 0, 12, 2),
  DashboardTile('briefing', 0, 2, 8, 4),
  DashboardTile('focus', 8, 2, 4, 2),
  DashboardTile('teams', 8, 4, 4, 2),
  DashboardTile('meetings', 0, 6, 6, 3),
  DashboardTile('approvals', 6, 6, 6, 3),
  DashboardTile('mails', 0, 9, 6, 3),
  DashboardTile('messenger', 6, 9, 6, 3),
  DashboardTile('absence', 0, 12, 6, 3),
  DashboardTile('notices', 6, 12, 6, 3),
];

/// 예전 레이아웃 호환: 'quote'(인삿말 분리 전)는 'greeting'으로 옮긴다(위치 보존). 중복은 첫 것만.
List<DashboardTile> _migrate(List<DashboardTile> tiles) {
  final seen = <String>{};
  final out = <DashboardTile>[];
  for (final t in tiles) {
    final id = t.id == 'quote' ? 'greeting' : t.id;
    if (!seen.add(id)) continue;
    out.add(id == t.id ? t : DashboardTile(id, t.x, t.y, t.w, t.h));
  }
  return out;
}

bool _overlaps(DashboardTile a, int y, DashboardTile o) =>
    a.x < o.x + o.w && a.x + a.w > o.x && y < o.y + o.h && y + a.h > o.y;

/// 겹침 해소 — 방금 옮기거나 키운 타일(pinned)은 놓은 자리 그대로 두고, 그것과(연쇄적으로) 겹치는 타일만 아래로 내린다.
/// 겹치지 않는 타일은 손대지 않는다.
List<DashboardTile> resolveCollisions(List<DashboardTile> tiles, {String? pinned}) {
  final sorted = [...tiles]..sort((a, b) => a.id == pinned ? -1 : b.id == pinned ? 1 : a.y != b.y ? a.y - b.y : a.x - b.x);
  final placed = <DashboardTile>[];
  for (final t in sorted) {
    var y = t.y;
    for (var o = placed.where((o) => _overlaps(t, y, o)).firstOrNull; o != null; o = placed.where((o) => _overlaps(t, y, o)).firstOrNull) {
      y = o.y + o.h;
    }
    placed.add(t.copyWith(y: y));
  }
  return placed;
}

/// 자동 배열 — 칼럼·크기는 그대로, 위에서부터 빈 칸이 없게 각 타일을 올릴 수 있는 만큼 끌어올린다.
List<DashboardTile> autoArrange(List<DashboardTile> tiles) {
  final sorted = [...tiles]..sort((a, b) => a.y != b.y ? a.y - b.y : a.x - b.x);
  final placed = <DashboardTile>[];
  for (final t in sorted) {
    var y = 0;
    while (placed.any((o) => _overlaps(t, y, o))) {
      y++;
    }
    placed.add(t.copyWith(y: y));
  }
  return placed;
}

List<DashboardTile> _parse(Object? j) {
  if (j is! Map || j['tiles'] is! List) return const [];
  return (j['tiles'] as List).map(DashboardTile.fromJson).whereType<DashboardTile>().toList();
}

/// 계정 단위 대시보드 배치. 비어 있으면 기본 배치를 돌려준다(저장 전까지는 기본).
final homeDashboardProvider =
    AsyncNotifierProvider<HomeDashboard, List<DashboardTile>>(HomeDashboard.new);

class HomeDashboard extends AsyncNotifier<List<DashboardTile>> {
  @override
  Future<List<DashboardTile>> build() async {
    if (!ref.watch(innobotSignedInProvider)) return defaultDashboard;
    final tiles = _parse(await ref.read(apiClientProvider).getJson('/api/users/home-dashboard'));
    return tiles.isEmpty ? defaultDashboard : _migrate(tiles);
  }

  /// 바로 반영하고 서버에 저장. 실패하면 이전 배치로 되돌리고 false.
  Future<bool> save(List<DashboardTile> tiles) async {
    final prev = state.value ?? defaultDashboard;
    state = AsyncData(tiles);
    try {
      final j = await ref.read(apiClientProvider).putJson(
            '/api/users/home-dashboard',
            {'tiles': tiles.map((t) => t.toJson()).toList()},
          );
      if (ref.mounted) {
        final saved = _parse(j);
        state = AsyncData(saved.isEmpty ? tiles : saved);
      }
      return true;
    } catch (_) {
      if (ref.mounted) state = AsyncData(prev);
      return false;
    }
  }
}
