import 'package:flutter_test/flutter_test.dart';
import 'package:playground/assistant/assistant_session.dart';
import 'package:playground/assistant/gw_assistant_api.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'assistant_session_test.dart' show say, use, scope, scenarioGw, toolResults;
import 'chat_brain.dart';
import 'gw_assistant_api_test.dart' show Gw, base;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('myTeam — 내 부서(세션 deptSeq) 사람 전원, 나는 빼고', () async {
    final team = await Gw(base()).api().myTeam();
    expect(team.map((p) => '${p.name}(${p.deptName})'), ['강승억(클라우드팀)', '김민준(클라우드팀)']);
  });

  test('createEvent — 캘린더를 고르면 그 mcalSeq·calType으로, 모르는 캘린더는 오류', () async {
    final gw = Gw({
      ...base(),
      '/schres/sc111A02': (_) => {'resultList': [
            {'mcalSeq': '1', 'calType': 'E', 'empSeq': '7', 'calTitle': '내 캘린더'},
            {'mcalSeq': '9', 'calType': 'M', 'empSeq': '0', 'calTitle': '이노그리드'},
            {'mcalSeq': '8', 'calType': 'M', 'empSeq': '0', 'calTitle': '부서'},
          ]},
      '/schres/sc111A05': (_) => {'schSeq': '900'},
      '/schres/sc111A03': (_) => {'resultList': [{'schSeq': '900', 'schTitle': '내부회의', 'createSeq': '7'}]},
      // 실측(2026-11-11 이노그리드 캘린더) 모양: 같은 조직이 권한별로 여러 번, 안 쓰는 항목(useYn N), 소유자(userType 90)
      '/schres/sc111A07': (_) => {'ownerDeptSeq': '3052', 'calUserList': [
            {'orgType': 'C', 'orgSeq': '1000', 'compSeq': '1000', 'deptSeq': '', 'userType': '10', 'useYn': 'Y'},
            {'orgType': 'C', 'orgSeq': '1000', 'compSeq': '1000', 'deptSeq': '', 'userType': '20', 'useYn': 'Y'},
            {'orgType': 'D', 'orgSeq': '2057', 'compSeq': '1000', 'deptSeq': '2057', 'userType': '00', 'useYn': 'Y'},
            {'orgType': 'D', 'orgSeq': '2007', 'compSeq': '1000', 'deptSeq': '2007', 'userType': '10', 'useYn': 'N'},
            {'orgType': 'D', 'orgSeq': '2057', 'compSeq': '1000', 'deptSeq': '2057', 'userType': '20', 'useYn': 'Y'},
            {'orgType': 'E', 'orgSeq': '3273', 'compSeq': '1000', 'deptSeq': '', 'userType': '90', 'useYn': 'Y'},
          ]},
    });
    final r = await gw.api().createEvent(title: '내부회의', start: '202610051500', end: '202610051600', calendarId: '9');
    expect(r['ok'], isTrue);
    final b = gw.calls['/schres/sc111A05']!.single;
    expect((b['mcalSeq'], b['calType']), ('9', 'M'));
    expect(b['schUserList'], [
      {'compSeq': '1000', 'deptSeq': '', 'orgType': 'C', 'orgSeq': '1000', 'userType': '20'},
      {'compSeq': '1000', 'deptSeq': '2057', 'orgType': 'D', 'orgSeq': '2057', 'userType': '20'},
      {'compSeq': '1000', 'deptSeq': '3052', 'orgType': 'E', 'orgSeq': '3273', 'empSeq': '3273', 'userType': '20'},
    ], reason: '이노그리드 캘린더는 웹처럼 그 캘린더 구성원이 공개범위로 들어간다');
    await gw.api().createEvent(title: '내부회의', start: '202610051500', end: '202610051600', calendarId: '8');
    expect(gw.calls['/schres/sc111A05']!.last['schUserList'], isEmpty, reason: '다른 공유캘린더는 예전처럼 비운다');
    await expectLater(gw.api().createEvent(title: 't', start: '202610051500', end: '202610051600', calendarId: '99'), throwsA(isA<GwException>()));
    final personal = await gw.api().createEvent(title: '내부회의', start: '202610051500', end: '202610051600');
    expect(personal['ok'], isTrue);
    expect(gw.calls['/schres/sc111A05']!.last['mcalSeq'], '1', reason: '지정 안 하면 개인 캘린더');
    expect(gw.calls['/schres/sc111A05']!.last['schUserList'], isEmpty, reason: '개인 캘린더는 웹도 공개범위를 비운다');
    expect(gw.calls['/schres/sc111A07'], hasLength(1), reason: '이노그리드 말고는 캘린더 정보를 묻지 않는다');
  });

  test('비서 — 우리 팀 전원 + 캘린더 지정: my_team은 바로, 카드에 캘린더 이름, 실행하면 그 캘린더에', () async {
    final brain = ChatBrain([
      use([('t', 'my_team', {}), ('c', 'list_calendars', {})]),
      use([
        ('e', 'create_event', {
          'title': '내부회의',
          'start': '2026-10-05T16:00',
          'end': '2026-10-05T17:00',
          'calendar_id': '9',
          'attendees': [
            {'emp_seq': '31', 'dept_seq': '20', 'name': '강승억'},
            {'emp_seq': '33', 'dept_seq': '20', 'name': '김민준'},
          ],
        }),
      ]),
      say('등록했습니다.'),
    ]);
    final gw = scenarioGw();
    final c = scope(brain, gw);
    final s = c.read(assistantSessionProvider.notifier);
    await s.send('우리팀 전원 내부회의');
    final team = toolResults(brain.received[1]).first['content'] as String;
    expect(team, contains('김민준'));
    final card = c.read(assistantSessionProvider).items.last;
    expect(card.lines.single, contains('캘린더 부서'));
    expect(card.lines.single, contains('참석 강승억(클라우드팀), 김민준(클라우드팀)'));
    await s.confirm();
    expect(gw.calls['/schres/sc111A05']!.single['mcalSeq'], '9');
  });

  test('비서 — 볼 수 없는 캘린더 id면 카드 없이 오류 결과', () async {
    final brain = ChatBrain([
      use([('e', 'create_event', {'title': 't', 'start': '2026-10-05T16:00', 'end': '2026-10-05T17:00', 'calendar_id': '99'})]),
      say('다시 볼게요.'),
    ]);
    final c = scope(brain, scenarioGw());
    await c.read(assistantSessionProvider.notifier).send('일정');
    final r = toolResults(brain.received[1]).single;
    expect(r['is_error'], isTrue);
    expect(r['content'], contains('캘린더'));
    expect(c.read(assistantSessionProvider).pending, isFalse);
  });
}
