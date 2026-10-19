// 아마란스 응답 정제 — 순수 함수만(네트워크 없음). 필드 이름·의미의 출처는 inno-creed src/modules/*.rs.
import 'package:html/dom.dart' as dom;
import 'package:html/parser.dart' as html_parser;
import 'gw_client.dart' show asStr, asBool, asInt;

/// 한국 시각. 기기 시간대와 무관하게 '오늘'을 정하는 기준(근태·일정·대기일수).
/// 반환값은 "KST 벽시계 + UTC 플래그"(isUtc=true). GW 시각 문자열을 DateTime으로 만들어 이것과 비교할 때는 반드시 `DateTime.utc(...)`로 만든다(`briefing_model.dart` `gwTime` 참고).
DateTime kstOf(DateTime t) => t.toUtc().add(const Duration(hours: 9));
DateTime kstNow() => kstOf(DateTime.now());

String ymd(DateTime d) => '${d.year}${d.month.toString().padLeft(2, '0')}${d.day.toString().padLeft(2, '0')}';
String ymdhm(DateTime d) => '${ymd(d)}${d.hour.toString().padLeft(2, '0')}${d.minute.toString().padLeft(2, '0')}';

/// 'YYYYMMDDHHmm' → 'HH:mm'. 형식이 다르면 원문.
String hm(String s) => s.length == 12 ? '${s.substring(8, 10)}:${s.substring(10, 12)}' : s;
String _digits(String s) => s.replaceAll(RegExp(r'\D'), '');
DateTime? _parseYmd(String s) {
  final d = _digits(s);
  if (d.length < 8) return null;
  return DateTime(int.parse(d.substring(0, 4)), int.parse(d.substring(4, 6)), int.parse(d.substring(6, 8)));
}

int? daysBetween(String ymd8, DateTime today) {
  final a = _parseYmd(ymd8);
  if (a == null) return null;
  return DateTime(today.year, today.month, today.day).difference(a).inDays;
}

/// HTML → 평문(package:html로 DOM을 걸음). 블록 요소(p·div·li·tr·h1~6·br…) 경계는 줄바꿈으로 남기고(상세 본문이 한 줄로 뭉치지 않게)
/// 소스의 줄바꿈·들여쓰기는 공백으로 본다. 빈 줄은 최대 1개까지. head·style·script·주석은 글자까지 버리고, 엔티티는 파서가 모두 푼다(&middot;·&hellip; 포함).
/// 표: 칸이 둘 이상이고 안에 표가 없는 행은 "칸 | 칸"(칸 안의 블록·br은 한 칸 띄움, 빈 칸은 뺌 — 뉴스클리핑처럼 칸마다 p가 든 표도 한 행 = 한 줄).
/// 칸 하나짜리 행·중첩 표가 든 행은 레이아웃 표로 보고 안의 줄바꿈을 그대로 둔다(2026-10-15, 정규식 변환이 칸 안 p 때문에 행을 못 묶던 원인).
String htmlToText(String html) {
  if (html.isEmpty) return '';
  final out = _Out();
  final doc = html_parser.parse(html);
  _walk(doc.body ?? doc, out);
  return _tidyLines(out.b.toString().split('\n').map((l) => l.replaceAll(RegExp(r'[ \t]+'), ' ')).join('\n'));
}

const _blockTags = {'p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'section', 'article', 'header', 'footer', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'hr', 'address', 'dl', 'dt', 'dd', 'figure', 'figcaption', 'nav', 'aside', 'main', 'form', 'fieldset', 'center'};
const _skipTags = {'head', 'style', 'script', 'title', 'noscript', 'template'};

/// 줄 단위 출력 — 블록 경계는 "줄 처음이 아닐 때만" 줄바꿈(연속 p가 빈 줄 없이 이어지고, 태그 사이 공백만 있는 텍스트는 줄을 만들지 않는다).
class _Out {
  final b = StringBuffer();
  bool nl = true;
  void text(String t) {
    if (t.trim().isEmpty) {
      if (!nl) b.write(' ');
      return;
    }
    b.write(t);
    nl = false;
  }
  void br() {
    b.write('\n');
    nl = true;
  }
  void sep() {
    if (!nl) br();
  }
}

void _walk(dom.Node n, _Out out) {
  if (n is dom.Text) {
    out.text(n.text.replaceAll(RegExp(r'\s+'), ' '));
    return;
  }
  if (n is! dom.Element) {
    for (final c in n.nodes) {
      _walk(c, out); // Document·DocumentFragment; 주석(dom.Comment)은 자식이 없어 글자가 안 남는다
    }
    return;
  }
  final tag = n.localName ?? '';
  if (_skipTags.contains(tag)) return;
  if (tag == 'br') {
    out.br();
    return;
  }
  if (tag == 'tr') {
    final cells = n.children.where((c) => c.localName == 'td' || c.localName == 'th').toList();
    if (cells.length >= 2 && n.querySelector('table') == null) {
      final texts = cells.map((c) {
        final cell = _Out();
        for (final x in c.nodes) {
          _walk(x, cell);
        }
        return cell.b.toString().replaceAll(RegExp(r'\s+'), ' ').trim();
      }).where((t) => t.isNotEmpty);
      out.sep();
      out.text(texts.join(' | '));
      out.br();
      return;
    }
  }
  final block = _blockTags.contains(tag);
  if (block) out.sep();
  final before = out.b.length;
  for (final c in n.nodes) {
    _walk(c, out);
  }
  if (block && out.b.length == before) out.br(); // 빈 문단(p·div 안이 비거나 공백뿐)은 빈 줄 하나 — _tidyLines가 연속 빈 줄을 1개로 줄인다
  if (block) out.sep();
}

/// HTML 엔티티 → 글자. 파서가 이름·숫자 참조를 모두 푼다(&middot;·&hellip;·&#39;…). 날 `<`는 태그로 읽히지 않게 먼저 가리고,
/// `&amp;lt;`는 한 번만 풀려 `&lt;`가 된다. `&nbsp;`(U+00A0)는 보통 공백으로.
String decodeEntities(String s) => s.contains('&') ? (html_parser.parseFragment(s.replaceAll('<', '&lt;')).text ?? s).replaceAll('\u00a0', ' ') : s;

/// mail002A01 `mime.body` → 본문 평문. plain이 있으면 plain(아마란스 plain은 HTML 메일의 태그만 벗긴 것이라 `&nbsp;` 같은 엔티티와 CR이
/// 남는다 — html 부분이 함께 있을 때만 엔티티를 푼다; 순수 텍스트 메일의 `&lt;`는 글자 그대로), 없으면 html을 평문화.
/// 단 html에 표(`<table>`)가 있으면 html에서 변환한다 — plain은 칸마다 빈 줄로 벌어져 행·칸을 알 수 없다.
String mailBodyText(Map b) {
  final html = asStr(b['html']);
  var plain = asStr(b['plain']);
  if (html.contains(RegExp(r'<table\b', caseSensitive: false))) return htmlToText(html); // 표는 plain에서 행·칸 구조가 사라져(칸마다 빈 줄) html에서 변환
  if (html.isNotEmpty) plain = decodeEntities(plain);
  plain = _tidyLines(plain.replaceAll('\r', ''));
  return plain.isNotEmpty ? plain : htmlToText(html);
}

String _tidyLines(String s) => s.split('\n').map((l) => l.trim()).join('\n').replaceAll(RegExp(r'\n{3,}'), '\n\n').trim();

/// 목록 미리보기용 — 줄바꿈·연속 공백을 한 칸으로.
String oneLine(String s) => s.replaceAll(RegExp(r'\s+'), ' ').trim();

/// 받는 사람·참조 문자열(`김 <k@x>,양<y@x>, "박, 지연" <p@x>`) → 사람 목록. 따옴표·`<주소>` 안의 쉼표는 구분자가 아니다(웹 lib/gw/mail.ts와 같은 규칙).
List<String> splitRecipients(String s) {
  final out = <String>[];
  final cur = StringBuffer();
  var quoted = false, angle = false;
  for (final ch in s.split('')) {
    if (ch == '"') quoted = !quoted;
    if (!quoted && ch == '<') angle = true;
    if (!quoted && ch == '>') angle = false;
    if (ch == ',' && !quoted && !angle) {
      out.add(cur.toString());
      cur.clear();
      continue;
    }
    cur.write(ch);
  }
  out.add(cur.toString());
  return [for (final r in out) if (r.trim().isNotEmpty) r.trim()];
}

/// 미결함 행(eap105A04 map.list[]). 대문자 컬럼명은 서버 그대로.
class PendingApproval {
  const PendingApproval({required this.docId, required this.formId, required this.title, required this.form, required this.drafter, required this.dept, required this.arrivedDt, required this.status, required this.unread, required this.fileCount});
  final String docId, formId, title, form, drafter, dept, arrivedDt, status;
  final bool unread;
  final int fileCount;
  int? waitingDays(DateTime today) => daysBetween(arrivedDt, today);
  factory PendingApproval.fromRow(Map r) => PendingApproval(
        docId: asStr(r['DOC_ID']), formId: asStr(r['FORM_ID']), title: asStr(r['DOC_TITLE']),
        form: asStr(r['FORM_NM']).isEmpty ? asStr(r['DRAFT_FORM_NM']) : asStr(r['FORM_NM']),
        drafter: asStr(r['USER_NM']), dept: asStr(r['DEPT_NM']), arrivedDt: _digits(asStr(r['ARRIVED_DT'])), status: asStr(r['DOC_STSNM']),
        unread: asStr(r['READYN']) == 'N', fileCount: asInt(r['FILE_CNT']));
}

/// 문서 상세(eap111A04). 본문은 평문 contentsWord 우선, 비면 docContents(HTML) 태그 제거.
class ApprovalDetail {
  const ApprovalDetail({required this.title, required this.form, required this.status, required this.drafter, required this.dept, required this.repDt, required this.attachCount, required this.currentApprover, required this.content});
  final String title, form, status, drafter, dept, repDt, currentApprover, content;
  final int attachCount;
  factory ApprovalDetail.fromData(Map d) {
    final word = asStr(d['contentsWord']).trim();
    return ApprovalDetail(
        title: asStr(d['docTitle']), form: asStr(d['formName']), status: asStr(d['docStsName']), drafter: asStr(d['empName']), dept: asStr(d['deptName']), repDt: asStr(d['repDt']),
        attachCount: asInt(d['attachCnt']), currentApprover: asStr(d['lineName']), content: word.isEmpty ? htmlToText(asStr(d['docContents'])) : word);
  }
}

/// getMenuCountInfo {menuNo: count} → 함 라벨.
Map<String, int> parseApprovalCounts(Map data) => {'pending': asInt(data['1001000']), 'approved': asInt(data['1001100']), 'reference': asInt(data['1001200']), 'sent': asInt(data['1000400'])};

/// 오늘 출퇴근(getTodayComeLeaveInfo). comeTm/leaveTm은 'YYYYMMDDHHmm', 미등록이면 ''(null도 ''로).
class Attendance {
  const Attendance({required this.workDt, required this.comeTm, required this.leaveTm, required this.holiday});
  final String workDt, comeTm, leaveTm;
  final bool holiday;
  bool get clockedIn => comeTm.isNotEmpty;
  bool get clockedOut => leaveTm.isNotEmpty;
  factory Attendance.fromData(String workDt, Map? d) => Attendance(workDt: workDt, comeTm: asStr(d?['comeTm']), leaveTm: asStr(d?['leaveTm']), holiday: asBool(d?['holidayYn']));
}

class PunchResult {
  const PunchResult({required this.ok, required this.already, required this.kind, required this.comeTm, required this.leaveTm, required this.verified, required this.note});
  final bool ok, already, verified;
  final String kind, comeTm, leaveTm, note;
}

/// 캘린더(sc111A02 resultList[]).
class GwCalendar {
  const GwCalendar({required this.mcalSeq, required this.title, required this.calType, required this.ownerEmpSeq, required this.color});
  final String mcalSeq, title, calType, ownerEmpSeq, color;
  bool get personal => calType == 'E';
  factory GwCalendar.fromRow(Map r) => GwCalendar(mcalSeq: asStr(r['mcalSeq']), title: asStr(r['calTitle']), calType: asStr(r['calType']), ownerEmpSeq: asStr(r['empSeq']), color: asStr(r['calColor']));
}

/// sc111A03의 calList. 빈 calType은 'E'로 보정(안 하면 그 캘린더 일정이 조회에서 빠진다 — 실측), adminYn은 조회용 'Y'.
List<Map<String, String>> calListFor(List<GwCalendar> cals) => [for (final c in cals) {'mcalSeq': c.mcalSeq, 'calType': c.calType.isEmpty ? 'E' : c.calType, 'adminYn': 'Y', 'color': c.color}];

/// 일정(sc111A03 resultList[]). delYn은 이름과 달리 "내 일정(참석자/작성자)" 플래그.
class GwEvent {
  const GwEvent({required this.schSeq, required this.title, required this.start, required this.end, required this.allDay, required this.calendar, required this.mcalSeq, required this.mine, required this.createName, required this.place, this.attendees = '', this.contents = ''});
  final String schSeq, title, start, end, calendar, mcalSeq, createName, place;
  /// 참석자 이름 목록(schUserList 원문)과 내용(contents, HTML일 수 있음) — 일정 캘린더 펼침 상세용
  final String attendees, contents;
  final bool allDay, mine;
  factory GwEvent.fromRow(Map r) => GwEvent(
        schSeq: asStr(r['schSeq']), title: asStr(r['schTitle']), start: asStr(r['startDate']), end: asStr(r['endDate']), allDay: asBool(r['alldayYn']), calendar: asStr(r['calTitle']), mcalSeq: asStr(r['mcalSeq']),
        mine: asStr(r['delYn']) == 'Y', createName: asStr(r['createName']), place: asStr(r['schPlace']), attendees: asStr(r['schUserList']), contents: asStr(r['contents']));
}

List<GwEvent> myEvents(List<GwEvent> all, List<GwCalendar> cals, String empSeq) {
  final personal = {for (final c in cals) if (c.personal && c.ownerEmpSeq == empSeq) c.mcalSeq};
  return [for (final e in all) if (e.mine || personal.contains(e.mcalSeq)) e];
}

class GwResource {
  const GwResource({required this.resSeq, required this.resName, required this.attrSeq, required this.attrName});
  final String resSeq, resName, attrSeq, attrName;
  factory GwResource.fromRow(Map r) => GwResource(resSeq: asStr(r['resSeq']), resName: asStr(r['resName']), attrSeq: asStr(r['attrSeq']), attrName: asStr(r['attrName']));
}

/// 회의실 예약(rs121A05 resultList[]). 원본 74필드 중 표시에 쓰는 것만.
class GwReservation {
  const GwReservation({required this.resSeq, required this.resName, required this.start, required this.end, required this.title, required this.display, required this.owner, required this.ownerEmpSeq, required this.attendees, required this.allDay});
  final String resSeq, resName, start, end, title, display, owner, ownerEmpSeq, attendees;
  final bool allDay;
  factory GwReservation.fromRow(Map r) {
    final owner = asStr(r['empName']), name = asStr(r['resName']);
    final disp = asStr(r['resTitleDisplay']);
    return GwReservation(resSeq: asStr(r['resSeq']), resName: name, start: asStr(r['resStartDate']), end: asStr(r['resEndDate']), title: asStr(r['reqText']), display: disp.isEmpty ? '[$owner] $name' : disp,
        owner: owner, ownerEmpSeq: asStr(r['empSeq']), attendees: asStr(r['resUserName']), allDay: asBool(r['alldayYn']));
  }
}

/// mail000A03 배열의 마지막 항목 = 계정 전체 집계. 없으면 0.
class MailSummary {
  const MailSummary({required this.unread, required this.toMe, required this.total});
  final int unread, toMe, total;
  static MailSummary fromCounts(List counts) {
    final last = counts.isEmpty ? null : counts.last;
    if (last is! Map) return const MailSummary(unread: 0, toMe: 0, total: 0);
    return MailSummary(unread: asInt(last['unreadCount']), toMe: asInt(last['toMeCount']), total: asInt(last['totalCount']));
  }
}

/// mail000A01 트리에서 이름(fullname/name, 대소문자 무시)이 맞는 메일함의 mboxSeq. 계정마다 값이 달라 상수 금지.
int? findMboxSeq(Object? node, String name) {
  if (node is Map) {
    if (node.containsKey('mboxSeq') && [node['fullname'], node['name']].any((v) => asStr(v).toLowerCase() == name.toLowerCase())) {
      return int.tryParse(asStr(node['mboxSeq']));
    }
    for (final v in node.values) {
      final r = findMboxSeq(v, name);
      if (r != null) return r;
    }
  } else if (node is List) {
    for (final v in node) {
      final r = findMboxSeq(v, name);
      if (r != null) return r;
    }
  }
  return null;
}

/// mail003A01 Records[] 항목. 본문은 열지 않는다(읽음 처리 부작용).
class MailItem {
  const MailItem({required this.muid, required this.subject, required this.fromName, required this.fromEmail, required this.date, required this.tooltip, required this.seen, required this.attach});
  final String muid, subject, fromName, fromEmail, date, tooltip;
  final bool seen, attach;
  factory MailItem.fromRow(Map r) => MailItem(
        muid: asStr(r['muid']), subject: asStr(r['subject']), fromName: asStr(r['fromAddrName']), fromEmail: asStr(r['fromAddrEmail']), date: asStr(r['rfc822date']), tooltip: asStr(r['tooltipDate']),
        seen: asBool(r['seen']), attach: asBool(r['attach']));
}

/// 서버 날짜 표기 정리: 'YYYY-MM-DD HH:MM:SS' → 초 제거, 숫자만 12~14자리면 'YYYY-MM-DD HH:MM', 그 외 원문.
String niceDate(String s) {
  final t = s.trim();
  final m = RegExp(r'^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})').firstMatch(t);
  if (m != null) return '${m.group(1)} ${m.group(2)}';
  final d = _digits(t);
  if (d.length >= 12 && d == t) return '${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)} ${d.substring(8, 10)}:${d.substring(10, 12)}';
  return t;
}

/// 게시글 목록 행(ViewBoardNewAndNoticeArtList articleList[]). 전 게시판 공지·새 글 집계.
class GwNotice {
  const GwNotice({required this.artSeqNo, required this.title, required this.board, required this.boardId, required this.writer, required this.dept, required this.writeDate, required this.readCnt, required this.fileCnt, required this.attachmentUid, required this.isNew, required this.read, required this.preview});
  final String artSeqNo, title, board, boardId, writer, dept, writeDate, attachmentUid, preview;
  final int readCnt, fileCnt;
  final bool isNew, read;
  factory GwNotice.fromRow(Map r) => GwNotice(
        artSeqNo: asStr(r['art_seq_no']), title: asStr(r['art_title']), board: asStr(r['cat_title']), boardId: asStr(r['cat_seq_no']), writer: asStr(r['mbr_nick']), dept: asStr(r['dept_name']),
        writeDate: niceDate(asStr(r['write_date'])), readCnt: asInt(r['read_cnt']), fileCnt: asInt(r['file_cnt']), attachmentUid: asStr(r['uid']),
        isNew: asStr(r['is_new_yn']) == 'Y', read: asStr(r['art_read_yn']) == 'Y', preview: oneLine(htmlToText(asStr(r['art_content']))));
}

class GwComment {
  const GwComment({required this.writer, required this.writeDate, required this.content});
  final String writer, writeDate, content;
}

/// 게시글 상세(ViewPost). ⚠️ 호출하면 조회수가 오른다(실제 열람). 게시판명은 art가 아니라 board.cat_title.
class GwNoticeDetail {
  const GwNoticeDetail({required this.artSeqNo, required this.title, required this.board, required this.writer, required this.dept, required this.writeDate, required this.readCnt, required this.fileCnt, required this.content, required this.comments});
  final String artSeqNo, title, board, writer, dept, writeDate, content;
  final int readCnt, fileCnt;
  final List<GwComment> comments;
  factory GwNoticeDetail.fromData(Map d) {
    final art = d['art'] is Map ? d['art'] as Map : const {};
    final board = d['board'] is Map ? d['board'] as Map : const {};
    final remarks = (d['remarkList'] as List?) ?? const [];
    String firstOf(Map r, List<String> keys) => keys.map((k) => asStr(r[k])).firstWhere((v) => v.isNotEmpty, orElse: () => '');
    return GwNoticeDetail(
      artSeqNo: asStr(art['art_seq_no']), title: asStr(art['art_title']), board: asStr(board['cat_title']), writer: asStr(art['mbr_nick']), dept: asStr(art['dept_name']),
      writeDate: niceDate(asStr(art['write_date'])), readCnt: asInt(art['read_cnt']), fileCnt: asInt(art['file_cnt']), content: htmlToText(asStr(art['art_content'])),
      comments: [for (final r in remarks) if (r is Map) GwComment(writer: asStr(r['mbr_nick']), writeDate: niceDate(asStr(r['write_date'])), content: htmlToText(firstOf(r, ['remark_desc', 'remark_content', 'content', 'art_content'])))],
    );
  }
}

/// mail002A01 원본(⚠️ 아마란스에서 읽음 처리됨) → 본문 화면. 본문은 서식 없는 텍스트(plain 우선, 없으면 html→text) — mcp_tools._readMail과 같은 규칙.
class MailDetail {
  const MailDetail({required this.muid, required this.subject, required this.from, required this.to, required this.cc, required this.date, required this.body, required this.attachments, required this.remoteImages});
  final String muid, subject, from, to, cc, date, body;
  /// (파일 이름, 대략 크기 바이트 — 서버 값은 base64 길이라 3/4)
  final List<(String, int)> attachments;
  /// 외부 호스트 이미지 수(표시하지 않음을 안내)
  final int remoteImages;
  factory MailDetail.fromRaw(String muid, Map d) {
    final dm = d['decodeMime'] is Map ? d['decodeMime'] as Map : const {};
    final mime = d['mime'] is Map ? d['mime'] as Map : const {};
    final b = mime['body'] is Map ? mime['body'] as Map : const {};
    final html = asStr(b['html']);
    var remote = 0;
    for (final img in RegExp(r'<img\b[^>]*?\bsrc\s*=\s*["' "'" r']?([^"' "'" r'\s>]+)', caseSensitive: false).allMatches(html)) {
      final host = Uri.tryParse(img[1]!)?.host ?? '';
      if (host.isNotEmpty && !host.endsWith('innogrid.com')) remote++;
    }
    final files = ((mime['fileList'] as List?) ?? const []).whereType<Map>();
    return MailDetail(
      muid: muid, subject: htmlToText(asStr(dm['subject'])), from: htmlToText(asStr(dm['from'])), to: htmlToText(asStr(dm['to'])), cc: htmlToText(asStr(dm['cc'])), date: asStr(dm['date']),
      body: mailBodyText(b),
      attachments: [for (final f in files) if (asStr(f['originalFileName']).isNotEmpty) (asStr(f['originalFileName']), asInt(f['fileSize']) * 3 ~/ 4)],
      remoteImages: remote,
    );
  }
}
