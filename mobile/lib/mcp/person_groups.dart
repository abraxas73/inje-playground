// mobile/lib/mcp/person_groups.dart — 사람 그룹(`<앱 지원 폴더>/person_groups.json`, inno-creed와 같은 형식).
// {"groups":{"<이름>":{"note":"","members":[{"empSeq":"3166","label":"이재학"}]}}}. 정본은 empSeq, label은 사람이 읽는 용도.
// 사람이 파일을 손으로 고칠 수 있으므로 쓰기는 읽고-고치고-쓰기로 다른 그룹을 건드리지 않는다.
import 'dart:convert';
import 'dart:io';
import '../gw/gw_client.dart' show asStr;
import 'mcp_worker.dart' show McpToolError;

const _note = '그룹을 만들거나 고치려면 save_person_group(이름/empSeq를 그대로 주면 된다), 지우려면 delete_person_group. '
    'path 의 JSON 파일을 사람이 직접 편집해도 된다 — 형식: {"groups":{"<이름>":{"note":"...","members":[{"empSeq":"3166","label":"이재학"}]}}}';

Map<String, String> _brief(Map r) => {'empSeq': asStr(r['empSeq']), 'name': asStr(r['empName']), 'dept': asStr(r['deptName']), 'duty': asStr(r['dutyName']), 'email': asStr(r['emailAddr'])};

/// 이름 또는 empSeq → 명부 행. 숫자만이면 empSeq 완전일치, 아니면 이름 완전일치(동명이인이면 모호).
({Map? hit, String reason, List<Map> candidates}) resolvePerson(String input, List<Map> roster) {
  final q = input.trim();
  if (RegExp(r'^\d+$').hasMatch(q)) {
    final m = roster.where((r) => asStr(r['empSeq']) == q).toList();
    return m.isEmpty ? (hit: null, reason: 'not_found', candidates: const []) : (hit: m.first, reason: 'ok', candidates: m);
  }
  final lower = q.toLowerCase();
  final exact = roster.where((r) => asStr(r['empName']).trim().toLowerCase() == lower).toList();
  if (exact.length == 1) return (hit: exact.first, reason: 'ok', candidates: exact);
  if (exact.length > 1) return (hit: null, reason: 'ambiguous', candidates: exact);
  return (hit: null, reason: 'not_found', candidates: roster.where((r) => asStr(r['empName']).toLowerCase().contains(lower)).take(10).toList());
}

class PersonGroups {
  PersonGroups(this.appSupportDir);
  final String Function() appSupportDir;
  String get path => '${appSupportDir()}${Platform.pathSeparator}person_groups.json';

  Future<Map<String, dynamic>> _read() async {
    final f = File(path);
    if (!await f.exists()) return {'groups': <String, dynamic>{}};
    try {
      final j = jsonDecode(await f.readAsString());
      if (j is Map<String, dynamic> && (j['groups'] == null || j['groups'] is Map)) return {...j, 'groups': Map<String, dynamic>.from(j['groups'] as Map? ?? {})};
    } catch (_) {}
    throw McpToolError('person_groups.json 형식이 올바르지 않습니다. $path 파일을 확인하세요.');
  }

  Future<void> _write(Map<String, dynamic> data) async {
    final f = File(path);
    await f.parent.create(recursive: true);
    // 임시 파일에 쓰고 바꿔치기 — 쓰다 멈춰도 기존 파일이 반쯤 잘리지 않게
    final tmp = File('$path.tmp');
    await tmp.writeAsString(const JsonEncoder.withIndent('  ').convert(data), flush: true);
    await tmp.rename(f.path);
  }

  static List<Map> _members(Object? g) => g is Map ? ((g['members'] as List?) ?? const []).whereType<Map>().toList() : const [];

  /// 그룹 목록(이름·인원·메모).
  Future<Map<String, dynamic>> list() async {
    final groups = (await _read())['groups'] as Map;
    return {
      'kind': 'personGroups', 'path': path, 'count': groups.length, 'note': _note,
      'groups': [for (final e in groups.entries) {'name': e.key, 'count': _members(e.value).length, 'note': asStr(e.value is Map ? (e.value as Map)['note'] : '')}],
    };
  }

  /// 그룹 하나를 명부로 풀어서 — 명부에 없는 사람은 status not_found + missing, emails에서는 빠진다.
  Future<Map<String, dynamic>> get(String name, List<Map> roster) async {
    final g = ((await _read())['groups'] as Map)[name];
    if (g is! Map) throw McpToolError('"$name" 그룹이 없습니다. person_group(이름 비움)으로 목록을 확인하세요.');
    final byEmp = {for (final r in roster) asStr(r['empSeq']): r};
    final members = <Map<String, String>>[], missing = <Map<String, String>>[];
    for (final m in _members(g)) {
      final emp = asStr(m['empSeq']), r = byEmp[emp];
      if (r == null) {
        members.add({'empSeq': emp, 'name': asStr(m['label']), 'email': '', 'dept': '', 'duty': '', 'status': 'not_found'});
        missing.add({'empSeq': emp, 'label': asStr(m['label'])});
      } else {
        final b = _brief(r);
        members.add({'empSeq': emp, 'name': b['name']!, 'email': b['email']!, 'dept': b['dept']!, 'duty': b['duty']!, 'status': 'ok'});
      }
    }
    return {
      'kind': 'personGroup', 'name': name, 'note': asStr(g['note']), 'path': path, 'count': members.length, 'members': members,
      'empSeqs': [for (final m in members) m['empSeq']], 'emails': [for (final m in members) if (m['status'] == 'ok' && m['email']!.isNotEmpty) m['email']], 'missing': missing,
    };
  }

  /// 만들기·고치기. mode replace(기본)/add/remove. 명부에 없거나 동명이인이 하나라도 있으면 저장하지 않고 후보를 돌려준다.
  Future<Map<String, dynamic>> save(String name, List<String> inputs, {String mode = '', String note = '', required List<Map> roster}) async {
    final m = mode.isEmpty ? 'replace' : mode;
    if (!const {'replace', 'add', 'remove'}.contains(m)) throw McpToolError('mode는 replace·add·remove 중 하나입니다.');
    if (name.isEmpty) throw McpToolError('name 인자가 필요합니다.');
    final data = await _read();
    final groups = data['groups'] as Map<String, dynamic>;
    final existing = groups[name];
    if (m != 'replace' && existing is! Map) throw McpToolError('"$name" 그룹이 없어 $m 할 수 없습니다. 먼저 replace로 만드세요.');
    if (m != 'remove' && inputs.isEmpty) throw McpToolError('members가 비었습니다.');
    var current = [for (final x in _members(existing)) {'empSeq': asStr(x['empSeq']), 'label': asStr(x['label'])}];
    final resolved = <Map<String, String>>[], problems = <Map<String, dynamic>>[];
    for (final input in inputs) {
      // remove는 파일에 있는 empSeq·라벨과 먼저 맞춰 본다(명부에서 빠진 사람도 뺄 수 있게)
      final inFile = m == 'remove' ? current.where((x) => x['empSeq'] == input || x['label'] == input).firstOrNull : null;
      if (inFile != null) {
        resolved.add(inFile);
        continue;
      }
      final r = resolvePerson(input, roster);
      if (r.hit != null) {
        resolved.add({'empSeq': asStr(r.hit!['empSeq']), 'label': asStr(r.hit!['empName'])});
      } else {
        problems.add({'input': input, 'reason': r.reason, 'people': [for (final c in r.candidates) _brief(c)]});
      }
    }
    if (problems.isNotEmpty) {
      return {
        'ok': false, 'kind': 'personGroupSave', 'name': name, 'saved': false, 'candidates': problems,
        'message': '명부에 없거나 동명이인인 사람이 있어 저장하지 않았습니다. 후보에서 empSeq를 골라 다시 저장하세요.',
      };
    }
    final drop = {for (final x in resolved) x['empSeq']};
    current = switch (m) {
      'add' => [...current, for (final x in resolved) if (!current.any((c) => c['empSeq'] == x['empSeq'])) x],
      'remove' => [for (final c in current) if (!drop.contains(c['empSeq'])) c],
      _ => [for (final (i, x) in resolved.indexed) if (resolved.indexWhere((y) => y['empSeq'] == x['empSeq']) == i) x],
    };
    final keepNote = note.isEmpty ? asStr(existing is Map ? existing['note'] : '') : note;
    groups[name] = {'note': keepNote, 'members': current};
    await _write(data);
    return {'ok': true, 'kind': 'personGroupSave', 'name': name, 'mode': m, 'note': keepNote, 'count': current.length, 'members': current, 'path': path};
  }

  Future<Map<String, dynamic>> delete(String name) async {
    final data = await _read();
    final groups = data['groups'] as Map<String, dynamic>;
    if (!groups.containsKey(name)) throw McpToolError('"$name" 그룹이 없습니다. 지우지 않았습니다.');
    groups.remove(name);
    await _write(data);
    return {'ok': true, 'kind': 'personGroupDelete', 'deleted': name, 'remaining': groups.keys.toList(), 'path': path};
  }
}
