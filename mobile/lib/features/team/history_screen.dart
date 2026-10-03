import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../api/client.dart';
import '../../auth/session.dart';
import '../ladder/history_screen.dart' show fmtDate;
import 'models.dart';
import 'repository.dart';

class TeamHistoryScreen extends ConsumerStatefulWidget {
  const TeamHistoryScreen({super.key});
  @override
  ConsumerState<TeamHistoryScreen> createState() => _TeamHistoryScreenState();
}

class _TeamHistoryScreenState extends ConsumerState<TeamHistoryScreen> {
  List<TeamSessionRow>? _sessions;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final s = await ref.read(teamRepositoryProvider).sessions();
      if (mounted) setState(() { _sessions = s; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _attend(TeamResultRow r, String name, bool v) async {
    try {
      await ref.read(teamRepositoryProvider).setAttendance(r.id, name, v);
      setState(() => r.attendance[name] = v);
    } on ApiException catch (e) {
      _snack(e.message);
    }
  }

  Future<void> _comment(TeamResultRow r) async {
    final ctl = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('${r.teamName} 댓글'),
        content: TextField(controller: ctl, autofocus: true, maxLines: 3),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('취소')), FilledButton(onPressed: () => Navigator.pop(ctx, ctl.text.trim()), child: const Text('등록'))],
      ),
    );
    if (text == null || text.isEmpty) return;
    final author = (ref.read(sessionProvider).asData?.value?.email ?? '익명').split('@').first;
    try {
      await ref.read(teamRepositoryProvider).addComment(r.id, author, text);
      await _load();
    } on ApiException catch (e) {
      _snack(e.message);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('커피 타임 이력')),
        body: RefreshIndicator(
          onRefresh: _load,
          child: _error != null
              ? ListView(children: [Padding(padding: const EdgeInsets.all(24), child: Text(_error!, style: const TextStyle(color: Colors.red)))])
              : _sessions == null
                  ? const Center(child: CircularProgressIndicator())
                  : _sessions!.isEmpty
                      ? ListView(children: const [Padding(padding: EdgeInsets.all(32), child: Center(child: Text('저장된 결과가 없습니다.', style: TextStyle(color: Colors.grey))))])
                      : ListView.separated(
                          itemCount: _sessions!.length,
                          separatorBuilder: (_, _) => const Divider(height: 1),
                          itemBuilder: (context, i) {
                            final s = _sessions![i];
                            return ExpansionTile(
                              title: Text(s.title ?? '${s.results.length}팀 · ${s.results.fold<int>(0, (a, r) => a + r.members.length)}명'),
                              subtitle: Text(fmtDate(s.createdAt)),
                              children: [
                                for (final r in s.results)
                                  Padding(
                                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Text(r.teamName, style: const TextStyle(fontWeight: FontWeight.w600)),
                                        const Spacer(),
                                        TextButton.icon(onPressed: () => _comment(r), icon: const Icon(Icons.comment_outlined, size: 16), label: const Text('댓글')),
                                      ]),
                                      for (final m in r.members)
                                        CheckboxListTile(
                                          dense: true,
                                          contentPadding: EdgeInsets.zero,
                                          controlAffinity: ListTileControlAffinity.leading,
                                          title: Text(m['hasCard'] == true ? '${m['name']}(법카)' : '${m['name']}'),
                                          value: attended(r.attendance, '${m['name']}'),
                                          onChanged: (v) => _attend(r, '${m['name']}', v ?? false),
                                        ),
                                      for (final c in r.comments) Padding(padding: const EdgeInsets.only(left: 8, top: 2), child: Text('${c['author']}: ${c['content']}', style: Theme.of(context).textTheme.bodySmall)),
                                    ]),
                                  ),
                              ],
                            );
                          },
                        ),
        ),
      );
}
