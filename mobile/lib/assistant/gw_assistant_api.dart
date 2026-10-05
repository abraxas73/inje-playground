// mobile/lib/assistant/gw_assistant_api.dart
import '../gw/gw_api.dart';
import '../gw/gw_client.dart';
import '../gw/gw_models.dart';

/// 비서용 아마란스 호출 — 사람 찾기·빈 회의실·예약/취소·일정 등록/삭제. 근거: inno-creed src/modules/{org,resource,calendar}.rs(실측).
/// GW 호출은 GwClient만 경유하고 쓰기는 read-back으로 판정한다. 값은 로그에 찍지 않는다.

class GwPerson {
  const GwPerson({required this.empSeq, required this.name, required this.deptSeq, required this.deptName, required this.email, required this.duty, required this.position});
  final String empSeq, name, deptSeq, deptName, email, duty, position;
  factory GwPerson.fromRow(Map m) => GwPerson(empSeq: asStr(m['empSeq']), name: asStr(m['empName']), deptSeq: asStr(m['deptSeq']), deptName: asStr(m['deptName']), email: asStr(m['emailAddr']), duty: asStr(m['dutyName']), position: asStr(m['positionName']));
  Map<String, dynamic> toJson() => {'empSeq': empSeq, 'name': name, 'deptSeq': deptSeq, 'deptName': deptName, 'email': email, 'duty': duty, 'position': position};
}

/// 사내 점심(자정 기준 분). 서버가 막지 않으므로 빈 회의실에서 뺀다(inno-creed LUNCH).
const lunchBreak = (780, 840);

String _two(int v) => v.toString().padLeft(2, '0');
String gwStamp(DateTime t) => '${t.year}${_two(t.month)}${_two(t.day)}${_two(t.hour)}${_two(t.minute)}';
String _hhmm(int m) => '${_two(m ~/ 60)}:${_two(m % 60)}';
String _iso(String ts12) => ts12.length == 12 ? '${ts12.substring(0, 4)}-${ts12.substring(4, 6)}-${ts12.substring(6, 8)}T${ts12.substring(8, 10)}:${ts12.substring(10, 12)}' : ts12;

/// 'YYYY-MM-DDTHH:mm' → DateTime.utc(벽시계 — kstNow()와 같은 규약). 형식이 다르면 null.
DateTime? parseLocal(String s) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})').firstMatch(s.trim());
  if (m == null) return null;
  return DateTime.utc(int.parse(m[1]!), int.parse(m[2]!), int.parse(m[3]!), int.parse(m[4]!), int.parse(m[5]!));
}

/// 'YYYYMMDDHHmm'을 그날(ymd8) 기준 분으로. 전날 이전은 -무한, 다음 날 이후는 +무한(하루 전체 점유). 12자리가 아니면 null.
int? minutesOn(String ts, String ymd8) {
  if (ts.length != 12) return null;
  final day = ts.substring(0, 8);
  if (day.compareTo(ymd8) < 0) return -(1 << 40);
  if (day.compareTo(ymd8) > 0) return 1 << 40;
  return int.parse(ts.substring(8, 10)) * 60 + int.parse(ts.substring(10, 12));
}

/// 점유 구간을 뺀 [winStart, winEnd] 안의 빈 구간 중 duration 이상.
List<(int, int)> freeSlots(List<(int, int)> busy, int winStart, int winEnd, int duration) {
  final sorted = [...busy]..sort((a, b) => a.$1.compareTo(b.$1));
  final out = <(int, int)>[];
  var cur = winStart;
  for (final (s, e) in sorted) {
    if (e <= cur) continue;
    if (s >= winEnd) break;
    if (s > cur && s - cur >= duration) out.add((cur, s));
    if (e > cur) cur = e;
  }
  if (winEnd - cur >= duration) out.add((cur, winEnd));
  return out;
}

final _rosterCache = Expando<(DateTime, List<GwPerson>)>();
const _rosterTtl = Duration(minutes: 30);

extension GwAssistantApi on GwApi {
  /// 전사 명부(30분 캐시) — gw102A01 부서 트리에서 인원 있는 부서(gubun d)만 gw102A02로 훑는다(동시 8). 부서 하나 실패는 건너뛴다.
  Future<List<GwPerson>> roster() async {
    final hit = _rosterCache[client];
    if (hit != null && DateTime.now().difference(hit.$1) < _rosterTtl) return hit.$2;
    final tree = await client.call('/gw/APIHandler/gw102A01', {'parentSeq': '0', 'popupType': 'main', 'selectedType': 'tree', 'isAllCompShow': false, 'compFilter': '', 'isTreeChecked': '', 'isTreeAllOpen': true, 'isPartYn': false});
    final nodes = (tree is Map ? tree['treeList'] : null) as List? ?? const [];
    final depts = [for (final d in nodes) if (d is Map && asStr(d['orgGubun']) == 'd' && asInt(d['childUserCnt']) > 0) asStr(d['id'])];
    final seen = <String>{};
    final people = <GwPerson>[];
    for (var i = 0; i < depts.length; i += 8) {
      final batch = depts.sublist(i, i + 8 > depts.length ? depts.length : i + 8);
      final results = await Future.wait(batch.map((id) => client.call('/gw/APIHandler/gw102A02', {
            'selectedId': id, 'orgGubun': 'd', 'popupType': 'main', 'selectedType': 'tree', 'searchDiv': 'all', 'searchText': '', 'isBdayOption': '1', 'isJoinDayOption': '0', 'isOrganizationDisplayOption': '5|0|1|3|', 'isGridListDisplayOption': '0', 'isLoginIdOption': '1',
          }).then<List>((v) => v is List ? v : const []).catchError((_) => const [])));
      for (final list in results) {
        for (final m in list) {
          if (m is! Map) continue;
          final p = GwPerson.fromRow(m);
          if (p.empSeq.isNotEmpty && seen.add(p.empSeq)) people.add(p);
        }
      }
    }
    _rosterCache[client] = (DateTime.now(), people);
    return people;
  }

  /// 이름 정확 일치가 있으면 그것만(동명이인 전부), 없으면 이름·이메일 부분 일치. 최대 10명.
  Future<List<GwPerson>> findPerson(String q) async {
    final query = q.trim().toLowerCase();
    if (query.isEmpty) return const [];
    final all = await roster();
    final exact = all.where((p) => p.name.toLowerCase() == query).toList();
    final hits = exact.isNotEmpty ? exact : all.where((p) => p.name.toLowerCase().contains(query) || p.email.toLowerCase().contains(query)).toList();
    return hits.take(10).toList();
  }

  Future<List<Map>> _reservationRows(DateTime from, DateTime to) async {
    final rooms = await resources();
    final d = await client.call('/schres/rs121A05', {
      'companyInfo': await client.companyInfo(), 'startDate': ymd(from), 'endDate': ymd(to), 'statusType': ['10', '20'], 'resList': [for (final r in rooms) {'resSeq': r.resSeq}],
      'statusCode': '', 'searchType': '', 'sechType': '', 'menuAuth': 'USER', 'langCode': 'kr',
    });
    return ((d is Map ? d['resultList'] : null) as List? ?? const []).whereType<Map>().toList();
  }

  /// 하루 [fromMin, toMin] 창에서 duration분 이상 빈 회의실. 점심 제외. 가장 이른 빈 구간 순.
  Future<List<Map<String, dynamic>>> freeRooms(DateTime day, int fromMin, int toMin, int duration, {String group = ''}) async {
    final attr = switch (group.trim()) { '본사' => '1', '구로' => '3', _ => '' };
    final rooms = (await resources()).where((r) => attr.isEmpty || r.attrSeq == attr).toList();
    final rows = await _reservationRows(day, day);
    final d8 = ymd(day);
    final out = <Map<String, dynamic>>[];
    for (final room in rooms) {
      final busy = <(int, int)>[lunchBreak];
      for (final b in rows.where((b) => asStr(b['resSeq']) == room.resSeq)) {
        final s = minutesOn(asStr(b['resStartDate']), d8), e = minutesOn(asStr(b['resEndDate']), d8);
        if (s != null && e != null) busy.add((s, e));
      }
      final slots = freeSlots(busy, fromMin, toMin, duration);
      if (slots.isNotEmpty) out.add({'resSeq': room.resSeq, 'resName': room.resName, 'group': room.attrName, 'freeSlots': [for (final (a, b) in slots) {'from': _hhmm(a), 'to': _hhmm(b)}]});
    }
    out.sort((a, b) => ((a['freeSlots'] as List).first['from'] as String).compareTo((b['freeSlots'] as List).first['from'] as String));
    return out;
  }

  /// 내 예약(취소에 필요한 seqNum·resIdx 포함).
  Future<List<Map<String, dynamic>>> myReservations(DateTime from, DateTime to) async {
    final me = client.creds().empSeq;
    return [
      for (final r in await _reservationRows(from, to))
        if (asStr(r['empSeq']) == me) {'resSeq': asStr(r['resSeq']), 'resName': asStr(r['resName']), 'seqNum': asInt(r['seqNum']), 'resIdx': asStr(r['resIdx']).isEmpty ? '1' : asStr(r['resIdx']), 'start': _iso(asStr(r['resStartDate'])), 'end': _iso(asStr(r['resEndDate'])), 'title': asStr(r['reqText'])},
    ];
  }

  Future<dynamic> _reservationDetail(String resSeq, int seqNum, String resIdx) async =>
      client.call('/schres/rs121A10', {'companyInfo': await client.companyInfo(), 'resSeq': resSeq, 'seqNum': seqNum, 'resIdx': resIdx, 'langCode': 'kr'});

  /// 회의실 예약(rs121A06) → 상세 read-back(rs121A10). 참석자 목록은 본인만(일정 등록이 참석자를 초대한다).
  Future<Map<String, dynamic>> reserveRoom({required String resSeq, required String start, required String end, required String title}) async {
    final c = client.creds();
    final s = await client.session();
    final reg = await client.call('/schres/rs121A06', {
      'companyInfo': await client.companyInfo(), 'resSeq': resSeq, 'reqText': title, 'apprYn': 'N', 'alldayYn': 'N', 'startDate': start, 'endDate': end, 'descText': '',
      'resSubscriberList': [{'groupSeq': c.groupSeq, 'compSeq': s.compSeq, 'deptSeq': s.deptSeq, 'empSeq': c.empSeq}], 'uidList': '', 'repeatType': '10', 'repeatEndDay': '', 'langCode': 'kr',
    });
    final seqNum = asInt(reg is Map ? reg['seqNum'] : null, -1);
    if (seqNum < 0) throw GwException(200, 0, '예약 응답에 예약 번호가 없습니다');
    final resIdx = asStr(reg is Map ? reg['resIdx'] : null).isEmpty ? '1' : asStr((reg as Map)['resIdx']);
    final detail = await _reservationDetail(resSeq, seqNum, resIdx);
    final ok = detail is Map && asStr(detail['reqText']) == title;
    return {'ok': ok, 'resSeq': resSeq, 'seqNum': seqNum, 'resIdx': resIdx, 'title': title, 'start': start, 'end': end};
  }

  /// 내 예약 취소 — 상세 스냅샷(소유권 확인) → rs121A11 → 재조회가 실패하면 취소됨.
  Future<Map<String, dynamic>> cancelReservation(String resSeq, int seqNum, String resIdx) async {
    final d = await _reservationDetail(resSeq, seqNum, resIdx);
    if (d is! Map || asStr(d['empSeq']) != client.creds().empSeq) throw GwException(200, 0, '본인 예약이 아니라 취소할 수 없습니다');
    await client.call('/schres/rs121A11', {
      'companyInfo': await client.companyInfo(), 'statusCode': 'CA', 'deleteRangeCode': 'UO',
      'resSeqList': [{'resSeq': resSeq, 'seqNum': seqNum, 'resIdx': resIdx, 'reqText': asStr(d['reqText']), 'startDate': asStr(d['startDate']), 'endDate': asStr(d['endDate']), 'createDate': asStr(d['createDate']), 'schmSeq': '', 'schSeq': '', 'resName': asStr(d['resName']), 'alldayYn': 'N'}],
      'langCode': 'kr',
    });
    var gone = false;
    try {
      await _reservationDetail(resSeq, seqNum, resIdx);
    } on GwException {
      gone = true;
    }
    return {'ok': gone, 'canceled': true};
  }

  /// 내 개인 캘린더에 일정 등록(sc111A05 신규). 주최 M(본인) + 참석 W(각자 부서, 중복 제거), mailSend N. read-back은 그날 목록의 제목.
  Future<Map<String, dynamic>> createEvent({required String title, required String start, required String end, List<GwPerson> attendees = const [], String place = ''}) async {
    final c = client.creds();
    final s = await client.session();
    final cal = (await calendars()).where((x) => x.personal && x.ownerEmpSeq == c.empSeq).firstOrNull;
    if (cal == null) throw GwException(200, 0, '내 개인 캘린더를 찾지 못했습니다');
    Map<String, String> part(String emp, String dept, String name, String type) => {'compSeq': s.compSeq, 'deptSeq': dept, 'orgType': 'E', 'orgSeq': emp, 'empSeq': emp, 'empName': name, 'partType': type, 'mcalSeq': ''};
    final seen = <String>{c.empSeq};
    final guests = [for (final p in attendees) if (seen.add(p.empSeq)) p];
    final reg = await client.call('/schres/sc111A05', {
      'companyInfo': await client.companyInfo(), 'schSeq': '', 'schmSeq': '', 'schGbnCode': '10', 'schTitle': title, 'mcalSeq': cal.mcalSeq, 'calType': cal.calType,
      'startDate': start, 'endDate': end, 'gbnCode': 'E', 'repeatType': '10', 'repeatByDay': '', 'repeatEndDay': '', 'rangeCode': 'N', 'alarm_yn': 'Y', 'schAlarmList': [],
      'contents': place.trim().isEmpty ? '' : '장소: ${place.trim()}', 'myMemo': '', 'alldayYn': 'N', 'lunarYn': 'N', 'inviterPartType': 'M',
      'schPartEmpList': [part(c.empSeq, s.deptSeq, s.empName, 'M'), for (final g in guests) part(g.empSeq, g.deptSeq, g.name, 'W')],
      'schUserList': [], 'addressUserList': [], 'resList': [], 'reservedList': [], 'uidList': '', 'placeMapData': '{}', 'otherLinkList': [],
      'groupSeq': c.groupSeq, 'empSeq': c.empSeq, 'videoYn': 'N', 'videoTimeZone': 'Asia/Seoul', 'mailSend': 'N', 'langCode': 'kr',
    });
    final schSeq = asStr(reg is Map ? reg['schSeq'] : null);
    if (schSeq.isEmpty) throw GwException(200, 0, '일정 등록 응답에 일정 번호가 없습니다');
    final day = DateTime(int.parse(start.substring(0, 4)), int.parse(start.substring(4, 6)), int.parse(start.substring(6, 8)));
    final row = (await eventRows(day)).where((r) => asStr(r['schSeq']) == schSeq).firstOrNull;
    return {'ok': row != null && asStr(row['schTitle']) == title, 'schSeq': schSeq, 'title': title, 'start': start, 'end': end, 'attendees': [for (final g in guests) g.name]};
  }

  /// 내가 등록한 일정 삭제(sc111A06) — 그날 목록에서 createSeq 확인 → 삭제 → 다시 없으면 성공.
  Future<Map<String, dynamic>> deleteEvent(String schSeq, String dateYmd8) async {
    final day = DateTime(int.parse(dateYmd8.substring(0, 4)), int.parse(dateYmd8.substring(4, 6)), int.parse(dateYmd8.substring(6, 8)));
    final row = (await eventRows(day)).where((r) => asStr(r['schSeq']) == schSeq).firstOrNull;
    if (row == null) throw GwException(200, 0, '그 날짜에서 일정을 찾지 못했습니다');
    if (asStr(row['createSeq']) != client.creds().empSeq) throw GwException(200, 0, '내가 등록한 일정이 아니라 삭제할 수 없습니다');
    await client.call('/schres/sc111A06', {'mcalSeq': asStr(row['mcalSeq']), 'schmSeq': schSeq, 'schSeq': schSeq, 'rangeCode': '', 'langCode': 'kr'});
    final still = (await eventRows(day)).any((r) => asStr(r['schSeq']) == schSeq);
    return {'ok': !still, 'deleted': true};
  }
}
