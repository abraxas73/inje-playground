import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'session.dart';

class GuestScreen extends ConsumerWidget {
  const GuestScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final email = ref.watch(sessionProvider).asData?.value?.email ?? '';
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 28, 24, 16),
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  const Center(child: TintIcon(Icons.lock_outline, size: 56)),
                  const SizedBox(height: 16),
                  Text('사용자 권한이 필요합니다', textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 8),
                  Text('$email 계정은 아직 승인되지 않았습니다.\n관리자에게 권한을 요청해 주세요.', textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(height: 24),
                  FilledButton.icon(onPressed: () => ref.read(sessionProvider.notifier).reload(), icon: const Icon(Icons.refresh, size: 18), label: const Text('다시 확인')),
                  TextButton(style: TextButton.styleFrom(foregroundColor: Brand.muted), onPressed: () => ref.read(sessionProvider.notifier).signOut(), child: const Text('로그아웃')),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
