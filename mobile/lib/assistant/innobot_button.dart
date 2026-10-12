import 'dart:io';
import 'dart:math' as math;
// mobile/lib/assistant/innobot_button.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../app/theme.dart';
import 'assistant_session.dart';
import 'assistant_sheet.dart';
import 'claude_open.dart';

/// 모든 탭 위에 떠 있는 이노봇(56px). 기본 오른쪽 아래, 길게 눌러 끌면 세로 위치를 옮기고 기기에 저장.
/// 서버가 비서를 꺼 두었다고 답한 뒤에는(assistantAvailableProvider) 이번 실행 동안 숨긴다.
/// 데스크톱(macOS·Windows)에서는 바로 위에 Claude 열기 버튼(ClaudeButton)을 함께 띄우고 같이 끌린다.
class InnobotButton extends ConsumerStatefulWidget {
  const InnobotButton({super.key});
  static bool get showsClaude => Platform.isMacOS || Platform.isWindows;
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
          bottom: _bottom.clamp(
            8,
            math.max(8.0, MediaQuery.of(context).size.height - 200),
          ),
          child: GestureDetector(
            onLongPressStart: (_) => _dragStart = _bottom,
            onLongPressMoveUpdate: (d) => setState(
              () => _bottom = (_dragStart - d.offsetFromOrigin.dy).clamp(
                8,
                math.max(8.0, MediaQuery.of(context).size.height - 200),
              ),
            ),
            onLongPressEnd: (_) => SharedPreferences.getInstance()
                .then((p) => p.setDouble(_key, _bottom))
                .catchError((_) => false),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (InnobotButton.showsClaude)
                  const Padding(
                    padding: EdgeInsets.only(bottom: 10),
                    child: ClaudeButton(),
                  ),
                _RoundButton(
                  color: Brand.botViolet,
                  tooltip: '비서 이노봇',
                  onTap: () => showAssistantSheet(context),
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
