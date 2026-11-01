// 할 일 화면 — 시급도 매트릭스(/todo, JARVIS todo_list_screen)·아이젠하워 매트릭스(/todo/matrix)·프로젝트(/todo/projects)·주간 리뷰(/todo/review).
// 분면 사이 끌어 놓기 = 분류(urgency) 또는 우선순위(priority) 변경. 데스크톱 홈 위젯은 [TodoMatrixPanel]을 그대로 쓴다.
import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import '../auth/session.dart';
import '../gw/gw_models.dart' show kstOf;
import '../more/catalog.dart';
import 'todo_migration.dart';
import 'todo_model.dart';
import 'todo_sheets.dart';
import 'todo_store.dart';
import 'todo_widgets.dart';

/// 페이지 권한(todo)이 없으면 화면 대신 안내 — 즐겨찾기·주소로 들어와도. 데이터는 RLS가 같은 권한으로 막는다.
class TodoGate extends ConsumerWidget {
  const TodoGate({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider).asData?.value;
    if (s != null && canUsePage(s, todoEntry)) return child;
    return Scaffold(
      appBar: const BrandHeader(title: '할 일', showBack: true),
      body: Center(child: Text(s == null ? '로그인이 필요합니다' : '할 일을 쓸 권한이 없습니다. 관리자에게 문의하세요.', style: TextStyle(color: Brand.muted))),
    );
  }
}

/// 두 매트릭스가 함께 쓰는 필터(상태·태그).
class TodoFilterNotifier extends Notifier<TodoFilter> {
  @override
  TodoFilter build() => const TodoFilter();
  void set(TodoFilter f) => state = f;
}

final todoFilterProvider = NotifierProvider<TodoFilterNotifier, TodoFilter>(TodoFilterNotifier.new);

enum TodoMatrixKind { urgency, priority }

/// 매트릭스 본문 — 2×2 분면. 화면과 데스크톱 홈 위젯이 함께 쓴다.
class TodoMatrixPanel extends ConsumerWidget {
  const TodoMatrixPanel({super.key, this.kind = TodoMatrixKind.urgency, this.dense = false});
  final TodoMatrixKind kind;
  final bool dense;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(todosProvider);
    final filter = ref.watch(todoFilterProvider);
    ref.watch(todoProjectsProvider); // 줄의 프로젝트 배지
    final todos = data.value;
    if (todos == null) {
      return data.hasError
          ? Center(child: TextButton(onPressed: () => ref.invalidate(todosProvider), child: Text('할 일을 불러오지 못했습니다 · 다시 시도\n${todoErrorText(data.error!)}', textAlign: TextAlign.center)))
          : const Center(child: CircularProgressIndicator());
    }
    final n = ref.read(todosProvider.notifier);
    void open(Todo t) => showTodoEdit(context, t);
    final gap = dense ? 6.0 : 8.0;
    if (kind == TodoMatrixKind.urgency) {
      final b = byUrgency(todos, filter);
      return QuadrantGrid(gap: gap, cells: [
        for (final u in TodoUrgency.values)
          TodoQuadrant(
            spec: QuadrantSpec.urgency(u),
            todos: b[u]!,
            dense: dense,
            accepts: (t) => t.urgency != u,
            onDrop: (t) => todoGuard(context, () => n.setUrgency(t, u)),
            onOpen: open,
          ),
      ]);
    }
    final b = byPriority(todos, filter);
    return QuadrantGrid(gap: gap, cells: [
      for (final p in TodoPriority.values)
        TodoQuadrant(
          spec: QuadrantSpec.priority(p),
          todos: b[p]!,
          dense: dense,
          badge: TodoRowBadge.urgency,
          accepts: (t) => t.priority != p,
          onDrop: (t) => todoGuard(context, () => n.setPriority(t, p)),
          onOpen: open,
        ),
    ]);
  }
}

class _FilterButton extends ConsumerWidget {
  const _FilterButton();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final f = ref.watch(todoFilterProvider);
    return Badge(
      isLabelVisible: !f.isDefault,
      smallSize: 8,
      child: SquareIconButton(
        icon: Icons.filter_list_rounded,
        tooltip: f.isDefault ? '필터' : '필터 (적용 중)',
        onPressed: () async {
          final r = await showTodoFilter(context, f);
          if (r != null) ref.read(todoFilterProvider.notifier).set(r);
        },
      ),
    );
  }
}

Future<void> _refresh(WidgetRef ref) async {
  ref.invalidate(todosProvider);
  ref.invalidate(todoProjectsProvider);
  await ref.read(todosProvider.future).catchError((_) => const <Todo>[]);
}

/// 필터가 기본값이 아니면 무엇으로 거르는지 한 줄(해제 버튼).
class _FilterBar extends ConsumerWidget {
  const _FilterBar();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final f = ref.watch(todoFilterProvider);
    if (f.isDefault) return const SizedBox.shrink();
    final parts = [if (!(f.states.length == 1 && f.states.contains(TodoState.inProgress))) f.states.map((s) => s.label).join('·'), if (f.tags.isNotEmpty) f.tags.join(' ')];
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
      child: Row(children: [
        Icon(Icons.filter_alt_outlined, size: 15, color: Brand.blue),
        const SizedBox(width: 4),
        Expanded(child: Text('필터: ${parts.join(' · ')}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: Brand.blue, fontWeight: FontWeight.w700))),
        TextButton(onPressed: () => ref.read(todoFilterProvider.notifier).set(const TodoFilter()), child: const Text('해제')),
      ]),
    );
  }
}

class _MatrixScaffold extends ConsumerStatefulWidget {
  const _MatrixScaffold({required this.kind});
  final TodoMatrixKind kind;
  @override
  ConsumerState<_MatrixScaffold> createState() => _MatrixScaffoldState();
}

class _MatrixScaffoldState extends ConsumerState<_MatrixScaffold> {
  @override
  void initState() {
    super.initState();
    // 들어올 때마다 다시 읽는다(다른 기기·이노봇이 바꿨을 수 있음) + 어제 남은 '오늘' 할 일 묻기
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.invalidate(todosProvider);
      ref.invalidate(todoProjectsProvider);
      maybeShowTodoMigration(context, ref);
    });
  }

  @override
  Widget build(BuildContext context) {
    final urgency = widget.kind == TodoMatrixKind.urgency;
    final desktop = MediaQuery.sizeOf(context).width >= 720;
    return Scaffold(
      appBar: BrandHeader(
        title: urgency ? '할 일' : '아이젠하워 매트릭스',
        showBack: true,
        favoritePath: urgency ? '/todo' : '/todo/matrix',
        onRefresh: () => _refresh(ref),
        actions: [
          const _FilterButton(),
          if (urgency) SquareIconButton(icon: Icons.grid_view_rounded, tooltip: '아이젠하워 매트릭스', onPressed: () => context.push('/todo/matrix')),
          if (!urgency) SquareIconButton(icon: Icons.view_quilt_outlined, tooltip: '할 일(분류별)', onPressed: () => context.go('/todo')),
          SquareIconButton(icon: Icons.folder_outlined, tooltip: '프로젝트', onPressed: () => context.push('/todo/projects')),
          if (desktop) SquareIconButton(icon: Icons.insights_outlined, tooltip: '주간 리뷰', onPressed: () => context.push('/todo/review')),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        key: const ValueKey('todo-add'),
        heroTag: 'todo-add',
        tooltip: '새 할 일',
        onPressed: () => showTodoCapture(context),
        child: const Icon(Icons.add),
      ),
      body: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Row(children: [
            Expanded(
              child: Text(
                urgency
                    ? '${desktop ? '끌어서' : '길게 눌러'} 다른 칸으로 옮기면 분류가 바뀝니다. 새 할 일은 받은함으로 — 분류는 나중에.'
                    : '${desktop ? '끌어서' : '길게 눌러'} 다른 칸으로 옮기면 우선순위가 바뀝니다. 긴급·중요도로 지금 할 일을 고르세요.',
                style: TextStyle(fontSize: 12, color: Brand.muted),
              ),
            ),
            if (!desktop) TextButton.icon(onPressed: () => context.push('/todo/review'), icon: const Icon(Icons.insights_outlined, size: 16), label: const Text('주간 리뷰')),
          ]),
        ),
        const StaleBanner(),
        const _FilterBar(),
        Expanded(child: Padding(padding: const EdgeInsets.fromLTRB(12, 0, 12, 84), child: TodoMatrixPanel(kind: widget.kind))),
      ]),
    );
  }
}

class TodoScreen extends StatelessWidget {
  const TodoScreen({super.key});
  @override
  Widget build(BuildContext context) => const _MatrixScaffold(kind: TodoMatrixKind.urgency);
}

class PriorityMatrixScreen extends StatelessWidget {
  const PriorityMatrixScreen({super.key});
  @override
  Widget build(BuildContext context) => const _MatrixScaffold(kind: TodoMatrixKind.priority);
}

/// 데스크톱 홈 위젯 — 시급도 매트릭스 + 머리줄(새로 추가·전체 화면).
class TodoDashboardCard extends ConsumerWidget {
  const TodoDashboardCard({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          const Expanded(child: WidgetTitle('할 일')),
          IconButton(tooltip: '새 할 일', visualDensity: VisualDensity.compact, onPressed: () => showTodoCapture(context), icon: const Icon(Icons.add, size: 20)),
          IconButton(tooltip: '전체 화면', visualDensity: VisualDensity.compact, onPressed: () => context.push('/todo'), icon: const Icon(Icons.open_in_full, size: 18)),
        ]),
        const SizedBox(height: 4),
        const Expanded(child: TodoMatrixPanel(dense: true)),
      ]);
}

// ───────────────────────── 프로젝트 ─────────────────────────

class TodoProjectsScreen extends ConsumerStatefulWidget {
  const TodoProjectsScreen({super.key});
  @override
  ConsumerState<TodoProjectsScreen> createState() => _TodoProjectsScreenState();
}

class _TodoProjectsScreenState extends ConsumerState<TodoProjectsScreen> {
  var _showArchived = false;

  @override
  Widget build(BuildContext context) {
    final data = ref.watch(todoProjectsProvider);
    final todos = ref.watch(todosProvider).value ?? const <Todo>[];
    return Scaffold(
      appBar: BrandHeader(title: '프로젝트', showBack: true, onRefresh: () => _refresh(ref)),
      floatingActionButton: FloatingActionButton.extended(heroTag: 'todo-project-add', onPressed: () => context.push('/todo/projects/new'), icon: const Icon(Icons.add), label: const Text('새 프로젝트')),
      body: data.when(
        skipLoadingOnRefresh: true,
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: TextButton(onPressed: () => ref.invalidate(todoProjectsProvider), child: Text('프로젝트를 불러오지 못했습니다 · 다시 시도\n${todoErrorText(e)}', textAlign: TextAlign.center))),
        data: (all) {
          final active = [for (final p in all) if (!p.archived) p], archived = [for (final p in all) if (p.archived) p];
          Widget tile(TodoProject p) {
            final mine = [for (final t in todos) if (t.projectId == p.id) t];
            final open = mine.where((t) => t.isOpen).length;
            return Card(
              child: ListTile(
                key: ValueKey('todo-project-${p.id}'),
                leading: Icon(p.archived ? Icons.inventory_2_outlined : Icons.folder_rounded, color: p.archived ? Brand.faint : Brand.blue),
                title: Text(p.title, style: TextStyle(fontWeight: FontWeight.w700, color: Brand.navy)),
                subtitle: p.outcome == null || p.outcome!.isEmpty ? null : Text(p.outcome!, maxLines: 2, overflow: TextOverflow.ellipsis),
                trailing: Text('진행 $open', style: TextStyle(fontWeight: FontWeight.w800, color: open > 0 ? Brand.blue : Brand.faint)),
                onTap: () => context.push('/todo/projects/${p.id}'),
              ),
            );
          }

          return ListView(padding: const EdgeInsets.fromLTRB(16, 0, 16, 96), children: [
            Text('여러 할 일을 결과(목표) 단위로 묶어 보세요. 할 일이 2개 이상 필요한 결과물이면 프로젝트입니다.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
            const SizedBox(height: 10),
            CountTitle('진행 중', active.length),
            const SizedBox(height: 6),
            if (active.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Center(child: Text('아직 프로젝트가 없어요', style: TextStyle(color: Brand.muted)))),
            for (final p in active) tile(p),
            const SizedBox(height: 12),
            InkWell(
              onTap: () => setState(() => _showArchived = !_showArchived),
              child: Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Row(children: [Icon(_showArchived ? Icons.expand_less : Icons.expand_more, color: Brand.muted), const SizedBox(width: 4), CountTitle('보관됨', archived.length)])),
            ),
            if (_showArchived) ...[
              if (archived.isEmpty) Padding(padding: const EdgeInsets.all(16), child: Text('보관된 프로젝트가 없어요', style: TextStyle(color: Brand.muted))),
              for (final p in archived) tile(p),
            ],
          ]);
        },
      ),
    );
  }
}

/// 프로젝트 만들기·편집 — 제목·결과·보관, 편집 땐 할 일 넣고 빼기(누르면 바로 반영, JARVIS _AssignSection).
class TodoProjectEditScreen extends ConsumerStatefulWidget {
  const TodoProjectEditScreen({super.key, this.projectId});
  final String? projectId;
  @override
  ConsumerState<TodoProjectEditScreen> createState() => _TodoProjectEditScreenState();
}

class _TodoProjectEditScreenState extends ConsumerState<TodoProjectEditScreen> {
  final _title = TextEditingController(), _outcome = TextEditingController();
  var _status = TodoProjectStatus.active;
  var _loaded = false, _saving = false;

  @override
  void dispose() {
    _title.dispose();
    _outcome.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final title = _title.text.trim();
    if (title.isEmpty || _saving) return;
    setState(() => _saving = true);
    final n = ref.read(todoProjectsProvider.notifier);
    final outcome = _outcome.text.trim().isEmpty ? null : _outcome.text.trim();
    try {
      if (widget.projectId == null) {
        final p = await n.add(title, outcome);
        if (mounted) context.pushReplacement('/todo/projects/${p.id}');
      } else {
        await n.save(widget.projectId!, title: title, outcome: outcome, status: _status);
        if (mounted) Navigator.of(context).maybePop();
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('저장 실패: ${todoErrorText(e)}')));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('프로젝트를 지울까요?'),
        content: const Text('프로젝트에 묶인 할 일은 지워지지 않고 프로젝트 없음으로 남습니다.'),
        actions: [TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('취소')), FilledButton(style: FilledButton.styleFrom(backgroundColor: Brand.danger), onPressed: () => Navigator.pop(d, true), child: const Text('지우기'))],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(todoProjectsProvider.notifier).delete(widget.projectId!);
      if (mounted) Navigator.of(context).maybePop();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('지우지 못했습니다: ${todoErrorText(e)}')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final projects = ref.watch(todoProjectsProvider);
    final id = widget.projectId;
    final project = id == null ? null : projects.value?.where((p) => p.id == id).firstOrNull;
    if (!_loaded && project != null) {
      _loaded = true;
      _title.text = project.title;
      _outcome.text = project.outcome ?? '';
      _status = project.status;
    }
    if (id != null && project == null) {
      return Scaffold(
        appBar: const BrandHeader(title: '프로젝트', showBack: true),
        body: Center(child: projects.isLoading ? const CircularProgressIndicator() : Text('프로젝트를 찾지 못했습니다', style: TextStyle(color: Brand.muted))),
      );
    }
    return Scaffold(
      appBar: BrandHeader(title: id == null ? '새 프로젝트' : '프로젝트 편집', showBack: true, actions: [if (id != null) SquareIconButton(icon: Icons.delete_outline, tooltip: '지우기', onPressed: _delete)]),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 0, 16, 32), children: [
        TextField(key: const ValueKey('todo-project-title'), controller: _title, maxLength: 200, decoration: const InputDecoration(labelText: '프로젝트 이름', border: OutlineInputBorder(), counterText: '')),
        const SizedBox(height: 10),
        TextField(controller: _outcome, maxLength: 2000, minLines: 2, maxLines: 4, decoration: const InputDecoration(labelText: '원하는 결과 (끝나면 무엇이 되어 있나요?)', border: OutlineInputBorder(), counterText: '')),
        if (id != null) ...[
          const SizedBox(height: 12),
          SegmentedButton<TodoProjectStatus>(
            showSelectedIcon: false,
            segments: const [ButtonSegment(value: TodoProjectStatus.active, label: Text('진행 중')), ButtonSegment(value: TodoProjectStatus.archived, label: Text('보관'))],
            selected: {_status},
            onSelectionChanged: (s) => setState(() => _status = s.first),
          ),
        ],
        const SizedBox(height: 12),
        FilledButton(key: const ValueKey('todo-project-save'), onPressed: _saving ? null : _save, child: Text(id == null ? '만들기' : '저장')),
        if (id != null) ...[const SizedBox(height: 20), _AssignSection(projectId: id)],
      ]),
    );
  }
}

class _AssignSection extends ConsumerWidget {
  const _AssignSection({required this.projectId});
  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final todos = [for (final t in ref.watch(todosProvider).value ?? const <Todo>[]) if (t.isOpen) t];
    final mine = [for (final t in todos) if (t.projectId == projectId) t], others = [for (final t in todos) if (t.projectId != projectId) t];
    final n = ref.read(todosProvider.notifier);
    Widget column(String title, List<Todo> list, bool add) => Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            CountTitle(title, list.length),
            const SizedBox(height: 6),
            Container(
              constraints: const BoxConstraints(minHeight: 80, maxHeight: 360),
              decoration: BoxDecoration(color: Brand.surface, border: Border.all(color: Brand.line), borderRadius: BorderRadius.circular(12)),
              child: list.isEmpty
                  ? Center(child: Padding(padding: const EdgeInsets.all(16), child: Text(add ? '추가할 항목이 없어요' : '아직 비어 있어요', style: TextStyle(color: Brand.muted, fontSize: 12.5))))
                  : ListView(shrinkWrap: true, children: [
                      for (final t in list)
                        ListTile(
                          dense: true,
                          key: ValueKey('todo-assign-${t.id}'),
                          title: Text(t.title, maxLines: 2, overflow: TextOverflow.ellipsis),
                          subtitle: Text(t.urgency.label),
                          trailing: Icon(add ? Icons.add_circle_outline : Icons.remove_circle_outline, color: add ? Brand.blue : Brand.danger, size: 20),
                          onTap: () => todoGuard(context, () => n.save(t.copyWith(projectId: () => add ? projectId : null))),
                        ),
                    ]),
            ),
          ]),
        );
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('할 일 넣고 빼기', style: TextStyle(fontWeight: FontWeight.w800, color: Brand.navy)),
      Text('누르면 바로 옮겨집니다(진행 중인 할 일만).', style: TextStyle(fontSize: 12, color: Brand.muted)),
      const SizedBox(height: 8),
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [column('다른 할 일', others, true), const SizedBox(width: 10), column('이 프로젝트', mine, false)]),
    ]);
  }
}

// ───────────────────────── 주간 리뷰 ─────────────────────────

class TodoReviewScreen extends ConsumerWidget {
  const TodoReviewScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(todoReviewProvider);
    return Scaffold(
      appBar: BrandHeader(title: '주간 리뷰', showBack: true, onRefresh: () => ref.invalidate(todoReviewProvider)),
      body: data.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: TextButton(onPressed: () => ref.invalidate(todoReviewProvider), child: Text('리뷰를 불러오지 못했습니다 · 다시 시도\n${todoErrorText(e)}', textAlign: TextAlign.center))),
        data: (r) {
          if (r == null) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.insights_outlined, size: 40, color: Brand.faint),
                  const SizedBox(height: 10),
                  Text('아직 리뷰가 없어요', style: TextStyle(fontWeight: FontWeight.w800, color: Brand.navy)),
                  const SizedBox(height: 4),
                  Text('매주 일요일 오후 6시(KST)에 한 주의 할 일을 돌아보는 리뷰를 만들어 드려요.\n그 주에 할 일을 쓴 기록이 있어야 만들어집니다.', textAlign: TextAlign.center, style: TextStyle(color: Brand.muted, fontSize: 12.5)),
                ]),
              ),
            );
          }
          final s = r.stats;
          final k = kstOf(r.runAt);
          final byP = s['by_priority'] is Map ? s['by_priority'] as Map : const {};
          final tags = [for (final t in (s['top_tags'] as List? ?? const [])) '$t'];
          final carry = [for (final t in (s['carryover_titles'] as List? ?? const [])) '$t'];
          Widget stat(String label, Object? v, Color c) => Expanded(
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Column(children: [
                      Text('${v ?? 0}', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: c)),
                      Text(label, style: TextStyle(fontSize: 12, color: Brand.muted)),
                    ]),
                  ),
                ),
              );
          return ListView(padding: const EdgeInsets.fromLTRB(16, 0, 16, 32), children: [
            Text('${k.month}월 ${k.day}일 ${k.hour.toString().padLeft(2, '0')}:${k.minute.toString().padLeft(2, '0')} (KST) 리뷰 · 다음 리뷰: 일요일 18:00', style: TextStyle(fontSize: 12, color: Brand.muted)),
            const SizedBox(height: 10),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: r.summary.trim().isEmpty
                    ? Text('이번 주에는 리뷰할 활동이 충분하지 않았어요.', style: TextStyle(color: Brand.muted))
                    : MarkdownBody(data: r.summary, styleSheet: MarkdownStyleSheet(p: TextStyle(fontSize: 14.5, height: 1.6, color: Brand.navy), listBullet: TextStyle(fontSize: 14.5, color: Brand.navy))),
              ),
            ),
            const SizedBox(height: 12),
            Text('한 주 요약', style: TextStyle(fontWeight: FontWeight.w800, color: Brand.navy)),
            const SizedBox(height: 6),
            Row(children: [stat('완료', s['done'], Brand.success), stat('진행 중', s['open'], Brand.blue), stat('이월', s['migrated'], const Color(0xFFD97706))]),
            const SizedBox(height: 12),
            Text('완료 우선순위 분포', style: TextStyle(fontWeight: FontWeight.w800, color: Brand.navy)),
            const SizedBox(height: 6),
            Wrap(spacing: 6, children: [for (final p in TodoPriority.values) Chip(label: Text('${p.short} ${byP[p.code] ?? 0}'), side: BorderSide(color: priorityColor(p)))]),
            if (tags.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text('자주 나온 태그', style: TextStyle(fontWeight: FontWeight.w800, color: Brand.navy)),
              const SizedBox(height: 6),
              Wrap(spacing: 6, children: [for (final t in tags) Chip(label: Text(t))]),
            ],
            if (carry.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text('이월 중인 항목', style: TextStyle(fontWeight: FontWeight.w800, color: Brand.navy)),
              for (final t in carry) ListTile(dense: true, contentPadding: EdgeInsets.zero, leading: const Icon(Icons.redo, size: 18, color: Color(0xFFD97706)), title: Text(t)),
            ],
          ]);
        },
      ),
    );
  }
}
