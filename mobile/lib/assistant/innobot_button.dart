import 'dart:math' as math;
// mobile/lib/assistant/innobot_button.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../app/theme.dart';
import 'assistant_session.dart';
import 'assistant_sheet.dart';

/// 모든 탭 위에 떠 있는 이노봇(56px). 기본 오른쪽 아래, 길게 눌러 끌면 세로 위치를 옮기고 기기에 저장.
/// 서버가 비서를 꺼 두었다고 답한 뒤에는(assistantAvailableProvider) 이번 실행 동안 숨긴다.
class InnobotButton extends ConsumerStatefulWidget {
  const InnobotButton({super.key});
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
            child: Tooltip(
              message: '비서 이노봇',
              child: Material(
                color: Brand.botViolet,
                shape: const CircleBorder(
                  side: BorderSide(color: Colors.white, width: 2),
                ),
                elevation: 6,
                shadowColor: Brand.botViolet.withValues(alpha: 0.5),
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: () => showAssistantSheet(context),
                  child: Padding(
                    padding: const EdgeInsets.all(6),
                    child: Image.asset(
                      'assets/brand/innobot.png',
                      width: 44,
                      height: 44,
                      fit: BoxFit.contain,
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
}
