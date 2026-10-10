// mobile/lib/mcp/mcp_tools.dart — Claude 커넥터(MCP) 도구 디스패치. 인자 이름은 inno-creed 2.2.0 스키마(frontend/src/lib/mcp/tools.json) 그대로,
// 응답 키는 inno-creed 실측 출력(test/mcp/fixtures)과 같게. 신규 엔드포인트가 필요한 도구(update_*·list_approvals·첨부 등)는 이 파일에 아직 없다.
import 'dart:convert';
import 'dart:io';
import '../assistant/gw_assistant_api.dart' show GwAssistantApi, composeFields, draftFields, freeSlots, lunchBreak, minutesOn;
import '../gw/gw_api.dart';
import '../gw/gw_client.dart';
import '../gw/gw_mcp_api.dart';
import '../gw/gw_models.dart' as m;
import 'approval_schemas.dart';
import 'mcp_args.dart' as a;
import 'mcp_worker.dart' show McpToolError;
import 'person_groups.dart';

/// macOS `~/Library/Application Support/INNOGRID`, Windows `%APPDATA%\INNOGRID`(없으면 만든다). 사람 그룹 파일 위치.
String mcpAppSupportDir() {
  final e = Platform.environment;
  final d = Platform.isWindows ? '${e['APPDATA'] ?? ''}\\INNOGRID' : '${e['HOME'] ?? ''}/Library/Application Support/INNOGRID';
  Directory(d).createSync(recursive: true);
  return d;
}

const _noGw = '아마란스가 연결되어 있지 않습니다. 앱 더보기 > 아마란스에서 연결하세요.';
const _lunchNote = '점심시간(13:00~14:00)은 빈 구간에서 제외했습니다. 점심시간에도 찾으려면 include_lunch=true로 다시 호출하세요.';
const _treeNote = 'userCount는 하위 부서를 포함한 누적 인원';
const _boxLabels = {
  '1001000': 'pending(미결)', '1001100': 'approved(기결)', '1001110': 'approved_ongoing(기결진행)', '1001120': 'approved_done(기결종결)',
  '1001200': 'reference(수신참조)', '1001400': 'enforcement(시행)', '1000400': 'sent(상신)', '1000500': 'draft(임시보관)',
};
const _searchModules = {'메일': '0', '전자결재': '6', '게시판': '9', '일정': '3', '자원': '13', '파일': '10'};

String _two(int v) => v.toString().padLeft(2, '0');
String _iso(String ts) => ts.length == 12 ? '${ts.substring(0, 4)}-${ts.substring(4, 6)}-${ts.substring(6, 8)}T${ts.substring(8, 10)}:${ts.substring(10, 12)}' : ts;
String _hhmm(int min) => '${_two(min ~/ 60)}:${_two(min % 60)}';
String _digits(String s) => s.replaceAll(RegExp(r'\D'), '');
String _snippet(Object? v) {
  final s = m.oneLine(m.htmlToText(asStr(v)));
  return s.length > 200 ? '${s.substring(0, 200)}…' : s;
}

/// 다국어 필드({kr,en,…})면 kr.
String _sv(Map r, String k) => r[k] is Map ? asStr((r[k] as Map)['kr']) : asStr(r[k]);

/// 'YYYYMMDD'·'YYYY-MM-DD' → 'YYYY-MM-DD'(게시판·검색 날짜). 비면 ''.
String _dashed(String v) {
  final d = a.ymd(v);
  return d.length == 8 ? '${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}' : v;
}

String _req(Map args, String k) {
  final v = a.str(args, k);
  if (v.isEmpty) throw McpToolError('$k 인자가 필요합니다.');
  return v;
}

/// 시각 인자 'YYYYMMDDHHmm'(구분자 허용) → 12자리 숫자.
String _stamp(Map args, String k) {
  final v = _digits(_req(args, k));
  if (v.length < 12) throw McpToolError('$k는 YYYYMMDDHHmm 형식이어야 합니다(예: 202610121330).');
  return v.substring(0, 12);
}

/// 날짜 인자 → 'YYYYMMDD'.
String _day(Map args, String k) {
  final v = a.ymd(_req(args, k));
  if (v.length != 8) throw McpToolError('$k는 YYYYMMDD 형식이어야 합니다.');
  return v;
}

/// 명부 행 → find_person·org_chart 사람 항목.
Map<String, dynamic> _person(Map r, {bool chain = false}) {
  final status = asStr(r['workStatus']);
  final out = <String, dynamic>{
    'empSeq': asStr(r['empSeq']), 'name': asStr(r['empName']), 'loginId': asStr(r['loginId']), 'email': asStr(r['emailAddr']), 'mobile': asStr(r['mobileTelNum']),
    'deptId': asStr(r['deptSeq']), 'deptName': asStr(r['deptName']), 'deptPath': asStr(r['pathName']), 'duty': asStr(r['dutyName']), 'dutyCode': asStr(r['dutyCode']),
    'position': asStr(r['positionName']), 'note': status.isEmpty || status == '999' ? '' : asStr(r['atNm']),
  };
  if (chain) {
    final ids = asStr(r['path']).split('|').where((s) => s.isNotEmpty).toList(), names = asStr(r['pathName']).split('>');
    out['deptChain'] = [for (final (i, id) in ids.indexed) {'deptId': id, 'name': i < names.length ? names[i].trim() : ''}];
  }
  return out;
}

Map<String, dynamic> _reservation(Map r) {
  final g = m.GwReservation.fromRow(r);
  return {
    'allDay': g.allDay, 'attendees': g.attendees, 'displayTitle': g.display, 'end': _iso(g.end), 'owner': g.owner, 'ownerEmpSeq': g.ownerEmpSeq,
    'resIdx': asStr(r['resIdx']).isEmpty ? '1' : asStr(r['resIdx']), 'resName': g.resName, 'resSeq': g.resSeq, 'seqNum': asInt(r['seqNum']), 'start': _iso(g.start), 'title': g.title,
  };
}

/// 서명(mail014A01 signature)은 `<div dze_signature><html><head></head><body>…</body></html>…</div>` — 본문에 끼울 때 문서 태그를 벗긴다(웹 작성기와 같은 형상).
String _signature(Map init) => asStr(init['signature']).replaceAll(RegExp(r'<head\b[^>]*>.*?</head>', caseSensitive: false, dotAll: true), '').replaceAll(RegExp(r'</?(html|body)\b[^>]*>', caseSensitive: false), '');

class McpTools {
  McpTools({required this.gw, required String Function() appSupportDir, ApprovalSchemas? schemas})
      : groups = PersonGroups(appSupportDir),
        schemas = schemas ?? ApprovalSchemas();
  final GwApi? gw;
  final PersonGroups groups;
  final ApprovalSchemas schemas;

  GwApi get _gw => gw ?? (throw McpToolError(_noGw));

  /// 결과는 JSON 문자열. 실패는 사람이 읽을 McpToolError 한 문장(서버 resultMsg 또는 원인 종류만 — 토큰·원문 예외는 싣지 않는다).
  Future<String> execute(String tool, Map<String, dynamic> args) async {
    try {
      return jsonEncode(await _run(tool, args));
    } on McpToolError {
      rethrow;
    } on GwException catch (e) {
      throw McpToolError(e.message);
    } on FormatException {
      throw McpToolError('입력 형식이 올바르지 않습니다.'); // 원문(입력값이 섞일 수 있음)은 싣지 않는다
    } catch (e) {
      throw McpToolError('도구 실행 중 오류가 발생했습니다 (${e.runtimeType})');
    }
  }

  Future<Object?> _run(String tool, Map<String, dynamic> x) => switch (tool) {
        'whoami' => _whoami(),
        'find_person' => _findPerson(x),
        'org_chart' => _orgChart(x),
        'person_group' => a.str(x, 'name').isEmpty ? groups.list() : _gw.rosterRows().then((r) => groups.get(a.str(x, 'name'), r)),
        'save_person_group' => _savePersonGroup(x),
        'delete_person_group' => groups.delete(_req(x, 'name')),
        'list_resources' => _gw.resourcesRaw(),
        'list_reservations' => _listReservations(x),
        'my_reservations' => _myReservations(x),
        'find_free_rooms' => _freeRooms(x),
        'reserve_resource' => _reserve(x),
        'cancel_reservation' => _cancelReservation(x),
        'list_calendars' => _gw.calendarsRaw(),
        'list_events' => _listEvents(x),
        'create_calendar_event' => _createEvent(x),
        'delete_calendar_event' => _deleteEvent(x),
        'get_attendance_today' => _attendance(x),
        'attendance_clock_in' => _punch(true),
        'attendance_clock_out' => _punch(false),
        'list_mailboxes' => _gw.mailboxesRaw(),
        'mailbox_counts' => _gw.mailCountsRaw(),
        'list_mail_inbox' => _gw.mailListRaw('INBOX'),
        'list_mail_drafts' => _gw.mailListRaw('DRAFTS'),
        'read_mail' => _readMail(x),
        'save_mail_draft' => _compose(x, send: false),
        'send_mail' => _compose(x, send: true),
        'approval_counts' => _approvalCounts(),
        'pending_approvals' => _pendingApprovals(x),
        'read_approval' => _readApproval(x),
        'list_approval_line_schemas' => schemas.list(),
        'get_approval_line_schema' => schemas.schema(_req(x, 'doc_type')),
        'list_approval_submission_guides' => schemas.guides(),
        'get_approval_submission_guide' => schemas.guide(_req(x, 'doc_type')),
        'suggest_approval_line' => _suggest(x),
        'list_notices' => _listNotices(x),
        'read_notice' => _readNotice(x),
        'search' => _search(x),
        _ => throw McpToolError('모르는 도구입니다: $tool'),
      };

  // ── 세션·사람·조직 ──
  Future<Map<String, dynamic>> _whoami() async {
    final g = _gw, s = await g.client.session(), c = g.client.creds();
    Map? row;
    try {
      row = (await g.deptMembers(s.deptSeq)).where((r) => asStr(r['empSeq']) == c.empSeq).firstOrNull;
    } on GwUnauthorized {
      rethrow;
    } on GwException {
      row = null; // 직책·직급만 못 채운다 — profileResolved:false
    }
    return {
      'coCd': s.coCd, 'compSeq': s.compSeq, 'deptCd': s.deptCd, 'deptName': asStr(row?['deptName']), 'deptSeq': s.deptSeq, 'duty': asStr(row?['dutyName']), 'email': s.email,
      'empCd': s.empCd, 'empName': s.empName, 'empSeq': c.empSeq, 'groupSeq': c.groupSeq, 'position': asStr(row?['positionName']), 'profileResolved': row != null,
    };
  }

  Future<Map<String, dynamic>> _findPerson(Map x) async {
    final q = _req(x, 'query'), lower = q.toLowerCase();
    final roster = await _gw.rosterRows();
    List<Map> hits;
    if (RegExp(r'^\d+$').hasMatch(q)) {
      hits = roster.where((r) => asStr(r['empSeq']) == q).toList();
    } else {
      bool has(Map r) => ['empName', 'loginId', 'emailAddr', 'deptName', 'pathName', 'dutyName', 'positionName'].any((k) => asStr(r[k]).toLowerCase().contains(lower));
      final all = roster.where(has).toList();
      String name(Map r) => asStr(r['empName']).toLowerCase();
      // 이름 완전일치 → 이름 부분일치 → 조직정보 일치(각 묶음 안은 명부 순서)
      hits = [...all.where((r) => name(r) == lower), ...all.where((r) => name(r) != lower && name(r).contains(lower)), ...all.where((r) => !name(r).contains(lower))];
    }
    final limit = a.boolOf(x, 'no_limit') ? hits.length : (a.intOf(x, 'limit') ?? 20).clamp(1, 1 << 20);
    final people = [for (final r in hits.take(limit)) _person(r, chain: true)];
    final truncated = people.length < hits.length;
    return {
      'kind': 'people', 'query': q, 'matched': hits.length, 'count': people.length, 'rosterSize': roster.length, 'truncated': truncated, 'people': people,
      if (truncated) 'note': '${hits.length}명 중 ${people.length}명만 보냈습니다. 검색어를 좁히거나 limit·no_limit을 쓰세요.',
    };
  }

  Future<Map<String, dynamic>> _orgChart(Map x) async {
    final deptId = a.str(x, 'dept_id');
    if (deptId.isNotEmpty) {
      final members = [for (final r in await _gw.deptMembers(deptId)) _person(r)];
      return {'kind': 'deptMembers', 'deptId': deptId, 'count': members.length, 'members': members};
    }
    final tree = await _gw.orgTree();
    final byParent = <String, List<Map>>{};
    for (final n in tree) {
      (byParent[asStr(n['parentKeySeq'])] ??= []).add(n);
    }
    final keys = {for (final n in tree) asStr(n['keySeq'])};
    final scope = a.str(x, 'parent_seq');
    final List<Map> roots;
    if (scope.isEmpty || scope == '0') {
      roots = tree.where((n) => !keys.contains(asStr(n['parentKeySeq']))).toList();
    } else {
      final r = tree.where((n) => asStr(n['id']) == scope).firstOrNull;
      if (r == null) throw McpToolError('부서 $scope을(를) 조직도에서 찾지 못했습니다. org_chart(flat:true)로 deptId를 확인하세요.');
      roots = [r];
    }
    final inScope = <String>{};
    Map<String, dynamic> build(Map n) {
      inScope.add(asStr(n['keySeq']));
      final kids = byParent[asStr(n['keySeq'])] ?? const [];
      return {
        'deptId': asStr(n['id']), 'name': asStr(n['text']), 'gubun': asStr(n['orgGubun']), 'userCount': asInt(n['childUserCnt']),
        if (kids.isNotEmpty) 'children': [for (final k in kids) build(k)],
      };
    }

    final nested = [for (final r in roots) build(r)];
    final base = {'scope': scope.isEmpty ? '0' : scope, 'count': inScope.length, 'note': _treeNote};
    if (!a.boolOf(x, 'flat')) return {'kind': 'deptTree', ...base, 'tree': nested};
    return {
      'kind': 'deptList', ...base,
      'depts': [
        for (final n in tree)
          if (inScope.contains(asStr(n['keySeq'])))
            {'deptId': asStr(n['id']), 'name': asStr(n['text']), 'gubun': asStr(n['orgGubun']), 'level': asInt(n['orgLevel']), 'parentSeq': asStr(n['parentSeq']), 'path': asStr(n['path']), 'userCount': asInt(n['childUserCnt'])},
      ],
    };
  }

  Future<Map<String, dynamic>> _savePersonGroup(Map x) async {
    final name = _req(x, 'name');
    return groups.save(name, a.strList(x, 'members'), mode: a.str(x, 'mode'), note: a.str(x, 'note'), roster: await _gw.rosterRows());
  }

  /// 이름·empSeq 목록 → 명부 행. 없는 사람·동명이인은 쓰기 전에 실패(조용히 빠지지 않게).
  Future<List<Map>> _resolve(List<String> inputs) async {
    if (inputs.isEmpty) return const [];
    final roster = await _gw.rosterRows();
    return [
      for (final i in inputs)
        switch (resolvePerson(i, roster)) {
          (hit: final Map h, reason: _, candidates: _) => h,
          (hit: _, reason: 'ambiguous', candidates: final c) => throw McpToolError(
              '"$i"은(는) 동명이인이 있어 정하지 못했습니다 — empSeq로 지정하세요: ${c.map((r) => '${asStr(r['empName'])}(${asStr(r['empSeq'])}, ${asStr(r['deptName'])})').join(', ')}'),
          _ => throw McpToolError('"$i"을(를) 명부에서 찾지 못했습니다 — find_person으로 empSeq를 확인하세요.'),
        },
    ];
  }

  // ── 회의실 ──
  Future<Map<String, dynamic>> _listReservations(Map x) async {
    final s = _day(x, 'start'), e = _day(x, 'end'), seqs = a.strList(x, 'res_seqs');
    final rows = (await _gw.reservationRows(s, e, resSeqs: seqs)).where((r) => seqs.isEmpty || seqs.contains(asStr(r['resSeq']))).toList();
    return {'kind': 'reservations', 'period': '$s~$e', 'count': rows.length, 'reservations': a.boolOf(x, 'verbose') ? rows : [for (final r in rows) _reservation(r)]};
  }

  Future<Map<String, dynamic>> _myReservations(Map x) async {
    final s = _day(x, 'start'), e = _day(x, 'end'), me = _gw.client.creds().empSeq;
    final mine = [for (final r in await _gw.reservationRows(s, e)) if (asStr(r['empSeq']) == me) _reservation(r)];
    return {'kind': 'myReservations', 'empSeq': me, 'period': '$s~$e', 'count': mine.length, 'reservations': mine};
  }

  Future<Map<String, dynamic>> _freeRooms(Map x) async {
    final date = _day(x, 'date'), duration = a.intOf(x, 'duration_min');
    if (duration == null || duration <= 0) throw McpToolError('duration_min은 1 이상의 분 단위 숫자입니다.');
    final w = _digits(a.str(x, 'window').isEmpty ? '0900-1800' : a.str(x, 'window'));
    if (w.length != 8) throw McpToolError('window는 HHmm-HHmm 형식입니다(예: 0900-1200).');
    int mins(String hhmm) => int.parse(hhmm.substring(0, 2)) * 60 + int.parse(hhmm.substring(2, 4));
    final from = mins(w.substring(0, 4)), to = mins(w.substring(4, 8));
    if (to <= from) throw McpToolError('window의 끝이 시작보다 늦어야 합니다.');
    final group = a.str(x, 'group'), lunch = !a.boolOf(x, 'include_lunch');
    final attr = switch (group) { '' || '전체' => '', '본사' => '1', '구로' => '3', _ => RegExp(r'^\d+$').hasMatch(group) ? group : throw McpToolError('group은 ""·본사·구로·attrSeq 숫자 중 하나입니다.') };
    final rooms = (await _gw.resources()).where((r) => attr.isEmpty || r.attrSeq == attr).toList();
    final rows = await _gw.reservationRows(date, date, resSeqs: [for (final r in rooms) r.resSeq]);
    final out = <Map<String, dynamic>>[];
    for (final room in rooms) {
      final busy = <(int, int)>[if (lunch) lunchBreak];
      for (final b in rows.where((b) => asStr(b['resSeq']) == room.resSeq)) {
        final s = minutesOn(asStr(b['resStartDate']), date), e = minutesOn(asStr(b['resEndDate']), date);
        busy.add(s == null || e == null ? (-(1 << 40), 1 << 40) : (s, e)); // 시각을 못 읽는 예약은 하루 종일 점유
      }
      final slots = freeSlots(busy, from, to, duration);
      if (slots.isNotEmpty) {
        out.add({'resSeq': room.resSeq, 'resName': room.resName, 'attrName': room.attrName, 'freeSlots': [for (final (f, t) in slots) {'from': _hhmm(f), 'to': _hhmm(t), 'minutes': t - f}]});
      }
    }
    // 가장 이른 빈 구간 순(같으면 목록 순서 유지)
    final ordered = [for (final (i, r) in out.indexed) (i, r)]..sort((p, q) {
        final c = ((p.$2['freeSlots'] as List).first['from'] as String).compareTo((q.$2['freeSlots'] as List).first['from'] as String);
        return c != 0 ? c : p.$1.compareTo(q.$1);
      });
    return {
      'kind': 'freeSlots', 'date': date, 'window': '${_hhmm(from)}-${_hhmm(to)}', 'durationMin': duration, 'group': group.isEmpty ? '전체' : group,
      'lunchBreak': '13:00~14:00', 'lunchExcluded': lunch, if (lunch) 'note': _lunchNote, 'roomsChecked': rooms.length, 'roomsWithSlot': out.length, 'rooms': [for (final p in ordered) p.$2],
    };
  }

  Future<Map<String, dynamic>> _reserve(Map x) async {
    final g = _gw, resSeq = _req(x, 'res_seq'), title = _req(x, 'req_text'), start = _stamp(x, 'start'), end = _stamp(x, 'end');
    if (end.compareTo(start) <= 0) throw McpToolError('end가 start보다 늦어야 합니다.');
    final c = g.client.creds(), s = await g.client.session();
    final guests = [for (final r in await _resolve(a.strList(x, 'attendees'))) if (asStr(r['empSeq']) != c.empSeq) r];
    final seen = <String>{c.empSeq};
    final subs = [
      {'groupSeq': c.groupSeq, 'compSeq': s.compSeq, 'deptSeq': s.deptSeq, 'empSeq': c.empSeq},
      for (final r in guests) if (seen.add(asStr(r['empSeq']))) {'groupSeq': c.groupSeq, 'compSeq': s.compSeq, 'deptSeq': asStr(r['deptSeq']), 'empSeq': asStr(r['empSeq'])},
    ];
    final reg = await g.reserveRaw(resSeq: resSeq, title: title, start: start, end: end, desc: a.str(x, 'desc'), subscribers: subs);
    final seqNum = asInt(reg is Map ? reg['seqNum'] : null, -1);
    if (seqNum < 0) throw McpToolError('예약 응답에 예약 번호가 없습니다. my_reservations로 생성 여부를 확인하세요.');
    final resIdx = asStr(reg is Map ? reg['resIdx'] : null).isEmpty ? '1' : asStr((reg as Map)['resIdx']);
    // 예약은 이미 생겼다 — 재조회만 실패하면 오류로 보고하지 않는다(재시도로 중복 예약이 생기지 않게)
    Map detail = const {};
    var readback = true;
    try {
      final d = await g.reservationDetailRaw(resSeq, seqNum, resIdx);
      if (d is Map) detail = d;
    } on GwUnauthorized {
      rethrow;
    } on GwException {
      readback = false;
    }
    final got = ((detail['subscriberList'] as List?) ?? const []).whereType<Map>().toList();
    final gotSeqs = {for (final r in got) asStr(r['empSeq'])};
    final verifiedAttendees = readback && seen.every(gotSeqs.contains);
    final verified = readback && asStr(detail['reqText']) == title;
    final sm = minutesOn(start, start.substring(0, 8))!, em = minutesOn(end, start.substring(0, 8))!;
    return {
      'ok': verified || !readback, 'verified_by_readback': verified, if (!readback) 'note': '예약은 등록됐지만 재조회에 실패해 확인하지 못했습니다. 다시 예약하지 말고 my_reservations로 확인하세요.', 'resSeq': resSeq, 'seqNum': seqNum, 'resIdx': resIdx, 'reqText': title, 'period': '$start~$end',
      'displayTitle': '[${asStr(detail['empName']).isEmpty ? s.empName : asStr(detail['empName'])}] ${asStr(detail['resName'])}',
      'attendees': [for (final r in got) asStr(r['empName'])], 'attendeesVerified': verifiedAttendees,
      if (readback && !verifiedAttendees) 'attendeesWarning': '요청한 참석자 일부가 예약에 반영되지 않았습니다. 아마란스에서 확인하세요.',
      if (sm < lunchBreak.$2 && em > lunchBreak.$1) 'lunchWarning': '예약 구간이 점심시간(13:00~14:00)에 걸칩니다. 의도한 것인지 사용자에게 확인하세요.',
    };
  }

  Future<Map<String, dynamic>> _cancelReservation(Map x) async {
    final resSeq = _req(x, 'res_seq'), seqNum = a.intOf(x, 'seq_num'), resIdx = a.str(x, 'res_idx', '1');
    if (seqNum == null) throw McpToolError('seq_num(예약 ID)이 필요합니다. my_reservations로 확인하세요.');
    final r = await _gw.cancelReservation(resSeq, seqNum, resIdx.isEmpty ? '1' : resIdx);
    return {'canceled': r['canceled'] == true, 'ok': r['ok'] == true, 'seqNum': seqNum, 'verified_by_readback': r['ok'] == true, if (r['message'] != null) 'message': r['message']};
  }

  // ── 일정 ──
  Future<Map<String, dynamic>> _listEvents(Map x) async {
    final rows = await _gw.eventRowsRange(_day(x, 'start'), _day(x, 'end'));
    return {
      'count': rows.length,
      'events': [
        for (final r in rows)
          {
            'schSeq': asStr(r['schSeq']), 'title': asStr(r['schTitle']), 'start': _iso(asStr(r['startDate'])), 'end': _iso(asStr(r['endDate'])), 'allday': asBool(r['alldayYn']),
            'calendar': '${asStr(r['calTitle'])}(${asStr(r['mcalSeq'])})', 'mine': asStr(r['delYn']) == 'Y', 'createName': asStr(r['createName']), 'createSeq': asStr(r['createSeq']),
            'attendees': asStr(r['schUserList']), 'partCount': asInt(r['partCount']), if (asStr(r['contents']).isNotEmpty) 'contents': asStr(r['contents']),
          },
      ],
    };
  }

  Future<Map<String, dynamic>> _createEvent(Map x) async {
    final g = _gw, title = _req(x, 'title'), start = _stamp(x, 'start'), end = _stamp(x, 'end');
    if (end.compareTo(start) <= 0) throw McpToolError('end가 start보다 늦어야 합니다.');
    // 종일·화상회의·비밀메모는 요청 형식을 아직 실측하지 않았다 — 무시하고 등록하면 설명과 다른 일정이 생기므로 거절
    if (asBool(x['allday']) || asBool(x['video']) || a.str(x, 'secret_memo').isNotEmpty) {
      throw McpToolError('allday·video·secret_memo는 이 앱 버전에서 아직 지원하지 않습니다. 빼고 등록한 뒤 아마란스에서 바꾸세요.');
    }
    final c = g.client.creds(), s = await g.client.session();
    final guests = await _resolve(a.strList(x, 'participants'));
    final cals = await g.calendars();
    final want = a.str(x, 'calendar');
    final m.GwCalendar cal;
    if (want.isEmpty) {
      cal = cals.where((k) => k.personal && k.ownerEmpSeq == c.empSeq).firstOrNull ?? (throw McpToolError('내 개인 캘린더를 찾지 못했습니다. list_calendars로 확인해 calendar를 지정하세요.'));
    } else {
      final hits = cals.where((k) => k.mcalSeq == want).toList();
      if (hits.isEmpty) hits.addAll(cals.where((k) => k.title.toLowerCase().contains(want.toLowerCase())));
      if (hits.length != 1) {
        throw McpToolError(hits.isEmpty ? '"$want" 캘린더를 찾지 못했습니다. list_calendars로 확인하세요.' : '"$want"에 맞는 캘린더가 여럿입니다 — mcalSeq로 지정하세요: ${hits.map((k) => '${k.title}(${k.mcalSeq})').join(', ')}');
      }
      cal = hits.single;
    }
    Map<String, String> part(String emp, String dept, String name, String type) =>
        {'compSeq': s.compSeq, 'deptSeq': dept, 'orgType': 'E', 'orgSeq': emp, 'empSeq': emp, 'empName': name, 'partType': type, 'mcalSeq': ''};
    final seen = <String>{c.empSeq};
    final reg = await g.createEventRaw(title: title, mcalSeq: cal.mcalSeq, calType: cal.calType.isEmpty ? 'E' : cal.calType, start: start, end: end, contents: a.str(x, 'contents'), parts: [
      part(c.empSeq, s.deptSeq, s.empName, 'M'),
      for (final r in guests) if (seen.add(asStr(r['empSeq']))) part(asStr(r['empSeq']), asStr(r['deptSeq']), asStr(r['empName']), 'W'),
    ]);
    final schSeq = asStr(reg is Map ? reg['schSeq'] : null);
    if (schSeq.isEmpty) throw McpToolError('일정 등록 응답에 일정 번호가 없습니다. list_events로 생성 여부를 확인하세요.');
    // 일정은 이미 생겼다 — 재조회만 실패하면 성공으로 돌려준다(재시도로 중복 등록되지 않게)
    Map? row;
    var readback = true;
    try {
      row = (await g.eventRowsRange(start.substring(0, 8), start.substring(0, 8))).where((r) => asStr(r['schSeq']) == schSeq).firstOrNull;
    } on GwUnauthorized {
      rethrow;
    } on GwException {
      readback = false;
    }
    final verified = row != null && asStr(row['schTitle']) == title;
    final personal = cal.personal && cal.ownerEmpSeq == c.empSeq;
    return {
      'ok': verified || !readback, 'verified_by_readback': verified, if (!readback) 'note': '일정은 등록됐지만 재조회에 실패해 확인하지 못했습니다. 다시 등록하지 말고 list_events로 확인하세요.', 'schSeq': schSeq, 'title': title, 'period': '$start~$end', 'calendar': '${cal.title}(${cal.mcalSeq})',
      if (!personal) 'warning': '개인 캘린더가 아닌 "${cal.title}"에 등록했습니다 — 다른 사람에게도 보일 수 있습니다.',
    };
  }

  Future<Map<String, dynamic>> _deleteEvent(Map x) async {
    final schSeq = _req(x, 'sch_seq');
    final r = await _gw.deleteEvent(schSeq, _day(x, 'date'));
    return {'deleted': r['deleted'] == true, 'ok': r['ok'] == true, 'schSeq': schSeq, 'verified_by_readback': r['ok'] == true};
  }

  // ── 근태 ──
  Future<Map<String, dynamic>> _attendance(Map x) async {
    final wd = a.str(x, 'work_dt').isEmpty ? m.ymd(m.kstNow()) : _day(x, 'work_dt');
    final d = await _gw.attendanceRaw(wd);
    return {'workDt': wd, 'comeTm': asStr(d['comeTm']), 'leaveTm': asStr(d['leaveTm']), 'holidayYn': asStr(d['holidayYn'])};
  }

  Future<Map<String, dynamic>> _punch(bool clockIn) async {
    final r = await _gw.punch(clockIn: clockIn);
    return {'ok': r.ok, 'already': r.already, 'kind': r.kind, 'comeTm': r.comeTm, 'leaveTm': r.leaveTm, 'verified_by_readback': r.verified, 'message': r.note};
  }

  // ── 메일 ──
  Future<Map<String, dynamic>> _readMail(Map x) async {
    final muid = _req(x, 'muid');
    final d = await _gw.mailReadRaw(muid);
    final dm = d['decodeMime'] is Map ? d['decodeMime'] as Map : const {};
    final mime = d['mime'] is Map ? d['mime'] as Map : const {};
    final b = mime['body'] is Map ? mime['body'] as Map : const {};
    final plain = asStr(b['plain']).replaceAll('\r', '').split('\n').map((l) => l.trim()).join('\n').replaceAll(RegExp(r'\n{3,}'), '\n\n').trim();
    final html = asStr(b['html']);
    final inline = <String>[];
    var remote = 0;
    for (final img in RegExp(r'''<img\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)''', caseSensitive: false).allMatches(html)) {
      final src = img[1]!;
      final host = Uri.tryParse(src)?.host ?? '';
      if (host.isEmpty && !src.startsWith('data:') || host == Uri.parse(_gw.client.baseUrl).host) {
        inline.add(src);
      } else if (host.isNotEmpty) {
        remote++;
      }
    }
    const images = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'};
    final files = ((mime['fileList'] as List?) ?? const []).whereType<Map>().toList();
    return {
      'muid': muid, 'subject': m.htmlToText(asStr(dm['subject'])), 'from': m.htmlToText(asStr(dm['from'])), 'to': m.htmlToText(asStr(dm['to'])), 'cc': m.htmlToText(asStr(dm['cc'])),
      'bcc': m.htmlToText(asStr(dm['bcc'])), 'date': asStr(dm['date']), 'body': plain.isNotEmpty ? plain : m.htmlToText(html), 'inlineImages': inline, 'remoteResourceCount': remote,
      'attachments': [
        for (final (i, f) in files.indexed)
          {'index': i, 'fileName': asStr(f['originalFileName']), 'fileExt': asStr(f['fileExtsn']), 'fileSizeApprox': asInt(f['fileSize']) * 3 ~/ 4, 'fileSn': asStr(f['fileSn']), 'isImage': images.contains(asStr(f['fileExtsn']).toLowerCase())},
      ],
    };
  }

  /// save_mail_draft(A14)·send_mail(A04). 첨부 업로드는 이 버전 범위 밖 — 거절한다(첨부 없이 보내면 설명과 다른 메일이 나간다).
  Future<Map<String, dynamic>> _compose(Map x, {required bool send}) async {
    if (a.strList(x, 'attachments').isNotEmpty) throw McpToolError('첨부(attachments)는 이 앱 버전에서 아직 지원하지 않습니다. 첨부 없이 저장하거나 아마란스 웹에서 첨부하세요.');
    final g = _gw, s = await g.client.session();
    final subject = a.str(x, 'subject'), to = a.str(x, 'to').isEmpty ? s.email : a.str(x, 'to'), cc = a.str(x, 'cc'), bcc = a.str(x, 'bcc');
    final init = await g.composeInit();
    final sig = a.boolOf(x, 'signature', true) ? _signature(init) : '';
    final fields = composeFields(init, fromName: s.empName, bodyAuth: '${s.emailAddr}|${g.client.creds().authToken}', to: to, cc: cc, subject: subject.trim().isEmpty ? '(제목없음)' : subject, html: '${a.str(x, 'html')}$sig')
      ..['bcc'] = bcc;
    final base = {'to': to, 'cc': cc, 'bcc': bcc, 'subject': subject, 'signature_attached': sig.isNotEmpty, 'attachments': 0};
    if (send) {
      dynamic r;
      try {
        r = await g.client.callMultipart('/mail/mail014A04', fields);
      } on GwException catch (e) {
        // 요청을 보낸 뒤 연결이 끊기면 이미 발송됐을 수 있다 — 실패로 단정하지 않는다
        if (e is! GwUnauthorized && e.status == 0) throw McpToolError('발송 결과를 확인할 수 없습니다. 보낸편지함을 확인한 뒤 다시 보내세요.');
        rethrow;
      }
      if (r is! Map || r['result'] != true) throw McpToolError('메일 발송에 실패했습니다.');
      return {'ok': true, 'sent': true, ...base};
    }
    final r = await g.client.callMultipart('/mail/mail014A14', {...fields, ...draftFields});
    final muid = asStr(r is Map ? r['autoMUID'] : null);
    if (muid.isEmpty) throw McpToolError('임시저장에 실패했습니다.');
    var verified = false;
    try {
      final list = await g.mailListRaw('DRAFTS');
      verified = ((list is Map ? list['Records'] : null) as List? ?? const []).any((e) => e is Map && asStr(e['muid']) == muid);
    } on GwUnauthorized {
      rethrow;
    } on GwException {
      verified = false;
    }
    return {
      'ok': true, 'sent': false, 'draft_muid': muid, 'mail_key': asStr((r as Map)['mailKey']).replaceAll(RegExp(r'\.eml$'), ''), 'verified_by_readback': verified,
      'note': '임시보관함에 저장만 됨(발송 아님). 목록 확인은 list_mail_drafts', ...base,
    };
  }

  // ── 결재 ──
  Future<Map<String, dynamic>> _approvalCounts() async => {for (final e in (await _gw.approvalCountsRaw()).entries) _boxLabels[asStr(e.key)] ?? asStr(e.key): e.value};

  Future<Map<String, dynamic>> _pendingApprovals(Map x) async {
    final (total, docs) = await _gw.pendingApprovals(pageSize: (a.intOf(x, 'page_size') ?? 20).clamp(1, 200));
    final today = m.kstNow();
    return {
      'kind': 'pendingApprovals', 'totalCount': total, 'count': docs.length,
      'items': [
        for (final d in docs)
          {'docId': d.docId, 'formId': d.formId, 'title': d.title, 'form': d.form, 'drafter': d.drafter, 'dept': d.dept, 'arrivedDt': d.arrivedDt, 'waitingDays': d.waitingDays(today), 'status': d.status, 'unread': d.unread, 'fileCount': d.fileCount},
      ],
    };
  }

  Future<Map<String, dynamic>> _readApproval(Map x) async {
    final docId = _req(x, 'doc_id'), d = await _gw.approvalDetailRaw(docId, _req(x, 'form_id'));
    final det = m.ApprovalDetail.fromData(d);
    return {
      'docId': asStr(d['docId']).isEmpty ? docId : asStr(d['docId']), 'docNo': asStr(d['docNo']), 'title': det.title, 'form': det.form, 'status': det.status, 'drafter': det.drafter, 'dept': det.dept,
      'repDt': det.repDt, 'currentApprover': det.currentApprover, 'attachCount': asStr(d['attachCnt']), 'content': det.content,
      'approvalLine': [
        for (final u in ((d['user_info'] as List?) ?? const []).whereType<Map>())
          {'userId': asStr(u['user_id']), 'receiveDiv': asStr(u['receive_div']), 'procYn': asStr(u['proc_yn']), 'procTime': asStr(u['proc_time'])},
      ],
    };
  }

  Future<Map<String, dynamic>> _suggest(Map x) async {
    final docType = _req(x, 'doc_type'), trip = a.str(x, 'trip');
    await schemas.schema(docType); // 모르는 양식이면 조직도를 훑기 전에 실패
    final who = await _whoami();
    final me = {for (final k in ['empSeq', 'empName', 'deptSeq', 'deptName', 'duty', 'position']) (k == 'empName' ? 'name' : k): asStr(who[k])};
    return schemas.suggest(docType, trip, me: me, tree: await _gw.orgTree(), members: _gw.deptMembers);
  }

  // ── 게시판·검색 ──
  Future<Map<String, dynamic>> _listNotices(Map x) async {
    final d = await _gw.noticeListRaw(
        page: a.intOf(x, 'page') ?? 1, pageSize: (a.intOf(x, 'page_size') ?? 20).clamp(1, 100), search: a.str(x, 'search'), field: a.str(x, 'field'),
        start: a.str(x, 'start_date').isEmpty ? '' : _dashed(a.str(x, 'start_date')), end: a.str(x, 'end_date').isEmpty ? '' : _dashed(a.str(x, 'end_date')));
    final rows = ((d['articleList'] as List?) ?? const []).whereType<Map>().toList();
    return {
      'totalCnt': asInt(d['totalCnt'], rows.length),
      'articles': [
        for (final r in rows)
          {
            'artSeqNo': asStr(r['art_seq_no']), 'title': asStr(r['art_title']), 'board': asStr(r['cat_title']), 'boardId': asStr(r['cat_seq_no']), 'writer': asStr(r['mbr_nick']), 'dept': asStr(r['dept_name']),
            'writeDate': asStr(r['write_date']), 'readCnt': asStr(r['read_cnt']), 'fileCnt': asInt(r['file_cnt']), 'attachmentUid': asStr(r['uid']), 'isNew': asStr(r['is_new_yn']) == 'Y',
            'read': asStr(r['art_read_yn']) == 'Y', 'preview': _snippet(r['art_content']),
          },
      ],
    };
  }

  Future<Map<String, dynamic>> _readNotice(Map x) async {
    final d = await _gw.noticeRaw(_req(x, 'art_seq_no'));
    final art = d['art'] is Map ? d['art'] as Map : const {}, board = d['board'] is Map ? d['board'] as Map : const {};
    final images = <String>[];
    final html = asStr(art['art_content']).replaceAllMapped(RegExp(r'''<img\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)[^>]*>''', caseSensitive: false), (mm) {
      images.add(mm[1]!);
      return '[이미지]';
    });
    String firstOf(Map r, List<String> keys) => keys.map((k) => asStr(r[k])).firstWhere((v) => v.isNotEmpty, orElse: () => '');
    return {
      'artSeqNo': asStr(art['art_seq_no']), 'title': asStr(art['art_title']), 'board': asStr(board['cat_title']), 'writer': asStr(art['mbr_nick']), 'dept': asStr(art['dept_name']),
      'writeDate': asStr(art['write_date']), 'readCnt': asStr(art['read_cnt']), 'fileCnt': asInt(art['file_cnt']), 'attachmentUid': asStr(art['uid']), 'content': m.htmlToText(html), 'images': images,
      'comments': [
        for (final r in ((d['remarkList'] as List?) ?? const []).whereType<Map>())
          {'writer': asStr(r['mbr_nick']), 'writeDate': asStr(r['write_date']), 'content': m.htmlToText(firstOf(r, ['remark_desc', 'remark_content', 'content', 'art_content']))},
      ],
    };
  }

  Future<Map<String, dynamic>> _search(Map x) async {
    final q = _req(x, 'query'), scope = a.str(x, 'scope'), from = a.str(x, 'from'), to = a.str(x, 'to');
    final limit = (a.intOf(x, 'limit') ?? 10).clamp(1, 50);
    final all = scope.isEmpty || scope == '전체';
    final targets = _searchModules.entries.where((e) => all || e.key == scope || (scope == '결재' && e.key == '전자결재')).toList();
    if (targets.isEmpty) throw McpToolError('scope는 ""·전체·메일·결재·게시판·일정·자원·파일 중 하나입니다.');
    final results = <Map<String, dynamic>>[];
    var total = 0;
    GwException? lastErr;
    for (final t in targets) {
      Map d;
      try {
        d = await _gw.searchRaw(t.value, q, from: from, to: to, limit: limit);
      } on GwUnauthorized {
        rethrow;
      } on GwException catch (e) {
        lastErr = e; // 모듈 하나 실패는 건너뛰고, 전부 실패하면 던진다
        continue;
      }
      final rows = ((d['resultgrid'] as List?) ?? const []).whereType<Map>().toList();
      final items = [
        for (final r in rows)
          switch (t.value) {
            '0' => {'module': t.key, 'title': _sv(r, 'subject'), 'date': _sv(r, 'rfc822date'), 'who': _sv(r, 'fromAddrName'), 'from': _sv(r, 'fromAddrEmail'), 'box': _sv(r, 'boxName'), 'muid': _sv(r, 'muid'), 'snippet': _snippet(_sv(r, 'mailBody'))},
            '6' => {
                'module': t.key, 'title': _sv(r, 'docTitle'), 'date': _sv(r, 'rep_dt'), 'who': _sv(r, 'userNm'), 'empSeq': _sv(r, 'empSeq'), 'dept': _sv(r, 'deptNm'), 'form': _sv(r, 'formNm'),
                'docId': _sv(r, 'docId'), 'formId': _sv(r, 'formId'), 'status': _sv(r, 'docSts'), 'snippet': _snippet(_sv(r, 'docContents')),
              },
            '9' => {'module': t.key, 'title': _sv(r, 'artTitle'), 'date': _sv(r, 'writeDate'), 'who': _sv(r, 'mbrNick'), 'empSeq': _sv(r, 'empSeq'), 'board': _sv(r, 'boardName'), 'artSeqNo': _sv(r, 'artSeqNo'), 'snippet': _snippet(_sv(r, 'artContent'))},
            '3' => {'module': t.key, 'title': _sv(r, 'schTitle'), 'date': _sv(r, 'startDate'), 'schSeq': _sv(r, 'schSeq')},
            '13' => {'module': t.key, 'title': _sv(r, 'reqText'), 'date': _sv(r, 'startDate'), 'resSeq': _sv(r, 'resSeq')},
            _ => {'module': t.key, 'title': _sv(r, 'fileName'), 'date': _sv(r, 'createDate'), 'who': _sv(r, 'empName')},
          },
      ];
      total += asInt(d['totalcount']);
      results.add({'module': t.key, 'totalCount': asInt(d['totalcount']), 'returned': items.length, 'items': items});
    }
    if (results.isEmpty && lastErr != null) throw lastErr;
    return {'kind': 'search', 'query': q, 'scope': all ? '전체' : scope, 'period': from.isEmpty && to.isEmpty ? null : {'from': from, 'to': to}, 'totalAcrossModules': total, 'results': results};
  }
}
