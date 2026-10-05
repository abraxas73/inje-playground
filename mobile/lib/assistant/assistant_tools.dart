// mobile/lib/assistant/assistant_tools.dart
import '../api/client.dart';
import '../gw/clockin_notify.dart';
import '../gw/gw_api.dart';
import '../gw/gw_client.dart';
import '../gw/gw_models.dart';
import 'assistant_journal.dart';
import 'gw_assistant_api.dart';

/// 비서 도구 — 등급(앱 고정, 서버 TOOL_TIERS와 같은 이름)·진행 문구·확인 카드 문장·결과 슬림화·실행.
/// Claude가 무엇을 주장하든 등급은 이 표로 판정한다(프롬프트 주입으로 쓰기를 바로 실행할 수 없다).
enum ToolTier { read, write, irreversible, meta }

const assistantToolTiers = <String, ToolTier>{
  'find_person': ToolTier.read, 'list_rooms': ToolTier.read, 'find_free_rooms': ToolTier.read, 'my_reservations': ToolTier.read, 'reserve_room': ToolTier.write, 'cancel_reservation': ToolTier.write,
  'list_calendars': ToolTier.read, 'list_events': ToolTier.read, 'create_event': ToolTier.write, 'delete_event': ToolTier.write,
  'attendance_today': ToolTier.read, 'clock_in': ToolTier.write, 'clock_out': ToolTier.write,
  'mail_list': ToolTier.read, 'mail_read': ToolTier.read, 'mail_save_draft': ToolTier.write, 'mail_send': ToolTier.irreversible,
  'approvals_pending': ToolTier.read, 'approval_read': ToolTier.read, 'approval_counts': ToolTier.read,
  'notices_list': ToolTier.read, 'notice_read': ToolTier.read, 'search': ToolTier.read,
  'teams_chats': ToolTier.read, 'teams_mentions': ToolTier.read, 'teams_send': ToolTier.write,
  'undo_last': ToolTier.meta,
};
const serverToolNames = {'teams_chats', 'teams_mentions', 'teams_send'};
ToolTier? tierOf(String name) => assistantToolTiers[name];

class ToolCall {
  const ToolCall(this.id, this.name, this.input);
  final String id, name;
  final Map<String, dynamic> input;
}

const _progress = {
  'find_person': '사람 찾는 중…', 'list_rooms': '회의실 목록 보는 중…', 'find_free_rooms': '빈 회의실 찾는 중…', 'my_reservations': '내 예약 보는 중…', 'list_calendars': '캘린더 보는 중…', 'list_events': '일정 보는 중…',
  'attendance_today': '출퇴근 기록 보는 중…', 'mail_list': '메일함 보는 중…', 'mail_read': '메일 읽는 중…', 'approvals_pending': '미결 결재 보는 중…', 'approval_read': '결재 문서 읽는 중…', 'approval_counts': '결재 건수 보는 중…',
  'notices_list': '공지 보는 중…', 'notice_read': '게시글 읽는 중…', 'search': '아마란스 검색 중…', 'teams_chats': 'Teams 채팅 보는 중…', 'teams_mentions': 'Teams 답장 대기 보는 중…',
};
String progressText(String name) => _progress[name] ?? '처리하는 중…';

const _wd = ['월', '화', '수', '목', '금', '토', '일'];
String _two(int v) => v.toString().padLeft(2, '0');
String _when(String startIso, String endIso) {
  final s = parseLocal(startIso), e = parseLocal(endIso);
  if (s == null) return startIso;
  final d = '${s.month}/${s.day}(${_wd[s.weekday - 1]}) ${_two(s.hour)}:${_two(s.minute)}';
  return e == null ? d : '$d–${_two(e.hour)}:${_two(e.minute)}';
}
String _s(Object? v) => v == null ? '' : '$v';
List<String> _strList(Object? v) => v is List ? [for (final x in v) '$x'] : (v is String && v.isNotEmpty ? [v] : const []);

/// 확인 카드 한 줄(앱 코드가 인자로 만든다 — Claude 문장 아님).
String cardLine(ToolCall c) {
  final i = c.input;
  switch (c.name) {
    case 'reserve_room':
      return "회의실 예약 · ${_when(_s(i['start']), _s(i['end']))} · ${_s(i['room_name'])} · '${_s(i['title'])}'";
    case 'create_event':
      final who = [for (final a in (i['attendees'] as List? ?? const [])) if (a is Map) _s(a['name'])];
      final place = _s(i['place']);
      return "일정 등록 · ${_when(_s(i['start']), _s(i['end']))} · '${_s(i['title'])}'${who.isEmpty ? '' : ' · 참석 ${who.join(', ')}'}${place.isEmpty ? '' : ' · 장소 $place'}";
    case 'cancel_reservation':
      return '예약 취소 · ${_s(i['label'])}';
    case 'delete_event':
      return '일정 삭제 · ${_s(i['label'])}';
    case 'clock_in':
      final extra = _s(i['extra']).trim();
      return i['notify_teams'] == true ? '출근 기록 · Teams 알림${extra.isEmpty ? '' : '(+$extra)'}' : '출근 기록';
    case 'clock_out':
      return '퇴근 기록';
    case 'mail_save_draft':
      return "메일 임시저장 · 받는 사람 ${_strList(i['to']).join(', ')} · 제목 '${_s(i['subject'])}'";
    case 'mail_send':
      final cc = _strList(i['cc']);
      return "메일 발송(되돌릴 수 없음) · 받는 사람 ${_strList(i['to']).join(', ')}${cc.isEmpty ? '' : ' · 참조 ${cc.join(', ')}'} · 제목 '${_s(i['subject'])}'\n${_s(i['body'])}";
    case 'teams_send':
      return 'Teams 보내기 · ${_s(i['chat_name'])} · "${_s(i['text'])}"';
    default:
      return c.name;
  }
}

/// 도구 결과를 Claude에 보내기 전에 줄인다 — 문자열 500자, 목록 20개(+"…외 N개"), 깊이 6. bodyKeys의 문자열은 자르지 않는다(메일 본문은 호출부가 8,000자로 자름).
dynamic slim(dynamic v, {int depth = 0, Set<String> bodyKeys = const {}}) {
  if (depth > 6) return '…';
  if (v is String) return v.length > 500 ? '${v.substring(0, 500)}…' : v;
  if (v is List) {
    final head = [for (final x in v.take(20)) slim(x, depth: depth + 1, bodyKeys: bodyKeys)];
    return v.length > 20 ? [...head, '…외 ${v.length - 20}개'] : head;
  }
  if (v is Map) return {for (final e in v.entries) '${e.key}': bodyKeys.contains('${e.key}') && e.value is String ? e.value : slim(e.value, depth: depth + 1, bodyKeys: bodyKeys)};
  return v;
}

/// 메일 본문 읽기 허용 집합 — 같은 사용자 요청에서 목록·검색으로 받은 muid만, 요청당 5통.
class MailReadGuard {
  final _allowed = <String>{};
  var _used = 0;
  static const maxPerRequest = 5;
  void allowFrom(dynamic result) {
    if (result is Map) {
      final m = result['muid'];
      if (m is String && m.isNotEmpty) _allowed.add(m);
      for (final v in result.values) { allowFrom(v); }
    } else if (result is List) {
      for (final v in result) { allowFrom(v); }
    }
  }
  bool tryUse(String muid) {
    if (!_allowed.contains(muid) || _used >= maxPerRequest) return false;
    _used++;
    return true;
  }
  void reset() { _allowed.clear(); _used = 0; }
}

/// 실행 기록 → 되돌리기 호출(확인 카드에 쓰일 ToolCall). 되돌릴 수 없으면 null.
({ToolCall call, String summary})? undoFor(JournalEntry e) {
  final u = e.undo;
  if (u == null || u['tool'] is! String) return null;
  return (call: ToolCall('undo:${e.at}', u['tool'] as String, Map<String, dynamic>.from(u['args'] as Map? ?? const {})), summary: e.summary);
}

String _ymd8(String date) => date.replaceAll('-', '');
DateTime? _date(String s) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(s.trim());
  return m == null ? null : DateTime(int.parse(m[1]!), int.parse(m[2]!), int.parse(m[3]!));
}
int? _hm(String s) {
  final m = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(s.trim());
  return m == null ? null : int.parse(m[1]!) * 60 + int.parse(m[2]!);
}

class _BadInput implements Exception {
  const _BadInput(this.message);
  final String message;
}

class AssistantToolRunner {
  AssistantToolRunner({required this.gw, required this.api, required this.journal, required this.guard, DateTime Function()? now}) : _now = now ?? kstNow;
  final GwApi? gw;
  final ApiClient api;
  final AssistantJournal journal;
  final MailReadGuard guard;
  final DateTime Function() _now;

  static const _gwMissing = '아마란스가 연결되어 있지 않습니다. 더보기 > 아마란스에서 연결하세요.';

  /// 도구 하나 실행 → Claude에 보낼 결과(슬림화 전). 쓰기 성공은 실행 기록에 남긴다. 실패는 {ok:false,error}.
  Future<Map<String, dynamic>> run(ToolCall c) async {
    if (tierOf(c.name) == null || c.name == 'undo_last') return {'ok': false, 'error': '모르는 도구입니다: ${c.name}'};
    if ((c.name == 'mail_send' || c.name == 'mail_save_draft') && _strList(c.input['to']).isEmpty) return {'ok': false, 'error': '받는 사람이 없습니다'};
    if (serverToolNames.contains(c.name)) {
      try {
        final r = await api.postJson('/api/assistant/execute', {'tool': c.name, 'args': c.input});
        if (r is Map && (r['ok'] == true || r['ok'] == false)) return Map<String, dynamic>.from(r);
        // 관리자가 비서를 끄면 서버는 ok 없이 {enabled:false}를 준다.
        return {'ok': false, 'error': r is Map && r['enabled'] == false ? '비서 기능이 꺼져 있습니다' : '서버 응답이 올바르지 않습니다'};
      } on ApiException catch (e) {
        return {'ok': false, 'error': e.message};
      }
    }
    final g = gw;
    if (g == null) return {'ok': false, 'error': _gwMissing};
    try {
      final r = await _gw(g, c);
      if (c.name == 'mail_list' || c.name == 'search') guard.allowFrom(r);
      return r;
    } on _BadInput catch (e) {
      return {'ok': false, 'error': e.message};
    } on GwUnauthorized catch (e) {
      return {'ok': false, 'error': e.message};
    } on GwException catch (e) {
      // 발송 결과 불명(보낸편지함 안내)도 그대로 전달 — 자동 재시도하지 않는다.
      return {'ok': false, 'error': e.message};
    } catch (e) {
      return {'ok': false, 'error': '처리하지 못했습니다: ${e.runtimeType}'};
    }
  }

  String _stamp(Object? iso) {
    final t = parseLocal(_s(iso));
    if (t == null) throw const _BadInput('시각 형식이 올바르지 않습니다(YYYY-MM-DDTHH:mm)');
    return gwStamp(t);
  }
  DateTime _day(Object? s) => _date(_s(s)) ?? (throw const _BadInput('날짜 형식이 올바르지 않습니다(YYYY-MM-DD)'));

  Future<void> _log(String tool, String summary, Map<String, dynamic>? undo) =>
      journal.add(JournalEntry(at: _now().toIso8601String(), tool: tool, summary: summary, undo: undo));

  Future<Map<String, dynamic>> _gw(GwApi g, ToolCall c) async {
    final i = c.input;
    switch (c.name) {
      case 'find_person':
        return {'ok': true, 'people': [for (final p in await g.findPerson(_s(i['query']))) p.toJson()]};
      case 'list_rooms':
        return {'ok': true, 'rooms': [for (final r in await g.resources()) {'resSeq': r.resSeq, 'resName': r.resName, 'group': r.attrName}]};
      case 'find_free_rooms':
        final from = _hm(_s(i['from'])), to = _hm(_s(i['to']));
        if (from == null || to == null) throw const _BadInput('시간 창 형식이 올바르지 않습니다(HH:mm)');
        final dur = i['duration_min'] is num ? (i['duration_min'] as num).toInt() : 60;
        return {'ok': true, 'date': _s(i['date']), 'lunchExcluded': '13:00–14:00', 'rooms': await g.freeRooms(_day(i['date']), from, to, dur, group: _s(i['group']))};
      case 'my_reservations':
        return {'ok': true, 'reservations': await g.myReservations(_day(i['from_date']), _day(i['to_date']))};
      case 'reserve_room':
        final start = _stamp(i['start']), end = _stamp(i['end']);
        final r = await g.reserveRoom(resSeq: _s(i['res_seq']), start: start, end: end, title: _s(i['title']));
        if (r['ok'] == true) {
          final label = "${_when(_s(i['start']), '').trim()} ${_s(i['room_name'])} '${_s(i['title'])}'";
          await _log('reserve_room', cardLine(c), {'tool': 'cancel_reservation', 'args': {'res_seq': r['resSeq'], 'seq_num': r['seqNum'], 'res_idx': r['resIdx'], 'label': label}});
        }
        return r;
      case 'cancel_reservation':
        return g.cancelReservation(_s(i['res_seq']), i['seq_num'] is num ? (i['seq_num'] as num).toInt() : int.tryParse(_s(i['seq_num'])) ?? -1, _s(i['res_idx']).isEmpty ? '1' : _s(i['res_idx']));
      case 'list_calendars':
        return {'ok': true, 'calendars': [for (final c in await g.calendars()) {'mcalSeq': c.mcalSeq, 'title': c.title, 'personal': c.personal}]};
      case 'list_events':
        final from = _day(i['from_date']), to = _day(i['to_date']);
        if (to.difference(from).inDays > 31) throw const _BadInput('기간은 31일까지 조회할 수 있습니다');
        final cals = await g.calendars();
        final me = g.client.creds().empSeq;
        final out = <Map<String, dynamic>>[];
        for (var d = from; !d.isAfter(to); d = d.add(const Duration(days: 1))) {
          final evs = await g.events(d);
          for (final e in (i['mine_only'] == true ? myEvents(evs, cals, me) : evs)) {
            out.add({'schSeq': e.schSeq, 'title': e.title, 'start': e.start, 'end': e.end, 'allDay': e.allDay, 'calendar': e.calendar, 'by': e.createName});
          }
        }
        return {'ok': true, 'events': out};
      case 'create_event':
        final people = [
          for (final a in (i['attendees'] as List? ?? const []))
            if (a is Map) GwPerson(empSeq: _s(a['emp_seq']), name: _s(a['name']), deptSeq: _s(a['dept_seq']), deptName: '', email: '', duty: '', position: ''),
        ];
        if (people.any((p) => p.empSeq.isEmpty || p.deptSeq.isEmpty)) throw const _BadInput('참석자는 find_person 결과의 emp_seq·dept_seq가 필요합니다');
        final r = await g.createEvent(title: _s(i['title']), start: _stamp(i['start']), end: _stamp(i['end']), attendees: people, place: _s(i['place']));
        if (r['ok'] == true) {
          await _log('create_event', cardLine(c), {'tool': 'delete_event', 'args': {'sch_seq': r['schSeq'], 'date': _s(i['start']).substring(0, 10), 'label': "${_when(_s(i['start']), '').trim()} '${_s(i['title'])}'"}});
        }
        return r;
      case 'delete_event':
        return g.deleteEvent(_s(i['sch_seq']), _ymd8(_s(i['date'])));
      case 'attendance_today':
        final a = await g.attendanceToday();
        return {'ok': true, 'date': a.workDt, 'clockIn': a.comeTm, 'clockOut': a.leaveTm, 'holiday': a.holiday};
      case 'clock_in':
      case 'clock_out':
        final isIn = c.name == 'clock_in';
        final r = await g.punch(clockIn: isIn);
        var note = r.note;
        if (isIn && r.ok && !r.already && i['notify_teams'] == true) {
          final p = await ClockInNotifyPrefs.load();
          if (!p.hasChat) {
            note = '$note (Teams 채팅방이 설정되지 않아 알리지 않았습니다 — 출퇴근 화면에서 고르세요)';
          } else {
            final err = await sendClockInToTeams(api, p.chatId, clockInMessage(r.comeTm, _s(i['extra'])));
            note = err == null ? '$note · ${p.topic}에 알렸습니다' : '$note · Teams 알림 실패: $err';
          }
        }
        if (r.ok && !r.already) await _log(c.name, cardLine(c), null);
        return {'ok': r.ok, 'already': r.already, 'note': note, 'clockIn': r.comeTm, 'clockOut': r.leaveTm};
      case 'mail_list':
        final (unread, items) = await g.inbox(pageSize: 20);
        final limit = i['limit'] is num ? (i['limit'] as num).toInt().clamp(1, 20) : 20;
        final list = [for (final m in items) if (i['unread_only'] != true || !m.seen) {'muid': m.muid, 'subject': m.subject, 'from': m.fromName, 'date': m.tooltip.isNotEmpty ? m.tooltip : m.date, 'seen': m.seen}];
        return {'ok': true, 'unreadTotal': unread, 'mails': list.take(limit).toList()};
      case 'mail_read':
        final muid = _s(i['muid']);
        if (!guard.tryUse(muid)) throw const _BadInput('이 메일은 읽을 수 없습니다 — 먼저 mail_list나 search로 찾은 메일만, 요청 한 번에 5통까지 읽습니다');
        return {'ok': true, ...await g.mailRead(muid)};
      case 'mail_save_draft':
        final r = await g.mailSaveDraft(to: _strList(i['to']), cc: _strList(i['cc']), subject: _s(i['subject']), body: _s(i['body']));
        if (r['ok'] == true) await _log('mail_save_draft', cardLine(c), null);
        return r;
      case 'mail_send':
        final r = await g.mailSend(to: _strList(i['to']), cc: _strList(i['cc']), subject: _s(i['subject']), body: _s(i['body']));
        if (r['ok'] == true) await _log('mail_send', cardLine(c).split('\n').first, null);
        return r;
      case 'approvals_pending':
        final (total, list) = await g.pendingApprovals();
        return {'ok': true, 'total': total, 'items': [for (final a in list) {'docId': a.docId, 'formId': a.formId, 'title': a.title, 'drafter': a.drafter, 'form': a.form, 'waitingDays': a.waitingDays(_now()), 'unread': a.unread}]};
      case 'approval_read':
        final d = await g.approvalDetail(_s(i['doc_id']), _s(i['form_id']));
        return {'ok': true, 'title': d.title, 'currentApprover': d.currentApprover, 'attachments': d.attachCount, 'content': d.content.length > 8000 ? '${d.content.substring(0, 8000)}…' : d.content};
      case 'approval_counts':
        return {'ok': true, 'counts': await g.approvalCounts()};
      case 'notices_list':
        final (total, list) = await g.notices(pageSize: 10, search: _s(i['search']));
        return {'ok': true, 'total': total, 'items': [for (final n in list) {'artSeqNo': n.artSeqNo, 'title': n.title, 'board': n.board, 'writer': n.writer, 'date': n.writeDate, 'isNew': n.isNew}]};
      case 'notice_read':
        final n = await g.notice(_s(i['art_seq_no']));
        return {'ok': true, 'title': n.title, 'board': n.board, 'writer': n.writer, 'date': n.writeDate, 'content': n.content.length > 8000 ? '${n.content.substring(0, 8000)}…' : n.content};
      case 'search':
        return {'ok': true, ...await g.search(_s(i['query']), scope: _s(i['scope']).isEmpty ? '전체' : _s(i['scope']), from: _s(i['from_date']), to: _s(i['to_date']))};
    }
    return {'ok': false, 'error': '모르는 도구입니다: ${c.name}'};
  }
}
