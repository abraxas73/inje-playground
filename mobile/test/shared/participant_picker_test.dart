import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/features/shared/participant_picker.dart';

Widget host(ParticipantPicker p) => MaterialApp(home: Scaffold(body: SingleChildScrollView(child: p)));

void main() {
  final toggles = <(String, bool)>[];
  final setAlls = <bool>[];
  final added = <String>[];
  ParticipantPicker picker(List<String> names, Set<String> selected, {List<String> extras = const [], String word = '참가'}) => ParticipantPicker(
        names: names, selected: selected, extras: extras, loaded: true, includeWord: word,
        onToggle: (n, v) => toggles.add((n, v)), onSetAll: setAlls.add, onAddExtra: added.add, onRemoveExtra: (_) {}, onReload: () async {},
      );
  setUp(() { toggles.clear(); setAlls.clear(); added.clear(); });

  testWidgets('10명 이하는 펼친 채 — 이름마다 스위치, 끄면 onToggle(name,false), 모두 해제는 onSetAll(false)', (t) async {
    await t.pumpWidget(host(picker(['김민준', '이서연'], {'김민준', '이서연'})));
    expect(find.byType(Switch), findsNWidgets(2));
    expect(find.text('2명 참가'), findsOneWidget);
    await t.tap(find.byType(Switch).first);
    expect(toggles, [('김민준', false)]);
    await t.tap(find.text('모두 해제'));
    expect(setAlls, [false]);
  });

  testWidgets('10명 초과는 접힌 채 시작 — 요약만 보이고, 펼치기 아이콘으로 목록이 열린다', (t) async {
    final names = [for (var i = 1; i <= 12; i++) '사람$i'];
    await t.pumpWidget(host(picker(names, names.toSet(), word: '참석')));
    expect(find.byType(Switch), findsNothing);
    expect(find.text('전원 참석 · 펼쳐서 개별 조정'), findsOneWidget);
    await t.tap(find.byTooltip('펼치기'));
    await t.pump();
    expect(find.byType(Switch), findsNWidgets(12));
  });

  testWidgets('접힌 상태에서 제외된 사람은 칩으로 — 누르면 onToggle(name,true)', (t) async {
    final names = [for (var i = 1; i <= 12; i++) '사람$i'];
    await t.pumpWidget(host(picker(names, names.toSet()..remove('사람3')..remove('사람7'))));
    expect(find.text('미참가 2명 · 누르면 참가'), findsOneWidget);
    await t.tap(find.widgetWithText(ActionChip, '사람7'));
    expect(toggles, [('사람7', true)]);
  });

  testWidgets('직접 입력 — 비어 있거나 이미 있는 이름은 무시, 새 이름은 onAddExtra', (t) async {
    await t.pumpWidget(host(picker(['김민준'], {'김민준'})));
    await t.enterText(find.byType(TextField), '김민준');
    await t.tap(find.byTooltip('추가'));
    await t.enterText(find.byType(TextField), '홍길동');
    await t.tap(find.byTooltip('추가'));
    expect(added, ['홍길동']);
  });
}
