// 할 일(TODO) — JARVIS lib/features/todo 포팅. 순수 모델·로직만(위젯·네트워크 없음). 표 docs/sql/2026-11-02-todos.sql.
// 두 축: state(진행 중·완료·취소)와 urgency(오늘·받은함·예정·언젠가 = 시급도 매트릭스), 별도로 priority(p1~p4 = 아이젠하워 매트릭스).
import '../gw/gw_models.dart' show kstOf;

enum TodoState {
  inProgress('in_progress', '진행 중'),
  done('done', '완료'),
  cancelled('cancelled', '취소');

  const TodoState(this.code, this.label);
  final String code, label;
  static TodoState of(Object? v) => values.firstWhere((e) => e.code == v, orElse: () => inProgress);
}

/// 시급도 — 매트릭스 순서(왼위 오늘·오위 받은함·왼아래 예정·오아래 언젠가).
enum TodoUrgency {
  today('today', '오늘'),
  inbox('inbox', '받은함'),
  scheduled('scheduled', '예정'),
  someday('someday', '언젠가');

  const TodoUrgency(this.code, this.label);
  final String code, label;
  static TodoUrgency of(Object? v) => values.firstWhere((e) => e.code == v, orElse: () => inbox);
}

/// 아이젠하워 우선순위.
enum TodoPriority {
  p1('p1', '긴급 + 중요', '지금 하기'),
  p2('p2', '중요 · 비긴급', '일정 잡기'),
  p3('p3', '긴급 · 비중요', '맡기기·빨리 처리'),
  p4('p4', '둘 다 아님', '버리기·나중에');

  const TodoPriority(this.code, this.label, this.action);
  final String code, label, action;
  String get short => code.toUpperCase();
  static TodoPriority of(Object? v) => values.firstWhere((e) => e.code == v, orElse: () => p3);
}

class Todo {
  const Todo({
    required this.id,
    required this.title,
    this.notes,
    this.state = TodoState.inProgress,
    this.urgency = TodoUrgency.inbox,
    this.priority = TodoPriority.p3,
    this.estimatedMinutes,
    this.scheduledFor,
    this.projectId,
    this.contextTags = const [],
    this.migrationCount = 0,
    this.completedAt,
    this.createdAt,
    this.updatedAt,
  });

  final String id, title;
  final String? notes, projectId;
  final TodoState state;
  final TodoUrgency urgency;
  final TodoPriority priority;
  final int? estimatedMinutes;
  final DateTime? scheduledFor, completedAt, createdAt, updatedAt; // UTC
  final List<String> contextTags;
  final int migrationCount;

  bool get isOpen => state == TodoState.inProgress;
  /// 3회 이상 이월 — "정말 필요한 일인가요?" 정리 대상.
  bool get isStale => isOpen && migrationCount >= 3;

  static DateTime? _t(Object? v) => v is String && v.isNotEmpty ? DateTime.tryParse(v)?.toUtc() : null;

  factory Todo.fromRow(Map row) => Todo(
        id: '${row['id']}',
        title: '${row['title'] ?? ''}',
        notes: row['notes'] as String?,
        state: TodoState.of(row['state']),
        urgency: TodoUrgency.of(row['urgency']),
        priority: TodoPriority.of(row['priority']),
        estimatedMinutes: (row['estimated_minutes'] as num?)?.toInt(),
        scheduledFor: _t(row['scheduled_for']),
        projectId: row['project_id'] as String?,
        contextTags: [for (final t in (row['context_tags'] as List? ?? const [])) '$t'],
        migrationCount: (row['migration_count'] as num?)?.toInt() ?? 0,
        completedAt: _t(row['completed_at']),
        createdAt: _t(row['created_at']),
        updatedAt: _t(row['updated_at']),
      );

  /// 쓰기용 칸(id·user_id·시각은 DB가 정한다).
  Map<String, Object?> toRow() => {
        'title': title,
        'notes': notes,
        'state': state.code,
        'urgency': urgency.code,
        'priority': priority.code,
        'estimated_minutes': estimatedMinutes,
        'scheduled_for': scheduledFor?.toUtc().toIso8601String(),
        'project_id': projectId,
        'context_tags': contextTags,
      };

  Todo copyWith({
    String? title,
    String? Function()? notes,
    TodoState? state,
    TodoUrgency? urgency,
    TodoPriority? priority,
    int? Function()? estimatedMinutes,
    DateTime? Function()? scheduledFor,
    String? Function()? projectId,
    List<String>? contextTags,
    int? migrationCount,
  }) =>
      Todo(
        id: id,
        title: title ?? this.title,
        notes: notes != null ? notes() : this.notes,
        state: state ?? this.state,
        urgency: urgency ?? this.urgency,
        priority: priority ?? this.priority,
        estimatedMinutes: estimatedMinutes != null ? estimatedMinutes() : this.estimatedMinutes,
        scheduledFor: scheduledFor != null ? scheduledFor() : this.scheduledFor,
        projectId: projectId != null ? projectId() : this.projectId,
        contextTags: contextTags ?? this.contextTags,
        migrationCount: migrationCount ?? this.migrationCount,
        completedAt: (state ?? this.state) == TodoState.done ? (completedAt ?? DateTime.now().toUtc()) : null,
        createdAt: createdAt,
        updatedAt: DateTime.now().toUtc(),
      );
}

enum TodoProjectStatus { active, archived }

class TodoProject {
  const TodoProject({required this.id, required this.title, this.outcome, this.status = TodoProjectStatus.active, this.createdAt});
  final String id, title;
  final String? outcome;
  final TodoProjectStatus status;
  final DateTime? createdAt;
  bool get archived => status == TodoProjectStatus.archived;

  factory TodoProject.fromRow(Map row) => TodoProject(
        id: '${row['id']}',
        title: '${row['title'] ?? ''}',
        outcome: row['outcome'] as String?,
        status: row['status'] == 'archived' ? TodoProjectStatus.archived : TodoProjectStatus.active,
        createdAt: row['created_at'] is String ? DateTime.tryParse(row['created_at'] as String) : null,
      );
}

/// 주간 리뷰(크론 /api/cron/todo-review가 쓰는 본인 행).
class TodoReview {
  const TodoReview({required this.runAt, required this.summary, required this.stats});
  final DateTime runAt;
  final String summary;
  final Map stats;
  factory TodoReview.fromRow(Map row) => TodoReview(runAt: DateTime.parse('${row['last_run_at']}').toUtc(), summary: '${row['last_summary'] ?? ''}', stats: row['last_stats'] is Map ? row['last_stats'] as Map : const {});
}

/// AI 분석 제안(POST /api/todo/analyze).
class TodoAnalysis {
  const TodoAnalysis({required this.title, this.scheduledFor, this.estimatedMinutes, this.priority = TodoPriority.p3, this.contextTags = const []});
  final String title;
  final DateTime? scheduledFor;
  final int? estimatedMinutes;
  final TodoPriority priority;
  final List<String> contextTags;
  factory TodoAnalysis.fromJson(Map j) => TodoAnalysis(
        title: '${j['title'] ?? ''}',
        scheduledFor: j['scheduled_for'] is String ? DateTime.tryParse(j['scheduled_for'] as String)?.toUtc() : null,
        estimatedMinutes: (j['estimated_minutes'] as num?)?.toInt(),
        priority: TodoPriority.of(j['priority']),
        contextTags: [for (final t in (j['context_tags'] as List? ?? const [])) '$t'],
      );
}

/// 화면 필터 — 상태(기본 진행 중만)·태그(비면 전부). 태그는 하나라도 맞으면 보인다.
class TodoFilter {
  const TodoFilter({this.states = const {TodoState.inProgress}, this.tags = const {}});
  final Set<TodoState> states;
  final Set<String> tags;
  bool get isDefault => states.length == 1 && states.contains(TodoState.inProgress) && tags.isEmpty;
  bool matches(Todo t) => (states.isEmpty || states.contains(t.state)) && (tags.isEmpty || t.contextTags.any(tags.contains));
}

/// 분면 안 순서: 진행 중 먼저 → 우선순위(p1 먼저) → 예정 시각 → 만든 순.
int _order(Todo a, Todo b) {
  int c = (a.isOpen ? 0 : 1).compareTo(b.isOpen ? 0 : 1);
  if (c != 0) return c;
  c = a.priority.index.compareTo(b.priority.index);
  if (c != 0) return c;
  final sa = a.scheduledFor, sb = b.scheduledFor;
  if (sa != null || sb != null) {
    if (sa == null) return 1;
    if (sb == null) return -1;
    c = sa.compareTo(sb);
    if (c != 0) return c;
  }
  return (a.createdAt ?? DateTime(0)).compareTo(b.createdAt ?? DateTime(0));
}

Map<TodoUrgency, List<Todo>> byUrgency(Iterable<Todo> todos, TodoFilter f) {
  final m = {for (final u in TodoUrgency.values) u: <Todo>[]};
  for (final t in todos) {
    if (f.matches(t)) m[t.urgency]!.add(t);
  }
  for (final l in m.values) {
    l.sort(_order);
  }
  return m;
}

Map<TodoPriority, List<Todo>> byPriority(Iterable<Todo> todos, TodoFilter f) {
  final m = {for (final p in TodoPriority.values) p: <Todo>[]};
  for (final t in todos) {
    if (f.matches(t)) m[t.priority]!.add(t);
  }
  for (final l in m.values) {
    l.sort(_order);
  }
  return m;
}

/// 할 일들에 쓰인 태그(필터 시트 선택지) — 기본 태그 + 쓰인 태그, 쓰인 순서 많은 것부터.
const defaultContextTags = ['@office', '@home', '@computer', '@phone', '@errand', '@waiting', '@meeting'];
List<String> usedTags(Iterable<Todo> todos) {
  final n = <String, int>{};
  for (final t in todos) {
    for (final g in t.contextTags) {
      n[g] = (n[g] ?? 0) + 1;
    }
  }
  return (n.keys.toList()..sort((a, b) => n[b]!.compareTo(n[a]!)));
}

/// 태그 정리 — 공백 제거·소문자·@ 붙임. 비면 null.
String? normalizeTag(String raw) {
  final t = raw.trim().toLowerCase().replaceAll(RegExp(r'\s+'), '');
  if (t.isEmpty || t == '@') return null;
  final v = t.startsWith('@') ? t : '@$t';
  return v.length > 21 ? v.substring(0, 21) : v;
}

String kstDate(DateTime utc) {
  final k = kstOf(utc);
  return '${k.year}-${k.month.toString().padLeft(2, '0')}-${k.day.toString().padLeft(2, '0')}';
}

/// 이월 확인 대상 — 진행 중이고 '오늘'에 있는데 마지막 변경이 오늘(KST) 자정 전인 것(JARVIS _pickYesterdayLingering).
List<Todo> lingeringFromYesterday(Iterable<Todo> todos, DateTime nowUtc) {
  final today = kstDate(nowUtc);
  return [
    for (final t in todos)
      if (t.isOpen && t.urgency == TodoUrgency.today && t.updatedAt != null && kstDate(t.updatedAt!).compareTo(today) < 0) t,
  ];
}

/// 예상 시간 표시 — 90 → "1시간 30분", 45 → "45분".
String minutesLabel(int m) {
  if (m < 60) return '$m분';
  final h = m ~/ 60, r = m % 60;
  return r == 0 ? '$h시간' : '$h시간 $r분';
}

/// 예정 시각 표시(KST) — "11/3 (월) 15:00", 자정이면 시각 생략.
String scheduleLabel(DateTime utc) {
  final k = kstOf(utc);
  const wd = ['월', '화', '수', '목', '금', '토', '일'];
  final time = k.hour == 0 && k.minute == 0 ? '' : ' ${k.hour.toString().padLeft(2, '0')}:${k.minute.toString().padLeft(2, '0')}';
  return '${k.month}/${k.day} (${wd[k.weekday - 1]})$time';
}
