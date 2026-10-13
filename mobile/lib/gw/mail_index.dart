import 'dart:convert';
import 'gw_client.dart' show asStr, asBool, asInt;
import 'gw_models.dart';

/// 메일 검색 색인(순수 Dart, 기기 안에서만). 목록(mail003A01)의 제목·보낸 사람·날짜는 모두 담고,
/// 본문·받는 사람·첨부 이름은 이미 읽은 메일만(mail002A01이 읽음 처리하므로 안 읽은 메일 본문은 열지 않는다).
/// 검색은 저장된 글자열을 정규식(대소문자 무시)으로 훑는다 — 몇천 통·수 MB면 수십 ms라 역색인 없이 충분하다.
/// ponytail: 선형 스캔, 수만 통이 되면 SQLite FTS5(trigram)로 교체.
class MailDoc {
  const MailDoc({required this.muid, required this.box, required this.subject, required this.fromName, required this.fromEmail, required this.to, required this.cc, required this.date, required this.seen, required this.attach, required this.size, this.body, this.files = const []});
  final String muid, box, subject, fromName, fromEmail, to, cc;
  /// 'YYYY-MM-DD HH:MM:SS'(tooltipDate). 문자열 비교로 정렬·기간 필터.
  final String date;
  final bool seen, attach;
  final int size;
  /// null = 본문 미색인. ''는 읽었지만 비어 있음(또는 읽기 실패 — 다시 시도하지 않음).
  final String? body;
  final List<String> files;

  String get from => _addr(fromName, fromEmail);
  static String _addr(String name, String email) => name.isEmpty ? email : email.isEmpty ? name : '$name <$email>';

  factory MailDoc.fromRow(Map r, String box) => MailDoc(
        muid: asStr(r['muid']), box: box, subject: asStr(r['subject']), fromName: asStr(r['fromAddrName']), fromEmail: asStr(r['fromAddrEmail']),
        to: _addr(asStr(r['toAddrName']), asStr(r['toAddrEmail'])), cc: '', date: asStr(r['tooltipDate']).isNotEmpty ? asStr(r['tooltipDate']) : asStr(r['rfc822date']),
        seen: asBool(r['seen']), attach: asBool(r['attach']), size: asInt(r['size']));

  MailDoc copyWith({bool? seen, String? body, List<String>? files, String? to, String? cc, String? date}) =>
      MailDoc(muid: muid, box: box, subject: subject, fromName: fromName, fromEmail: fromEmail, to: to ?? this.to, cc: cc ?? this.cc, date: date ?? this.date, seen: seen ?? this.seen, attach: attach, size: size, body: body ?? this.body, files: files ?? this.files);

  /// 목록 화면·본문 화면이 쓰는 항목. 짧은 날짜는 전체 날짜에서 'MM-DD HH:MM'.
  MailItem toItem() => MailItem(muid: muid, subject: subject, fromName: fromName, fromEmail: fromEmail, date: date.length >= 16 ? date.substring(5, 16) : date, tooltip: date, seen: seen, attach: attach);

  Map<String, Object?> toJson() => {'m': muid, 'bx': box, 's': subject, 'fn': fromName, 'fe': fromEmail, 'to': to, 'cc': cc, 'd': date, 'sn': seen, 'at': attach, 'sz': size, if (body != null) 'b': body, if (files.isNotEmpty) 'f': files};
  factory MailDoc.fromJson(Map j) => MailDoc(
      muid: asStr(j['m']), box: asStr(j['bx']), subject: asStr(j['s']), fromName: asStr(j['fn']), fromEmail: asStr(j['fe']), to: asStr(j['to']), cc: asStr(j['cc']), date: asStr(j['d']),
      seen: asBool(j['sn']), attach: asBool(j['at']), size: asInt(j['sz']), body: j['b'] is String ? j['b'] as String : null, files: [for (final f in (j['f'] as List?) ?? const []) asStr(f)]);
}

enum MailField { any, subject, from, to, body, file }

class MailTerm {
  MailTerm(this.field, this.text) : re = RegExp(RegExp.escape(text), caseSensitive: false);
  final MailField field;
  final String text;
  final RegExp re;
}

/// 검색식: 단어는 AND, `OR`/`|`로 묶음, `"구문"`, `-제외`, `from: to: subject: body: file: after: before: has:attach is:unread in:sent`(한글 별칭 포함).
class MailQuery {
  const MailQuery({required this.groups, required this.excludes, this.after, this.before, this.attach, this.seen, this.box});
  /// AND로 묶이는 OR 그룹들.
  final List<List<MailTerm>> groups;
  final List<MailTerm> excludes;
  /// 'YYYY', 'YYYY-MM', 'YYYY-MM-DD' — 문자열 비교(after 포함, before 미포함).
  final String? after, before;
  final bool? attach, seen;
  final String? box;
  bool get isEmpty => groups.isEmpty && excludes.isEmpty && after == null && before == null && attach == null && seen == null && box == null;
  Iterable<MailTerm> get terms => groups.expand((g) => g);
}

const _fields = {
  'from': MailField.from, '보낸사람': MailField.from, '보낸이': MailField.from, '발신': MailField.from,
  'to': MailField.to, 'cc': MailField.to, '받는사람': MailField.to, '받는이': MailField.to, '참조': MailField.to, '수신': MailField.to,
  'subject': MailField.subject, '제목': MailField.subject,
  'body': MailField.body, '본문': MailField.body, '내용': MailField.body,
  'file': MailField.file, 'attachment': MailField.file, '첨부': MailField.file, '첨부파일': MailField.file, '파일': MailField.file,
};
const _afterKeys = {'after', 'since', 'newer', '이후', '부터'}, _beforeKeys = {'before', 'until', 'older', '이전', '까지'};

MailQuery parseMailQuery(String input) {
  final groups = <List<MailTerm>>[], excludes = <MailTerm>[];
  String? after, before, box;
  bool? attach, seen;
  var orNext = false;
  for (final tok in _tokens(input)) {
    if (tok == 'OR' || tok == '|') {
      orNext = groups.isNotEmpty;
      continue;
    }
    var t = tok;
    final not = t.startsWith('-') || t.startsWith('!');
    if (not) t = t.substring(1);
    var field = MailField.any;
    final colon = t.indexOf(':');
    if (colon > 0) {
      final key = t.substring(0, colon).toLowerCase(), value = _unquote(t.substring(colon + 1));
      if (_fields.containsKey(key)) {
        field = _fields[key]!;
        t = value;
      } else if (_afterKeys.contains(key)) {
        after = _dateKey(value) ?? after;
        continue;
      } else if (_beforeKeys.contains(key)) {
        before = _dateKey(value) ?? before;
        continue;
      } else if (key == 'has') {
        if (const {'attach', 'attachment', 'file', '첨부', '첨부파일'}.contains(value.toLowerCase())) attach = !not;
        continue;
      } else if (key == 'is') {
        final v = value.toLowerCase();
        if (const {'unread', 'unseen', '안읽음', '미읽음', '안읽은'}.contains(v)) seen = not;
        if (const {'read', 'seen', '읽음', '읽은'}.contains(v)) seen = !not;
        continue;
      } else if (key == 'in' || key == '함' || key == '메일함') {
        final v = value.toLowerCase();
        if (const {'inbox', '받은', '받은편지함', '받은메일함'}.contains(v)) box = 'INBOX';
        if (const {'sent', '보낸', '보낸편지함', '보낸메일함'}.contains(v)) box = 'SENT';
        continue;
      }
    }
    t = _unquote(t);
    if (t.isEmpty) continue;
    final term = MailTerm(field, t);
    if (not) {
      excludes.add(term);
    } else if (orNext) {
      groups.last.add(term);
    } else {
      groups.add([term]);
    }
    orNext = false;
  }
  return MailQuery(groups: groups, excludes: excludes, after: after, before: before, attach: attach, seen: seen, box: box);
}

/// 공백으로 나누되 따옴표 안은 한 토큰(`from:"홍 길동"` 포함).
List<String> _tokens(String s) {
  final out = <String>[];
  final b = StringBuffer();
  var quoted = false;
  for (final ch in s.split('')) {
    if (ch == '"') {
      quoted = !quoted;
      b.write(ch);
    } else if (!quoted && ch.trim().isEmpty) {
      if (b.isNotEmpty) out.add(b.toString());
      b.clear();
    } else {
      b.write(ch);
    }
  }
  if (b.isNotEmpty) out.add(b.toString());
  return out;
}

String _unquote(String s) => s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.substring(1, s.length - 1).trim() : s.replaceAll('"', '').trim();

/// '2026-9', '2026/10/05', '20261005', '2026.10' → 'YYYY[-MM[-DD]]'. 못 읽으면 null.
String? _dateKey(String v) {
  final digits = v.replaceAll(RegExp(r'\D'), '');
  final parts = v.contains(RegExp(r'\D')) ? v.split(RegExp(r'\D+')).where((p) => p.isNotEmpty).toList() : [if (digits.length >= 4) digits.substring(0, 4), if (digits.length >= 6) digits.substring(4, 6), if (digits.length >= 8) digits.substring(6, 8)];
  if (parts.isEmpty || parts.first.length != 4 || parts.length > 3) return null;
  final nums = parts.map(int.tryParse).toList();
  if (nums.any((n) => n == null)) return null;
  final y = nums[0]!, m = nums.length > 1 ? nums[1]! : null, d = nums.length > 2 ? nums[2]! : null;
  if (m != null && (m < 1 || m > 12) || d != null && (d < 1 || d > 31)) return null;
  return '$y${m == null ? '' : '-${m.toString().padLeft(2, '0')}'}${d == null ? '' : '-${d.toString().padLeft(2, '0')}'}';
}

class MailHit {
  const MailHit(this.doc, this.score, this.snippet, this.terms);
  final MailDoc doc;
  final int score;
  final String snippet;
  final List<MailTerm> terms;
}

/// [res]가 맞는 구간(겹침 병합, 시작 순). 화면 강조용.
List<(int, int)> matchRanges(String text, List<MailTerm> terms) {
  final raw = [for (final t in terms) for (final m in t.re.allMatches(text)) (m.start, m.end)]..sort((a, b) => a.$1.compareTo(b.$1));
  final out = <(int, int)>[];
  for (final r in raw) {
    if (out.isNotEmpty && r.$1 <= out.last.$2) {
      if (r.$2 > out.last.$2) out[out.length - 1] = (out.last.$1, r.$2);
    } else {
      out.add(r);
    }
  }
  return out;
}

class MailIndex {
  MailIndex([Map<String, MailDoc>? docs]) : docs = docs ?? {};
  final Map<String, MailDoc> docs;
  static const bodyLimit = 10000;

  int get bodies => docs.values.where((d) => d.body != null).length;

  /// 목록 행 반영. 새 메일이거나 읽음·제목이 달라졌으면 true. 본문·받는 사람·첨부 이름은 유지.
  bool upsertMeta(MailDoc meta) {
    final old = docs[meta.muid];
    if (old == null) {
      docs[meta.muid] = meta;
      return true;
    }
    if (old.seen == meta.seen && old.subject == meta.subject && old.date == meta.date && old.attach == meta.attach) return false;
    docs[meta.muid] = meta.copyWith(body: old.body, files: old.files, to: old.to.isNotEmpty ? old.to : null, cc: old.cc);
    return true;
  }

  void setDetail(String muid, {required String body, required String to, required String cc, required List<String> files, required String date}) {
    final old = docs[muid];
    if (old == null) return;
    docs[muid] = old.copyWith(seen: true, body: body.length > bodyLimit ? body.substring(0, bodyLimit) : body, files: files, to: to.isNotEmpty ? to : null, cc: cc.isNotEmpty ? cc : null, date: date.isNotEmpty && old.date.length < date.length ? date : null);
  }

  /// 메일함 전체를 끝까지 읽은 뒤 — 목록에 더 없는 메일(삭제·이동)을 색인에서 뺀다.
  void retain(String box, Set<String> muids) => docs.removeWhere((k, d) => d.box == box && !muids.contains(k));

  List<MailHit> search(String input, {bool byRelevance = false, int limit = 300}) {
    final q = parseMailQuery(input);
    if (q.isEmpty) return const [];
    final hits = <MailHit>[];
    for (final d in docs.values) {
      if (q.box != null && d.box != q.box) continue;
      if (q.attach != null && d.attach != q.attach) continue;
      if (q.seen != null && d.seen != q.seen) continue;
      if (q.after != null && d.date.compareTo(q.after!) < 0) continue;
      if (q.before != null && d.date.compareTo(q.before!) >= 0) continue;
      var score = 0, ok = true;
      for (final g in q.groups) {
        var best = 0;
        for (final t in g) {
          final s = _score(d, t);
          if (s > best) best = s;
        }
        if (best == 0) {
          ok = false;
          break;
        }
        score += best;
      }
      if (!ok || q.excludes.any((t) => _score(d, t) > 0)) continue;
      hits.add(MailHit(d, score, _snippet(d, q), q.terms.toList()));
    }
    hits.sort((a, b) {
      if (byRelevance && a.score != b.score) return b.score.compareTo(a.score);
      return b.doc.date.compareTo(a.doc.date);
    });
    return hits.length > limit ? hits.sublist(0, limit) : hits;
  }

  static int _score(MailDoc d, MailTerm t) {
    int has(String s, int w) => s.isNotEmpty && t.re.hasMatch(s) ? w : 0;
    return switch (t.field) {
      MailField.subject => has(d.subject, 5),
      MailField.from => has(d.from, 3),
      MailField.to => has(d.to, 2) + has(d.cc, 2),
      MailField.body => has(d.body ?? '', 1),
      MailField.file => has(d.files.join('\n'), 2),
      MailField.any => has(d.subject, 5) + has(d.from, 3) + has(d.to, 2) + has(d.cc, 2) + has(d.files.join('\n'), 2) + has(d.body ?? '', 1),
    };
  }

  /// 본문에서 가장 앞선 일치 주변(±60자), 없으면 본문 앞 120자.
  static String _snippet(MailDoc d, MailQuery q, {int radius = 60}) {
    final body = oneLine(d.body ?? '');
    if (body.isEmpty) return '';
    int? first;
    for (final t in q.terms) {
      if (t.field != MailField.any && t.field != MailField.body) continue;
      final m = t.re.firstMatch(body);
      if (m != null && (first == null || m.start < first)) first = m.start;
    }
    if (first == null) return body.length > radius * 2 ? '${body.substring(0, radius * 2)}…' : body;
    final start = (first - radius).clamp(0, body.length), end = (first + radius).clamp(0, body.length);
    return '${start > 0 ? '…' : ''}${body.substring(start, end)}${end < body.length ? '…' : ''}';
  }

  String toJson() => jsonEncode({'v': 1, 'docs': [for (final d in docs.values) d.toJson()]});
  factory MailIndex.fromJson(Map j) => MailIndex({for (final d in (j['docs'] as List?) ?? const []) if (d is Map) asStr(d['m']): MailDoc.fromJson(d)});
}
