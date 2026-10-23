import 'package:flutter/material.dart';
import 'theme.dart';
import '../favorites/favorites.dart';

/// 이노그리드 워드마크(frontend/public/logo.svg를 PNG로 뜬 것, 1320×177). 밝은 바탕엔 네이비, 어두운 바탕엔 흰색.
class BrandLogo extends StatelessWidget {
  const BrandLogo({super.key, this.width = 86, this.white = false, this.opacity = 1});
  final double width;
  final bool white;
  final double opacity;
  @override
  Widget build(BuildContext context) => Opacity(
        opacity: opacity,
        child: Image.asset(white ? 'assets/brand/logo_white.png' : 'assets/brand/logo_dark.png', width: width, height: width * 177 / 1320, fit: BoxFit.contain, semanticLabel: '이노그리드'),
      );
}

/// 탭 화면 머리: 작은 워드마크 + 큰 제목 + 오른쪽 44px 아이콘 버튼. Scaffold.appBar 자리에 쓴다(상태 표시줄 여백은 SafeArea가 먹는다).
/// 셸 밖 push 화면(하단 바 없음)은 [showBack]으로 왼쪽에 뒤로 버튼을 둔다.
class BrandHeader extends StatelessWidget implements PreferredSizeWidget {
  const BrandHeader({super.key, required this.title, this.actions = const [], this.showBack = false, this.favoritePath, this.onRefresh, this.compact = false});

  /// 홈 위젯 안(대시보드 타일·Always On 창) — 로고 없이 위젯 제목 크기로 낮게. 화면은 [WidgetChrome.of]로 정한다.
  final bool compact;
  final String title;

  /// 주면 오른쪽에 새로고침 버튼(데스크톱은 당겨서 새로고침을 못 하므로).
  final VoidCallback? onRefresh;
  final List<Widget> actions;
  final bool showBack;

  /// 앱 안 경로를 주면 제목 옆에 즐겨찾기(☆/★) — 누르면 떠 있는 ★ 목록에서 바로 갈 수 있다.
  final String? favoritePath;
  @override
  Size get preferredSize => Size.fromHeight(compact ? 52 : 76);
  @override
  Widget build(BuildContext context) => compact ? _compact(context) : SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
          child: Row(children: [
            if (showBack) Padding(padding: const EdgeInsets.only(right: 12), child: SquareIconButton(icon: Icons.arrow_back, tooltip: '뒤로', onPressed: () => Navigator.of(context).maybePop())),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                const BrandLogo(width: 86, opacity: 0.8),
                const SizedBox(height: 6),
                Row(children: [
                  Flexible(child: Text(title, style: Theme.of(context).textTheme.headlineSmall, maxLines: 1, overflow: TextOverflow.ellipsis)),
                  if (favoritePath != null) FavoriteStar(path: favoritePath!, title: title),
                ]),
              ]),
            ),
            if (onRefresh != null) Padding(padding: const EdgeInsets.only(left: 8), child: SquareIconButton(icon: Icons.refresh, tooltip: '새로고침', onPressed: onRefresh)),
            for (final a in actions) Padding(padding: const EdgeInsets.only(left: 8), child: a),
          ]),
        ),
      );

  Widget _compact(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(8, 4, 8, 4),
        child: Row(children: [
          if (showBack) IconButton(icon: const Icon(Icons.arrow_back, size: 20), tooltip: '뒤로', onPressed: () => Navigator.of(context).maybePop()) else const SizedBox(width: 8),
          Expanded(child: Align(alignment: Alignment.centerLeft, child: WidgetTitle(title))),
          if (favoritePath != null) FavoriteStar(path: favoritePath!, title: title),
          if (onRefresh != null) IconButton(icon: const Icon(Icons.refresh, size: 20), tooltip: '새로고침', onPressed: onRefresh),
          ...actions,
        ]),
      );
}

/// 홈 위젯의 제목 글꼴(모든 위젯 공통) — 위젯 머리줄·메신저/Teams 위젯 머리.
const widgetTitleStyle = TextStyle(fontSize: 15, fontWeight: FontWeight.w800);

/// 홈 위젯 타일의 ⋮ 메뉴 자리 — 타일이 내려 주고, 위젯 제목([WidgetTitle])이 제목 바로 옆에 그린다
/// (오른쪽 위 구석에 띄우면 위젯 자체 버튼(새로고침·검색·더 보기)을 가렸다). 제목이 맡지 않으면 타일이 구석에 그린다.
class TileMenuSlot extends InheritedWidget {
  const TileMenuSlot({super.key, required this.button, required this.claim, required super.child});
  /// 지금 보일 버튼(마우스가 올라왔거나 메뉴가 열렸거나 Always On일 때), 아니면 null.
  final Widget? button;
  /// 제목이 버튼을 맡았다고 알린다(한 번).
  final VoidCallback claim;
  static TileMenuSlot? of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<TileMenuSlot>();
  @override
  bool updateShouldNotify(TileMenuSlot oldWidget) => oldWidget.button != button;
}

/// 위젯 제목 — 공통 글꼴, 타일 안이면 바로 옆에 ⋮ 메뉴.
class WidgetTitle extends StatelessWidget {
  const WidgetTitle(this.text, {super.key, this.style});
  final String text;
  final TextStyle? style;
  @override
  Widget build(BuildContext context) {
    final slot = TileMenuSlot.of(context);
    if (slot != null) WidgetsBinding.instance.addPostFrameCallback((_) => slot.claim());
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Flexible(child: Text(text, style: style ?? widgetTitleStyle.copyWith(color: Brand.navy), maxLines: 1, overflow: TextOverflow.ellipsis)),
      if (slot?.button != null) Padding(padding: const EdgeInsets.only(left: 4), child: slot!.button),
    ]);
  }
}

/// 이 아래 화면은 홈 위젯 안에 있다(대시보드 타일·Always On 창) — 머리를 작게, 목록 글꼴을 다른 위젯과 같게.
class WidgetChrome extends InheritedWidget {
  const WidgetChrome({super.key, required super.child});
  static bool of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<WidgetChrome>() != null;
  @override
  bool updateShouldNotify(WidgetChrome oldWidget) => false;
}

/// 44×44 흰 바탕 둥근 네모 아이콘 버튼(머리 영역·카드 안).
class SquareIconButton extends StatelessWidget {
  const SquareIconButton({super.key, required this.icon, required this.tooltip, this.onPressed});
  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;
  @override
  Widget build(BuildContext context) => SizedBox(
        width: 44,
        height: 44,
        child: IconButton(
          style: IconButton.styleFrom(
            backgroundColor: Brand.surface,
            foregroundColor: Brand.navy,
            disabledForegroundColor: Brand.faint,
            side: BorderSide(color: Brand.line),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            padding: EdgeInsets.zero,
          ),
          icon: Icon(icon, size: 20),
          tooltip: tooltip,
          onPressed: onPressed,
        ),
      );
}

/// 이름 머리글자 배지 — 색은 이름으로 정해져 같은 사람은 늘 같은 색.
class InitialBadge extends StatelessWidget {
  const InitialBadge(this.name, {super.key, this.size = 40, this.circle = false});
  final String name;
  final double size;
  final bool circle;
  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: Brand.tintFor(name), borderRadius: BorderRadius.circular(circle ? size : size * 0.3)),
        child: Text(name.isEmpty ? '?' : name.characters.first, style: TextStyle(fontSize: size * 0.38, fontWeight: FontWeight.w800, color: Brand.navy)),
      );
}

/// 연한 네모 안의 아이콘(위치 카드·빈 상태).
class TintIcon extends StatelessWidget {
  const TintIcon(this.icon, {super.key, this.size = 40, this.color = Brand.blue, this.background});
  final IconData icon;
  final double size;
  final Color color;
  final Color? background; // 기본은 Brand.blueTint(밝기별 getter라 기본값으로 못 넣어 build에서 해석)
  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        decoration: BoxDecoration(color: background ?? Brand.blueTint, borderRadius: BorderRadius.circular(size * 0.3)),
        child: Icon(icon, size: size / 2, color: color),
      );
}

/// 구역 제목 "참가자 4" — 숫자만 CI 블루.
class CountTitle extends StatelessWidget {
  const CountTitle(this.label, this.count, {super.key});
  final String label;
  final int count;
  @override
  Widget build(BuildContext context) => Text.rich(TextSpan(text: '$label ', style: Theme.of(context).textTheme.titleMedium, children: [
        TextSpan(text: '$count', style: const TextStyle(color: Brand.blue)),
      ]));
}

/// 화면 아래 큰 알약 버튼(56px, 블루 그림자).
class PrimaryCta extends StatelessWidget {
  const PrimaryCta({super.key, required this.label, required this.icon, this.onPressed});
  final String label;
  final IconData icon;
  final VoidCallback? onPressed;
  @override
  Widget build(BuildContext context) => DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(999),
          boxShadow: onPressed == null ? const [] : [BoxShadow(color: Brand.blue.withValues(alpha: 0.25), blurRadius: 20, offset: const Offset(0, 8))],
        ),
        child: FilledButton.icon(
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56), textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          onPressed: onPressed,
          icon: Icon(icon, size: 20),
          label: Text(label),
        ),
      );
}

/// 법카 배지.
class CardHolderBadge extends StatelessWidget {
  const CardHolderBadge({super.key});
  @override
  Widget build(BuildContext context) => Container(
        height: 22,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        decoration: const BoxDecoration(color: Brand.cardBadgeBg, borderRadius: BorderRadius.all(Radius.circular(999))),
        child: const Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.credit_card, size: 12, color: Brand.cardBadgeFg),
          SizedBox(width: 4),
          Text('법카', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Brand.cardBadgeFg)),
        ]),
      );
}

/// 네이비 바탕 + 격자(브랜드 '그리드' 모티프) + 은은한 빛 — 로그인·스플래시.
class GridBackdrop extends StatelessWidget {
  const GridBackdrop({super.key});
  @override
  Widget build(BuildContext context) => Stack(fit: StackFit.expand, children: [
        ColoredBox(color: Brand.hero),
        CustomPaint(painter: _GridPainter()),
        Positioned(left: -140, top: -120, child: _Glow(360, Brand.blue.withValues(alpha: 0.45))),
        Positioned(right: -120, bottom: 120, child: _Glow(260, Brand.sky.withValues(alpha: 0.18))),
      ]);
}

class _GridPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..strokeWidth = 1
      ..shader = LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Colors.white.withValues(alpha: 0.08), Colors.white.withValues(alpha: 0)], stops: const [0, 0.62]).createShader(Offset.zero & size);
    for (var x = 0.0; x <= size.width; x += 44) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (var y = 0.0; y <= size.height; y += 44) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(_GridPainter oldDelegate) => false;
}

class _Glow extends StatelessWidget {
  const _Glow(this.size, this.color);
  final double size;
  final Color color;
  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        decoration: BoxDecoration(shape: BoxShape.circle, gradient: RadialGradient(colors: [color, color.withValues(alpha: 0)])),
      );
}

/// Microsoft 로고(4색 네모) — 로그인 버튼용.
class MicrosoftMark extends StatelessWidget {
  const MicrosoftMark({super.key, this.size = 20});
  final double size;
  @override
  Widget build(BuildContext context) {
    final s = (size - 2) / 2;
    Widget sq(Color c) => Container(width: s, height: s, color: c);
    return SizedBox(
      width: size,
      height: size,
      child: Column(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [sq(const Color(0xFFF25022)), sq(const Color(0xFF7FBA00))]),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [sq(const Color(0xFF00A4EF)), sq(const Color(0xFFFFB900))]),
      ]),
    );
  }
}
