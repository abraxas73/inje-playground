import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../app/theme.dart';
import '../gw/gw_api.dart';
import 'mcp_worker_provider.dart';

/// "방금" / "N분 전" / "N시간 전".
String agoLabel(DateTime t, DateTime now) {
  final d = now.difference(t);
  if (d.inMinutes < 1) return '방금';
  if (d.inHours < 1) return '${d.inMinutes}분 전';
  return '${d.inHours}시간 전';
}

/// 더보기 → Claude 커넥터(데스크탑만): 요청 받기 스위치·처리 상태·연결 방법.
class McpSettingsSheet extends ConsumerStatefulWidget {
  const McpSettingsSheet({super.key});
  @override
  ConsumerState<McpSettingsSheet> createState() => _McpSettingsSheetState();
}

class _McpSettingsSheetState extends ConsumerState<McpSettingsSheet> {
  Timer? _tick; // 워커 카운터·"N분 전"을 다시 그린다

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 5), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final enabled = ref.watch(mcpEnabledProvider);
    final w = ref.watch(mcpWorkerProvider);
    final gwMissing = ref.watch(gwApiProvider) == null;
    final last = w?.lastAt;
    final status = !enabled
        ? '꺼짐 — 요청을 받지 않습니다.'
        : w == null
            ? '앱에 로그인하면 요청을 받습니다.'
            : last == null
                ? '연결 대기 중 — 아직 처리한 요청이 없습니다.'
                : '${w.handled}건 처리 · 마지막 ${w.lastTool} · ${agoLabel(last, DateTime.now())}';
    final small = theme.textTheme.bodySmall;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Claude 커넥터', style: theme.textTheme.headlineSmall),
        const SizedBox(height: 6),
        Text("claude.ai·Claude Code에서 'INNOGRID 아마란스' 커넥터를 연결하면 이 앱이 요청을 대신 실행합니다. 아마란스가 연결돼 있어야 합니다.", style: small),
        const SizedBox(height: 8),
        SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('요청 받기'), value: enabled, onChanged: (v) => ref.read(mcpEnabledProvider.notifier).set(v)),
        Text(status, style: small?.copyWith(color: Brand.muted)),
        if (gwMissing) Padding(padding: const EdgeInsets.only(top: 6), child: Text('아마란스가 연결되어 있지 않습니다. 더보기 > 아마란스에서 연결하세요.', style: small?.copyWith(color: Brand.dangerText))),
        const SizedBox(height: 12),
        TextButton.icon(
          style: TextButton.styleFrom(padding: EdgeInsets.zero),
          onPressed: () => launchUrl(Uri.parse('https://innocrew.innogrid.com/apps#mcp'), mode: LaunchMode.externalApplication),
          icon: const Icon(Icons.open_in_new, size: 16),
          label: const Text('커넥터 연결 방법'),
        ),
      ]),
    );
  }
}
