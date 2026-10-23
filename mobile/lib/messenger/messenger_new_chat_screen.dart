import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import '../gw/gw_api.dart';
import '../gw/gw_client.dart' show asStr;
import '../gw/gw_mcp_api.dart';
import 'messenger_chat_screen.dart';
import 'messenger_models.dart';
import 'messenger_provider.dart';

/// 새 대화 — 사내 명부에서 사람을 골라 대화방을 연다(1:1은 기존 방 재사용, 여럿이면 그룹방 새로).
/// 명부는 아마란스 조직도(gw102A01·A02, 30분 캐시) — 사번(empSeq)은 메신저와 같다.

typedef MsgPerson = ({String empSeq, String name, String dept, String duty});

/// 사내 명부(이름 순). 테스트에서 override.
final msgRosterProvider = FutureProvider.autoDispose<List<MsgPerson>>((ref) async {
  final api = ref.watch(gwApiProvider);
  if (api == null) throw StateError('아마란스를 먼저 연결해 주세요.');
  final rows = await api.rosterRows();
  return [
    for (final r in rows)
      if (asStr(r['empSeq']).isNotEmpty && asStr(r['empName']).trim().isNotEmpty)
        (empSeq: asStr(r['empSeq']), name: asStr(r['empName']).trim(), dept: asStr(r['deptName']), duty: asStr(r['dutyName'])),
  ]..sort((a, b) => a.name.compareTo(b.name));
});

class MessengerNewChatScreen extends ConsumerStatefulWidget {
  const MessengerNewChatScreen({super.key});
  @override
  ConsumerState<MessengerNewChatScreen> createState() => _MessengerNewChatScreenState();
}

class _MessengerNewChatScreenState extends ConsumerState<MessengerNewChatScreen> {
  final _q = TextEditingController();
  final _picked = <MsgPerson>[];
  bool _opening = false;

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    if (_picked.isEmpty || _opening) return;
    setState(() => _opening = true);
    try {
      final roomId = await ref.read(messengerApiProvider).openRoomWith([for (final p in _picked) p.empSeq]);
      if (!mounted) return;
      final title = _picked.length == 1 ? _picked.first.name : '${_picked.first.name} 외 ${_picked.length - 1}명';
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => MessengerRoomScreen(room: MsgRoom.minimal(roomId, title: title))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('대화방을 열지 못했습니다: $e')));
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final myEmpSeq = ref.read(messengerClientProvider).session?.empSeq ?? '';
    final roster = ref.watch(msgRosterProvider);
    final word = _q.text.trim().toLowerCase();
    return Scaffold(
      appBar: BrandHeader(compact: WidgetChrome.of(context), title: '새 대화', showBack: true),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: TextField(
            controller: _q,
            autofocus: true,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(hintText: '이름 · 부서', prefixIcon: const Icon(Icons.search), border: OutlineInputBorder(borderRadius: BorderRadius.circular(22))),
          ),
        ),
        if (_picked.isNotEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Wrap(spacing: 6, runSpacing: 4, children: [
              for (final p in _picked) InputChip(label: Text(p.name), onDeleted: () => setState(() => _picked.remove(p))),
            ]),
          ),
        Expanded(
          child: roster.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('명부를 불러오지 못했습니다: $e', textAlign: TextAlign.center))),
            data: (all) {
              if (word.isEmpty) return Center(child: Text('대화할 사람을 찾아 고르세요', style: TextStyle(color: Brand.muted)));
              final hits = [
                for (final p in all)
                  if (p.empSeq != myEmpSeq && (p.name.toLowerCase().contains(word) || p.dept.toLowerCase().contains(word))) p,
              ].take(50).toList();
              if (hits.isEmpty) return Center(child: Text('찾는 사람이 없습니다', style: TextStyle(color: Brand.muted)));
              return ListView(children: [
                for (final p in hits)
                  CheckboxListTile(
                    dense: true,
                    value: _picked.any((x) => x.empSeq == p.empSeq),
                    onChanged: (v) => setState(() => v == true ? _picked.add(p) : _picked.removeWhere((x) => x.empSeq == p.empSeq)),
                    title: Text(p.name, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                    subtitle: Text([p.dept, p.duty].where((s) => s.isNotEmpty).join(' · '), style: TextStyle(fontSize: 12, color: Brand.muted)),
                  ),
              ]);
            },
          ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _picked.isEmpty || _opening ? null : _start,
                icon: _opening ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.chat_bubble_outline),
                label: Text(_picked.length > 1 ? '${_picked.length}명과 대화 시작' : '대화 시작'),
              ),
            ),
          ),
        ),
      ]),
    );
  }
}
