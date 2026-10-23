import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/client.dart';
import '../gw/gw_api.dart';
import '../gw/gw_client.dart' show asStr;
import '../gw/gw_mcp_api.dart';

/// 사내 명부(조직도) — 서버가 매일 동기화한 `GET /api/directory/org`를 쓴다(매번 아마란스 조직도를 훑지 않게).
/// 서버가 안 되면(권한 꺼짐·명부 비어 있음·오프라인) 예전처럼 아마란스 조직도(rosterRows)에서 직접 받는다.
typedef OrgPerson = ({String empSeq, String name, String email, String dept, String duty});

List<OrgPerson> parseOrgPeople(dynamic j) {
  final list = j is Map && j['people'] is List ? j['people'] as List : const [];
  return [
    for (final p in list.whereType<Map>())
      if (asStr(p['name']).trim().isNotEmpty)
        (empSeq: asStr(p['empSeq']), name: asStr(p['name']).trim(), email: asStr(p['email']), dept: asStr(p['deptName']), duty: asStr(p['duty'])),
  ];
}

final orgPeopleProvider = FutureProvider<List<OrgPerson>>((ref) async {
  try {
    final people = parseOrgPeople(await ref.read(apiClientProvider).getJson('/api/directory/org'));
    if (people.isNotEmpty) return people;
  } catch (_) {}
  final api = ref.watch(gwApiProvider);
  if (api == null) throw StateError('사내 명부를 불러오지 못했습니다. 아마란스를 연결해 주세요.');
  return [
    for (final r in await api.rosterRows())
      if (asStr(r['empName']).trim().isNotEmpty)
        (
          empSeq: asStr(r['empSeq']),
          name: asStr(r['empName']).trim(),
          email: asStr(r['emailAddr']).contains('@') || asStr(r['emailAddr']).isEmpty ? asStr(r['emailAddr']) : '${asStr(r['emailAddr'])}@${asStr(r['emailDomain']).isEmpty ? 'innogrid.com' : asStr(r['emailDomain'])}',
          dept: asStr(r['deptName']),
          duty: asStr(r['dutyName']),
        ),
  ];
});
