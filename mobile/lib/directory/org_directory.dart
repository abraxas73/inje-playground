import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/client.dart';
import '../gw/gw_api.dart';
import '../gw/gw_client.dart' show asStr;
import '../gw/gw_mcp_api.dart';

/// 사내 명부(조직도) — 서버가 매일 동기화한 `GET /api/directory/org`를 쓴다(매번 아마란스 조직도를 훑지 않게).
/// 서버가 안 되면(권한 꺼짐·명부 비어 있음·오프라인) 예전처럼 아마란스 조직도(rosterRows)에서 직접 받는다.
typedef OrgPerson = ({String empSeq, String name, String email, String dept, String duty, String position, String photo, String photoLarge});

/// 아마란스 사진 주소 — 로그인 쿠키(BIZCUBE_AT·HK)가 있어야 받힌다(`person_view.dart` gwPhotoHeadersProvider, 2026-11-04 실측). 없으면 빈 문자열.
const _gwPhotoBase = 'https://gw.innogrid.com/gw/contentsImgController/download/';
({String photo, String photoLarge}) gwPhotoUrls(String groupSeq, String picFileId) {
  final ok = RegExp(r'^[A-Za-z0-9_-]+$');
  if (!ok.hasMatch(groupSeq) || !RegExp(r'^[A-Za-z0-9_.-]+$').hasMatch(picFileId)) return (photo: '', photoLarge: '');
  return (photo: '$_gwPhotoBase$groupSeq/empPic/thum_$picFileId', photoLarge: '$_gwPhotoBase$groupSeq/empPic/$picFileId');
}

/// 서버 명부의 사진 경로 "{groupSeq}/empPic/{picFileId}" → 아마란스 주소(앱은 아마란스 연결 쿠키로 직접 받는다).
({String photo, String photoLarge}) _photoOf(Object? path) {
  final parts = asStr(path).split('/');
  return parts.length == 3 && parts[1] == 'empPic' ? gwPhotoUrls(parts[0], parts[2]) : (photo: '', photoLarge: '');
}

List<OrgPerson> parseOrgPeople(dynamic j) {
  final list = j is Map && j['people'] is List ? j['people'] as List : const [];
  return [
    for (final p in list.whereType<Map>())
      if (asStr(p['name']).trim().isNotEmpty)
        for (final ph in [_photoOf(p['photoPath'])])
          (empSeq: asStr(p['empSeq']), name: asStr(p['name']).trim(), email: asStr(p['email']), dept: asStr(p['deptName']), duty: asStr(p['duty']), position: asStr(p['position']), photo: ph.photo, photoLarge: ph.photoLarge),
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
        for (final ph in [gwPhotoUrls(asStr(r['groupSeq']), asStr(r['picFileId']))])
        (
          empSeq: asStr(r['empSeq']),
          name: asStr(r['empName']).trim(),
          email: asStr(r['emailAddr']).contains('@') || asStr(r['emailAddr']).isEmpty ? asStr(r['emailAddr']) : '${asStr(r['emailAddr'])}@${asStr(r['emailDomain']).isEmpty ? 'innogrid.com' : asStr(r['emailDomain'])}',
          dept: asStr(r['deptName']),
          duty: asStr(r['dutyName']),
          position: asStr(r['positionName']),
          photo: ph.photo,
          photoLarge: ph.photoLarge,
        ),
  ];
});

/// 사번 → 사람(메신저 아바타·상세 보기). 명부를 못 읽으면 빈 표 — 화면은 이름 첫 글자로 그린다.
final orgPersonBySeqProvider = FutureProvider<Map<String, OrgPerson>>((ref) async {
  try {
    return {for (final p in await ref.watch(orgPeopleProvider.future)) if (p.empSeq.isNotEmpty) p.empSeq: p};
  } catch (_) {
    return const {};
  }
});
