import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/gw/gw_models.dart';
import 'package:playground/gw/room_timeline.dart';

GwReservation rv(String seq, String room, String s, String e, String title, {String owner = '김', String emp = '9'}) =>
    GwReservation(resSeq: seq, resName: room, start: s, end: e, title: title, display: '[$owner] $room', owner: owner, ownerEmpSeq: emp, attendees: '', allDay: false);

void main() {
  final day = DateTime.utc(2026, 10, 28);
  test('roomMinute — 그날 분, 앞날은 0·다음 날은 1440', () {
    expect(roomMinute('202610280930', day), 570);
    expect(roomMinute('202610271800', day), 0);
    expect(roomMinute('202610290900', day), 1440);
  });
  testWidgets('자원 종류별 묶음 + 24시간 격자, 막대는 시간에 비례한 위치·폭, 누르면 아래 상세, 처음 위치는 지금 1시간 전', (tester) async {
    tester.view.physicalSize = const Size(1200, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    const rooms = [
      // 아마란스는 표시 순서라 종류가 섞여 온다
      GwResource(resSeq: '1', resName: '회의실 A-1', attrSeq: '1', attrName: '회의실', color: '#748ffc'),
      GwResource(resSeq: '3', resName: 'Meeting RM.4', attrSeq: '3', attrName: '이노_구로 오피스 회의실'),
      GwResource(resSeq: '2', resName: '회의실 B', attrSeq: '1', attrName: '회의실'),
    ];
    final res = [rv('1', '회의실 A-1', '202610280930', '202610281100', 'GRIM-GPU 월간 회의', owner: '권경민', emp: '7'), rv('3', 'Meeting RM.4', '202610270900', '202610291800', '장기 예약')];
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: SingleChildScrollView(child: RoomTimeline(day: day, rooms: rooms, reservations: res, me: '7', now: DateTime.utc(2026, 10, 28, 10, 20))))));
    expect(find.text('회의실'), findsOneWidget); // 종류별 묶음 머리글 하나씩
    expect(find.text('이노_구로 오피스 회의실'), findsOneWidget);
    expect(tester.getTopLeft(find.text('회의실 B')).dy < tester.getTopLeft(find.text('이노_구로 오피스 회의실')).dy, isTrue);
    expect(find.text('0시'), findsOneWidget);
    expect(find.text('23시'), findsOneWidget);
    final sc = tester.widget<SingleChildScrollView>(find.byKey(const ValueKey('room-timeline-scroll')));
    expect(sc.controller!.offset, 9 * RoomTimeline.hourWidth);
    final bar = tester.getRect(find.ancestor(of: find.text('[권경민] GRIM-GPU 월간 회의'), matching: find.byType(InkWell)));
    expect(bar.width, closeTo(1.5 * RoomTimeline.hourWidth, 0.1));
    final box = tester.widget<Container>(find.ancestor(of: find.text('[권경민] GRIM-GPU 월간 회의'), matching: find.byType(Container)).first);
    expect((box.decoration as BoxDecoration).color, const Color(0xFF748FFC)); // 아마란스 자원 색
    final whole = tester.getRect(find.ancestor(of: find.text('[김] 장기 예약'), matching: find.byType(InkWell)));
    expect(whole.width, closeTo(24 * RoomTimeline.hourWidth, 0.1)); // 앞뒤 날에 걸친 예약은 하루 전체
    expect(find.byKey(const ValueKey('room-timeline-detail')), findsNothing);
    await tester.tap(find.text('[권경민] GRIM-GPU 월간 회의'));
    await tester.pump();
    expect(find.byKey(const ValueKey('room-timeline-detail')), findsOneWidget);
    expect(find.text('09:30–11:00'), findsOneWidget);
    await tester.tap(find.text('[권경민] GRIM-GPU 월간 회의')); // 다시 누르면 상세 닫힘
    await tester.pump();
    expect(find.byKey(const ValueKey('room-timeline-detail')), findsNothing);
    // 묶음 머리글을 누르면 접히고 다시 누르면 펼친다(처음엔 펼침)
    await tester.tap(find.byKey(const ValueKey('room-group-1')));
    await tester.pump();
    expect(find.text('회의실 A-1'), findsNothing);
    expect(find.text('회의실 B'), findsNothing);
    expect(find.text('Meeting RM.4'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('room-group-1')));
    await tester.pump();
    expect(find.text('회의실 A-1'), findsOneWidget);
  });
}
