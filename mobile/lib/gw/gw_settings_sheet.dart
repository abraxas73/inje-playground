import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../app/theme.dart';
import 'gw_creds.dart';
import 'gw_login_store.dart';

/// 더보기 → 아마란스: 연결 상태·재연결·해제 + 자동 로그인 아이디·비밀번호(보안 저장소).
class GwSettingsSheet extends ConsumerStatefulWidget {
  const GwSettingsSheet({super.key});
  @override
  ConsumerState<GwSettingsSheet> createState() => _GwSettingsSheetState();
}

class _GwSettingsSheetState extends ConsumerState<GwSettingsSheet> {
  final _id = TextEditingController(), _pw = TextEditingController();
  bool _seeded = false;
  String? _msg;

  @override
  void dispose() {
    _id.dispose();
    _pw.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final id = _id.text.trim(), pw = _pw.text;
    if (id.isEmpty || pw.isEmpty) {
      setState(() => _msg = '아이디와 비밀번호를 모두 넣어 주세요.');
      return;
    }
    await ref.read(gwLoginProvider.notifier).save(GwLogin(id: id, pw: pw));
    if (mounted) setState(() => _msg = '저장됨 — 다음 연결부터 자동으로 로그인합니다.');
  }

  Future<void> _clear() async {
    await ref.read(gwLoginProvider.notifier).clear();
    _pw.clear();
    if (mounted) setState(() => _msg = '저장된 로그인 정보를 지웠습니다.');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final gw = ref.watch(gwProvider).value;
    final login = ref.watch(gwLoginProvider).value;
    if (!_seeded && (login != null || gw?.creds != null)) {
      _seeded = true;
      _id.text = login?.id ?? (gw?.creds?.email ?? '').split('@').first;
      _pw.text = login?.pw ?? '';
    }
    final status = gw?.status ?? GwStatus.none;
    final c = gw?.creds;
    void connect() {
      Navigator.of(context).pop();
      context.push('/gw/connect');
    }
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('아마란스', style: theme.textTheme.headlineSmall),
          const SizedBox(height: 6),
          Text(switch (status) {
            GwStatus.none => '연결되지 않음 — 연결하면 미결 결재·출퇴근·일정·메일을 앱에서 봅니다.',
            GwStatus.connected => '연결됨 · ${c?.empName ?? ''} (${c?.email ?? ''})',
            GwStatus.needsRelogin => '로그인이 만료되었습니다 — 다시 연결하세요.',
          }, style: theme.textTheme.bodySmall?.copyWith(color: status == GwStatus.needsRelogin ? Brand.dangerText : Brand.muted)),
          const SizedBox(height: 12),
          Row(children: [
            FilledButton.icon(onPressed: connect, icon: const Icon(Icons.login, size: 18), label: Text(switch (status) { GwStatus.none => '연결하기', GwStatus.connected => '재연결', GwStatus.needsRelogin => '다시 연결' })),
            const SizedBox(width: 8),
            if (status != GwStatus.none) OutlinedButton(onPressed: () => ref.read(gwProvider.notifier).disconnect(), child: const Text('연결 해제')),
          ]),
          const Divider(height: 32),
          Text('자동 로그인', style: theme.textTheme.titleMedium),
          const SizedBox(height: 4),
          Text('저장해 두면 연결할 때 아이디·비밀번호를 대신 넣습니다. 비밀번호는 이 기기의 보안 저장소(iOS Keychain · Android Keystore)에만 저장되고 서버로 가지 않습니다.', style: theme.textTheme.bodySmall),
          const SizedBox(height: 12),
          TextField(key: const Key('gw-login-id'), controller: _id, decoration: const InputDecoration(labelText: '아이디', hintText: '예: hong.gildong'), autocorrect: false, enableSuggestions: false),
          const SizedBox(height: 10),
          TextField(key: const Key('gw-login-pw'), controller: _pw, decoration: const InputDecoration(labelText: '비밀번호'), obscureText: true, autocorrect: false, enableSuggestions: false),
          const SizedBox(height: 12),
          Row(children: [
            FilledButton(onPressed: _save, child: const Text('저장')),
            const SizedBox(width: 8),
            if (login != null) TextButton(onPressed: _clear, child: const Text('저장 정보 삭제')),
          ]),
          if (_msg != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(_msg!, style: theme.textTheme.bodySmall?.copyWith(color: Brand.navy))),
        ]),
      ),
    );
  }
}
