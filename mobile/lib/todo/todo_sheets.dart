// 할 일 시트 — 빠른 입력(JARVIS todo_capture_sheet)·편집(todo_edit_sheet)·필터(todo_list_screen _FilterSheet)와 공용 입력 조각.
// AI는 제안만: "AI로 채우기"는 비어 있는 칸만 채우고 저장은 사용자가 누른다. 예정 시각은 KST 벽시계로 고르고 UTC로 저장한다.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/client.dart';
import '../app/theme.dart';
import '../assistant/assistant_voice.dart';
import '../gw/gw_models.dart' show kstOf;
import 'todo_model.dart';
import 'todo_store.dart';
import 'todo_widgets.dart';

Future<T?> _sheet<T>(BuildContext context, Widget child) => showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      constraints: const BoxConstraints(maxWidth: 600),
      backgroundColor: Brand.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (c) => Padding(padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(c).bottom), child: child),
    );

Widget _label(String s, {Widget? trailing}) => Padding(
      padding: const EdgeInsets.only(top: 14, bottom: 6),
      child: Row(children: [Text(s, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: Brand.muted)), if (trailing != null) ...[const SizedBox(width: 4), trailing]]),
    );

// ───────────────────────── 공용 입력 조각 ─────────────────────────

class UrgencyPicker extends StatelessWidget {
  const UrgencyPicker({super.key, required this.value, required this.onChanged});
  final TodoUrgency value;
  final ValueChanged<TodoUrgency> onChanged;
  @override
  Widget build(BuildContext context) => SegmentedButton<TodoUrgency>(
        showSelectedIcon: false,
        style: const ButtonStyle(visualDensity: VisualDensity.compact),
        segments: [for (final u in TodoUrgency.values) ButtonSegment(value: u, label: Text(u.label), icon: Icon(QuadrantSpec.urgency(u).icon, size: 15))],
        selected: {value},
        onSelectionChanged: (s) => onChanged(s.first),
      );
}

class PriorityPicker extends StatelessWidget {
  const PriorityPicker({super.key, required this.value, required this.onChanged});
  final TodoPriority value;
  final ValueChanged<TodoPriority> onChanged;
  @override
  Widget build(BuildContext context) => Wrap(spacing: 6, runSpacing: 6, children: [
        for (final p in TodoPriority.values)
          ChoiceChip(
            key: ValueKey('todo-priority-${p.code}'),
            label: Text('${p.short} ${p.label}'),
            selected: value == p,
            selectedColor: priorityColor(p).withValues(alpha: 0.18),
            side: BorderSide(color: value == p ? priorityColor(p) : Brand.line),
            onSelected: (_) => onChanged(p),
          ),
      ]);
}

/// 예상 시간 — 15·30·60·120분 + 없음 + 직접 입력(JARVIS estimate_time_chips).
class EstimateChips extends StatelessWidget {
  const EstimateChips({super.key, required this.value, required this.onChanged});
  final int? value;
  final ValueChanged<int?> onChanged;
  static const options = [15, 30, 60, 120];

  Future<void> _custom(BuildContext context) async {
    final c = TextEditingController(text: value != null && !options.contains(value) ? '$value' : '');
    final v = await showDialog<int>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('예상 소요 시간'),
        content: TextField(controller: c, autofocus: true, keyboardType: TextInputType.number, decoration: const InputDecoration(hintText: '예: 45', suffixText: '분'), onSubmitted: (s) => Navigator.pop(d, int.tryParse(s.trim()))),
        actions: [TextButton(onPressed: () => Navigator.pop(d), child: const Text('취소')), FilledButton(onPressed: () => Navigator.pop(d, int.tryParse(c.text.trim())), child: const Text('저장'))],
      ),
    );
    if (v != null && v > 0 && v <= 10080) onChanged(v);
  }

  @override
  Widget build(BuildContext context) => Wrap(spacing: 6, runSpacing: 6, children: [
        ChoiceChip(label: const Text('없음'), selected: value == null, onSelected: (_) => onChanged(null)),
        for (final m in options) ChoiceChip(label: Text(minutesLabel(m)), selected: value == m, onSelected: (_) => onChanged(m)),
        ChoiceChip(label: Text(value != null && !options.contains(value) ? minutesLabel(value!) : '직접 입력'), selected: value != null && !options.contains(value), onSelected: (_) => _custom(context)),
      ]);
}

/// 컨텍스트 태그 — 기본 태그 + 쓰던 태그 + 직접 추가(JARVIS context_tag_selector).
class TagSelector extends ConsumerWidget {
  const TagSelector({super.key, required this.value, required this.onChanged});
  final List<String> value;
  final ValueChanged<List<String>> onChanged;

  Future<void> _add(BuildContext context) async {
    final c = TextEditingController();
    final v = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('새 컨텍스트 태그'),
        content: TextField(controller: c, autofocus: true, decoration: const InputDecoration(hintText: '@태그명 (예: @car, @reading)'), onSubmitted: (s) => Navigator.pop(d, s)),
        actions: [TextButton(onPressed: () => Navigator.pop(d), child: const Text('취소')), FilledButton(onPressed: () => Navigator.pop(d, c.text), child: const Text('추가'))],
      ),
    );
    final t = v == null ? null : normalizeTag(v);
    if (t != null && !value.contains(t)) onChanged([...value, t]);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final used = usedTags(ref.watch(todosProvider).value ?? const []);
    final all = {...defaultContextTags, ...used, ...value}.toList();
    return Wrap(spacing: 6, runSpacing: 6, children: [
      for (final t in all)
        FilterChip(
          label: Text(t),
          selected: value.contains(t),
          onSelected: (on) => onChanged(on ? [...value, t] : [for (final x in value) if (x != t) x]),
        ),
      ActionChip(avatar: const Icon(Icons.add, size: 16), label: const Text('직접 추가'), onPressed: () => _add(context)),
    ]);
  }
}

/// 예정 시각 고르기 — 날짜 → 시각(KST). 시각을 건너뛰면 그날 09:00.
Future<DateTime?> pickSchedule(BuildContext context, DateTime? currentUtc) async {
  final now = kstOf(DateTime.now());
  final cur = currentUtc == null ? null : kstOf(currentUtc);
  final initial = cur == null ? DateTime(now.year, now.month, now.day) : DateTime(cur.year, cur.month, cur.day);
  final first = DateTime(now.year - 1), last = DateTime(now.year + 5);
  final d = await showDatePicker(
    context: context,
    initialDate: initial,
    firstDate: initial.isBefore(first) ? initial : first, // 오래된 예정 시각을 고칠 때 initialDate < firstDate 단언에 걸리지 않게
    lastDate: initial.isAfter(last) ? initial : last,
  );
  if (d == null || !context.mounted) return null;
  final t = await showTimePicker(context: context, initialTime: cur == null ? const TimeOfDay(hour: 9, minute: 0) : TimeOfDay(hour: cur.hour, minute: cur.minute));
  final tod = t ?? const TimeOfDay(hour: 9, minute: 0);
  return DateTime.utc(d.year, d.month, d.day, tod.hour, tod.minute).subtract(const Duration(hours: 9));
}

class ScheduleField extends StatelessWidget {
  const ScheduleField({super.key, required this.value, required this.onChanged});
  final DateTime? value;
  final ValueChanged<DateTime?> onChanged;
  @override
  Widget build(BuildContext context) => Row(children: [
        OutlinedButton.icon(
          onPressed: () async {
            final v = await pickSchedule(context, value);
            if (v != null) onChanged(v);
          },
          icon: const Icon(Icons.event_outlined, size: 17),
          label: Text(value == null ? '예정 시각 추가' : scheduleLabel(value!)),
        ),
        if (value != null) IconButton(tooltip: '예정 시각 지우기', onPressed: () => onChanged(null), icon: const Icon(Icons.close, size: 18)),
      ]);
}

// ───────────────────────── 빠른 입력 ─────────────────────────

/// 새 할 일 — 수집은 즉시, 분류는 나중에(기본 받은함). 2분 룰을 켜면 바로 완료로 저장.
Future<void> showTodoCapture(BuildContext context, {TodoUrgency urgency = TodoUrgency.inbox, TodoPriority? priority}) =>
    _sheet(context, _CaptureSheet(urgency: urgency, priority: priority));

class _CaptureSheet extends ConsumerStatefulWidget {
  const _CaptureSheet({required this.urgency, this.priority});
  final TodoUrgency urgency;
  final TodoPriority? priority;
  @override
  ConsumerState<_CaptureSheet> createState() => _CaptureSheetState();
}

class _CaptureSheetState extends ConsumerState<_CaptureSheet> {
  final _title = TextEditingController();
  late var _urgency = widget.urgency;
  late var _priority = widget.priority ?? TodoPriority.p3;
  int? _minutes;
  List<String> _tags = const [];
  DateTime? _scheduled;
  var _twoMinute = false, _more = false, _saving = false, _analyzing = false, _listening = false;
  late final VoiceInput _voice = ref.read(voiceInputProvider);

  @override
  void dispose() {
    if (_listening) _voice.stop();
    _title.dispose();
    super.dispose();
  }

  Future<void> _mic() async {
    if (_listening) {
      await _voice.stop();
      if (mounted) setState(() => _listening = false);
      return;
    }
    final ok = await _voice.start((text, done) {
      if (!mounted) return;
      _title.text = text;
      _title.selection = TextSelection.collapsed(offset: text.length);
      if (done) setState(() => _listening = false);
    }, () {
      if (mounted) setState(() => _listening = false);
    });
    if (!mounted) return;
    if (!ok) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('음성 인식을 쓸 수 없습니다. 마이크 권한을 확인하세요.')));
      return;
    }
    setState(() => _listening = true);
  }

  /// AI 분석 — 제목은 정리된 것으로 바꾸고, 나머지는 아직 안 고른 칸만 채운다(JARVIS non-destructive merge).
  Future<void> _analyze() async {
    final text = _title.text.trim();
    if (text.isEmpty || _analyzing) return;
    setState(() => _analyzing = true);
    try {
      final a = TodoAnalysis.fromJson(await ref.read(todoStoreProvider).analyze(text));
      if (!mounted) return;
      setState(() {
        if (a.title.isNotEmpty) _title.text = a.title;
        if (_scheduled == null && a.scheduledFor != null) {
          _scheduled = a.scheduledFor;
          if (_urgency == TodoUrgency.inbox) _urgency = TodoUrgency.scheduled;
        }
        _minutes ??= a.estimatedMinutes;
        if (widget.priority == null && _priority == TodoPriority.p3) _priority = a.priority;
        if (_tags.isEmpty) _tags = a.contextTags;
        _more = true;
      });
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'AI 분석에 실패했습니다')));
    } finally {
      if (mounted) setState(() => _analyzing = false);
    }
  }

  Future<void> _save() async {
    final title = _title.text.trim();
    if (title.isEmpty || _saving) return;
    setState(() => _saving = true);
    try {
      await ref.read(todosProvider.notifier).add(Todo(
            id: '',
            title: title,
            state: _twoMinute ? TodoState.done : TodoState.inProgress,
            urgency: _scheduled != null && _urgency == TodoUrgency.inbox ? TodoUrgency.scheduled : _urgency,
            priority: _priority,
            estimatedMinutes: _minutes,
            scheduledFor: _scheduled,
            contextTags: _tags,
          ));
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('저장 실패: ${todoErrorText(e)}')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final ai = ref.watch(todoAiEnabledProvider).value ?? false;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
        Text('새 할 일', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Brand.navy)),
        const SizedBox(height: 10),
        TextField(
          key: const ValueKey('todo-capture-title'),
          controller: _title,
          autofocus: true,
          maxLength: 400,
          minLines: 1,
          maxLines: 3,
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _save(),
          decoration: InputDecoration(
            hintText: _listening ? '듣는 중…' : '무엇을 해야 하나요? (예: 내일 오후 3시 김부장님께 보고서 보내기)',
            border: const OutlineInputBorder(),
            counterText: '',
            suffixIcon: IconButton(tooltip: _listening ? '그만 듣기' : '말로 입력', onPressed: _mic, icon: Icon(_listening ? Icons.stop_circle_outlined : Icons.mic_none_rounded, color: _listening ? Brand.danger : null)),
          ),
        ),
        if (_scheduled != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Row(children: [
              const Icon(Icons.event, size: 15, color: Color(0xFF8B5CF6)),
              const SizedBox(width: 4),
              Text('예정 ${scheduleLabel(_scheduled!)}', style: const TextStyle(fontSize: 12, color: Color(0xFF8B5CF6), fontWeight: FontWeight.w700)),
              const SizedBox(width: 4),
              InkWell(onTap: () => setState(() => _scheduled = null), child: Icon(Icons.close, size: 15, color: Brand.muted)),
            ]),
          ),
        if (ai)
          Align(
            alignment: Alignment.centerLeft,
            child: Padding(
              padding: const EdgeInsets.only(top: 8),
              child: OutlinedButton.icon(
                key: const ValueKey('todo-capture-ai'),
                onPressed: _analyzing ? null : _analyze,
                icon: _analyzing ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.auto_awesome, size: 17),
                label: Text(_analyzing ? '분석 중…' : 'AI로 채우기 (날짜·우선순위·시간·태그)'),
              ),
            ),
          ),
        _label('분류'),
        SingleChildScrollView(scrollDirection: Axis.horizontal, child: UrgencyPicker(value: _urgency, onChanged: (u) => setState(() => _urgency = u))),
        CheckboxListTile(
          key: const ValueKey('todo-capture-two-minute'),
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          value: _twoMinute,
          onChanged: (v) => setState(() => _twoMinute = v ?? false),
          title: const Text('지금 바로 끝낼 일 (2분 룰)'),
          subtitle: const Text('2분 안에 끝나면 바로 하고 완료로 기록해요'),
        ),
        InkWell(
          onTap: () => setState(() => _more = !_more),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(children: [
              Icon(_more ? Icons.expand_less : Icons.expand_more, size: 20, color: Brand.muted),
              const SizedBox(width: 4),
              Text('세부 옵션 (우선순위·예상 시간·태그·예정 시각)', style: TextStyle(color: Brand.muted, fontWeight: FontWeight.w700, fontSize: 13)),
            ]),
          ),
        ),
        if (_more) ...[
          _label('우선순위'),
          PriorityPicker(value: _priority, onChanged: (p) => setState(() => _priority = p)),
          _label('예상 소요 시간'),
          EstimateChips(value: _minutes, onChanged: (v) => setState(() => _minutes = v)),
          _label('컨텍스트', trailing: const Tooltip(message: '이 일을 할 수 있는 장소·도구·상태 — 예) @office 사무실, @computer 컴퓨터 앞, @phone 통화, @waiting 답 대기', child: Icon(Icons.info_outline, size: 15))),
          TagSelector(value: _tags, onChanged: (v) => setState(() => _tags = v)),
          _label('예정 시각'),
          ScheduleField(value: _scheduled, onChanged: (v) => setState(() => _scheduled = v)),
        ],
        const SizedBox(height: 14),
        Row(children: [
          Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('취소'))),
          const SizedBox(width: 10),
          Expanded(
            child: FilledButton(
              key: const ValueKey('todo-capture-save'),
              onPressed: _saving ? null : _save,
              child: Text(_twoMinute ? '완료로 저장' : '저장'),
            ),
          ),
        ]),
      ]),
    );
  }
}

// ───────────────────────── 편집 ─────────────────────────

Future<void> showTodoEdit(BuildContext context, Todo todo) => _sheet(context, _EditSheet(todo: todo));

class _EditSheet extends ConsumerStatefulWidget {
  const _EditSheet({required this.todo});
  final Todo todo;
  @override
  ConsumerState<_EditSheet> createState() => _EditSheetState();
}

class _EditSheetState extends ConsumerState<_EditSheet> {
  late final _title = TextEditingController(text: widget.todo.title);
  late final _notes = TextEditingController(text: widget.todo.notes ?? '');
  late var _urgency = widget.todo.urgency;
  late var _priority = widget.todo.priority;
  late int? _minutes = widget.todo.estimatedMinutes;
  late List<String> _tags = widget.todo.contextTags;
  late DateTime? _scheduled = widget.todo.scheduledFor;
  late String? _project = widget.todo.projectId;
  var _saving = false;

  @override
  void dispose() {
    _title.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() f) async {
    if (_saving) return;
    setState(() => _saving = true);
    try {
      await f();
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('저장 실패: ${todoErrorText(e)}')));
      }
    }
  }

  Todo _draft({TodoState? state}) => widget.todo.copyWith(
        title: _title.text.trim(),
        notes: () => _notes.text.trim().isEmpty ? null : _notes.text.trim(),
        urgency: _urgency,
        priority: _priority,
        estimatedMinutes: () => _minutes,
        contextTags: _tags,
        scheduledFor: () => _scheduled,
        projectId: () => _project,
        state: state,
      );

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('할 일을 지울까요?'),
        content: const Text('완료와 달리 기록이 남지 않고 완전히 지워집니다.'),
        actions: [TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('취소')), FilledButton(style: FilledButton.styleFrom(backgroundColor: Brand.danger), onPressed: () => Navigator.pop(d, true), child: const Text('지우기'))],
      ),
    );
    if (ok == true) await _run(() => ref.read(todosProvider.notifier).delete(widget.todo));
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.todo;
    final projects = [for (final p in ref.watch(todoProjectsProvider).value ?? const <TodoProject>[]) if (!p.archived || p.id == _project) p];
    final n = ref.read(todosProvider.notifier);
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
        Row(children: [
          Expanded(child: Text('할 일 편집', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Brand.navy))),
          if (t.migrationCount > 0) Chip(visualDensity: VisualDensity.compact, label: Text('${t.migrationCount}회 이월'), backgroundColor: t.isStale ? const Color(0xFFFFF3C4) : null),
          IconButton(tooltip: '지우기', onPressed: _saving ? null : _delete, icon: const Icon(Icons.delete_outline)),
        ]),
        if (t.isStale)
          Container(
            margin: const EdgeInsets.only(top: 4, bottom: 4),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: const Color(0xFFFFF3C4).withValues(alpha: Brand.brightness == Brightness.dark ? 0.15 : 1), borderRadius: BorderRadius.circular(10)),
            child: Text('${t.migrationCount}번 이월된 할 일이에요. 오늘 꼭 할지, 아니면 취소할지 정해볼까요?', style: const TextStyle(fontSize: 12.5, color: Color(0xFF8A5A00))),
          ),
        const SizedBox(height: 8),
        TextField(key: const ValueKey('todo-edit-title'), controller: _title, maxLength: 500, minLines: 1, maxLines: 3, decoration: const InputDecoration(labelText: '제목', border: OutlineInputBorder(), counterText: '')),
        const SizedBox(height: 10),
        TextField(controller: _notes, maxLength: 5000, minLines: 2, maxLines: 6, decoration: const InputDecoration(labelText: '메모', border: OutlineInputBorder(), counterText: '')),
        _label('분류'),
        SingleChildScrollView(scrollDirection: Axis.horizontal, child: UrgencyPicker(value: _urgency, onChanged: (u) => setState(() => _urgency = u))),
        _label('우선순위'),
        PriorityPicker(value: _priority, onChanged: (p) => setState(() => _priority = p)),
        _label('예상 소요 시간'),
        EstimateChips(value: _minutes, onChanged: (v) => setState(() => _minutes = v)),
        _label('컨텍스트'),
        TagSelector(value: _tags, onChanged: (v) => setState(() => _tags = v)),
        _label('예정 시각'),
        ScheduleField(value: _scheduled, onChanged: (v) => setState(() => _scheduled = v)),
        _label('프로젝트'),
        DropdownButtonFormField<String?>(
          key: const ValueKey('todo-edit-project'),
          initialValue: _project,
          isExpanded: true,
          decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true),
          items: [
            const DropdownMenuItem<String?>(value: null, child: Text('없음')),
            for (final p in projects) DropdownMenuItem<String?>(value: p.id, child: Text(p.archived ? '${p.title} (보관됨)' : p.title, overflow: TextOverflow.ellipsis)),
            if (_project != null && !projects.any((p) => p.id == _project)) DropdownMenuItem<String?>(value: _project, child: const Text('알 수 없는 프로젝트')),
          ],
          onChanged: (v) => setState(() => _project = v),
        ),
        const SizedBox(height: 16),
        Row(children: [
          if (t.isOpen) ...[
            Expanded(child: OutlinedButton.icon(onPressed: _saving ? null : () => _run(() => n.save(_draft(state: TodoState.cancelled))), icon: const Icon(Icons.block, size: 17), label: const Text('취소 처리'))),
            const SizedBox(width: 8),
            Expanded(child: OutlinedButton.icon(key: const ValueKey('todo-edit-done'), onPressed: _saving ? null : () => _run(() => n.save(_draft(state: TodoState.done))), icon: const Icon(Icons.check, size: 17), label: const Text('완료'))),
          ] else
            Expanded(child: OutlinedButton.icon(onPressed: _saving ? null : () => _run(() => n.save(_draft(state: TodoState.inProgress))), icon: const Icon(Icons.replay, size: 17), label: const Text('다시 진행'))),
          const SizedBox(width: 8),
          Expanded(
            child: FilledButton(
              key: const ValueKey('todo-edit-save'),
              onPressed: _saving ? null : () => _title.text.trim().isEmpty ? null : _run(() => n.save(_draft())),
              child: const Text('저장'),
            ),
          ),
        ]),
      ]),
    );
  }
}

// ───────────────────────── 필터 ─────────────────────────

Future<TodoFilter?> showTodoFilter(BuildContext context, TodoFilter current) => _sheet(context, _FilterSheet(current: current));

class _FilterSheet extends ConsumerStatefulWidget {
  const _FilterSheet({required this.current});
  final TodoFilter current;
  @override
  ConsumerState<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends ConsumerState<_FilterSheet> {
  late final _states = {...widget.current.states};
  late final _tags = {...widget.current.tags};

  @override
  Widget build(BuildContext context) {
    final tags = {...usedTags(ref.watch(todosProvider).value ?? const []), ..._tags}.toList();
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
        Text('필터', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Brand.navy)),
        Text('상태와 태그로 좁혀서 볼 수 있어요', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
        _label('상태'),
        Wrap(spacing: 6, children: [
          for (final s in TodoState.values)
            FilterChip(
              key: ValueKey('todo-filter-${s.code}'),
              label: Text(s.label),
              selected: _states.contains(s),
              onSelected: (on) => setState(() => on ? _states.add(s) : _states.remove(s)),
            ),
        ]),
        _label('태그'),
        if (tags.isEmpty) Text('아직 태그를 쓴 할 일이 없어요', style: TextStyle(color: Brand.muted, fontSize: 12.5)),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final t in tags) FilterChip(label: Text(t), selected: _tags.contains(t), onSelected: (on) => setState(() => on ? _tags.add(t) : _tags.remove(t))),
        ]),
        const SizedBox(height: 16),
        Row(children: [
          Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(context, const TodoFilter()), child: const Text('초기화'))),
          const SizedBox(width: 10),
          Expanded(
            child: FilledButton(
              key: const ValueKey('todo-filter-apply'),
              onPressed: () => Navigator.pop(context, TodoFilter(states: _states, tags: _tags)),
              child: Text(_tags.isEmpty ? '적용' : '${_tags.length}개 태그로 적용'),
            ),
          ),
        ]),
      ]),
    );
  }
}
