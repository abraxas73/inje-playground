import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'gw_api.dart';
import 'gw_client.dart';
import 'gw_models.dart';

/// 기간 근태(전사) — 근태 화면 프리셋과 홈 부재 위젯 '이번주'. 2026-10-30 웹 세션으로 실측:
/// - 오늘: `/human/openapi/attendapplication/getTodayApplicationDetails`(메신저 P1181과 같은 원본, 날짜 인자는 무시하고 늘 오늘)
/// - 지난 날(어제까지): `getWorkTimeStatusList`에 사번 목록을 비우면 전사(약 340명 × 날짜) — 오늘·미래 행은 없다
/// - 미래(내일부터): 사람별 근태 신청 목록 `/human/attendapplication/at00001`(사번 없이 부르면 0건) — 그래서 조직을 고른 때만
/// 신청 사유·결재 내용은 받더라도 쓰지 않고 이름·부서·근태 종류·시각만 남긴다.

class AttendEntry {
  const AttendEntry({required this.date, required this.empCd, required this.name, required this.dept, required this.kind, this.startTm = '', this.endTm = '', this.startTs = 0, this.endTs = 0});
  /// YYYYMMDD
  final String date;
  final String empCd, name, dept, kind, startTm, endTm;
  /// 오늘 항목만(지금 유효한지 표시용, ms)
  final int startTs, endTs;
  bool activeAt(DateTime now) {
    if (startTs == 0 && endTs == 0) return false;
    final t = now.millisecondsSinceEpoch;
    return (startTs == 0 || t >= startTs) && (endTs == 0 || t <= endTs);
  }
}

enum AttendPreset {
  today('오늘'), thisWeek('이번주'), pastWeek('과거 일주일'), nextWeek('미래 일주일');
  const AttendPreset(this.label);
  final String label;
}

/// 프리셋 → [시작, 끝](KST 날짜, 포함). 이번주는 월~금.
(DateTime, DateTime) presetRange(AttendPreset p, DateTime now) {
  final d = DateTime.utc(now.year, now.month, now.day);
  return switch (p) {
    AttendPreset.today => (d, d),
    AttendPreset.thisWeek => (d.subtract(Duration(days: d.weekday - 1)), d.add(Duration(days: DateTime.friday - d.weekday))),
    AttendPreset.pastWeek => (d.subtract(const Duration(days: 6)), d),
    AttendPreset.nextWeek => (d, d.add(const Duration(days: 6))),
  };
}

enum AttendScope {
  all('전체'), team('우리팀'), center('우리센터'), hq('우리본부');
  const AttendScope(this.label);
  final String label;
}

String _norm(String s) => s.replaceAll(RegExp(r'\s'), '');

/// 조직도 트리(gw102A01 treeList) → 범위별 부서 이름(공백 제거). 근태 원본에는 부서 이름만 있어 이름으로 맞춘다.
/// 센터·본부는 내 부서부터 위로 올라가며 이름이 '센터'·'본부'로 끝나는 첫 부서와 그 아래 전부. 못 찾은 범위는 빠진다.
Map<AttendScope, Set<String>> attendScopes(List<Map> nodes, String myDeptSeq) {
  final byKey = {for (final n in nodes) if (asStr(n['orgGubun']) == 'd') asStr(n['keySeq']): n};
  final me = byKey['d$myDeptSeq'];
  if (me == null) return const {};
  Set<String> under(Map root) {
    final keys = {asStr(root['keySeq'])};
    for (var changed = true; changed;) {
      changed = false;
      for (final e in byKey.entries) {
        if (keys.contains(asStr(e.value['parentKeySeq'])) && keys.add(e.key)) changed = true;
      }
    }
    return {for (final k in keys) _norm(asStr(byKey[k]!['text']))};
  }
  Map? up(String suffix) {
    final seen = <String>{};
    for (Map? n = me; n != null && seen.add(asStr(n['keySeq'])); n = byKey[asStr(n['parentKeySeq'])]) {
      if (asStr(n['text']).trim().endsWith(suffix)) return n;
    }
    return null;
  }
  final center = up('센터'), hq = up('본부');
  return {
    AttendScope.team: under(me),
    if (center != null) AttendScope.center: under(center),
    if (hq != null) AttendScope.hq: under(hq),
  };
}

/// 범위(부서 이름 집합, null=전체)·검색어(이름 또는 부서 이름, 공백 무시)로 거른다.
List<AttendEntry> filterAttend(List<AttendEntry> list, {Set<String>? depts, String query = ''}) {
  final q = _norm(query).toLowerCase();
  return [
    for (final e in list)
      if ((depts == null || depts.contains(_norm(e.dept))) && (q.isEmpty || _norm(e.name).toLowerCase().contains(q) || _norm(e.dept).toLowerCase().contains(q))) e,
  ];
}

/// at00001 한 건(startDt~endDt) → 범위 안의 평일별 항목. 반려·취소·삭제 요청·날짜 형식이 이상한 건은 뺀다.
List<AttendEntry> applicationDays(Map r, String from8, String to8) {
  final state = asStr(r['approStateNm']);
  if (state.contains('반려') || state.contains('취소') || asStr(r['deleteReqYn']) == 'Y') return const [];
  final kind = asStr(r['atCdNm']).isNotEmpty ? asStr(r['atCdNm']) : asStr(r['atNm']);
  final s = asStr(r['startDt']), e = asStr(r['endDt']).isEmpty ? s : asStr(r['endDt']);
  final d8 = RegExp(r'^\d{8}$');
  if (kind.isEmpty || !d8.hasMatch(s) || !d8.hasMatch(e)) return const [];
  final out = <AttendEntry>[];
  for (var d = _day(s); !d.isAfter(_day(e)); d = d.add(const Duration(days: 1))) {
    final day = ymd(d);
    if (d.weekday >= DateTime.saturday || day.compareTo(from8) < 0 || day.compareTo(to8) > 0) continue; // 여러 날 신청의 주말은 근태가 아니다
    out.add(AttendEntry(date: day, empCd: asStr(r['empCd']), name: asStr(r['empNm']), dept: asStr(r['deptNm']), kind: kind, startTm: asStr(r['startTm']), endTm: asStr(r['endTm'])));
  }
  return out;
}

DateTime _day(String ymd8) => DateTime.utc(int.parse(ymd8.substring(0, 4)), int.parse(ymd8.substring(4, 6)), int.parse(ymd8.substring(6, 8)));

const _weekdays = ['월', '화', '수', '목', '금', '토', '일'];

/// 'YYYYMMDD' → '10.30 (금)'
String attendDayLabel(String ymd8) {
  if (ymd8.length != 8) return ymd8;
  final d = DateTime.utc(int.parse(ymd8.substring(0, 4)), int.parse(ymd8.substring(4, 6)), int.parse(ymd8.substring(6, 8)));
  return '${d.month}.${d.day.toString().padLeft(2, '0')} (${_weekdays[d.weekday - 1]})${ymd8 == ymd(kstNow()) ? ' · 오늘' : ''}';
}

class AttendRange {
  const AttendRange({required this.entries, required this.futureSkipped});
  final List<AttendEntry> entries;
  /// 전체 범위라 미래(내일부터)를 읽지 않았다 — 화면이 안내한다
  final bool futureSkipped;
}

final _pastCache = Expando<(DateTime, String, List<Map>)>();
const _pastTtl = Duration(minutes: 30);

extension GwAttendRangeApi on GwApi {
  List<Map> _maps(dynamic d) => (d is List ? d : const []).whereType<Map>().toList();

  /// 지난 7일(어제까지) 전사 근무 현황 원본 — 지난 날 근태와 사번→이름·부서 명부를 겸한다(30분 캐시, 날짜가 바뀌면 다시).
  Future<List<Map>> _pastRows(DateTime today) async {
    final key = ymd(today), hit = _pastCache[client];
    if (hit != null && hit.$2 == key && DateTime.now().difference(hit.$1) < _pastTtl) return hit.$3;
    final s = await client.session();
    final rows = _maps(await client.call('/human/openapi/worktime/status/getWorkTimeStatusList', {
      'coCd': s.coCd, 'empCdList': <String>[], 'startDate': ymd(today.subtract(const Duration(days: 7))), 'endDate': ymd(today.subtract(const Duration(days: 1))),
    }));
    _pastCache[client] = (DateTime.now(), key, rows);
    return rows;
  }

  /// 범위별 부서 이름(조직도 트리 + 내 부서).
  Future<Map<AttendScope, Set<String>>> attendScopeDepts() async {
    final s = await client.session();
    final tree = await client.call('/gw/APIHandler/gw102A01', {
      'parentSeq': '0', 'popupType': 'main', 'selectedType': 'tree', 'isAllCompShow': false, 'compFilter': '', 'isTreeChecked': '', 'isTreeAllOpen': true, 'isPartYn': false,
    });
    final nodes = (tree is Map ? tree['treeList'] : null) as List? ?? const [];
    return attendScopes([for (final n in nodes) if (n is Map && asStr(n['compSeq']) == s.compSeq) n], s.deptSeq);
  }

  /// [from]~[to](KST 날짜, 포함) 근태. [depts]가 null(전체)이면 미래는 읽지 않는다(사람마다 한 번씩 불러야 해서).
  Future<AttendRange> attendRange(DateTime from, DateTime to, {Set<String>? depts}) async {
    final now = kstNow();
    final today = DateTime.utc(now.year, now.month, now.day);
    final t8 = ymd(today), f8 = ymd(from), e8 = ymd(to);
    final past = await _pastRows(today);
    final dir = <String, (String, String)>{for (final r in past) asStr(r['empCd']): (asStr(r['korNm']), asStr(r['deptNm']))};
    final out = <AttendEntry>[
      for (final r in past)
        if (asStr(r['atNm']).isNotEmpty && asStr(r['atDt']).compareTo(f8) >= 0 && asStr(r['atDt']).compareTo(e8) <= 0)
          AttendEntry(date: asStr(r['atDt']), empCd: asStr(r['empCd']), name: asStr(r['korNm']), dept: asStr(r['deptNm']), kind: asStr(r['atNm'])),
    ];
    if (f8.compareTo(t8) <= 0 && e8.compareTo(t8) >= 0) {
      for (final r in _maps(await client.call('/human/openapi/attendapplication/getTodayApplicationDetails', {'clientType': 'ALL'}))) {
        if (asStr(r['messengerYn']) != 'Y' || asStr(r['atNm']).isEmpty) continue;
        final cd = asStr(r['empCd']);
        out.add(AttendEntry(date: t8, empCd: cd, name: asStr(r['empNm']), dept: dir[cd]?.$2 ?? '', kind: asStr(r['atNm']), startTm: asStr(r['startTm']), endTm: asStr(r['endTm']), startTs: asInt(r['startTimestamp']), endTs: asInt(r['endTimestamp'])));
      }
    }
    final tomorrow = ymd(today.add(const Duration(days: 1)));
    final wantsFuture = e8.compareTo(tomorrow) >= 0;
    if (wantsFuture && depts != null) {
      final s = await client.session();
      final from8 = f8.compareTo(tomorrow) > 0 ? f8 : tomorrow;
      final people = [for (final e in dir.entries) if (depts.contains(_norm(e.value.$2))) e.key];
      for (var i = 0; i < people.length; i += 8) {
        final batch = people.sublist(i, i + 8 > people.length ? people.length : i + 8);
        final lists = await Future.wait(batch.map((cd) => client.call('/human/attendapplication/at00001', {'coCd': s.coCd, 'empCd': cd, 'startDate': from8, 'endDate': e8}).catchError((Object e) {
              if (e is GwUnauthorized) throw e;
              return null; // 한 사람 실패는 건너뛴다
            })));
        for (final l in lists) {
          for (final r in _maps(l)) {
            out.addAll(applicationDays(r, from8, e8));
          }
        }
      }
    }
    return AttendRange(entries: depts == null ? out : filterAttend(out, depts: depts), futureSkipped: wantsFuture && depts == null);
  }
}

final attendScopeDeptsProvider = FutureProvider.autoDispose<Map<AttendScope, Set<String>>>((ref) async {
  final api = ref.watch(gwApiProvider);
  if (api == null) throw StateError('아마란스 연결이 필요합니다');
  return api.attendScopeDepts();
});

/// (프리셋, 범위) → 근태. 고른 조직을 조직도에서 못 찾으면 전체로 바꾸지 않고 실패한다.
final attendRangeProvider = FutureProvider.autoDispose.family<AttendRange, (AttendPreset, AttendScope)>((ref, key) async {
  final api = ref.watch(gwApiProvider);
  if (api == null) throw StateError('아마란스 연결이 필요합니다');
  final depts = key.$2 == AttendScope.all ? null : (await ref.watch(attendScopeDeptsProvider.future))[key.$2];
  if (key.$2 != AttendScope.all && depts == null) throw GwException(200, 0, '조직도에서 ${key.$2.label}을 찾지 못했습니다');
  final (from, to) = presetRange(key.$1, kstNow());
  return api.attendRange(from, to, depts: depts);
});
