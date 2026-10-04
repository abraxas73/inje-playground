import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/briefing/briefing_model.dart';
import 'package:playground/briefing/briefing_sections.dart';
import 'package:playground/features/home/quotes.dart';
import 'package:playground/gw/gw_models.dart';

Widget wrap(Widget w) => MaterialApp(home: Scaffold(body: SingleChildScrollView(child: w)));
final now = DateTime(2026, 10, 5, 8, 40);

void main() {
  testWidgets('SummaryCard — 문장이 없으면 격언, 있으면 문장과 시각, ↻는 onRefresh', (tester) async {
    var hits = 0;
    final q = dailyQuote(now);
    await tester.pumpWidget(wrap(SummaryCard(quote: q, summary: null, onRefresh: () => hits++)));
    expect(find.text(q.text), findsOneWidget);
    expect(find.text('오늘의 한 줄'), findsOneWidget);
    await tester.pumpWidget(wrap(SummaryCard(quote: q, summary: const SummaryText(text: '오늘 10시 주간회의가 있습니다.', at: '08:40'), onRefresh: () => hits++)));
    expect(find.text('오늘 10시 주간회의가 있습니다.'), findsOneWidget);
    expect(find.textContaining('Claude · 08:40'), findsOneWidget);
    expect(find.text('오늘의 한 마디'), findsOneWidget);
    await tester.tap(find.byTooltip('다시 만들기'));
    expect(hits, 1);
  });
  testWidgets('FocusSection — 항목마다 이동 버튼, 없으면 안내 한 줄', (tester) async {
    await tester.pumpWidget(wrap(FocusSection(items: const [FocusItem(icon: Icons.event, text: '09:30 주간회의', route: '/gw/today')], onOpen: (_) {})));
    expect(find.text('지금 필요한 것'), findsOneWidget);
    expect(find.text('09:30 주간회의'), findsOneWidget);
    await tester.pumpWidget(wrap(FocusSection(items: const [], onOpen: (_) {})));
    expect(find.text('지금 당장 처리할 것은 없습니다'), findsOneWidget);
  });
  testWidgets('MeetingsSection — 최대 6 + n개 더 + 내일 N건; 비면 안 그린다', (tester) async {
    final ev = [for (var i = 0; i < 8; i++) GwEvent(schSeq: '$i', title: '회의 $i', start: '2026100510${i}0', end: '202610051800', allDay: false, calendar: '', mcalSeq: '1', mine: true, createName: '', place: '')];
    await tester.pumpWidget(wrap(MeetingsSection(meetings: ev, tomorrowCount: 3, onMore: () {})));
    expect(find.textContaining('회의 '), findsNWidgets(6));
    expect(find.text('2개 더'), findsOneWidget);
    expect(find.text('내일 3건'), findsOneWidget);
    await tester.pumpWidget(wrap(MeetingsSection(meetings: const [], tomorrowCount: 0, onMore: () {})));
    expect(find.text('오늘 일정'), findsNothing);
  });
  testWidgets('AbsenceSection·ApprovalsSection·MailsSection·TeamsSection', (tester) async {
    await tester.pumpWidget(wrap(Column(children: [
      const AbsenceSection(absences: [Absence(who: '김민준', what: '김민준 연차', kind: AbsenceKind.leave)]),
      ApprovalsSection(total: 5, items: [PendingApproval(docId: 'd', formId: 'f', title: '휴가 신청', form: 'f', drafter: '이서연', dept: '', arrivedDt: '20261002', status: '', unread: true, fileCount: 0)], now: now, onMore: () {}),
      MailsSection(items: const [MailItem(muid: '1', subject: '견적', fromName: '박지훈', fromEmail: '', date: '', tooltip: '2026-10-05 09:12:00', seen: false, attach: false)], unreadTotal: 2, onMore: () {}),
      TeamsSection(mentions: const TeamsMentions(connected: true, items: [TeamsMention(chatId: 'c', topic: '센터', from: '김민준', text: '확인 부탁', at: '2026-10-05T00:00:00Z')]), onOpen: () {}),
      TeamsSection(mentions: const TeamsMentions(connected: false, items: []), onOpen: () {}),
    ])));
    expect(find.text('김민준 · 휴가'), findsOneWidget);
    expect(find.textContaining('김민준'), findsWidgets);
    expect(find.textContaining('3일째'), findsOneWidget);
    expect(find.text('미결 결재 5'), findsOneWidget);
    expect(find.text('견적'), findsOneWidget);
    expect(find.text('안 읽은 메일 2'), findsOneWidget);
    expect(find.text('Teams 답장 대기 1'), findsOneWidget);
    expect(find.text('확인 부탁'), findsOneWidget);
  });
  testWidgets('RetryLine과 GwConnectCard', (tester) async {
    var hits = 0;
    await tester.pumpWidget(wrap(Column(children: [RetryLine(label: '메일', onTap: () => hits++), const GwConnectCard(relogin: true, onConnect: null)])));
    await tester.tap(find.text('다시 시도'));
    expect(hits, 1);
    expect(find.text('아마란스 로그인이 만료되었습니다'), findsOneWidget);
  });
}
