import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'session.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  String? _error;
  bool _busy = false;
  Future<void> _login() async {
    setState(() { _busy = true; _error = null; });
    try { await ref.read(sessionProvider.notifier).signIn(); }
    catch (e) { setState(() => _error = '로그인에 실패했습니다: $e'); }
    finally { if (mounted) setState(() => _busy = false); }
  }
  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    return Scaffold(
      body: Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.grid_view_rounded, size: 56, color: Color(0xFF0284C7)),
        const SizedBox(height: 12),
        Text('이노그리드', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 4),
        const Text('이노크루를 위한 서비스에 로그인하세요', style: TextStyle(color: Colors.grey)),
        const SizedBox(height: 24),
        FilledButton.icon(onPressed: _busy || session.isLoading ? null : _login, icon: const Icon(Icons.login), label: const Text('Microsoft 계정으로 로그인')),
        if (session.hasError) Padding(padding: const EdgeInsets.only(top: 12), child: Text('${session.error}', style: const TextStyle(color: Colors.red))),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: const TextStyle(color: Colors.red))),
        if (session.hasError) TextButton(onPressed: () => ref.read(sessionProvider.notifier).reload(), child: const Text('다시 시도')),
      ]))),
    );
  }
}
