// 할 일 매트릭스 공용 위젯 — 분면 카드(DragTarget)·할 일 줄(끌기)·2×2 격자. JARVIS urgency_quadrant_card·todo_quadrant_card를 하나로 합쳤다.
// 끌기: 데스크톱은 마우스로 바로(Draggable), 휴대폰은 길게 눌러(LongPressDraggable). 진행 중인 것만 끌 수 있다.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/platform.dart';
import '../app/theme.dart';
import 'todo_model.dart';
import 'todo_store.dart';

/// 분면 하나의 생김새.
class QuadrantSpec {
  const QuadrantSpec({required this.label, required this.color, required this.icon, required this.empty, this.sub});
  final String label, empty;
  final String? sub;
  final Color color;
  final IconData icon;

  static QuadrantSpec urgency(TodoUrgency u) => switch (u) {
        TodoUrgency.today => const QuadrantSpec(label: '오늘', color: Color(0xFFF59E0B), icon: Icons.wb_sunny_rounded, empty: '오늘 할 일이 없어요'),
        TodoUrgency.inbox => const QuadrantSpec(label: '받은함', color: Brand.blue, icon: Icons.inbox_rounded, empty: '분류할 항목이 없어요'),
        TodoUrgency.scheduled => const QuadrantSpec(label: '예정', color: Color(0xFF8B5CF6), icon: Icons.event_rounded, empty: '예정된 항목이 없어요'),
        TodoUrgency.someday => const QuadrantSpec(label: '언젠가', color: Color(0xFF64748B), icon: Icons.coffee_rounded, empty: '언젠가 할 일이 없어요'),
      };

  static QuadrantSpec priority(TodoPriority p) => switch (p) {
        TodoPriority.p1 => const QuadrantSpec(label: '긴급 + 중요', sub: '지금 하기', color: Brand.danger, icon: Icons.local_fire_department_rounded, empty: '비어 있음'),
        TodoPriority.p2 => const QuadrantSpec(label: '중요 · 비긴급', sub: '일정 잡기', color: Brand.blue, icon: Icons.flag_rounded, empty: '비어 있음'),
        TodoPriority.p3 => const QuadrantSpec(label: '긴급 · 비중요', sub: '맡기기·빨리 처리', color: Color(0xFFF59E0B), icon: Icons.bolt_rounded, empty: '비어 있음'),
        TodoPriority.p4 => const QuadrantSpec(label: '둘 다 아님', sub: '버리기·나중에', color: Color(0xFF64748B), icon: Icons.delete_sweep_rounded, empty: '비어 있음'),
      };
}

Color priorityColor(TodoPriority p) => QuadrantSpec.priority(p).color;

/// 분면 카드 — 다른 분면에서 끌어 놓으면 [onDrop]. [accepts]는 이미 이 분면인 항목을 거른다.
class TodoQuadrant extends StatelessWidget {
  const TodoQuadrant({super.key, required this.spec, required this.todos, required this.accepts, required this.onDrop, required this.onOpen, this.badge = TodoRowBadge.priority, this.dense = false});
  final QuadrantSpec spec;
  final List<Todo> todos;
  final bool Function(Todo) accepts;
  final void Function(Todo) onDrop;
  final void Function(Todo) onOpen;
  final TodoRowBadge badge;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    return DragTarget<Todo>(
      onWillAcceptWithDetails: (d) => accepts(d.data),
      onAcceptWithDetails: (d) {
        HapticFeedback.lightImpact();
        onDrop(d.data);
      },
      builder: (context, candidate, _) {
        final hover = candidate.isNotEmpty;
        return AnimatedContainer(
          key: ValueKey('todo-quadrant-${spec.label}'),
          duration: const Duration(milliseconds: 180),
          decoration: BoxDecoration(
            color: hover ? Color.alphaBlend(spec.color.withValues(alpha: 0.06), Brand.surface) : Brand.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: hover ? spec.color : Brand.line, width: hover ? 2 : 1),
            boxShadow: hover ? [BoxShadow(color: spec.color.withValues(alpha: 0.25), blurRadius: 18, offset: const Offset(0, 6))] : null,
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              _Header(spec: spec, count: todos.where((t) => t.isOpen).length, dense: dense),
              Expanded(
                child: todos.isEmpty
                    ? _Empty(spec: spec)
                    : ListView.builder(
                        padding: const EdgeInsets.fromLTRB(4, 0, 4, 6),
                        itemCount: todos.length,
                        itemBuilder: (_, i) => TodoRow(todo: todos[i], accent: spec.color, badge: badge, onOpen: () => onOpen(todos[i]), dense: dense),
                      ),
              ),
            ]),
          ),
        );
      },
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.spec, required this.count, required this.dense});
  final QuadrantSpec spec;
  final int count;
  final bool dense;
  @override
  Widget build(BuildContext context) => Container(
        padding: EdgeInsets.fromLTRB(10, dense ? 6 : 9, 10, dense ? 5 : 8),
        decoration: BoxDecoration(border: Border(top: BorderSide(color: spec.color, width: 3))),
        child: Row(children: [
          Icon(spec.icon, size: 16, color: spec.color),
          const SizedBox(width: 6),
          Expanded(
            child: Text.rich(
              TextSpan(children: [
                TextSpan(text: spec.label, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: Brand.navy)),
                if (spec.sub != null && !dense) TextSpan(text: '  ${spec.sub}', style: TextStyle(fontSize: 11, color: Brand.muted)),
              ]),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
            decoration: BoxDecoration(color: spec.color.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(10)),
            child: Text('$count', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: spec.color)),
          ),
        ]),
      );
}

class _Empty extends StatelessWidget {
  const _Empty({required this.spec});
  final QuadrantSpec spec;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (_, c) => SingleChildScrollView(
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: c.maxHeight),
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Icon(spec.icon, size: 22, color: spec.color.withValues(alpha: 0.45)),
                  const SizedBox(height: 4),
                  Text(spec.empty, textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: Brand.muted)),
                  Text('다른 칸에서 끌어다 놓을 수 있어요', textAlign: TextAlign.center, style: TextStyle(fontSize: 10.5, color: Brand.faint)),
                ]),
              ),
            ),
          ),
        ),
      );
}

/// 줄에 붙이는 배지 — 시급도 매트릭스는 우선순위, 중요도 매트릭스는 시급도를 보여 준다.
enum TodoRowBadge { priority, urgency }

/// 할 일 한 줄 — ○ 완료 토글 · 제목(+배지·프로젝트) · 예상 시간 · 3회 이월 경고. 누르면 편집.
class TodoRow extends ConsumerWidget {
  const TodoRow({super.key, required this.todo, required this.accent, required this.onOpen, this.badge = TodoRowBadge.priority, this.dense = false});
  final Todo todo;
  final Color accent;
  final VoidCallback onOpen;
  final TodoRowBadge badge;
  final bool dense;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final done = todo.state == TodoState.done, cancelled = todo.state == TodoState.cancelled;
    final projects = ref.watch(todoProjectsProvider).value ?? const [];
    final project = todo.projectId == null ? null : projects.where((p) => p.id == todo.projectId).firstOrNull;
    final row = Opacity(
      opacity: cancelled ? 0.55 : 1,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          key: ValueKey('todo-row-${todo.id}'),
          onTap: onOpen,
          borderRadius: BorderRadius.circular(10),
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: 6, vertical: dense ? 4 : 6),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Semantics(
                button: true,
                label: done ? '완료 취소' : '완료',
                child: InkResponse(
                  key: ValueKey('todo-check-${todo.id}'),
                  radius: 16,
                  onTap: cancelled ? null : () => _guard(context, () => ref.read(todosProvider.notifier).toggleDone(todo)),
                  child: Padding(
                    padding: const EdgeInsets.only(top: 1),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 160),
                      width: 17,
                      height: 17,
                      decoration: BoxDecoration(shape: BoxShape.circle, color: done ? accent : Colors.transparent, border: Border.all(color: done ? accent : Brand.faint, width: 1.5)),
                      child: done ? const Icon(Icons.check_rounded, size: 11, color: Colors.white) : null,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text.rich(
                  TextSpan(children: [
                    TextSpan(
                      text: todo.title,
                      style: TextStyle(
                        fontSize: dense ? 12.5 : 13,
                        height: 1.35,
                        fontWeight: FontWeight.w500,
                        color: done || cancelled ? Brand.muted : Brand.navy,
                        decoration: done ? TextDecoration.lineThrough : null,
                      ),
                    ),
                    if (badge == TodoRowBadge.priority && todo.priority != TodoPriority.p3) ...[
                      const TextSpan(text: '  '),
                      WidgetSpan(alignment: PlaceholderAlignment.middle, child: _Pill(todo.priority.short, priorityColor(todo.priority))),
                    ],
                    if (badge == TodoRowBadge.urgency) ...[
                      const TextSpan(text: '  '),
                      WidgetSpan(alignment: PlaceholderAlignment.middle, child: _Pill(todo.urgency.label, QuadrantSpec.urgency(todo.urgency).color)),
                    ],
                    if (project != null) ...[
                      const TextSpan(text: ' '),
                      WidgetSpan(alignment: PlaceholderAlignment.middle, child: _Pill('📁 ${project.title}', Brand.muted, maxWidth: 110)),
                    ],
                    if (todo.scheduledFor != null && !dense) ...[
                      const TextSpan(text: ' '),
                      WidgetSpan(alignment: PlaceholderAlignment.middle, child: _Pill(scheduleLabel(todo.scheduledFor!), const Color(0xFF8B5CF6))),
                    ],
                  ]),
                ),
              ),
              if (todo.estimatedMinutes != null) ...[
                const SizedBox(width: 4),
                _Pill(minutesLabel(todo.estimatedMinutes!), accent),
              ],
              if (todo.isStale) ...[
                const SizedBox(width: 3),
                Tooltip(message: '${todo.migrationCount}번 이월됨', child: const Icon(Icons.warning_amber_rounded, size: 14, color: Color(0xFFD97706))),
              ],
            ]),
          ),
        ),
      ),
    );
    if (!todo.isOpen) return row;
    final feedback = _DragFeedback(title: todo.title, color: accent);
    final ghost = Opacity(opacity: 0.35, child: row);
    // 데스크톱은 마우스로 바로 끈다(길게 누르기는 마우스에 어색함). 휴대폰은 스크롤과 겹치지 않게 길게 눌러.
    return isDesktopPlatform
        ? Draggable<Todo>(data: todo, dragAnchorStrategy: pointerDragAnchorStrategy, feedback: feedback, childWhenDragging: ghost, child: MouseRegion(cursor: SystemMouseCursors.grab, child: row))
        : LongPressDraggable<Todo>(data: todo, dragAnchorStrategy: pointerDragAnchorStrategy, onDragStarted: HapticFeedback.mediumImpact, feedback: feedback, childWhenDragging: ghost, child: row);
  }
}

class _Pill extends StatelessWidget {
  const _Pill(this.text, this.color, {this.maxWidth = 140});
  final String text;
  final Color color;
  final double maxWidth;
  @override
  Widget build(BuildContext context) => Container(
        constraints: BoxConstraints(maxWidth: maxWidth),
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.13), borderRadius: BorderRadius.circular(6)),
        child: Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: color)),
      );
}

class _DragFeedback extends StatelessWidget {
  const _DragFeedback({required this.title, required this.color});
  final String title;
  final Color color;
  @override
  Widget build(BuildContext context) => Material(
        color: Colors.transparent,
        child: Container(
          constraints: const BoxConstraints(maxWidth: 260),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: Brand.hero,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: color, width: 2),
            boxShadow: [BoxShadow(color: color.withValues(alpha: 0.4), blurRadius: 20, offset: const Offset(0, 6))],
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Container(width: 8, height: 8, decoration: BoxDecoration(shape: BoxShape.circle, color: color)),
            const SizedBox(width: 8),
            Flexible(child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13))),
          ]),
        ),
      );
}

/// 2×2 격자 — 칸 사이 8px. 글자 선택(앱 전체 SelectionArea)이 마우스 끌기를 가로채지 않게 선택을 끈다.
class QuadrantGrid extends StatelessWidget {
  const QuadrantGrid({super.key, required this.cells, this.gap = 8});
  final List<Widget> cells; // 왼위·오위·왼아래·오아래
  final double gap;
  @override
  Widget build(BuildContext context) => SelectionContainer.disabled(
        child: Column(children: [
          Expanded(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [Expanded(child: cells[0]), SizedBox(width: gap), Expanded(child: cells[1])])),
          SizedBox(height: gap),
          Expanded(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [Expanded(child: cells[2]), SizedBox(width: gap), Expanded(child: cells[3])])),
        ]),
      );
}

/// 쓰기 실패를 스낵바로(낙관적 반영은 저장소가 되돌린다).
Future<void> _guard(BuildContext context, Future<void> Function() run) async {
  final m = ScaffoldMessenger.maybeOf(context);
  try {
    await run();
  } catch (e) {
    m?.showSnackBar(SnackBar(content: Text('저장하지 못했습니다: ${todoErrorText(e)}')));
  }
}

Future<void> todoGuard(BuildContext context, Future<void> Function() run) => _guard(context, run);

String todoErrorText(Object e) {
  final s = '$e';
  if (s.contains('SocketException') || s.contains('ClientException')) return '네트워크 연결을 확인하세요';
  if (s.contains('PostgrestException')) return '서버가 거절했습니다';
  return s.length > 80 ? s.substring(0, 80) : s;
}
