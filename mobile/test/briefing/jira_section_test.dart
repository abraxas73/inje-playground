import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/briefing/briefing_sections.dart';
import 'package:playground/briefing/jira_briefing.dart';
void main() {
  testWidgets('미연결·인증 만료·업무 없음은 영역 자체를 숨긴다', (tester) async {
    for (final data in [const JiraBriefing(connected: false), const JiraBriefing(connected: false, reconnect: true), const JiraBriefing(connected: true)]) {
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: JiraSection(data: data, onMore: () {}, onIssue: (_) {}))));
      expect(find.byType(Table), findsNothing);
      expect(find.byType(Text), findsNothing);
    }
  });
  testWidgets('Jira 표는 요약과 같은 데일리 브리핑 카드 안에 표시', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: BriefingCard(
      summary: const SummaryText(text: '오늘의 요약', at: '17:30'),
      jira: const JiraBriefing(connected: true, items: [JiraBriefingIssue(key: 'AX-1', summary: '설계 검토', status: 'To Do')]),
      onJiraMore: () {}, onJiraIssue: (_) {},
    ))));
    expect(find.byType(Card), findsOneWidget);
    expect(find.descendant(of: find.byType(Card), matching: find.byType(Table)), findsOneWidget);
    expect(find.descendant(of: find.byType(Card), matching: find.text('오늘의 요약')), findsOneWidget);
  });
  testWidgets('이슈 선택은 해당 키, 전체 목록은 목록 동작으로 연결', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    String? selected; var list = false;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: JiraSection(data: const JiraBriefing(connected: true, items: [JiraBriefingIssue(key: 'AX-1', summary: '설계 검토', status: '진행 중')]), onMore: () => list = true, onIssue: (key) => selected = key))));
    expect(find.byType(Table), findsOneWidget);
    expect(find.text('업무'), findsOneWidget);
    expect(find.text('상태'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('보기'));
    expect(selected, 'AX-1');
    selected = null;
    await tester.tap(find.text('설계 검토'));
    expect(selected, 'AX-1');
    await tester.tap(find.text('전체 목록'));
    expect(list, true);
  });
}
