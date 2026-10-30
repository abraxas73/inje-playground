import 'package:flutter_test/flutter_test.dart';
import 'package:playground/gw/gw_attend_range.dart';
import 'package:playground/gw/gw_models.dart';
import '../assistant/gw_assistant_api_test.dart' show Gw, session;

Map<String, dynamic> node(String id, String parent, String name) => {'id': id, 'keySeq': 'd$id', 'parentKeySeq': 'd$parent', 'text': name, 'orgGubun': 'd', 'compSeq': '10'};
final tree = [
  node('1', '0', '이노그리드'),
  node('5', '1', 'R&D본부'),
  node('10', '5', '클라우드 네이티브 센터'),
  node('20', '10', '네이티브 플랫폼팀'),
  node('21', '10', 'AI플랫폼팀'),
  node('11', '5', '다른센터'),
  node('30', '11', '다른팀'),
];

void main() {
  test('프리셋 기간 — 이번주는 월~금, 과거·미래 일주일은 오늘 포함 7일', () {
    final fri = DateTime.utc(2026, 10, 30, 15);
    expect(presetRange(AttendPreset.today, fri), (DateTime.utc(2026, 10, 30), DateTime.utc(2026, 10, 30)));
    expect(presetRange(AttendPreset.thisWeek, fri), (DateTime.utc(2026, 10, 26), DateTime.utc(2026, 10, 30)));
    expect(presetRange(AttendPreset.pastWeek, fri), (DateTime.utc(2026, 10, 24), DateTime.utc(2026, 10, 30)));
    expect(presetRange(AttendPreset.nextWeek, fri), (DateTime.utc(2026, 10, 30), DateTime.utc(2026, 11, 5)));
    expect(presetRange(AttendPreset.thisWeek, DateTime.utc(2026, 11, 1)).$2, DateTime.utc(2026, 10, 30)); // 일요일도 그 주 월~금
  });

  test('조직 범위 — 팀은 내 부서, 센터·본부는 위로 올라가 찾은 부서 아래 전부(이름 공백 무시)', () {
    final s = attendScopes(tree, '20');
    expect(s[AttendScope.team], {'네이티브플랫폼팀'});
    expect(s[AttendScope.center], {'클라우드네이티브센터', '네이티브플랫폼팀', 'AI플랫폼팀'});
    expect(s[AttendScope.hq], containsAll(['R&D본부', '다른센터', '다른팀', 'AI플랫폼팀']));
    expect(attendScopes([node('20', '0', '외딴팀')], '20').keys, [AttendScope.team]); // 센터·본부가 없으면 그 칩은 없다
  });

  test('검색은 이름 또는 조직명, 범위는 부서 이름', () {
    const list = [
      AttendEntry(date: '20261030', empCd: '1', name: '김민규', dept: '네이티브 플랫폼팀', kind: '연차'),
      AttendEntry(date: '20261030', empCd: '2', name: '홍길동', dept: '다른팀', kind: '출장'),
    ];
    expect(filterAttend(list, query: '민규').map((e) => e.empCd), ['1']);
    expect(filterAttend(list, query: '네이티브 플랫폼').map((e) => e.empCd), ['1']);
    expect(filterAttend(list, depts: {'다른팀'}).map((e) => e.empCd), ['2']);
  });

  test('근태 신청은 기간 안의 날짜로 펼치고, 반려·삭제 요청은 뺀다', () {
    final r = {'empCd': '1', 'empNm': '김', 'deptNm': '팀', 'atCdNm': '연차', 'startDt': '20261103', 'endDt': '20261106'};
    expect(applicationDays(r, '20261104', '20261105').map((e) => e.date), ['20261104', '20261105']);
    expect(applicationDays({...r, 'approStateNm': '반려'}, '20261101', '20261130'), isEmpty);
    expect(applicationDays({...r, 'deleteReqYn': 'Y'}, '20261101', '20261130'), isEmpty);
    expect(applicationDays({...r, 'startDt': '20261030', 'endDt': '20261102'}, '20261030', '20261106').map((e) => e.date), ['20261030', '20261102']); // 금~월이면 주말 빼고
    expect(applicationDays({...r, 'startDt': '2026-11-'}, '20261101', '20261130'), isEmpty); // 형식이 이상하면 그 건만 뺀다
  });

  test('기간 조회 — 지난 날은 전사 현황, 오늘은 오늘 근태, 내일부터는 범위 안 사람만 신청 목록', () async {
    final today = kstNow(), t = DateTime.utc(today.year, today.month, today.day);
    var next = t.add(const Duration(days: 1));
    while (next.weekday >= DateTime.saturday) {
      next = next.add(const Duration(days: 1));
    }
    final y8 = ymd(t.subtract(const Duration(days: 1))), t8 = ymd(t), n8 = ymd(next); // 미래 신청은 평일만 남는다
    final gw = Gw({
      '/gw/gw050A02': (_) => session,
      '/gw/APIHandler/gw102A01': (_) => {'treeList': tree},
      '/human/openapi/worktime/status/getWorkTimeStatusList': (_) => [
            {'empCd': 'A', 'korNm': '김민규', 'deptNm': '네이티브 플랫폼팀', 'atDt': y8, 'atNm': '연차'},
            {'empCd': 'B', 'korNm': '홍길동', 'deptNm': '다른팀', 'atDt': y8, 'atNm': '출장'},
            {'empCd': 'C', 'korNm': '이영희', 'deptNm': 'AI플랫폼팀', 'atDt': y8, 'atNm': ''},
          ],
      '/human/openapi/attendapplication/getTodayApplicationDetails': (_) => [
            {'empCd': 'C', 'empNm': '이영희', 'atNm': '재택', 'messengerYn': 'Y'},
            {'empCd': 'B', 'empNm': '홍길동', 'atNm': '외근', 'messengerYn': 'N'}, // 메신저 표시 안 함
          ],
      '/human/attendapplication/at00001': (b) => b['empCd'] == 'A' ? [{'empCd': 'A', 'empNm': '김민규', 'deptNm': '네이티브 플랫폼팀', 'atCdNm': '반차', 'startDt': n8, 'endDt': n8}] : [],
    });
    final api = gw.api();
    final depts = (await api.attendScopeDepts())[AttendScope.center];
    final r = await api.attendRange(t.subtract(const Duration(days: 1)), next, depts: depts);
    expect(r.entries.map((e) => '${e.date == y8 ? 'y' : e.date == t8 ? 't' : 'n'}:${e.name}:${e.kind}:${e.dept}'), unorderedEquals(['y:김민규:연차:네이티브 플랫폼팀', 't:이영희:재택:AI플랫폼팀', 'n:김민규:반차:네이티브 플랫폼팀']));
    expect(r.futureSkipped, isFalse);
    expect(gw.calls['/human/attendapplication/at00001']!.map((b) => b['empCd']), unorderedEquals(['A', 'C'])); // 센터 밖(B)은 부르지 않는다
    expect(gw.calls['/human/openapi/worktime/status/getWorkTimeStatusList']!.single['empCdList'], isEmpty);

    final all = await api.attendRange(t, t.add(const Duration(days: 1)));
    expect(all.futureSkipped, isTrue);
    expect(all.entries.map((e) => e.name), ['이영희']);
    expect(gw.calls['/human/attendapplication/at00001']!.length, 2); // 전체면 미래를 읽지 않는다
  });
}
