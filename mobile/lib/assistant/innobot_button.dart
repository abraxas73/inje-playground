import 'dart:io';
import 'dart:math' as math;
// mobile/lib/assistant/innobot_button.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import '../favorites/favorites_panel.dart';
import '../notifications/notifications.dart';
import '../notifications/notif_panel.dart';
import '../app/theme.dart';
import 'assistant_session.dart';
import 'assistant_sheet.dart';
import 'claude_open.dart';
import 'innobot_prefs.dart';

/// 떠 있는 이노봇(56px). 기본 오른쪽 아래, 길게 눌러 끌면 세로 위치를 옮기고 기기에 저장.
/// 서버가 비서를 꺼 두었다고 답한 뒤에는(assistantAvailableProvider) 이번 실행 동안 숨긴다.
/// showClaude면 바로 위에 Claude 열기 버튼(ClaudeButton)을 함께 띄우고 같이 끌린다(기본: 데스크톱).
/// bottomInset은 하단 바·안전 영역만큼 올리는 값, sheetContext는 시트를 띄울 내비게이터 아래 context(앱 전체 레이어에서 쓸 때).
class InnobotButton extends ConsumerStatefulWidget {
  const InnobotButton({super.key, this.showClaude, this.bottomInset = 0, this.sheetContext, this.onOpenPath, this.onContextMenu});
  static bool get showsClaude => Platform.isMacOS || Platform.isWindows;
  final bool? showClaude;
  final double bottomInset;
  final BuildContext? Function()? sheetContext;

  /// 즐겨찾기 페이지 열기(앱 안 경로). 없으면 ★ 버튼을 그리지 않는다.
  final void Function(String path)? onOpenPath;

  /// 버튼 묶음 오른쪽 클릭(데스크톱) — 화면 좌표. '버튼 숨기기' 메뉴용.
  final void Function(Offset globalPosition)? onContextMenu;
  @override
  ConsumerState<InnobotButton> createState() => _InnobotButtonState();
}

class _InnobotButtonState extends ConsumerState<InnobotButton> {
  static const _key = 'assistant.button.bottom';
  double _bottom = 16;
  double _dragStart = 16;

  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance()
        .then((p) {
          final v = p.getDouble(_key);
          if (v != null && mounted) setState(() => _bottom = v);
        })
        .catchError((_) {});
  }

  @override
  Widget build(BuildContext context) => !ref.watch(assistantAvailableProvider)
      ? const SizedBox.shrink()
      : Positioned(
          right: 14,
          bottom: widget.bottomInset + _bottom.clamp(
            8,
            math.max(8.0, MediaQuery.of(context).size.height - 200 - widget.bottomInset),
          ),
          child: GestureDetector(
            onSecondaryTapUp: widget.onContextMenu == null ? null : (d) => widget.onContextMenu!(d.globalPosition),
            onLongPressStart: (_) => _dragStart = _bottom,
            onLongPressMoveUpdate: (d) => setState(
              () => _bottom = (_dragStart - d.offsetFromOrigin.dy).clamp(
                8,
                math.max(8.0, MediaQuery.of(context).size.height - 200 - widget.bottomInset),
              ),
            ),
            onLongPressEnd: (_) => SharedPreferences.getInstance()
                .then((p) => p.setDouble(_key, _bottom))
                .catchError((_) => false),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                // 통합 알림: 종 버튼 + 패널(즐겨찾기와 상호 배타)
                if (notifOpen.value && widget.onOpenPath != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: NotificationPanel(
                      onOpenPath: widget.onOpenPath!,
                      maxHeight: math.max(160.0, MediaQuery.of(context).size.height - widget.bottomInset - _bottom - 66 * 3 - 40),
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _RoundButton(
                    color: notifOpen.value ? Brand.navy : Colors.white,
                    tooltip: notifOpen.value ? '알림 닫기' : '알림',
                    onTap: () {
                      final open = !notifOpen.value;
                      notifOpen.value = open;
                      if (open) favoritesOpen.value = false;
                    },
                    child: SizedBox(
                      width: 44,
                      height: 44,
                      child: Stack(alignment: Alignment.center, children: [
                        Icon(notifOpen.value ? Icons.close_rounded : Icons.notifications_rounded, size: 26, color: notifOpen.value ? Colors.white : Brand.navy),
                        if (!notifOpen.value)
                          Consumer(builder: (_, ref, _) {
                            final n = ref.watch(notifUnreadProvider);
                            if (n <= 0) return const SizedBox.shrink();
                            return Positioned(
                              top: 4,
                              right: 2,
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                                constraints: const BoxConstraints(minWidth: 16),
                                decoration: BoxDecoration(color: const Color(0xFFFF3B30), borderRadius: BorderRadius.circular(9), border: Border.all(color: Colors.white, width: 1.5)),
                                child: Text(n > 99 ? '99+' : '$n', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w700, height: 1.2)),
                              ),
                            );
                          }),
                      ]),
                    ),
                  ),
                ),
                if (widget.onOpenPath != null) ...[
                  if (favoritesOpen.value)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: FavoritesPanel(
                        onOpenPath: widget.onOpenPath!,
                        onOpenUrl: (u) => launchUrl(Uri.parse(u), mode: LaunchMode.externalApplication),
                        // 버튼 세 개(56+10씩)와 위 여백을 뺀 높이까지, 넘치면 목록 안에서 스크롤
                        maxHeight: math.max(120.0, MediaQuery.of(context).size.height - widget.bottomInset - _bottom - 66 * 3 - 40),
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _RoundButton(
                      color: favoritesOpen.value ? Brand.navy : Colors.white,
                      tooltip: favoritesOpen.value ? '즐겨찾기 닫기' : '즐겨찾기',
                      onTap: () {
                        final open = !favoritesOpen.value;
                        favoritesOpen.value = open;
                        if (open) notifOpen.value = false;
                      },
                      child: SizedBox(
                        width: 44,
                        height: 44,
                        child: Icon(favoritesOpen.value ? Icons.close_rounded : Icons.star_rounded, size: 28, color: favoritesOpen.value ? Colors.white : const Color(0xFFF5B301)),
                      ),
                    ),
                  ),
                ],
                if (widget.showClaude ?? InnobotButton.showsClaude)
                  const Padding(
                    padding: EdgeInsets.only(bottom: 10),
                    child: ClaudeButton(),
                  ),
                _RoundButton(
                  color: Brand.botViolet,
                  tooltip: '비서 이노봇',
                  onTap: () {
                    final c = widget.sheetContext?.call() ?? context;
                    if (c.mounted) showAssistantSheet(c);
                  },
                  child: Image.asset(
                    'assets/brand/innobot.png',
                    width: 44,
                    height: 44,
                    fit: BoxFit.contain,
                  ),
                ),
              ],
            ),
          ),
        );
}

/// 앱 전체 위의 이노봇 레이어(main.dart MaterialApp.router builder) — 모든 화면(탭·웹·아마란스·Dooray)에 버튼을 띄운다.
/// 숨김: 로그인 전·로그인 화면, 계정 설정 off(innobot_button), 시트·대화상자가 열렸을 때, 하단 그룹 메뉴를 펼쳤을 때.
/// Claude 열기는 데스크톱 홈에서만. 내비게이터 위라 Tooltip용 Overlay를 따로 두고, 시트는 라우터의 내비게이터로 띄운다.
class InnobotOverlay extends ConsumerWidget {
  const InnobotOverlay({super.key, required this.router});
  final GoRouter router;

  @override
  Widget build(BuildContext context, WidgetRef ref) => Overlay.wrap(
        child: ListenableBuilder(
          listenable: Listenable.merge([router.routerDelegate, innobotPopups, innobotFanOpen, favoritesOpen, notifOpen]),
          builder: (context, _) {
            // push로 연 화면(/web·/gw/*)은 uri가 바뀌지 않으므로 맨 위 경로를 본다
            final cfg = router.routerDelegate.currentConfiguration;
            final path = cfg.isEmpty ? cfg.uri.path : cfg.last.matchedLocation;
            final visible = innobotOverlayVisible(
              signedIn: ref.watch(innobotSignedInProvider),
              path: path,
              popups: innobotPopups.value,
              fanOpen: innobotFanOpen.value,
              enabled: ref.watch(innobotButtonPrefProvider).value ?? true,
              available: ref.watch(assistantAvailableProvider),
            );
            if (!visible) {
              // 숨겨지면(팝업·로그아웃·설정 off) 펼친 즐겨찾기·알림도 닫는다 — 다시 나타날 때 열린 채 남지 않게
              if (favoritesOpen.value) WidgetsBinding.instance.addPostFrameCallback((_) => favoritesOpen.value = false);
              if (notifOpen.value) WidgetsBinding.instance.addPostFrameCallback((_) => notifOpen.value = false);
              return const SizedBox.shrink();
            }
            // 탭 화면은 하단 바(NavigationBar 80) 위로
            final pad = MediaQuery.paddingOf(context).bottom, bar = hasBottomBar(path);
            final inset = pad + (bar ? 80 : 0);
            if (ref.watch(innobotFabsHiddenProvider)) {
              if (favoritesOpen.value) WidgetsBinding.instance.addPostFrameCallback((_) => favoritesOpen.value = false);
              if (notifOpen.value) WidgetsBinding.instance.addPostFrameCallback((_) => notifOpen.value = false);
              // 숨김 상태 — 하단 바 오른쪽(더보기 옆)에 작은 아이콘이 숨 쉬듯 깜빡이며 기다린다. 누르면 복귀.
              return Stack(children: [
                Positioned(right: 10, bottom: bar ? pad + 26 : pad + 10, child: FabsRestoreButton(onTap: () => ref.read(innobotFabsHiddenProvider.notifier).set(false))),
              ]);
            }
            return Stack(children: [
              // 즐겨찾기·알림을 펼치면 바깥을 살짝 어둡게 — 누르면 닫힌다
              if (favoritesOpen.value || notifOpen.value)
                Positioned.fill(
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () {
                      favoritesOpen.value = false;
                      notifOpen.value = false;
                    },
                    child: const ColoredBox(color: Color(0x33000000)),
                  ),
                ),
              InnobotButton(
                showClaude: showsClaudeAt(path),
                bottomInset: inset,
                sheetContext: () => router.routerDelegate.navigatorKey.currentContext,
                // 탭 화면(/food 등)은 그 탭으로, 나머지(웹·아마란스·Dooray)는 바 틀 안에 쌓는다
                onOpenPath: (p) => isBranchRoot(p) ? router.go(p) : router.push(p),
                onContextMenu: (pos) async {
                  final ctx = router.routerDelegate.navigatorKey.currentContext;
                  if (ctx == null) return;
                  final v = await showMenu<String>(
                    context: ctx,
                    position: RelativeRect.fromLTRB(pos.dx, pos.dy, pos.dx, pos.dy),
                    items: const [PopupMenuItem(value: 'hide', child: Row(children: [Icon(Icons.visibility_off_outlined, size: 18), SizedBox(width: 10), Text('버튼 숨기기')]))],
                  );
                  if (v == 'hide') ref.read(innobotFabsHiddenProvider.notifier).set(true);
                },
              ),
            ]);
          },
        ),
      );
}

/// 이노봇 위의 Claude 열기(56px) — 설치된 Claude 앱을 앞으로, 없으면 내려받기 페이지(claude_open.dart).
class ClaudeButton extends StatelessWidget {
  const ClaudeButton({super.key, this.onTap = openClaude});
  final Future<void> Function() onTap;

  @override
  Widget build(BuildContext context) => _RoundButton(
        color: Brand.claudeInk,
        tooltip: 'Claude 열기',
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Image.asset(
            'assets/brand/claude.png',
            width: 28,
            height: 28,
            fit: BoxFit.contain,
          ),
        ),
      );
}

/// 흰 테두리 원형 버튼(56px) — 이노봇·Claude 공용.
class _RoundButton extends StatelessWidget {
  const _RoundButton({
    required this.color,
    required this.tooltip,
    required this.onTap,
    required this.child,
  });
  final Color color;
  final String tooltip;
  final void Function() onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) => Tooltip(
        message: tooltip,
        child: Material(
          color: color,
          shape: const CircleBorder(
            side: BorderSide(color: Colors.white, width: 2),
          ),
          elevation: 6,
          shadowColor: color.withValues(alpha: 0.5),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: Padding(padding: const EdgeInsets.all(6), child: child),
          ),
        ),
      );
}

/// 숨긴 버튼 묶음을 다시 보이게 하는 작은 아이콘(26px) — 옅게 숨 쉬듯 깜빡인다.
class FabsRestoreButton extends StatefulWidget {
  const FabsRestoreButton({super.key, required this.onTap});
  final VoidCallback onTap;
  @override
  State<FabsRestoreButton> createState() => _FabsRestoreButtonState();
}

class _FabsRestoreButtonState extends State<FabsRestoreButton> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1600))..repeat(reverse: true);
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Tooltip(
        message: '이노봇·바로가기 버튼 다시 보이기',
        child: FadeTransition(
          opacity: Tween(begin: 0.45, end: 1.0).animate(_c),
          child: Material(
            color: Brand.blue,
            shape: const CircleBorder(),
            elevation: 3,
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: widget.onTap,
              child: const SizedBox(width: 26, height: 26, child: Icon(Icons.smart_toy_outlined, size: 15, color: Colors.white)),
            ),
          ),
        ),
      );
}
