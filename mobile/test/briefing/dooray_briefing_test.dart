import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/briefing/dooray_briefing.dart';
import 'package:playground/briefing/briefing_sections.dart';

void main() {
  test('only explicitly unread mail survives; disconnected data is discarded', () {
    final raw = {'connected': true, 'mail': {'items': [
      {'subject': 'unread', 'unread': true},
      {'subject': 'read', 'unread': false},
      {'subject': 'unknown'},
    ]}};
    expect(DoorayBriefing.parse(raw).mail.map((m) => m.subject), ['unread']);
    expect(DoorayBriefing.parse({...raw, 'connected': false}).visible, false);
  });
  testWidgets('기존 연결의 갱신 실패는 이전 표와 안전한 재시도 안내를 함께 표시', (tester) async {
    var retried = false;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: BriefingCard(summary: null,
      dooray: const DoorayBriefing(connected: true, events: [DoorayBriefingItem(subject: '이전 회의', detail: '09:00')], refreshError: '다시 연결해 주세요.'), onDoorayRetry: () => retried = true,
    ))));
    expect(find.text('이전 회의'), findsOneWidget);
    expect(find.text('다시 연결해 주세요.'), findsOneWidget);
    await tester.tap(find.text('다시 시도'));
    expect(retried, true);
  });

  test('개별 오류는 보존하고 메일 피드를 미읽음으로 해석하지 않는다', () {
    final data = DoorayBriefing.parse({'connected': true, 'events': {'items': [{'subject': '회의', 'startedAt': '2026-10-11T00:30:00Z', 'wholeDayFlag': false}]}, 'mail': {'items': [], 'error': 'upstream', 'partial': true}});
    expect(data.events.single.detail, '10/11 09:30');
    expect(data.mailError, 'upstream');
    expect(data.visible, true);
    expect(DoorayBriefing.parse({'connected': false, 'events': {'items': [{'subject': '숨김'}]}}).visible, false);
    expect(DoorayBriefing.parse({'connected': true}).visible, false);
  });
  testWidgets('미연결·빈 목록은 헤더와 카드도 숨긴다', (tester) async {
    for (final data in [const DoorayBriefing(), const DoorayBriefing(connected: true)]) {
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: BriefingCard(summary: null, dooray: data))));
      expect(find.byType(Card), findsNothing);
      expect(find.text('Dooray'), findsNothing);
    }
  });
  testWidgets('Dooray 표는 기존 브리핑 카드 안에 표시하며 별도 요약을 요구하지 않는다', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var opened = false;
    var retried = false;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: BriefingCard(summary: null,
      dooray: const DoorayBriefing(connected: true, events: [DoorayBriefingItem(subject: '오전 회의', detail: '09:30')], eventsError: 'failed'),
      onDoorayMore: () => opened = true, onDoorayRetry: () => retried = true,
    ))));
    expect(find.byType(Card), findsOneWidget);
    expect(find.descendant(of: find.byType(Card), matching: find.byType(Table)), findsNothing);
    expect(find.text('새로고침을 눌러 브리핑을 받아보세요.'), findsNothing);
    expect(find.text('안 읽은 메일'), findsNothing);
    expect(find.text('불러오지 못했습니다.'), findsOneWidget);
    await tester.tap(find.text('전체 보기'));
    await tester.tap(find.text('다시 시도'));
    expect(opened && retried, true);
    expect(tester.takeException(), isNull);
  });
}
