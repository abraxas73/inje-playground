import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../auth/session.dart';
import '../more/catalog.dart';
import '../more/service_grid.dart';
import 'fan_layout.dart';
import 'router.dart';
import 'theme.dart';

/// 하단 바: 홈 · 그룹(일상/AI/업무 — 웹 2단 메뉴의 1단) · 더보기. 그룹을 누르면 하위 메뉴가 바 위로 부채꼴로 펼쳐지고,
/// 네이티브 화면(뭐 먹지·사다리·커피 타임)은 탭 브랜치로, 나머지는 WebView로 연다.
class TabShell extends ConsumerStatefulWidget {
  const TabShell({super.key, required this.shell});
  final StatefulNavigationShell shell;
  @override
  ConsumerState<TabShell> createState() => _TabShellState();
}

const _homeBranch = 0, _moreBranch = 4;
const nativeBranch = {'food': 1, 'ladder': 2, 'team': 3};
const _groupIcons = <String, (IconData, IconData)>{
  'daily': (Icons.groups_outlined, Icons.groups),
  'ai': (Icons.auto_awesome_outlined, Icons.auto_awesome),
  'work': (Icons.work_outline, Icons.work),
};

class _TabShellState extends ConsumerState<TabShell> {
  String? _open; // 펼친 그룹 id

  void _close() => setState(() => _open = null);

  void _goBranch(int i) {
    _open = null;
    ref.read(tabTapProvider.notifier).bump();
    widget.shell.goBranch(i, initialLocation: i == widget.shell.currentIndex);
  }

  void _openPage(PageEntry p) {
    final b = nativeBranch[p.key];
    if (b != null) return _goBranch(b);
    _close();
    context.push('/web?path=${Uri.encodeComponent(p.href)}');
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider).asData?.value;
    final groups = session == null ? const <(PageGroup, List<PageEntry>)>[] : visibleGroups(session);
    // 슬롯: 홈(null) · 그룹들 · 더보기(null). 그룹 슬롯 index = 1 + 그룹 순번.
    final slotCount = groups.length + 2;
    final openIdx = groups.indexWhere((g) => g.$1.id == _open);
    final current = widget.shell.currentIndex;
    final dailyIdx = groups.indexWhere((g) => g.$1.id == 'daily');
    final selected = openIdx >= 0
        ? 1 + openIdx
        : current == _moreBranch
            ? slotCount - 1
            : nativeBranch.containsValue(current) && dailyIdx >= 0
                ? 1 + dailyIdx
                : 0;
    return PopScope(
      canPop: _open == null,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _close();
      },
      child: Scaffold(
        body: Stack(children: [
          widget.shell,
          if (openIdx >= 0)
            FanMenu(
              key: ValueKey(_open),
              pages: groups[openIdx].$2,
              slot: 1 + openIdx,
              slotCount: slotCount,
              currentBranch: current,
              onSelect: _openPage,
              onDismiss: _close,
            ),
        ]),
        bottomNavigationBar: NavigationBar(
          selectedIndex: selected,
          onDestinationSelected: (i) {
            if (i == 0) return _goBranch(_homeBranch);
            if (i == slotCount - 1) return _goBranch(_moreBranch);
            final id = groups[i - 1].$1.id;
            setState(() => _open = _open == id ? null : id);
          },
          destinations: [
            const NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: '홈'),
            for (final (g, _) in groups)
              NavigationDestination(
                icon: Icon(_groupIcons[g.id]?.$1 ?? Icons.apps),
                selectedIcon: Icon(_groupIcons[g.id]?.$2 ?? Icons.apps),
                label: g.label,
              ),
            const NavigationDestination(icon: Icon(Icons.more_horiz), label: '더보기'),
          ],
        ),
      ),
    );
  }
}

/// 바 위 스크림 + 경첩(누른 탭 가운데·바 윗변)에서 뻗는 살 + 부채꼴 항목. 항목 원의 중심이 fanLayout 좌표.
class FanMenu extends StatelessWidget {
  const FanMenu({super.key, required this.pages, required this.slot, required this.slotCount, required this.currentBranch, required this.onSelect, required this.onDismiss});
  final List<PageEntry> pages;
  final int slot, slotCount, currentBranch;
  final void Function(PageEntry) onSelect;
  final VoidCallback onDismiss;

  static const itemWidth = 72.0, itemHeight = 94.0, circle = 54.0;

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
        final origin = Offset((slot + 0.5) * box.maxWidth / slotCount, box.maxHeight);
        final pts = fanLayout(count: pages.length, originX: origin.dx, width: box.maxWidth, itemWidth: itemWidth);
        return TweenAnimationBuilder<double>(
          tween: Tween(begin: 0, end: 1),
          duration: const Duration(milliseconds: 260),
          curve: Curves.easeOutBack,
          builder: (_, t, _) {
            final k = t.clamp(0.0, 1.0);
            return Stack(fit: StackFit.expand, children: [
              GestureDetector(behavior: HitTestBehavior.opaque, onTap: onDismiss, child: ColoredBox(color: Brand.navy.withValues(alpha: 0.45 * k))),
              IgnorePointer(child: CustomPaint(painter: _Ribs(origin, [for (final p in pts) origin + p * t], k))),
              for (final (i, p) in pages.indexed)
                Positioned(
                  left: origin.dx + pts[i].dx * t - itemWidth / 2,
                  top: origin.dy + pts[i].dy * t - circle / 2,
                  width: itemWidth,
                  height: itemHeight,
                  child: Opacity(opacity: k, child: FanItem(page: p, active: nativeBranch[p.key] == currentBranch, onTap: () => onSelect(p))),
                ),
            ]);
          },
        );
      });
}

/// 부채의 살: 경첩에서 각 항목 원의 중심까지 가는 흰 실선(원 뒤로 숨는다).
class _Ribs extends CustomPainter {
  const _Ribs(this.origin, this.ends, this.opacity);
  final Offset origin;
  final List<Offset> ends;
  final double opacity;
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white.withValues(alpha: 0.45 * opacity)
      ..strokeWidth = 1.5
      ..strokeCap = StrokeCap.round;
    for (final e in ends) {
      canvas.drawLine(origin, e, paint);
    }
  }

  @override
  bool shouldRepaint(_Ribs old) => old.ends != ends || old.opacity != opacity;
}

/// 부채꼴 항목: 흰 원 + 아이콘, 아래 라벨(긴 이름은 2줄). 지금 보고 있는 네이티브 화면이면 블루 테두리.
class FanItem extends StatelessWidget {
  const FanItem({super.key, required this.page, required this.onTap, this.active = false});
  final PageEntry page;
  final VoidCallback onTap;
  final bool active;
  @override
  Widget build(BuildContext context) {
    final (icon, _) = serviceMeta[page.key] ?? (Icons.open_in_new, '');
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Container(
          width: FanMenu.circle,
          height: FanMenu.circle,
          decoration: BoxDecoration(
            color: Colors.white,
            shape: BoxShape.circle,
            border: active ? Border.all(color: Brand.blue, width: 2) : null,
            boxShadow: [BoxShadow(color: Brand.navy.withValues(alpha: 0.25), blurRadius: 14, offset: const Offset(0, 6))],
          ),
          child: Icon(icon, size: 24, color: active ? Brand.blue : Brand.navy),
        ),
        const SizedBox(height: 6),
        Text(page.label, maxLines: 2, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center, style: const TextStyle(fontSize: 11, height: 1.2, fontWeight: FontWeight.w700, color: Colors.white, shadows: [Shadow(color: Colors.black45, blurRadius: 6)])),
      ]),
    );
  }
}
