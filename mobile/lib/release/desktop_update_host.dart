import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/theme.dart';
import 'desktop_updater.dart';

/// Outside Navigator: pushed document/WebView routes cannot cover the strip.
class DesktopUpdateHost extends ConsumerWidget {
  const DesktopUpdateHost({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final updater = ref.watch(desktopUpdaterProvider);
    if (updater == null) return child;
    return ListenableBuilder(
      listenable: updater,
      builder: (context, _) => Column(
        children: [
          if (updater.state.visible) DesktopUpdateStrip(updater: updater),
          Expanded(child: child),
        ],
      ),
    );
  }
}

class DesktopUpdateStrip extends StatelessWidget {
  const DesktopUpdateStrip({super.key, required this.updater});
  final DesktopUpdater updater;
  @override
  Widget build(BuildContext context) {
    final state = updater.state;
    final available = state.phase == DesktopUpdatePhase.available;
    final busy =
        state.phase == DesktopUpdatePhase.installing ||
        state.phase == DesktopUpdatePhase.checking;
    return Material(
      color: Brand.blueTint,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
          child: Row(
            children: [
              const Icon(Icons.system_update_alt, size: 18, color: Brand.blue),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      available
                          ? '${state.release!.version} 버전으로 업데이트가 필요합니다.'
                          : '${state.message}${state.progress == null ? '' : ' ${(state.progress! * 100).round()}%'}',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: Brand.navy,
                      ),
                    ),
                    if (available)
                      Text(
                        '클릭하면 다운로드·설치 후 자동 재시작합니다. 작성 중인 내용을 먼저 저장해 주세요.',
                        style: TextStyle(fontSize: 12, color: Brand.navy),
                      ),
                    if (busy)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: LinearProgressIndicator(value: state.progress),
                      ),
                  ],
                ),
              ),
              if (available)
                TextButton(onPressed: updater.start, child: const Text('업데이트')),
              if (state.phase == DesktopUpdatePhase.error)
                TextButton(
                  onPressed: () => updater.check(manual: true),
                  child: const Text('다시 확인'),
                ),
              if (!busy && !available)
                TextButton(
                  onPressed: updater.dismiss,
                  child: const Text('닫기'),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
