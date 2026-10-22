// 아마란스 메신저 대화방 즐겨찾기 — 대화방 머리의 ☆/★로 켜고 끈다. 목록에서는 '즐겨찾기' 구역을 위에 따로 보여 준다.
// 계정별로 이 기기에 저장(SharedPreferences) — 아마란스에 대화방 즐겨찾기 API가 없어(확인 안 됨) 앱 쪽에만 둔다.
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../features/home/pinned_widgets.dart' show pinnedAccountProvider;

final messengerFavoritesProvider = NotifierProvider<MessengerFavorites, Set<String>>(MessengerFavorites.new);

class MessengerFavorites extends Notifier<Set<String>> {
  String? _account;
  String get _key => 'messenger.favorites.${_account ?? ''}';

  @override
  Set<String> build() {
    _account = ref.watch(pinnedAccountProvider);
    if (_account != null) _load();
    return const {};
  }

  Future<void> _load() async {
    try {
      final ids = (await SharedPreferences.getInstance()).getStringList(_key) ?? const [];
      if (ref.mounted && state.isEmpty) state = ids.toSet();
    } catch (_) {}
  }

  void toggle(String roomId) {
    state = state.contains(roomId) ? ({...state}..remove(roomId)) : {...state, roomId};
    final ids = state.toList();
    if (_account == null) return;
    SharedPreferences.getInstance().then((p) => p.setStringList(_key, ids)).catchError((_) => false);
  }
}
