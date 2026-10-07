import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/briefing/briefing_sections.dart';
import 'package:playground/briefing/jira_briefing.dart';
void main() {
  testWidgets('미연결이면 지라 연결, 연결됐고 업무가 없으면 빈 상태', (tester) async {
    var connected = false;
    Future<void> show(JiraBriefing data) => tester.pumpWidget(MaterialApp(home: Scaffold(body: JiraSection(data: data, onConnect: () => connected = true, onMore: () {}, onIssue: (_) {}))));
    await show(const JiraBriefing(connected: false));
    await tester.tap(find.text('지라 연결'));
    expect(connected, true);
    await show(const JiraBriefing(connected: true));
    expect(find.text('지라 연결'), findsNothing);
    expect(find.text('담당한 미완료 이슈가 없습니다.'), findsOneWidget);
  });
  testWidgets('이슈 선택은 해당 키, 전체 목록은 목록 동작으로 연결', (tester) async {
    String? selected; var list = false;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: JiraSection(data: const JiraBriefing(connected: true, items: [JiraBriefingIssue(key: 'AX-1', summary: '설계 검토', status: '진행 중')]), onConnect: () {}, onMore: () => list = true, onIssue: (key) => selected = key))));
    await tester.tap(find.text('설계 검토'));
    expect(selected, 'AX-1');
    await tester.tap(find.text('전체 목록'));
    expect(list, true);
  });
}
