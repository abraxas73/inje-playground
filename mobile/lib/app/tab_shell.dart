import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../assistant/innobot_button.dart';
import '../auth/session.dart';
import '../more/catalog.dart';
import '../more/service_grid.dart';
import 'menu_layout.dart';
import 'router.dart';
import 'theme.dart';

/// 하단 바: 홈 · 그룹(일상/AI/업무 — 웹 2단 메뉴의 1단) · 더보기. 그룹을 누르면 하위 메뉴가 바 위로 한두 줄로 펼쳐지고,
/// 네이티브 화면(뭐 먹지·사다리·커피 타임)은 탭 브랜치로, 나머지는 WebView로 연다.
class TabShell extends ConsumerStatefulWidget {
  const TabShell({super.key, required this.shell});
  final StatefulNavigationShell shell;
  @override
  ConsumerState<TabShell> createState() => _TabShellState();
}

const _homeBranch = homeBranch, _moreBranch = 4;
const nativeBranch = {'food': 1, 'ladder': 2, 'team': 3};
const _groupIcons = <String, (IconData, IconData)>{
  'daily': (Icons.groups_outlined, Icons.groups),
  'ai': (Icons.auto_awesome_outlined, Icons.auto_awesome),
  'work': (Icons.work_outline, Icons.work),
  'gw': (Icons.apartment_outlined, Icons.apartment),
};

class _TabShellState extends ConsumerState<TabShell> with SingleTickerProviderStateMixin {
  String? _open; // 펼친 그룹 id(접히는 동안에도 유지)
  bool _closing = false;
  late final AnimationController _fan; // initState에서 생성(late 지연 생성 금지 — 규칙)

  @override
  void initState() {
    super.initState();
    _fan = AnimationController(vsync: this);
  }

  @override
  void dispose() {
    _fan.dispose();
    super.dispose();
  }

  /// 펼침: 항목마다 60ms씩 늦게 시작해 하나씩 스르륵. 접힘은 역순(마지막 항목부터).
  void _show(String id, int count) {
    _fan.duration = FanMenu.totalDuration(count);
    _fan.reverseDuration = FanMenu.totalDuration(count) * 0.7;
    setState(() {
      _open = id;
      _closing = false;
    });
    _fan.forward(from: 0);
  }

  void _close() {
    if (_open == null || _closing) return;
    setState(() => _closing = true);
    // 접히는 중에 다른 그룹을 펼치면(forward) 이 reverse는 취소된다 — orCancel로 받아 무시
    _fan.reverse().orCancel.then((_) {
      if (mounted) setState(() { _open = null; _closing = false; });
    }, onError: (_) {});
  }

  void _goBranch(int i) {
    _close();
    ref.read(tabTapProvider.notifier).bump(i);
    widget.shell.goBranch(i, initialLocation: i == widget.shell.currentIndex);
  }

  void _openPage(PageEntry p) {
    final b = nativeBranch[p.key];
    if (b != null) return _goBranch(b);
    _close();
    // 앱 전용 네이티브 화면(/gw/*)은 그대로 push, 나머지는 WebView
    context.push(p.href.startsWith('/gw/') ? p.href : '/web?path=${Uri.encodeComponent(p.href)}');
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider).asData?.value;
    final groups = session == null ? const <(PageGroup, List<PageEntry>)>[] : visibleGroups(session);
    // 슬롯: 홈(null) · 그룹들 · 더보기(null). 그룹 슬롯 index = 1 + 그룹 순번.
    final slotCount = groups.length + 2;
    final openIdx = groups.indexWhere((g) => g.$1.id == _open);
    final shownIdx = _closing ? -1 : openIdx; // 접히는 중엔 선택 표시를 원래 탭으로
    final current = widget.shell.currentIndex;
    final dailyIdx = groups.indexWhere((g) => g.$1.id == 'daily');
    final selected = shownIdx >= 0
        ? 1 + shownIdx
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
          if (openIdx < 0) const InnobotButton(),
          if (openIdx >= 0)
            FanMenu(
              key: ValueKey(_open),
              pages: groups[openIdx].$2,
              slot: 1 + openIdx,
              slotCount: slotCount,
              currentBranch: current,
              progress: _fan,
              onSelect: _closing ? (_) {} : _openPage,
              onDismiss: _close,
            ),
        ]),
        bottomNavigationBar: NavigationBar(
          selectedIndex: selected,
          onDestinationSelected: (i) {
            if (i == 0) return _goBranch(_homeBranch);
            if (i == slotCount - 1) return _goBranch(_moreBranch);
            final id = groups[i - 1].$1.id;
            if (_open == id && !_closing) return _close();
            _show(id, groups[i - 1].$2.length);
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

/// 바 위 스크림 + 하위 메뉴 항목(바 위에 한 줄, 6개부터 두 줄 — rowLayout 좌표, 가로 중앙 정렬). 항목은 제자리에서 바 쪽으로부터 떠오른다(가로 이동 없음).
/// [progress] 0→1 동안 항목 i는 [i·stagger, i·stagger+perItem] 구간에서만 움직인다(왼쪽부터 하나씩).
class FanMenu extends StatelessWidget {
  const FanMenu({super.key, required this.pages, required this.slot, required this.slotCount, required this.currentBranch, required this.progress, required this.onSelect, required this.onDismiss});
  final List<PageEntry> pages;
  final int slot, slotCount, currentBranch;
  final Animation<double> progress;
  final void Function(PageEntry) onSelect;
  final VoidCallback onDismiss;

  static const itemWidth = 60.0, itemHeight = 82.0, circle = 46.0;
  static const perItem = Duration(milliseconds: 220), stagger = Duration(milliseconds: 60);
  static Duration totalDuration(int count) => perItem + stagger * (count - 1).clamp(0, 99);

  /// 항목 i의 구간(전체 진행 0~1 기준)
  static Interval interval(int i, int count) {
    final total = totalDuration(count).inMilliseconds.toDouble();
    final start = stagger.inMilliseconds * i / total;
    return Interval(start, start + perItem.inMilliseconds / total, curve: Curves.easeOutBack);
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
        final origin = Offset((slot + 0.5) * box.maxWidth / slotCount, box.maxHeight);
        final pts = rowLayout(count: pages.length, originX: origin.dx, width: box.maxWidth);
        return AnimatedBuilder(
          animation: progress,
          builder: (_, _) {
            final ts = [for (var i = 0; i < pages.length; i++) interval(i, pages.length).transform(progress.value)];
            final scrim = Interval(0, 0.4).transform(progress.value);
            return Stack(fit: StackFit.expand, children: [
              GestureDetector(behavior: HitTestBehavior.opaque, onTap: onDismiss, child: ColoredBox(color: Brand.navy.withValues(alpha: 0.45 * scrim))),
              for (final (i, p) in pages.indexed)
                Positioned(
                  left: origin.dx + pts[i].dx - itemWidth / 2,
                  top: origin.dy + pts[i].dy * ts[i] - circle / 2,
                  width: itemWidth,
                  height: itemHeight,
                  child: Opacity(opacity: ts[i].clamp(0.0, 1.0), child: FanItem(page: p, active: nativeBranch[p.key] == currentBranch, onTap: () => onSelect(p))),
                ),
            ]);
          },
        );
      });
}

/// 하위 메뉴 항목: 흰 원 + 아이콘, 아래 라벨(긴 이름은 2줄). 지금 보고 있는 네이티브 화면이면 블루 테두리.
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
          child: Icon(icon, size: 22, color: active ? Brand.blue : Brand.navy),
        ),
        const SizedBox(height: 5),
        Text(page.label, maxLines: 2, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center, style: const TextStyle(fontSize: 10, height: 1.2, fontWeight: FontWeight.w700, color: Colors.white, shadows: [Shadow(color: Colors.black45, blurRadius: 6)])),
      ]),
    );
  }
}
