// 이노봇 open_screen — 화면 키 → 앱 경로. 권한은 메뉴와 같은 canUsePage. 이동은 이노봇 레이어가 건 innobotOpenPath(innobot_prefs.dart).
import '../auth/session.dart';
import '../more/catalog.dart';

const _fixed = {'home': '/home', 'more': '/more', 'todo_matrix': '/todo/matrix', 'todo_review': '/todo/review', 'settings': '/web?path=%2Fsettings', 'manual': '/web?path=%2Fmanual'};

/// 화면 키 → (경로, 오류). 하단 바 메뉴(tab_shell _openPage)와 같은 규칙: 뭐 먹지·사다리·커피 타임은 탭, /gw/*·/todo는 네이티브, Dooray는 캘린더, 나머지는 WebView.
({String? path, String? error}) screenPath(String key, AppSession? s) {
  if (s == null) return (path: null, error: '로그인이 필요합니다');
  if (key.startsWith('todo_') && !canUsePage(s, todoEntry)) return (path: null, error: '할 일 권한이 없습니다');
  final fixed = _fixed[key];
  if (fixed != null) return (path: fixed, error: null);
  final entry = [...appPages, ...pages, ...adminPages].where((p) => p.key == key).firstOrNull;
  if (entry == null) return (path: null, error: '모르는 화면입니다: $key');
  if (!canUsePage(s, entry)) return (path: null, error: '${entry.label} 화면 권한이 없습니다');
  final href = entry.href;
  final native = const {'food', 'ladder', 'team'}.contains(key) || href.startsWith('/gw/') || href.startsWith('/todo');
  return (path: key == 'dooray' ? '/dooray/calendar' : native ? href : '/web?path=${Uri.encodeComponent(href)}', error: null);
}
