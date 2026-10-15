import 'dart:io';
import 'dart:math' as math;
// mobile/lib/assistant/innobot_button.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
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
  const InnobotButton({super.key, this.showClaude, this.bottomInset = 0, this.sheetContext});
  static bool get showsClaude => Platform.isMacOS || Platform.isWindows;
  final bool? showClaude;
  final double bottomInset;
  final BuildContext? Function()? sheetContext;
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
              children: [
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
          listenable: Listenable.merge([router.routerDelegate, innobotPopups, innobotFanOpen]),
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
            if (!visible) return const SizedBox.shrink();
            // 탭 화면은 하단 바(NavigationBar 80) 위로
            final inset = MediaQuery.paddingOf(context).bottom + (isTabPath(path) ? 80 : 0);
            return Stack(children: [
              InnobotButton(showClaude: showsClaudeAt(path), bottomInset: inset, sheetContext: () => router.routerDelegate.navigatorKey.currentContext),
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
