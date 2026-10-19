import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/client.dart';
import '../assistant/innobot_prefs.dart';

/// 앱 페이지 즐겨찾기 한 건 — 앱 안 경로(`/web?path=…`, `/gw/…`, `/food` 등)와 제목.
class AppFavorite {
  const AppFavorite(this.path, this.title);
  final String path, title;
  static AppFavorite? fromJson(Object? j) =>
      j is Map && j['path'] is String && j['title'] is String
      ? AppFavorite(j['path'] as String, j['title'] as String)
      : null;
}

List<AppFavorite> _parse(Object? j) => j is Map && j['items'] is List
    ? (j['items'] as List)
          .map(AppFavorite.fromJson)
          .whereType<AppFavorite>()
          .toList()
    : const [];

/// 계정 단위 페이지 즐겨찾기(서버 user_settings.app_favorites) — 모든 PC·폰에서 같은 목록.
final appFavoritesProvider =
    AsyncNotifierProvider<AppFavorites, List<AppFavorite>>(AppFavorites.new);

class AppFavorites extends AsyncNotifier<List<AppFavorite>> {
  @override
  Future<List<AppFavorite>> build() async {
    if (!ref.watch(innobotSignedInProvider)) return const [];
    return _parse(
      await ref.read(apiClientProvider).getJson('/api/users/favorites'),
    );
  }

  bool isFavorite(String path) =>
      state.value?.any((f) => f.path == path) ?? false;

  /// 바로 반영하고 서버에 저장. 실패하면 이전 목록으로 되돌리고 false.
  Future<bool> toggle(String path, String title) async {
    // 첫 목록을 받는 중에 누르면 그 응답이 나중에 도착해 방금 바꾼 걸 덮으므로, 받은 뒤에 바꾼다
    final prev = await future.catchError((_) => const <AppFavorite>[]);
    if (!ref.mounted) return false;
    final on = !prev.any((f) => f.path == path);
    state = AsyncData(
      on
          ? [AppFavorite(path, title), ...prev]
          : prev.where((f) => f.path != path).toList(),
    );
    try {
      final j = await ref.read(apiClientProvider).putJson(
        '/api/users/favorites',
        {'path': path, 'title': title, 'on': on},
      );
      if (ref.mounted) state = AsyncData(_parse(j));
      return true;
    } catch (_) {
      if (ref.mounted) state = AsyncData(prev);
      return false;
    }
  }
}

/// SharePoint 즐겨찾기 문서(웹 /sharepoint와 같은 목록) — 이름·링크만.
class SharepointFavorite {
  const SharepointFavorite(this.name, this.url);
  final String name, url;
}

final sharepointFavoritesProvider = FutureProvider<List<SharepointFavorite>>((
  ref,
) async {
  if (!ref.watch(innobotSignedInProvider)) return const [];
  final j = await ref
      .read(apiClientProvider)
      .getJson('/api/sharepoint/favorites');
  if (j is! Map || j['items'] is! List) return const [];
  return [
    for (final e in j['items'] as List)
      if (e is Map &&
          e['name'] is String &&
          e['url'] is String &&
          (e['url'] as String).startsWith('https://'))
        SharepointFavorite(e['name'] as String, e['url'] as String),
  ];
});

/// 제목 옆 즐겨찾기 표시(☆/★) — 누를 때마다 켜고 끈다.
class FavoriteStar extends ConsumerWidget {
  const FavoriteStar({super.key, required this.path, required this.title});
  final String path, title;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final on =
        ref.watch(appFavoritesProvider).value?.any((f) => f.path == path) ??
        false;
    return IconButton(
      tooltip: on ? '즐겨찾기 해제' : '즐겨찾기 추가',
      visualDensity: VisualDensity.compact,
      icon: Icon(
        on ? Icons.star_rounded : Icons.star_outline_rounded,
        color: on ? const Color(0xFFF5B301) : null,
      ),
      onPressed: title.trim().isEmpty
          ? null
          : () async {
              final ok = await ref
                  .read(appFavoritesProvider.notifier)
                  .toggle(path, title.trim());
              if (!ok && context.mounted) {
                ScaffoldMessenger.maybeOf(context)?.showSnackBar(
                  const SnackBar(
                    content: Text('즐겨찾기를 저장하지 못했습니다. 다시 시도해 주세요.'),
                  ),
                );
              }
            },
    );
  }
}
