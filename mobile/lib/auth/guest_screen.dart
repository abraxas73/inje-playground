import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'session.dart';

class GuestScreen extends ConsumerWidget {
  const GuestScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final email = ref.watch(sessionProvider).asData?.value?.email ?? '';
    return Scaffold(body: Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
      const Icon(Icons.lock_outline, size: 48, color: Colors.grey),
      const SizedBox(height: 12),
      const Text('사용자 권한이 필요합니다', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
      const SizedBox(height: 8),
      Text('$email 계정은 아직 승인되지 않았습니다. 관리자에게 권한을 요청해 주세요.', textAlign: TextAlign.center, style: const TextStyle(color: Colors.grey)),
      const SizedBox(height: 24),
      OutlinedButton(onPressed: () => ref.read(sessionProvider.notifier).reload(), child: const Text('다시 확인')),
      TextButton(onPressed: () => ref.read(sessionProvider.notifier).signOut(), child: const Text('로그아웃')),
    ]))));
  }
}
