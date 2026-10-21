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

/// 서버에 아무 배치도 없을 때의 기본 배치. 없는(데이터·권한 없는) 위젯은 뷰가 건너뛴다.
const defaultDashboard = <DashboardTile>[
  DashboardTile('briefing', 0, 0, 8, 4),
  DashboardTile('quote', 8, 0, 4, 2),
  DashboardTile('focus', 8, 2, 4, 2),
  DashboardTile('meetings', 0, 4, 6, 3),
  DashboardTile('approvals', 6, 4, 6, 3),
  DashboardTile('mails', 0, 7, 6, 3),
  DashboardTile('teams', 6, 7, 6, 3),
  DashboardTile('absence', 0, 10, 6, 3),
  DashboardTile('notices', 6, 10, 6, 3),
];

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
    return tiles.isEmpty ? defaultDashboard : tiles;
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
