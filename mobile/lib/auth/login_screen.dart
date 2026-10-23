import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/brand.dart';
import '../app/theme.dart';
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

  // 테스트 계정 이메일 로그인(애플 심사·공개 테스트용, 계정은 관리자가 웹에서 만든다)
  bool _showEmail = false;
  final _email = TextEditingController();
  final _password = TextEditingController();
  String? _emailError;
  @override
  void dispose() { _email.dispose(); _password.dispose(); super.dispose(); }

  Future<void> _emailLogin() async {
    if (_busy) return;
    if (_email.text.trim().isEmpty || _password.text.isEmpty) {
      setState(() => _emailError = '이메일과 비밀번호를 입력해 주세요.');
      return;
    }
    setState(() { _busy = true; _emailError = null; });
    try {
      await ref.read(sessionProvider.notifier).signInWithPassword(_email.text, _password.text);
      TextInput.finishAutofillContext();
    } on LoginFailure catch (e) {
      if (mounted) setState(() => _emailError = e.message);
    } catch (_) {
      if (mounted) setState(() => _emailError = '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  InputDecoration _field(String label) => InputDecoration(
    labelText: label,
    labelStyle: TextStyle(color: Colors.white.withValues(alpha: 0.7)),
    filled: true,
    fillColor: Colors.white.withValues(alpha: 0.08),
    isDense: true,
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
  );

  Widget _emailForm(TextStyle errorStyle) => AutofillGroup(
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      TextField(
        key: const Key('testEmail'),
        controller: _email,
        enabled: !_busy,
        autofocus: true,
        keyboardType: TextInputType.emailAddress,
        autocorrect: false,
        textInputAction: TextInputAction.next,
        autofillHints: const [AutofillHints.email, AutofillHints.username],
        style: const TextStyle(color: Colors.white),
        decoration: _field('이메일'),
      ),
      const SizedBox(height: 8),
      TextField(
        key: const Key('testPassword'),
        controller: _password,
        enabled: !_busy,
        obscureText: true,
        autocorrect: false,
        enableSuggestions: false,
        textInputAction: TextInputAction.done,
        autofillHints: const [AutofillHints.password],
        onSubmitted: (_) => _emailLogin(),
        style: const TextStyle(color: Colors.white),
        decoration: _field('비밀번호'),
      ),
      const SizedBox(height: 8),
      OutlinedButton(
        key: const Key('testSubmit'),
        style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: BorderSide(color: Colors.white.withValues(alpha: 0.4)), minimumSize: const Size.fromHeight(44)),
        onPressed: _busy ? null : _emailLogin,
        child: _busy
            ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
            : const Text('로그인'),
      ),
      if (_emailError != null) ...[const SizedBox(height: 8), Text(_emailError!, style: errorStyle, textAlign: TextAlign.center)],
    ]),
  );

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    final errorStyle = const TextStyle(fontSize: 13, color: Color(0xFFFFB4B4));
    return Scaffold(
      backgroundColor: Brand.hero,
      body: Stack(children: [
        const Positioned.fill(child: GridBackdrop()),
        SafeArea(
          child: LayoutBuilder(builder: (context, box) => SingleChildScrollView(
          child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: box.maxHeight),
          child: IntrinsicHeight(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(28, 48, 28, 20),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              const Align(alignment: Alignment.centerLeft, child: BrandLogo(width: 148, white: true)),
              const SizedBox(height: 40),
              Text('이노크루의 하루를\n조금 더 가볍게', style: Theme.of(context).textTheme.headlineMedium?.copyWith(color: Colors.white)),
              const SizedBox(height: 14),
              Text('뭐 먹지 · 사다리 · 커피 타임, 그리고 사내 서비스를 한곳에서.', style: TextStyle(fontSize: 15, height: 1.55, color: Colors.white.withValues(alpha: 0.72))),
              const Spacer(),
              Align(
                alignment: Alignment.centerLeft,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(999)),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    const Icon(Icons.verified_user_outlined, size: 14, color: Brand.sky),
                    const SizedBox(width: 6),
                    Text('회사 계정 전용', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Colors.white.withValues(alpha: 0.85))),
                  ]),
                ),
              ),
              const SizedBox(height: 14),
              FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: Colors.white,
                  foregroundColor: Brand.navy,
                  disabledBackgroundColor: Colors.white.withValues(alpha: 0.6),
                  disabledForegroundColor: Brand.navy.withValues(alpha: 0.5),
                  minimumSize: const Size.fromHeight(56),
                  textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                ),
                onPressed: _busy || session.isLoading ? null : _login,
                child: const Row(mainAxisSize: MainAxisSize.min, children: [MicrosoftMark(), SizedBox(width: 12), Flexible(child: Text('Microsoft 계정으로 로그인', overflow: TextOverflow.ellipsis))]),
              ),
              if (session.hasError) ...[
                const SizedBox(height: 12),
                Text('${session.error}', style: errorStyle, textAlign: TextAlign.center),
                TextButton(style: TextButton.styleFrom(foregroundColor: Colors.white), onPressed: () => ref.read(sessionProvider.notifier).reload(), child: const Text('다시 시도')),
              ],
              if (_error != null) ...[const SizedBox(height: 12), Text(_error!, style: errorStyle, textAlign: TextAlign.center)],
              const SizedBox(height: 14),
              Text('@innogrid.com 계정으로만 로그인할 수 있습니다.', textAlign: TextAlign.center, style: TextStyle(fontSize: 12, height: 1.5, color: Colors.white.withValues(alpha: 0.56))),
              if (_showEmail) ...[const SizedBox(height: 12), _emailForm(errorStyle)]
              else TextButton(
                style: TextButton.styleFrom(foregroundColor: Colors.white.withValues(alpha: 0.6), textStyle: const TextStyle(fontSize: 12)),
                onPressed: _busy ? null : () => setState(() => _showEmail = true),
                child: const Text('테스트 계정으로 로그인'),
              ),
            ]),
          ),
          ),
          ),
          )),
        ),
      ]),
    );
  }
}
