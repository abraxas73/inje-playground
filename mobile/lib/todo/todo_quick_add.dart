// 글자 선택 메뉴·메일 제목 옆 단추에서 바로 할 일 등록 — 받은 일(inbox)로 넣고 분류는 할 일 화면에서.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../auth/session.dart';
import '../more/catalog.dart';
import 'todo_model.dart';
import 'todo_store.dart';
import 'todo_widgets.dart' show todoErrorText;

/// 글 → 할 일 초안. 첫 글줄(공백 한 칸으로 접음, 200자)이 제목, 여러 줄이거나 잘렸으면 전문(5000자)을 메모로. 빈 글이면 null.
Todo? todoFromText(String text) {
  final all = text.trim();
  if (all.isEmpty) return null;
  final first = all.split('\n').map((l) => l.replaceAll(RegExp(r'\s+'), ' ').trim()).firstWhere((l) => l.isNotEmpty);
  final title = first.length > 200 ? '${first.substring(0, 199)}…' : first;
  final notes = !all.contains('\n') && first.length <= 200 ? null : (all.length > 5000 ? all.substring(0, 5000) : all);
  return Todo(id: '', title: title, notes: notes);
}

/// 이 사용자가 할 일을 쓸 수 있나(페이지 권한 todo). 단추를 보일지 정한다.
bool todoAllowed(AppSession? s) => s != null && canUsePage(s, todoEntry);

/// 등록하고 결과 문장(성공·실패)을 돌려준다.
Future<({bool ok, String message})> addTodoFromText(BuildContext context, String text) async {
  final draft = todoFromText(text);
  if (draft == null) return (ok: false, message: '등록할 글이 없습니다');
  try {
    await ProviderScope.containerOf(context, listen: false).read(todosProvider.notifier).add(draft);
    return (ok: true, message: "할 일에 추가했습니다: ${draft.title}");
  } catch (e) {
    return (ok: false, message: '할 일 추가 실패: ${todoErrorText(e)}');
  }
}

/// 글 하나를 할 일로 넣는 작은 단추(메일 제목 옆 등). 할 일 권한이 없으면 그리지 않는다.
class TodoAddButton extends ConsumerStatefulWidget {
  const TodoAddButton({super.key, required this.text, this.size = 20});
  final String text;
  final double size;
  @override
  ConsumerState<TodoAddButton> createState() => _TodoAddButtonState();
}

class _TodoAddButtonState extends ConsumerState<TodoAddButton> {
  bool _busy = false, _done = false;

  Future<void> _add() async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.maybeOf(context);
    final r = await addTodoFromText(context, widget.text);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _done = r.ok;
    });
    messenger?.showSnackBar(SnackBar(content: Text(r.message, maxLines: 2, overflow: TextOverflow.ellipsis)));
  }

  @override
  Widget build(BuildContext context) => !todoAllowed(ref.watch(sessionProvider).asData?.value)
      ? const SizedBox.shrink()
      : IconButton(
          tooltip: _done ? '할 일에 추가했습니다' : '할 일 등록',
          visualDensity: VisualDensity.compact,
          iconSize: widget.size,
          onPressed: _busy || _done ? null : _add,
          icon: Icon(_done ? Icons.check_circle_rounded : Icons.add_task_rounded),
        );
}
