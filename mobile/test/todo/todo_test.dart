import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/todo/todo_migration.dart';
import 'package:playground/todo/todo_model.dart';
import 'package:playground/todo/todo_screens.dart';
import 'package:playground/todo/todo_sheets.dart';
import 'package:playground/todo/todo_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 메모리 저장소 — DB 트리거·RPC가 하는 일(완료 시각·이월 횟수)도 흉내 낸다.
class FakeStore implements TodoStore {
  FakeStore(List<Map<String, Object?>> rows) : rows = [for (final r in rows) {...r}];
  final List<Map<String, Object?>> rows;
  final projects = <Map<String, Object?>>[];
  final calls = <String>[];
  var fail = false;
  var _n = 0;
  Map? review;

  Map<String, Object?> _row(String id) => rows.firstWhere((r) => r['id'] == id);

  @override
  Future<List<Map>> loadTodos() async => [for (final r in rows) {...r}];
  @override
  Future<Map> insertTodo(Map<String, Object?> row) async {
    calls.add('insert ${row['title']} ${row['state']} ${row['urgency']}');
    final r = {...row, 'id': 'n${_n++}', 'created_at': DateTime.now().toUtc().toIso8601String(), 'updated_at': DateTime.now().toUtc().toIso8601String(), 'migration_count': 0};
    rows.add(r);
    return {...r};
  }

  @override
  Future<Map> updateTodo(String id, Map<String, Object?> row) async {
    calls.add('update $id ${row.keys.length == 1 ? '${row.keys.single}=${row.values.single}' : 'all'}');
    if (fail) throw Exception('거절');
    _row(id).addAll(row);
    return {..._row(id)};
  }

  @override
  Future<void> deleteTodo(String id) async => rows.removeWhere((r) => r['id'] == id);
  @override
  Future<Map> migrateTodo(String id, String to) async {
    calls.add('migrate $id $to');
    final r = _row(id);
    if (to == 'cancelled') {
      r['state'] = 'cancelled';
    } else {
      r['urgency'] = to;
    }
    r['migration_count'] = ((r['migration_count'] as int?) ?? 0) + 1;
    return {...r};
  }

  @override
  Future<List<Map>> loadProjects() async => projects;
  @override
  Future<Map> insertProject(Map<String, Object?> row) async => {...row, 'id': 'p${_n++}'};
  @override
  Future<Map> updateProject(String id, Map<String, Object?> row) async => {...row, 'id': id};
  @override
  Future<void> deleteProject(String id) async {}
  @override
  Future<Map?> loadReview() async => review;
  @override
  Future<bool> aiEnabled() async => true;
  @override
  Future<Map> analyze(String text) async {
    calls.add('analyze $text');
    return {'title': '김부장님께 보고서 보내기', 'scheduled_for': '2026-11-03T06:00:00.000Z', 'estimated_minutes': 30, 'priority': 'p1', 'context_tags': ['@office']};
  }
}

Map<String, Object?> row(String id, String title, {String urgency = 'inbox', String priority = 'p3', String state = 'in_progress', int migrations = 0, String? updated}) => {
      'id': id, 'title': title, 'urgency': urgency, 'priority': priority, 'state': state, 'migration_count': migrations, 'context_tags': <String>[],
      'created_at': '2026-11-01T00:00:00Z', 'updated_at': updated ?? DateTime.now().toUtc().toIso8601String(),
    };

Widget host(FakeStore store, Widget child) => ProviderScope(
      overrides: [todoStoreProvider.overrideWithValue(store)],
      child: MaterialApp(home: Scaffold(body: SizedBox(width: 900, height: 700, child: child))),
    );

Future<void> dragTo(WidgetTester tester, Finder from, Finder to, {bool longPress = false}) async {
  final g = await tester.startGesture(tester.getCenter(from), kind: longPress ? PointerDeviceKind.touch : PointerDeviceKind.mouse);
  if (longPress) await tester.pump(kLongPressTimeout + const Duration(milliseconds: 100));
  final target = tester.getCenter(to);
  for (var i = 1; i <= 10; i++) {
    await g.moveTo(Offset.lerp(tester.getCenter(from), target, i / 10)!);
    await tester.pump(const Duration(milliseconds: 16));
  }
  await g.up();
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('순수 로직', () {
    test('분면 나누기 — 필터(기본 진행 중만·태그는 하나라도), 순서는 진행 중 → p1 → 예정 시각 → 만든 순', () {
      final todos = [
        Todo.fromRow(row('a', 'a', priority: 'p3')),
        Todo.fromRow(row('b', 'b', priority: 'p1')),
        Todo.fromRow(row('c', 'c', state: 'done')),
        Todo.fromRow({...row('d', 'd', urgency: 'today'), 'context_tags': ['@office']}),
      ];
      final m = byUrgency(todos, const TodoFilter());
      expect(m[TodoUrgency.inbox]!.map((t) => t.id), ['b', 'a']);
      expect(m[TodoUrgency.today]!.map((t) => t.id), ['d']);
      final all = byUrgency(todos, const TodoFilter(states: {TodoState.inProgress, TodoState.done}));
      expect(all[TodoUrgency.inbox]!.map((t) => t.id), ['b', 'a', 'c']);
      expect(byUrgency(todos, const TodoFilter(tags: {'@office'}))[TodoUrgency.inbox], isEmpty);
      expect(byPriority(todos, const TodoFilter())[TodoPriority.p3]!.map((t) => t.id), unorderedEquals(['a', 'd']));
      expect(byPriority(todos, const TodoFilter())[TodoPriority.p1]!.map((t) => t.id), ['b']);
    });

    test('이월 대상 — 진행 중 · 오늘 칸 · 마지막 변경이 KST 오늘 자정 전', () {
      final now = DateTime.utc(2026, 11, 2, 0, 30); // KST 11/2 09:30
      final todos = [
        Todo.fromRow(row('y', '어제 것', urgency: 'today', updated: '2026-11-01T14:00:00Z')), // KST 11/1 23:00
        Todo.fromRow(row('t', '오늘 바꾼 것', urgency: 'today', updated: '2026-11-01T15:10:00Z')), // KST 11/2 00:10
        Todo.fromRow(row('i', '받은함', updated: '2026-10-01T00:00:00Z')),
        Todo.fromRow(row('d', '끝난 것', urgency: 'today', state: 'done', updated: '2026-10-01T00:00:00Z')),
      ];
      expect(lingeringFromYesterday(todos, now).map((t) => t.id), ['y']);
    });

    test('태그 정리·시간 표시·예정 시각(KST)', () {
      expect(normalizeTag(' Office '), '@office');
      expect(normalizeTag('@'), isNull);
      expect(minutesLabel(90), '1시간 30분');
      expect(minutesLabel(45), '45분');
      expect(scheduleLabel(DateTime.utc(2026, 11, 3, 6)), '11/3 (화) 15:00');
      expect(scheduleLabel(DateTime.utc(2026, 11, 2, 15)), '11/3 (화)');
    });

    test('행 왕복 — 쓰기 칸에 id·시각은 넣지 않는다, 3회 이월은 정리 대상', () {
      final t = Todo.fromRow({...row('x', '제목', migrations: 3), 'scheduled_for': '2026-11-03T06:00:00Z', 'estimated_minutes': 30});
      expect(t.isStale, true);
      expect(t.toRow(), {'title': '제목', 'notes': null, 'state': 'in_progress', 'urgency': 'inbox', 'priority': 'p3', 'estimated_minutes': 30, 'scheduled_for': '2026-11-03T06:00:00.000Z', 'project_id': null, 'context_tags': <String>[]});
    });
  });

  group('매트릭스 끌어 놓기', () {
    testWidgets('데스크톱: 받은함 → 오늘로 마우스로 끌면 분류만 바뀐다', (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
      final store = FakeStore([row('a', '보고서 쓰기')]);
      await tester.pumpWidget(host(store, const TodoMatrixPanel()));
      await tester.pumpAndSettle();
      await dragTo(tester, find.byKey(const ValueKey('todo-row-a')), find.byKey(const ValueKey('todo-quadrant-오늘')));
      expect(store.calls, ['update a urgency=today']);
      expect(find.descendant(of: find.byKey(const ValueKey('todo-quadrant-오늘')), matching: find.byKey(const ValueKey('todo-row-a'))), findsOneWidget);
      debugDefaultTargetPlatformOverride = null;
    });

    testWidgets('휴대폰: 길게 눌러 끌기 — 아이젠하워 p3 → p1이면 우선순위만 바뀐다', (tester) async {
      final store = FakeStore([row('a', '고객 장애 대응')]);
      await tester.pumpWidget(host(store, const TodoMatrixPanel(kind: TodoMatrixKind.priority)));
      await tester.pumpAndSettle();
      await dragTo(tester, find.byKey(const ValueKey('todo-row-a')), find.byKey(const ValueKey('todo-quadrant-긴급 + 중요')), longPress: true);
      expect(store.calls, ['update a priority=p1']);
      expect(find.descendant(of: find.byKey(const ValueKey('todo-quadrant-긴급 + 중요')), matching: find.byKey(const ValueKey('todo-row-a'))), findsOneWidget);
    });

    testWidgets('같은 칸에 놓으면 아무 일 없고, 저장이 실패하면 원래 칸으로 되돌리고 알린다', (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.windows;
      final store = FakeStore([row('a', '정리하기')]);
      await tester.pumpWidget(host(store, const TodoMatrixPanel()));
      await tester.pumpAndSettle();
      await dragTo(tester, find.byKey(const ValueKey('todo-row-a')), find.byKey(const ValueKey('todo-quadrant-받은함')));
      expect(store.calls, isEmpty);
      store.fail = true;
      await dragTo(tester, find.byKey(const ValueKey('todo-row-a')), find.byKey(const ValueKey('todo-quadrant-언젠가')));
      expect(store.calls, ['update a urgency=someday']);
      expect(find.descendant(of: find.byKey(const ValueKey('todo-quadrant-받은함')), matching: find.byKey(const ValueKey('todo-row-a'))), findsOneWidget);
      expect(find.textContaining('저장하지 못했습니다'), findsOneWidget);
      debugDefaultTargetPlatformOverride = null;
    });

    testWidgets('○를 누르면 완료로 저장되고 기본 필터(진행 중)에서 빠진다', (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
      final store = FakeStore([row('a', '메일 답장')]);
      await tester.pumpWidget(host(store, const TodoMatrixPanel()));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('todo-check-a')));
      await tester.pumpAndSettle();
      expect(store.calls, ['update a state=done']);
      expect(find.text('메일 답장'), findsNothing, reason: '기본 필터는 진행 중만');
      debugDefaultTargetPlatformOverride = null;
    });
  });

  group('시트', () {
    testWidgets('빠른 입력 — AI로 채우기는 빈 칸만 채우고(예정 시각이 생기면 예정으로), 저장은 누를 때만', (tester) async {
      final store = FakeStore([]);
      await tester.pumpWidget(host(store, Consumer(builder: (c, _, _) => TextButton(onPressed: () => showTodoCapture(c), child: const Text('열기')))));
      await tester.tap(find.text('열기'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('todo-capture-title')), '내일 오후 3시 김부장님께 보고서');
      await tester.tap(find.byKey(const ValueKey('todo-capture-ai')));
      await tester.pumpAndSettle();
      expect(store.calls, ['analyze 내일 오후 3시 김부장님께 보고서']);
      expect(find.text('김부장님께 보고서 보내기'), findsOneWidget);
      expect(find.text('예정 11/3 (화) 15:00'), findsOneWidget);
      await tester.ensureVisible(find.byKey(const ValueKey('todo-capture-save')));
      await tester.tap(find.byKey(const ValueKey('todo-capture-save')));
      await tester.pumpAndSettle();
      expect(store.calls.last, 'insert 김부장님께 보고서 보내기 in_progress scheduled');
      expect(store.rows.single, containsPair('priority', 'p1'));
      expect(store.rows.single['context_tags'], ['@office']);
      expect(store.rows.single['estimated_minutes'], 30);
    });

    testWidgets('2분 룰을 켜면 완료로 저장', (tester) async {
      final store = FakeStore([]);
      await tester.pumpWidget(host(store, Consumer(builder: (c, _, _) => TextButton(onPressed: () => showTodoCapture(c, urgency: TodoUrgency.today), child: const Text('열기')))));
      await tester.tap(find.text('열기'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('todo-capture-title')), '회신');
      await tester.tap(find.byKey(const ValueKey('todo-capture-two-minute')));
      await tester.pump();
      expect(find.text('완료로 저장'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('todo-capture-save')));
      await tester.pumpAndSettle();
      expect(store.calls.last, 'insert 회신 done today');
    });

    testWidgets('줄을 누르면 편집 — 완료 버튼은 고친 내용과 함께 완료로 저장', (tester) async {
      final store = FakeStore([row('a', '초안')]);
      await tester.pumpWidget(host(store, const TodoMatrixPanel()));
      await tester.pumpAndSettle();
      await tester.tap(find.text('초안'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('todo-edit-title')), '최종안');
      await tester.ensureVisible(find.byKey(const ValueKey('todo-edit-done')));
      await tester.tap(find.byKey(const ValueKey('todo-edit-done')));
      await tester.pumpAndSettle();
      expect(store.calls, ['update a all']);
      expect(store.rows.single, allOf(containsPair('title', '최종안'), containsPair('state', 'done')));
    });
  });

  group('이월', () {
    testWidgets('어제 오늘 칸에 남은 것을 하루 한 번 묻고, 고른 것만 RPC로 — 유지는 건드리지 않는다', (tester) async {
      final store = FakeStore([
        row('a', '어제 못 한 일', urgency: 'today', updated: '2026-10-30T00:00:00Z'),
        row('b', '그대로 둘 일', urgency: 'today', updated: '2026-10-30T00:00:00Z'),
      ]);
      late WidgetRef r;
      await tester.pumpWidget(host(store, Consumer(builder: (c, ref, _) {
        r = ref;
        return TextButton(onPressed: () => maybeShowTodoMigration(c, r), child: const Text('홈'));
      })));
      await tester.tap(find.text('홈'));
      await tester.pumpAndSettle();
      expect(find.text('어제의 할 일을 정리하세요'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('todo-migrate-a-schedule')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('todo-migrate-apply')));
      await tester.pumpAndSettle();
      expect(store.calls, ['migrate a scheduled']);
      expect(store.rows.first, allOf(containsPair('urgency', 'scheduled'), containsPair('migration_count', 1)));
      // 같은 날 다시 들어오면 묻지 않는다
      await tester.tap(find.text('홈'));
      await tester.pumpAndSettle();
      expect(find.text('어제의 할 일을 정리하세요'), findsNothing);
    });
  });
}
