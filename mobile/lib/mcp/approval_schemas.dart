// mobile/lib/mcp/approval_schemas.dart — 결재라인 스키마·신청 가이드(내장 자산 assets/mcp/, inno-creed 2.2.0 출력 그대로)와 결재선 후보 제안.
// 사용자 override 파일은 지원하지 않는다(스펙 §8).
import 'dart:convert';
import 'package:flutter/services.dart' show rootBundle;
import '../gw/gw_client.dart' show asStr, asInt;
import 'mcp_worker.dart' show McpToolError;

const _top = '사업부장/실장/센터장이상';

/// 본인 직책(dutyName) → 스키마 grade 구간.
String gradeOf(String duty) {
  final d = duty.trim();
  if (d == '팀장') return '팀장';
  if (RegExp('센터장|실장|사업부장|본부장|부문장|대표').hasMatch(d)) return _top;
  return '팀원';
}

class ApprovalSchemas {
  ApprovalSchemas({Future<String> Function(String assetPath)? loader}) : _load = loader ?? rootBundle.loadString;
  final Future<String> Function(String) _load;
  final _cache = <String, Future<dynamic>>{};

  Future<dynamic> _json(String name) => _cache[name] ??= _load('assets/mcp/$name.json').then(jsonDecode);
  Future<dynamic> list() => _json('approval_line_schemas');
  Future<dynamic> guides() => _json('approval_submission_guides');

  /// 양식명·form_id·별칭 → formId. 공백 무시.
  Future<int> _formId(dynamic index, String docType) async {
    String n(Object? v) => asStr(v).replaceAll(RegExp(r'\s'), '');
    final q = n(docType);
    final forms = ((index as Map)['forms'] as List).cast<Map>();
    for (final f in forms) {
      if (q.isNotEmpty && (n(f['docType']) == q || n(f['formId']) == q || (f['aliases'] as List? ?? const []).any((x) => n(x) == q))) return asInt(f['formId']);
    }
    throw McpToolError('"$docType" 양식은 수록돼 있지 않습니다. 수록: ${forms.map((f) => '${f['docType']}(${f['formId']})').join(', ')}');
  }

  Future<dynamic> schema(String docType) async => _json('approval_line_schema_${await _formId(await list(), docType)}');
  Future<dynamic> guide(String docType) async => _json('approval_submission_guide_${await _formId(await guides(), docType)}');

  /// 내가 기안할 때의 결재선 후보. me = {empSeq,name,deptSeq,deptName,duty,position}, tree = gw102A01 treeList, members(deptId) = gw102A02.
  Future<Map<String, dynamic>> suggest(String docType, String trip, {required Map<String, String> me, required List<Map> tree, required Future<List<Map>> Function(String deptId) members}) async {
    final s = await schema(docType) as Map;
    final branchesAll = ((s['schema'] as Map)['branches'] as List).cast<Map>();
    final positions = s['positions'] as Map;
    final hasTrip = branchesAll.any((b) => (b['when'] as Map).containsKey('trip'));
    final warnings = <String>[
      '후보일 뿐 확정 결재선이 아닙니다 — 각 단계의 사람을 사용자에게 확인받은 뒤 save_approval_line으로 등록하세요.',
      '등록 시 결재(3000) 노드만 담으세요 — 양식필수 합의자·수신참조·시행자는 상신 때 서버(eap110A03)가 자동 병합합니다.',
    ];
    if (trip.isNotEmpty && !const {'국내', '해외'}.contains(trip)) throw McpToolError('trip은 "국내" 또는 "해외"입니다.');
    if (trip.isNotEmpty && !hasTrip) warnings.add('이 양식은 국내/해외 구분이 없어 trip을 무시했습니다.');
    final duty = me['duty'] ?? '', grade = gradeOf(duty);
    if (duty.isEmpty) {
      warnings.add('본인 직책을 확인하지 못해 팀원 구간으로 봤습니다.');
    } else if (grade == '팀원' && duty != '팀원') {
      warnings.add('직책 "$duty"을(를) 팀원 구간으로 봤습니다.');
    }
    final picked = [
      for (final b in branchesAll)
        if (asStr((b['when'] as Map)['grade']) == grade && (trip.isEmpty || !hasTrip || asStr((b['when'] as Map)['trip']) == trip)) b,
    ];
    if (picked.isEmpty) throw McpToolError('"$grade" 구간의 결재선이 스키마에 없습니다.');

    final depts = {for (final n in tree) if (asStr(n['orgGubun']) == 'd') asStr(n['id']): n};
    final byKey = {for (final n in tree) asStr(n['keySeq']): n};
    final memo = <String, Future<List<Map>>>{};
    Future<List<Map>> mem(String id) => memo[id] ??= members(id);
    bool dutyIn(Map r, String pattern) => pattern.split('|').contains(asStr(r['dutyName']).trim());
    Map<String, String> cand(Map r) => {'empSeq': asStr(r['empSeq']), 'name': asStr(r['empName']), 'deptId': asStr(r['deptSeq']), 'deptName': asStr(r['deptName']), 'duty': asStr(r['dutyName']), 'position': asStr(r['positionName'])};

    Future<Map<String, dynamic>> resolve(String pos) async {
      final p = positions[pos] is Map ? positions[pos] as Map : const {};
      final kind = asStr(p['kind']), pattern = asStr(p['duty']);
      if (kind == 'relative') {
        // 기안 부서에서 상위로 — 그 직책 보유자가 처음 나오는 부서
        var node = depts[me['deptSeq']];
        while (node != null) {
          final hits = (await mem(asStr(node['id']))).where((r) => dutyIn(r, pattern)).toList();
          final others = hits.where((r) => asStr(r['empSeq']) != me['empSeq']).toList();
          if (others.isNotEmpty) return {'candidates': others.map(cand).toList(), 'foundIn': asStr(node['text'])};
          if (hits.isNotEmpty) return {'candidates': hits.map(cand).toList(), 'foundIn': asStr(node['text']), 'self': true};
          final up = byKey[asStr(node['parentKeySeq'])] ?? depts[asStr(node['parentSeq'])];
          node = up != null && asStr(up['orgGubun']) == 'd' ? up : null;
        }
        return {'candidates': <Map>[], 'foundIn': ''};
      }
      // 고정 직책: positions[].dept 이름의 부서원에서 duty로(duty 없으면 부서원 전원)
      final dept = asStr(p['dept']);
      final found = <Map>[];
      for (final n in tree.where((n) => asStr(n['text']).trim() == dept)) {
        found.addAll((await mem(asStr(n['id']))).where((r) => pattern.isEmpty || dutyIn(r, pattern)));
      }
      return {'candidates': found.map(cand).toList(), 'foundIn': found.isEmpty ? '' : dept};
    }

    final out = <Map<String, dynamic>>[];
    for (final b in picked) {
      final steps = <Map<String, dynamic>>[];
      for (final (i, l) in ((b['line'] as List).cast<Map>()).indexed) {
        final pos = asStr(l['pos']);
        final p = positions[pos] is Map ? positions[pos] as Map : const {};
        final r = await resolve(pos);
        final c = r['candidates'] as List;
        final status = r['self'] == true ? '본인' : (c.isEmpty ? '미해결' : (c.length == 1 ? '후보1' : '후보다수'));
        if (status == '미해결') warnings.add('"$pos" 담당자를 찾지 못했습니다(공석·조직 라벨 차이 가능) — 사용자에게 물어보세요.');
        if (status == '후보다수') warnings.add('"$pos" 후보가 ${c.length}명입니다 — 사용자가 고르게 하세요.');
        if (status == '본인') warnings.add('"$pos"이(가) 기안자 본인입니다 — 이 단계는 생략하거나 바꿔야 할 수 있습니다.');
        steps.add({
          'order': i + 1, 'act': asStr(l['act']), 'pos': pos, 'final': l['final'] == true, 'kind': asStr(p['kind']), 'duty': asStr(p['duty']), 'desc': asStr(p['desc']),
          'status': status, 'candidates': c, 'foundIn': r['foundIn'],
        });
      }
      out.add({'when': b['when'], 'steps': steps});
    }
    final note = asStr((s['schema'] as Map)['note']);
    if (note.isNotEmpty) warnings.add(note);
    return {
      'kind': 'approvalLineSuggestion', 'docType': s['docType'], 'formId': (s['schema'] as Map)['form_id'], 'version': s['version'], 'source': s['source'], 'trip': trip,
      'drafter': {...me, 'grade': grade}, 'branches': out, 'verificationRequired': true, 'warnings': warnings,
    };
  }
}
