import 'gw_api.dart';
import 'gw_client.dart';

class GwOrgMemberStatus {
  const GwOrgMemberStatus(this.empSeq, this.name, this.tag);
  final String empSeq, name, tag;
}

class GwOrgAbsences {
  const GwOrgAbsences({
    required this.scopeName,
    required this.isCenter,
    required this.members,
  });
  final String scopeName;
  final bool isCenter;
  final List<GwOrgMemberStatus> members;
}

/// 직책과 조직도 계층으로만 범위를 정한다. 이름이 비슷한 다른 센터를 포함하지 않는다.
Set<String> absenceDepartmentIds(
  List<Map> nodes,
  String department,
  String duty,
) {
  if (department.isEmpty) throw GwException(200, 0, '소속 부서를 확인하지 못했습니다');
  if (duty.trim() != '센터장') return {department};
  final byKey = {
    for (final n in nodes)
      if (asStr(n['orgGubun']) == 'd') asStr(n['keySeq']): n,
  };
  Map? root = byKey['d$department'];
  final visited = <String>{};
  while (root != null && visited.add(asStr(root['keySeq']))) {
    if (asStr(root['text']).trim().endsWith('센터')) break;
    root = byKey[asStr(root['parentKeySeq'])];
  }
  if (root == null || !asStr(root['text']).trim().endsWith('센터')) {
    throw GwException(200, 0, '소속 센터를 확인하지 못했습니다');
  }
  final keys = {asStr(root['keySeq'])};
  var changed = true;
  while (changed) {
    changed = false;
    for (final e in byKey.entries) {
      if (keys.contains(asStr(e.value['parentKeySeq'])) && keys.add(e.key)) {
        changed = true;
      }
    }
  }
  return {for (final key in keys) asStr(byKey[key]!['id'])};
}

extension GwOrgAbsenceApi on GwApi {
  /// gw102A02의 atNm이 조직도 profile_badge에 표시되는 현재 근태 태그다.
  /// 명부의 30분 캐시를 사용하지 않고 새로고침마다 해당 조직만 다시 읽는다.
  Future<GwOrgAbsences> organizationAbsences({bool allCompany = false}) async {
    final me = client.creds().empSeq;
    final session = await client.session();
    Future<List<Map>> members(String dept) async {
      final result = await client.call('/gw/APIHandler/gw102A02', {
        'selectedId': dept,
        'orgGubun': 'd',
        'popupType': 'main',
        'selectedType': 'tree',
        'searchDiv': 'all',
        'searchText': '',
        'isBdayOption': '1',
        'isJoinDayOption': '0',
        'isOrganizationDisplayOption': '5|0|1|3|',
        'isGridListDisplayOption': '0',
        'isLoginIdOption': '1',
      });
      if (result is! List) throw GwException(200, 0, '조직도 상태를 불러오지 못했습니다');
      return result
          .whereType<Map>()
          .where(
            (r) =>
                asStr(r['deptSeq']) == dept &&
                asStr(r['compSeq']) == session.compSeq,
          )
          .toList();
    }

    if (session.deptSeq.isEmpty) throw GwException(200, 0, '소속 부서를 확인하지 못했습니다');
    final ownRows = await members(session.deptSeq);
    final self = ownRows.where((r) => asStr(r['empSeq']) == me).firstOrNull;
    if (!allCompany &&
        (self == null || asStr(self['dutyName']).trim().isEmpty)) {
      throw GwException(200, 0, '내 조직도 정보를 확인하지 못했습니다');
    }
    final center = !allCompany && asStr(self?['dutyName']).trim() == '센터장';
    var scopeName = asStr(self?['deptName']);
    var ids = {session.deptSeq};
    if (center || allCompany) {
      final tree = await client.call('/gw/APIHandler/gw102A01', {
        'parentSeq': '0',
        'popupType': 'main',
        'selectedType': 'tree',
        'isAllCompShow': false,
        'compFilter': '',
        'isTreeChecked': '',
        'isTreeAllOpen': true,
        'isPartYn': false,
      });
      if (tree is! Map || tree['treeList'] is! List) {
        throw GwException(200, 0, '조직도를 불러오지 못했습니다');
      }
      final nodes = (tree['treeList'] as List)
          .whereType<Map>()
          .where((n) => asStr(n['compSeq']) == session.compSeq)
          .toList();
      ids = allCompany
          ? {
              for (final n in nodes)
                if (asStr(n['orgGubun']) == 'd' && asStr(n['id']).isNotEmpty)
                  asStr(n['id']),
            }
          : absenceDepartmentIds(
              nodes,
              session.deptSeq,
              asStr(self?['dutyName']),
            );
      if (ids.isEmpty) throw GwException(200, 0, '회사 조직도를 확인하지 못했습니다');
      final root = nodes
          .where(
            (n) =>
                asStr(n['orgGubun']) == 'd' &&
                ids.contains(asStr(n['id'])) &&
                !ids.contains(asStr(n['parentSeq'])),
          )
          .firstOrNull;
      scopeName = allCompany
          ? '회사 전체'
          : root == null
          ? scopeName
          : asStr(root['text']);
    }
    final rows = [...ownRows];
    final rest = ids.where((id) => id != session.deptSeq).toList();
    for (var i = 0; i < rest.length; i += 8) {
      for (final batch in await Future.wait(
        rest.skip(i).take(8).map(members),
      )) {
        rows.addAll(batch);
      }
    }
    final seen = <String>{};
    final out = <GwOrgMemberStatus>[];
    for (final row in rows) {
      final id = asStr(row['empSeq']), tag = asStr(row['atNm']).trim();
      if (id.isEmpty ||
          id == me ||
          !ids.contains(asStr(row['deptSeq'])) ||
          tag.isEmpty ||
          !seen.add(id)) {
        continue;
      }
      final name = asStr(row['empName']).trim();
      if (name.isNotEmpty) out.add(GwOrgMemberStatus(id, name, tag));
    }
    out.sort((a, b) => a.name.compareTo(b.name));
    return GwOrgAbsences(scopeName: scopeName, isCenter: center, members: out);
  }
}
