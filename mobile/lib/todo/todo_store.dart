// 할 일 저장소 — 앱이 본인 행만 Supabase에 직접 읽고 쓴다(RLS, mcp_calls와 같은 방식). AI 분석만 서버 API(/api/todo/analyze).
// 화면은 이 파일의 Notifier만 부른다. 쓰기는 낙관적으로 바로 반영하고 실패하면 되돌린 뒤 오류를 던진다(화면이 스낵바로 알림).
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../api/client.dart';
import 'todo_model.dart';

/// 저장소 경계 — 운영은 Supabase, 테스트는 메모리 구현.
abstract class TodoStore {
  Future<List<Map>> loadTodos();
  Future<Map> insertTodo(Map<String, Object?> row);
  Future<Map> updateTodo(String id, Map<String, Object?> row);
  Future<void> deleteTodo(String id);
  /// 명시적 이월 — 분류를 [to](today·inbox·scheduled·someday) 또는 'cancelled'로 바꾸고 이월 횟수 +1(RPC migrate_todo).
  Future<Map> migrateTodo(String id, String to);
  Future<List<Map>> loadProjects();
  Future<Map> insertProject(Map<String, Object?> row);
  Future<Map> updateProject(String id, Map<String, Object?> row);
  Future<void> deleteProject(String id);
  Future<Map?> loadReview();
  Future<bool> aiEnabled();
  Future<Map> analyze(String text);
}

class SupabaseTodoStore implements TodoStore {
  SupabaseTodoStore(this.api);
  final ApiClient api;
  SupabaseClient get _db => Supabase.instance.client;

  @override
  Future<List<Map>> loadTodos() async {
    // 진행 중 전부 + 끝난 것(완료·취소)은 최근 30일만.
    // ponytail: 한 번에 1000행(Supabase 상한) — 진행 중 할 일이 1000개를 넘는 사람이 생기면 페이지로 나눠 읽는다.
    final since = DateTime.now().toUtc().subtract(const Duration(days: 30)).toIso8601String();
    return await _db.from('todos').select().or('state.eq.in_progress,updated_at.gte.$since').order('created_at').limit(1000);
  }

  @override
  Future<Map> insertTodo(Map<String, Object?> row) async => await _db.from('todos').insert(row).select().single();
  @override
  Future<Map> updateTodo(String id, Map<String, Object?> row) async => await _db.from('todos').update(row).eq('id', id).select().single();
  @override
  Future<void> deleteTodo(String id) async => await _db.from('todos').delete().eq('id', id);
  @override
  Future<Map> migrateTodo(String id, String to) async => await _db.rpc('migrate_todo', params: {'p_id': id, 'p_to': to}) as Map;
  @override
  Future<List<Map>> loadProjects() async => await _db.from('todo_projects').select().order('created_at');
  @override
  Future<Map> insertProject(Map<String, Object?> row) async => await _db.from('todo_projects').insert(row).select().single();
  @override
  Future<Map> updateProject(String id, Map<String, Object?> row) async => await _db.from('todo_projects').update(row).eq('id', id).select().single();
  @override
  Future<void> deleteProject(String id) async => await _db.from('todo_projects').delete().eq('id', id);
  @override
  Future<Map?> loadReview() async => await _db.from('todo_review_runs').select().maybeSingle();
  @override
  Future<bool> aiEnabled() async {
    final r = await api.getJson('/api/todo/analyze');
    return r is Map && r['enabled'] == true;
  }

  @override
  Future<Map> analyze(String text) async => await api.postJson('/api/todo/analyze', {'text': text}) as Map;
}

final todoStoreProvider = Provider<TodoStore>((ref) => SupabaseTodoStore(ref.watch(apiClientProvider)));

class TodosNotifier extends AsyncNotifier<List<Todo>> {
  TodoStore get _store => ref.read(todoStoreProvider);

  @override
  Future<List<Todo>> build() async => [for (final r in await ref.watch(todoStoreProvider).loadTodos()) Todo.fromRow(r)];

  List<Todo> get _list => state.value ?? const [];

  Future<Todo> add(Todo draft) async {
    final saved = Todo.fromRow(await _store.insertTodo(draft.toRow()));
    if (ref.mounted) state = AsyncData([..._list, saved]);
    return saved;
  }

  /// 낙관적 반영 → 저장 → 서버 행으로 교체. 실패하면 되돌리고 다시 던진다.
  Future<void> _mutate(Todo next, Future<Map> Function() call) async {
    final prev = _list;
    state = AsyncData([for (final t in prev) t.id == next.id ? next : t]);
    try {
      final saved = Todo.fromRow(await call());
      if (ref.mounted) state = AsyncData([for (final t in _list) t.id == saved.id ? saved : t]);
    } catch (_) {
      if (ref.mounted) state = AsyncData(prev);
      rethrow;
    }
  }

  Future<void> save(Todo next) => _mutate(next, () => _store.updateTodo(next.id, next.toRow()));
  Future<void> setUrgency(Todo t, TodoUrgency u) => _mutate(t.copyWith(urgency: u), () => _store.updateTodo(t.id, {'urgency': u.code}));
  Future<void> setPriority(Todo t, TodoPriority p) => _mutate(t.copyWith(priority: p), () => _store.updateTodo(t.id, {'priority': p.code}));
  Future<void> setState(Todo t, TodoState s) => _mutate(t.copyWith(state: s), () => _store.updateTodo(t.id, {'state': s.code}));
  Future<void> toggleDone(Todo t) => setState(t, t.state == TodoState.done ? TodoState.inProgress : TodoState.done);

  /// [to]: TodoUrgency.code 또는 'cancelled'.
  Future<void> migrate(Todo t, String to) => _mutate(
        to == 'cancelled' ? t.copyWith(state: TodoState.cancelled, migrationCount: t.migrationCount + 1) : t.copyWith(urgency: TodoUrgency.of(to), migrationCount: t.migrationCount + 1),
        () => _store.migrateTodo(t.id, to),
      );

  Future<void> delete(Todo t) async {
    final prev = _list;
    state = AsyncData([for (final x in prev) if (x.id != t.id) x]);
    try {
      await _store.deleteTodo(t.id);
    } catch (_) {
      if (ref.mounted) state = AsyncData(prev);
      rethrow;
    }
  }

  /// 프로젝트를 지우면 DB가 project_id를 비운다 — 화면 목록도 맞춘다.
  void detachProject(String projectId) {
    state = AsyncData([for (final t in _list) t.projectId == projectId ? t.copyWith(projectId: () => null) : t]);
  }
}

final todosProvider = AsyncNotifierProvider<TodosNotifier, List<Todo>>(TodosNotifier.new);

class TodoProjectsNotifier extends AsyncNotifier<List<TodoProject>> {
  TodoStore get _store => ref.read(todoStoreProvider);

  @override
  Future<List<TodoProject>> build() async => [for (final r in await ref.watch(todoStoreProvider).loadProjects()) TodoProject.fromRow(r)];

  List<TodoProject> get _list => state.value ?? const [];

  Future<TodoProject> add(String title, String? outcome) async {
    final p = TodoProject.fromRow(await _store.insertProject({'title': title, 'outcome': outcome}));
    if (ref.mounted) state = AsyncData([..._list, p]);
    return p;
  }

  Future<void> save(String id, {required String title, String? outcome, required TodoProjectStatus status}) async {
    final p = TodoProject.fromRow(await _store.updateProject(id, {'title': title, 'outcome': outcome, 'status': status.name}));
    if (ref.mounted) state = AsyncData([for (final x in _list) x.id == id ? p : x]);
  }

  Future<void> delete(String id) async {
    await _store.deleteProject(id);
    if (!ref.mounted) return;
    state = AsyncData([for (final x in _list) if (x.id != id) x]);
    ref.read(todosProvider.notifier).detachProject(id);
  }
}

final todoProjectsProvider = AsyncNotifierProvider<TodoProjectsNotifier, List<TodoProject>>(TodoProjectsNotifier.new);

final todoReviewProvider = FutureProvider.autoDispose<TodoReview?>((ref) async {
  final r = await ref.watch(todoStoreProvider).loadReview();
  return r == null ? null : TodoReview.fromRow(r);
});

/// AI 버튼을 그릴지 — 서버에 ANTHROPIC_API_KEY가 없으면 숨긴다. 확인 실패도 숨김.
final todoAiEnabledProvider = FutureProvider<bool>((ref) async {
  try {
    return await ref.watch(todoStoreProvider).aiEnabled();
  } catch (_) {
    return false;
  }
});
