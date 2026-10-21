import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/theme.dart';
import 'favorites.dart';

/// 즐겨찾기 목록이 펼쳐져 있는가 — 떠 있는 버튼 레이어(InnobotOverlay)가 바깥 누름 막을 깔고 닫는다.
final favoritesOpen = ValueNotifier<bool>(false);

/// ★ 버튼 위로 즐겨찾기가 하나씩 떠오르는 목록(버튼에 가까운 것부터 50ms 시간차).
/// 페이지 즐겨찾기는 앱 안에서 열고, SharePoint 문서는 브라우저로 연다. Esc·바깥 누름으로 닫힌다.
class FavoritesPanel extends ConsumerStatefulWidget {
  const FavoritesPanel({
    super.key,
    required this.onOpenPath,
    required this.onOpenUrl,
    required this.maxHeight,
  });
  final void Function(String path) onOpenPath;
  final void Function(String url) onOpenUrl;
  final double maxHeight;
  @override
  ConsumerState<FavoritesPanel> createState() => _FavoritesPanelState();
}

class _FavoritesPanelState extends ConsumerState<FavoritesPanel>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c;
  static const _item = Duration(milliseconds: 220),
      _stagger = Duration(milliseconds: 50);

  @override
  void initState() {
    super.initState();
    _c = AnimationController(vsync: this);
    // 목록은 내비게이터 밖 레이어라 포커스를 못 받을 수 있다 — Esc는 키보드 전체에서 받는다
    HardwareKeyboard.instance.addHandler(_onKey);
    // 열 때마다 서버 목록을 새로(다른 PC에서 바꾼 것·SharePoint 즐겨찾기 반영)
    ref.invalidate(appFavoritesProvider);
    ref.invalidate(sharepointFavoritesProvider);
  }

  bool _onKey(KeyEvent e) {
    if (e is KeyDownEvent && e.logicalKey == LogicalKeyboardKey.escape) {
      _close();
      return true;
    }
    return false;
  }

  @override
  void dispose() {
    HardwareKeyboard.instance.removeHandler(_onKey);
    _c.dispose();
    super.dispose();
  }

  void _close() => favoritesOpen.value = false;

  @override
  Widget build(BuildContext context) {
    final pages = ref.watch(appFavoritesProvider);
    final docs = ref.watch(sharepointFavoritesProvider);
    final rows = <Widget>[];
    void header(String t) => rows.add(
      Padding(
        padding: const EdgeInsets.only(top: 4, bottom: 6),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: Brand.hero,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
            child: Text(
              t,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: Colors.white,
              ),
            ),
          ),
        ),
      ),
    );
    final pageList = pages.value ?? const <AppFavorite>[];
    final docList = docs.value ?? const <SharepointFavorite>[];
    if (pageList.isNotEmpty) {
      header('페이지');
      for (final f in pageList) {
        rows.add(
          _Chip(
            icon: Icons.star_rounded,
            label: f.title,
            onTap: () {
              _close();
              widget.onOpenPath(f.path);
            },
          ),
        );
      }
    }
    if (docList.isNotEmpty) {
      header('SharePoint 문서');
      for (final d in docList) {
        rows.add(
          _Chip(
            icon: Icons.description_outlined,
            label: d.name,
            onTap: () {
              _close();
              widget.onOpenUrl(d.url);
            },
          ),
        );
      }
    }
    if (rows.isEmpty) {
      rows.add(
        _Chip(
          icon: pages.isLoading || docs.isLoading
              ? Icons.hourglass_empty
              : Icons.info_outline,
          label: pages.isLoading || docs.isLoading
              ? '불러오는 중…'
              : '아직 즐겨찾기가 없습니다 — 화면 제목 옆 ☆를 눌러 추가하세요',
          onTap: null,
        ),
      );
    }
    // 목록이 바뀌면(로딩 → 항목) 길이에 맞춰 처음부터 다시 펼친다
    final total = _item + _stagger * (rows.length - 1);
    if (_c.duration != total) {
      _c.duration = total;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _c.forward(from: 0);
      });
    }
    Widget animated(int i) {
      // 버튼에 가까운(아래쪽) 항목부터 떠오른다
      final order = rows.length - 1 - i;
      final start = (_stagger * order).inMicroseconds / total.inMicroseconds;
      final end =
          ((_stagger * order) + _item).inMicroseconds / total.inMicroseconds;
      final a = CurvedAnimation(
        parent: _c,
        curve: Interval(start, end.clamp(0.0, 1.0), curve: Curves.easeOutCubic),
      );
      return FadeTransition(
        opacity: a,
        child: SlideTransition(
          position: Tween(
            begin: const Offset(0, 0.6),
            end: Offset.zero,
          ).animate(a),
          child: rows[i],
        ),
      );
    }

    return ConstrainedBox(
      constraints: BoxConstraints(maxWidth: 320, maxHeight: widget.maxHeight),
      child: SingleChildScrollView(
        reverse: true,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [for (var i = 0; i < rows.length; i++) animated(i)],
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Material(
      color: Brand.surface,
      elevation: 4,
      borderRadius: BorderRadius.circular(22),
      child: InkWell(
        borderRadius: BorderRadius.circular(22),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                icon,
                size: 18,
                color: icon == Icons.star_rounded
                    ? const Color(0xFFF5B301)
                    : Brand.navy,
              ),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: Brand.navy,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
