import 'package:flutter_test/flutter_test.dart';
import 'package:playground/gw/gw_org_absences.dart';
import 'package:playground/gw/gw_client.dart';
import '../assistant/gw_assistant_api_test.dart' show Gw, session;

Map<String, dynamic> person(
  String id,
  String dept,
  String tag, {
  String duty = '팀원',
  String comp = '10',
}) => {
  'empSeq': id,
  'deptSeq': dept,
  'compSeq': comp,
  'empName': '사람$id',
  'deptName': '소속',
  'dutyName': duty,
  'atNm': tag,
};
Map<String, dynamic> node(String id, String parent, String name) => {
  'id': id,
  'keySeq': 'd$id',
  'parentKeySeq': 'd$parent',
  'parentSeq': parent,
  'text': name,
  'orgGubun': 'd',
  'compSeq': '10',
};
final tree = [
  node('20', '1', '개발센터'),
  node('21', '20', '플랫폼팀'),
  node('22', '20', 'AI팀'),
  node('23', '22', '파트'),
  node('200', '1', '다른센터'),
  node('201', '200', '플랫폼팀'),
];
Gw source(Map<String, List<Map<String, dynamic>>> rows) => Gw({
  '/gw/gw050A02': (_) => session,
  '/gw/APIHandler/gw102A01': (_) => {'treeList': tree},
  '/gw/APIHandler/gw102A02': (b) => rows[b['selectedId']] ?? [],
});

void main() {
  for (final duty in ['팀원', '팀장']) {
    test('$duty: 소속 부서만 조회하고 다른 조직·자기 자신·빈 태그를 제외한다', () async {
      final gw = source({
        '20': [
          person('7', '20', '연차', duty: duty),
          person('8', '20', '외근'),
          person('9', '20', ''),
          person('10', '21', '연차'),
          person('11', '20', '연차', comp: 'other'),
          person('8', '20', '외근'),
        ],
      });
      final r = await gw.api().organizationAbsences();
      expect(r.isCenter, false);
      expect(r.members.map((p) => p.empSeq), ['8']);
      expect(r.members.single.tag, '외근');
      expect(gw.calls['/gw/APIHandler/gw102A01'], isNull);
      expect(gw.calls['/gw/APIHandler/gw102A02']!.map((b) => b['selectedId']), [
        '20',
      ]);
    });
  }
  test('센터장: 센터 직속과 하위 팀·파트만 포함한다', () async {
    final gw = source({
      '20': [person('7', '20', '', duty: '센터장'), person('8', '20', '연차')],
      '21': [person('9', '21', '오후반차')],
      '22': [person('10', '22', '외근')],
      '23': [person('11', '23', '육아휴직')],
      '201': [person('12', '201', '출장')],
    });
    final r = await gw.api().organizationAbsences();
    expect(r.isCenter, true);
    expect(r.scopeName, '개발센터');
    expect(
      r.members.map((p) => p.empSeq),
      unorderedEquals(['8', '9', '10', '11']),
    );
    expect(
      r.members.map((p) => p.tag),
      unorderedEquals(['연차', '오후반차', '외근', '육아휴직']),
    );
    expect(
      gw.calls['/gw/APIHandler/gw102A02']!.map((b) => b['selectedId']),
      unorderedEquals(['20', '21', '22', '23']),
    );
  });
  test('팀 소속 센터장도 가장 가까운 상위 센터만 선택한다', () {
    expect(absenceDepartmentIds(tree, '21', '센터장'), {'20', '21', '22', '23'});
    expect(absenceDepartmentIds(tree, '21', '팀원'), {'21'});
  });
  test('센터 확인 불가·순환 트리는 전사로 확장하지 않고 실패한다', () {
    expect(
      () => absenceDepartmentIds([], '20', '센터장'),
      throwsA(isA<GwException>()),
    );
    expect(
      () => absenceDepartmentIds(
        [node('20', '21', '팀'), node('21', '20', '파트')],
        '20',
        '센터장',
      ),
      throwsA(isA<GwException>()),
    );
  });
  test('새로고침은 캐시 없이 현재 태그를 다시 읽는다', () async {
    final rows = {
      '20': [person('7', '20', ''), person('8', '20', '연차')],
    };
    final gw = source(rows), api = gw.api();
    expect((await api.organizationAbsences()).members.single.tag, '연차');
    rows['20'] = [person('7', '20', ''), person('8', '20', '')];
    expect((await api.organizationAbsences()).members, isEmpty);
  });
  test('내 정보가 없거나 하위 부서 조회가 실패하면 실패를 알린다', () async {
    final missing = source({
      '20': [person('8', '20', '연차')],
    });
    await expectLater(
      missing.api().organizationAbsences(),
      throwsA(isA<GwException>()),
    );
    final failed = source({
      '20': [person('7', '20', '', duty: '센터장')],
    });
    failed.routes['/gw/APIHandler/gw102A02'] = (b) {
      if (b['selectedId'] == '20') return [person('7', '20', '', duty: '센터장')];
      throw StateError('offline');
    };
    await expectLater(
      failed.api().organizationAbsences(),
      throwsA(isA<GwException>()),
    );
  });
}
