// 명시적 이월(JARVIS migration_prompt_dialog) — 자동 이월하지 않고 항목마다 [오늘 이월·연기·취소·유지]를 고른다.
// 결과는 RPC migrate_todo로(이월 횟수 +1). 앱 첫 화면에서 KST 하루 한 번만 묻는다. 3회 이상 이월된 것 정리에도 같은 창을 쓴다.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../app/theme.dart';
import 'todo_model.dart';
import 'todo_store.dart';

enum MigrationAction {
  today('오늘 이월', 'today'),
  schedule('연기', 'scheduled'),
  cancel('취소', 'cancelled'),
  keep('유지', null);

  const MigrationAction(this.label, this.to);
  final String label;
  final String? to;
}

const todoMigrationPrefKey = 'todo_last_migration_prompt_date';

/// 어제 '오늘'에 남은 할 일이 있으면 하루 한 번 묻는다(오늘 이미 물었으면 건너뜀). 없으면 날짜를 남기지 않는다(내일 다시 확인).
Future<void> maybeShowTodoMigration(BuildContext context, WidgetRef ref, {DateTime? now}) async {
  try {
    final prefs = await SharedPreferences.getInstance();
    final nowUtc = (now ?? DateTime.now()).toUtc();
    final today = kstDate(nowUtc);
    if (prefs.getString(todoMigrationPrefKey) == today) return;
    final todos = await ref.read(todosProvider.future);
    final pending = lingeringFromYesterday(todos, nowUtc);
    if (pending.isEmpty || !context.mounted) return;
    await prefs.setString(todoMigrationPrefKey, today);
    if (!context.mounted) return;
    await showTodoMigration(context, pending);
  } catch (_) {
    // 첫 화면을 막지 않는다 — 다음에 다시 묻는다.
  }
}

Future<void> showTodoMigration(BuildContext context, List<Todo> pending, {String title = '어제의 할 일을 정리하세요', String? subtitle}) => showDialog(
      context: context,
      builder: (_) => _MigrationDialog(pending: pending, title: title, subtitle: subtitle ?? '오늘로 이월할지, 일정으로 미룰지, 취소할지 고르세요.\n그대로 두면 유지됩니다.'),
    );

class _MigrationDialog extends ConsumerStatefulWidget {
  const _MigrationDialog({required this.pending, required this.title, required this.subtitle});
  final List<Todo> pending;
  final String title, subtitle;
  @override
  ConsumerState<_MigrationDialog> createState() => _MigrationDialogState();
}

class _MigrationDialogState extends ConsumerState<_MigrationDialog> {
  final _picks = <String, MigrationAction>{};
  var _saving = false;

  Future<void> _apply() async {
    setState(() => _saving = true);
    final n = ref.read(todosProvider.notifier);
    var failed = 0;
    for (final t in widget.pending) {
      final to = (_picks[t.id] ?? MigrationAction.keep).to;
      if (to == null) continue;
      try {
        await n.migrate(t, to);
      } catch (_) {
        failed++;
      }
    }
    if (!mounted) return;
    final m = ScaffoldMessenger.maybeOf(context);
    Navigator.pop(context);
    if (failed > 0) m?.showSnackBar(SnackBar(content: Text('$failed건을 정리하지 못했습니다. 다시 시도하세요.')));
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.title),
        content: SizedBox(
          width: 460,
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(widget.subtitle, style: TextStyle(fontSize: 13, color: Brand.muted)),
            const SizedBox(height: 10),
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                itemCount: widget.pending.length,
                separatorBuilder: (_, _) => Divider(height: 16, color: Brand.hairline),
                itemBuilder: (_, i) {
                  final t = widget.pending[i];
                  final pick = _picks[t.id] ?? MigrationAction.keep;
                  return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(child: Text(t.title, style: TextStyle(fontWeight: FontWeight.w700, color: Brand.navy))),
                      if (t.migrationCount > 0)
                        Text('${t.migrationCount}회 이월', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: t.isStale ? const Color(0xFFD97706) : Brand.muted)),
                    ]),
                    const SizedBox(height: 6),
                    Wrap(spacing: 6, runSpacing: 4, children: [
                      for (final a in MigrationAction.values)
                        ChoiceChip(
                          key: ValueKey('todo-migrate-${t.id}-${a.name}'),
                          visualDensity: VisualDensity.compact,
                          label: Text(a.label),
                          selected: pick == a,
                          onSelected: (_) => setState(() => _picks[t.id] = a),
                        ),
                    ]),
                  ]);
                },
              ),
            ),
          ]),
        ),
        actions: [
          FilledButton(key: const ValueKey('todo-migrate-apply'), onPressed: _saving ? null : _apply, child: Text(_saving ? '정리 중…' : '완료')),
        ],
      );
}

/// 3회 이상 이월된 할 일 띠 — 누르면 같은 창으로 정리(JARVIS suggest_stale_cleanup).
class StaleBanner extends ConsumerWidget {
  const StaleBanner({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stale = [for (final t in ref.watch(todosProvider).value ?? const <Todo>[]) if (t.isStale) t];
    if (stale.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Material(
        color: const Color(0xFFFFF3C4).withValues(alpha: Brand.brightness == Brightness.dark ? 0.15 : 1),
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: () => showTodoMigration(context, stale, title: '자주 미룬 할 일 정리', subtitle: '3번 이상 이월된 할 일이에요. 정말 필요한 일인지 정해볼까요?'),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(children: [
              const Icon(Icons.warning_amber_rounded, size: 18, color: Color(0xFFD97706)),
              const SizedBox(width: 8),
              Expanded(child: Text('3번 이상 미룬 할 일 ${stale.length}개 — 정리하기', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Color(0xFF8A5A00)))),
              const Icon(Icons.chevron_right, size: 18, color: Color(0xFF8A5A00)),
            ]),
          ),
        ),
      ),
    );
  }
}

