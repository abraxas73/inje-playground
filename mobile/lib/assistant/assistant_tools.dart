// mobile/lib/assistant/assistant_tools.dart
import 'dart:math' as math;
import '../api/client.dart';
import '../gw/clockin_notify.dart';
import '../gw/gw_api.dart';
import '../gw/gw_client.dart';
import '../gw/gw_models.dart';
import 'assistant_journal.dart';
import 'gw_assistant_api.dart';

/// 비서 도구 — 등급(앱 고정, 서버 TOOL_TIERS와 같은 이름)·진행 문구·확인 카드 문장·결과 슬림화·실행.
/// Claude가 무엇을 주장하든 등급은 이 표로 판정한다(프롬프트 주입으로 쓰기를 바로 실행할 수 없다).
/// choice = offer_choices(선택지마다 쓰기 묶음 — 사용자가 고른 선택지의 [실행]이 곧 확인).
enum ToolTier { read, write, irreversible, meta, choice }

const assistantToolTiers = <String, ToolTier>{
  'find_person': ToolTier.read,
  'list_rooms': ToolTier.read,
  'find_free_rooms': ToolTier.read,
  'my_reservations': ToolTier.read,
  'reserve_room': ToolTier.write,
  'cancel_reservation': ToolTier.write,
  'list_calendars': ToolTier.read,
  'my_team': ToolTier.read,
  'list_events': ToolTier.read,
  'create_event': ToolTier.write,
  'delete_event': ToolTier.write,
  'attendance_today': ToolTier.read,
  'clock_in': ToolTier.write,
  'clock_out': ToolTier.write,
  'mail_list': ToolTier.read,
  'mail_read': ToolTier.read,
  'mail_save_draft': ToolTier.write,
  'mail_send': ToolTier.irreversible,
  'approvals_pending': ToolTier.read,
  'approval_read': ToolTier.read,
  'approval_counts': ToolTier.read,
  'notices_list': ToolTier.read,
  'notice_read': ToolTier.read,
  'search': ToolTier.read,
  'teams_chats': ToolTier.read,
  'teams_mentions': ToolTier.read,
  'teams_send': ToolTier.write,
  'undo_last': ToolTier.meta,
  'offer_choices': ToolTier.choice,
};
const serverToolNames = {'teams_chats', 'teams_mentions', 'teams_send'};
ToolTier? tierOf(String name) => assistantToolTiers[name];

class ToolCall {
  const ToolCall(this.id, this.name, this.input);
  final String id, name;
  final Map<String, dynamic> input;
}

const _progress = {
  'find_person': '사람 찾는 중…',
  'my_team': '우리 팀 보는 중…',
  'list_rooms': '회의실 목록 보는 중…',
  'find_free_rooms': '빈 회의실 찾는 중…',
  'my_reservations': '내 예약 보는 중…',
  'list_calendars': '캘린더 보는 중…',
  'list_events': '일정 보는 중…',
  'attendance_today': '출퇴근 기록 보는 중…',
  'mail_list': '메일함 보는 중…',
  'mail_read': '메일 읽는 중…',
  'approvals_pending': '미결 결재 보는 중…',
  'approval_read': '결재 문서 읽는 중…',
  'approval_counts': '결재 건수 보는 중…',
  'notices_list': '공지 보는 중…',
  'notice_read': '게시글 읽는 중…',
  'search': '아마란스 검색 중…',
  'teams_chats': 'Teams 채팅 보는 중…',
  'teams_mentions': 'Teams 답장 대기 보는 중…',
};
String progressText(String name) => _progress[name] ?? '처리하는 중…';

const _wd = ['월', '화', '수', '목', '금', '토', '일'];
String _two(int v) => v.toString().padLeft(2, '0');
String _when(String startIso, String endIso) {
  final s = parseLocal(startIso), e = parseLocal(endIso);
  if (s == null) return startIso;
  final d =
      '${s.month}/${s.day}(${_wd[s.weekday - 1]}) ${_two(s.hour)}:${_two(s.minute)}';
  return e == null ? d : '$d–${_two(e.hour)}:${_two(e.minute)}';
}

String _s(Object? v) => v == null ? '' : '$v';
List<String> _strList(Object? v) => v is List
    ? [for (final x in v) '$x']
    : (v is String && v.isNotEmpty ? [v] : const []);

/// 확인 카드 한 줄(앱 코드가 만든다 — Claude 문장 아님). resolved는 AssistantToolRunner.resolve가 실행에 쓰일 id로 다시 읽은
/// 실제 대상(회의실·참석자·채팅방·예약/일정 제목과 시각) — 카드에는 반드시 이 값을 넘긴다. 없으면(진행 문구·결과 요약) 인자 값.
String cardLine(ToolCall c, [Map<String, dynamic>? resolved]) {
  final i = c.input;
  final r = resolved ?? const {};
  switch (c.name) {
    case 'reserve_room':
      return "회의실 예약 · ${_when(_s(i['start']), _s(i['end']))} · ${_s(r['room_name'] ?? i['room_name'])} · '${_s(i['title'])}'";
    case 'create_event':
      final who = r['attendees'] is List
          ? [for (final a in r['attendees'] as List) '$a']
          : [
              for (final a in (i['attendees'] as List? ?? const []))
                if (a is Map) _s(a['name']),
            ];
      final place = _s(i['place']);
      final cal = _s(r['calendar']);
      return "일정 등록 · ${_when(_s(i['start']), _s(i['end']))} · '${_s(i['title'])}'${cal.isEmpty ? '' : ' · 캘린더 $cal'}${who.isEmpty ? '' : ' · 참석 ${who.join(', ')}'}${place.isEmpty ? '' : ' · 장소 $place'}";
    case 'cancel_reservation':
      return r.isEmpty
          ? '예약 취소 · ${_s(i['label'])}'
          : "예약 취소 · ${_when(_s(r['start']), _s(r['end']))} · ${_s(r['room_name'])} · '${_s(r['title'])}'";
    case 'delete_event':
      return r.isEmpty
          ? '일정 삭제 · ${_s(i['label'])}'
          : "일정 삭제 · ${_when(_s(r['start']), _s(r['end']))} · '${_s(r['title'])}'";
    case 'clock_in':
      final extra = _s(i['extra']).trim();
      return i['notify_teams'] == true
          ? '출근 기록 · Teams 알림${extra.isEmpty ? '' : '(+$extra)'}'
          : '출근 기록';
    case 'clock_out':
      return '퇴근 기록';
    case 'mail_save_draft':
      return "메일 임시저장 · 받는 사람 ${_strList(i['to']).join(', ')} · 제목 '${_s(i['subject'])}'";
    case 'mail_send':
      final cc = _strList(i['cc']);
      return "메일 발송(되돌릴 수 없음) · 받는 사람 ${_strList(i['to']).join(', ')}${cc.isEmpty ? '' : ' · 참조 ${cc.join(', ')}'} · 제목 '${_s(i['subject'])}'\n${_s(i['body'])}";
    case 'teams_send':
      return 'Teams 보내기 · ${_s(r['chat_name'] ?? i['chat_name'])} · "${_s(i['text'])}"';
    default:
      return c.name;
  }
}

/// 도구 결과를 Claude에 보내기 전에 줄인다 — 문자열 500자, 목록 20개(+"…외 N개"), 깊이 6. bodyKeys의 문자열은 자르지 않는다(메일 본문은 호출부가 8,000자로 자름).
dynamic slim(dynamic v, {int depth = 0, Set<String> bodyKeys = const {}}) {
  if (depth > 6) return '…';
  if (v is String) return v.length > 500 ? '${v.substring(0, 500)}…' : v;
  if (v is List) {
    final head = [
      for (final x in v.take(20)) slim(x, depth: depth + 1, bodyKeys: bodyKeys),
    ];
    return v.length > 20 ? [...head, '…외 ${v.length - 20}개'] : head;
  }
  if (v is Map) {
    return {
      for (final e in v.entries)
        '${e.key}': bodyKeys.contains('${e.key}') && e.value is String
            ? e.value
            : slim(e.value, depth: depth + 1, bodyKeys: bodyKeys),
    };
  }
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
      for (final v in result.values) {
        allowFrom(v);
      }
    } else if (result is List) {
      for (final v in result) {
        allowFrom(v);
      }
    }
  }

  bool tryUse(String muid) {
    if (!_allowed.contains(muid) || _used >= maxPerRequest) return false;
    _used++;
    return true;
  }

  void reset() {
    _allowed.clear();
    _used = 0;
  }
}

/// 실행 기록 → 되돌리기 호출(확인 카드에 쓰일 ToolCall). 되돌릴 수 없으면 null.
const _undoTools = {'cancel_reservation', 'delete_event'};

/// 예약 되돌리기 기록 — 예약 번호·회차가 없으면 취소할 수 없으니 null(기록은 남기되 되돌리기 없음).
Map<String, dynamic>? reserveUndo(Map<String, dynamic> r, String label) {
  final seq = r['seqNum'];
  if (seq is! int || seq < 0 || _s(r['resIdx']).isEmpty) return null;
  return {
    'tool': 'cancel_reservation',
    'args': {
      'res_seq': r['resSeq'],
      'seq_num': seq,
      'res_idx': r['resIdx'],
      'label': label,
    },
  };
}

({ToolCall call, String summary})? undoFor(JournalEntry e) {
  final u = e.undo;
  if (u == null || !_undoTools.contains(u['tool'])) return null;
  return (
    call: ToolCall(
      'undo:${e.at}',
      u['tool'] as String,
      Map<String, dynamic>.from(u['args'] as Map? ?? const {}),
    ),
    summary: e.summary,
  );
}

DateTime? _date(String s) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(s.trim());
  return m == null
      ? null
      : DateTime(int.parse(m[1]!), int.parse(m[2]!), int.parse(m[3]!));
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
  AssistantToolRunner({
    required this.gw,
    required this.api,
    required this.journal,
    required this.guard,
    DateTime Function()? now,
    this.isActive,
  }) : _now = now ?? kstNow;
  final bool Function()? isActive;
  bool get _active => isActive?.call() ?? true;
  final GwApi? gw;
  final ApiClient api;
  final AssistantJournal journal;
  final MailReadGuard guard;
  final DateTime Function() _now;

  static const _gwMissing = '아마란스가 연결되어 있지 않습니다. 더보기 > 아마란스에서 연결하세요.';

  /// 도구 하나 실행 → Claude에 보낼 결과(슬림화 전). 쓰기 성공은 실행 기록에 남긴다. 실패는 {ok:false,error}.
  Future<Map<String, dynamic>> run(ToolCall c) async {
    if (!_active) return {'ok': false, 'error': '중지되어 실행하지 않았습니다'};
    final t = tierOf(c.name);
    if (t == null || t == ToolTier.meta || t == ToolTier.choice) {
      return {'ok': false, 'error': '모르는 도구입니다: ${c.name}'};
    }
    if ((c.name == 'mail_send' || c.name == 'mail_save_draft') &&
        _strList(c.input['to']).isEmpty) {
      return {'ok': false, 'error': '받는 사람이 없습니다'};
    }
    if (serverToolNames.contains(c.name)) {
      try {
        final r = await api.postJson('/api/assistant/execute', {
          'tool': c.name,
          'args': c.input,
        });
        if (r is Map && (r['ok'] == true || r['ok'] == false)) {
          return Map<String, dynamic>.from(r);
        }
        // 관리자가 비서를 끄면 서버는 ok 없이 {enabled:false}를 준다.
        return {
          'ok': false,
          'error': r is Map && r['enabled'] == false
              ? '비서 기능이 꺼져 있습니다'
              : '서버 응답이 올바르지 않습니다',
        };
      } on ApiException catch (e) {
        return {'ok': false, 'error': e.message};
      } catch (e) {
        // 연결 끊김 등 — 보내기는 서버에서 이미 처리됐을 수 있어 재시도를 권하지 않는다.
        return {
          'ok': false,
          'error': c.name == 'teams_send'
              ? '전송 결과를 확인할 수 없습니다. Teams에서 확인한 뒤 다시 보내세요'
              : '처리하지 못했습니다: ${e.runtimeType}',
        };
      }
    }
    final g = gw;
    if (g == null) return {'ok': false, 'error': _gwMissing};
    try {
      final r = await _gw(g, c);
      if (_active && (c.name == 'mail_list' || c.name == 'search')) {
        guard.allowFrom(r);
      }
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

  static const _resolveFailed = '확인에 필요한 정보를 가져오지 못했습니다';

  /// 확인 카드에 보일 실제 대상 — 실행에 쓰일 id(res_seq·emp_seq·sch_seq·chat_id)로 아마란스·서버를 다시 읽는다(조회만).
  /// 못 찾거나 남의 것이면 error(카드를 띄우지 않고 그 도구의 결과로 Claude에 돌려준다). 조회 자체가 실패해도 error.
  Future<({Map<String, dynamic> facts, String? error})> resolve(
    ToolCall c,
  ) async {
    try {
      return (facts: await _resolve(c), error: null);
    } on _BadInput catch (e) {
      return (facts: const <String, dynamic>{}, error: e.message);
    } on GwUnauthorized {
      return (facts: const <String, dynamic>{}, error: _resolveFailed);
    } on GwException catch (e) {
      // 우리 코드가 던진 판정(status 200, resultCode 0: 남의 것·없음)은 그대로, 나머지(네트워크·서버 오류)는 확인 실패.
      return (
        facts: const <String, dynamic>{},
        error: e.status == 200 && e.resultCode == 0
            ? e.message
            : _resolveFailed,
      );
    } catch (_) {
      return (facts: const <String, dynamic>{}, error: _resolveFailed);
    }
  }

  GwApi _needGw() => gw ?? (throw const _BadInput(_gwMissing));
  int _seqNum(Object? v) => v is num ? v.toInt() : int.tryParse(_s(v)) ?? -1;
  String _resIdx(Object? v) => _s(v).isEmpty ? '1' : _s(v);

  /// emp_seq → 조직도(캐시) 사람. 하나라도 없으면 거부.
  Future<List<GwPerson>> _attendees(GwApi g, Object? raw) async {
    if (raw != null && raw is! List) throw const _BadInput('참석자 형식이 올바르지 않습니다');
    final list = [
      for (final a in (raw as List? ?? const []))
        if (a is Map) a,
    ];
    if (list.isEmpty) return const [];
    final roster = {for (final p in await g.roster()) p.empSeq: p};
    final missing = [
      for (final a in list)
        if (!roster.containsKey(_s(a['emp_seq'])))
          "${_s(a['name'])}(${_s(a['emp_seq'])})",
    ];
    if (missing.isNotEmpty) {
      throw _BadInput('참석자를 조직도에서 찾지 못했습니다: ${missing.join(', ')}');
    }
    return [for (final a in list) roster[_s(a['emp_seq'])]!];
  }

  Future<Map<String, dynamic>> _resolve(ToolCall c) async {
    final i = c.input;
    switch (c.name) {
      case 'reserve_room':
        final room = (await _needGw().resources())
            .where((r) => r.resSeq == _s(i['res_seq']))
            .firstOrNull;
        if (room == null) {
          throw _BadInput(
            '회의실을 찾지 못했습니다: ${_s(i['res_seq'])} — list_rooms·find_free_rooms 결과의 resSeq를 쓰세요',
          );
        }
        return {'room_name': room.resName};
      case 'create_event':
        final calId = _s(i['calendar_id']).trim();
        String? calTitle;
        if (calId.isNotEmpty) {
          calTitle = (await _needGw().calendars())
              .where((x) => x.mcalSeq == calId)
              .firstOrNull
              ?.title;
          if (calTitle == null) {
            throw _BadInput('그 캘린더를 찾지 못했습니다 — list_calendars의 mcalSeq를 쓰세요');
          }
        }
        return {
          'attendees': [
            for (final p in await _attendees(_needGw(), i['attendees']))
              '${p.name}(${p.deptName})',
          ],
          'calendar': ?calTitle,
        };
      case 'cancel_reservation':
        return _needGw().reservationFacts(
          _s(i['res_seq']),
          _seqNum(i['seq_num']),
          _resIdx(i['res_idx']),
        );
      case 'delete_event':
        return _needGw().eventFacts(_s(i['sch_seq']), ymd(_day(i['date'])));
      case 'teams_send':
        final r = await api.postJson('/api/assistant/execute', {
          'tool': 'teams_chats',
          'args': const {},
        });
        if (r is! Map || r['ok'] != true) {
          throw _BadInput(
            r is Map && r['error'] is String
                ? r['error'] as String
                : _resolveFailed,
          );
        }
        final chats =
            (r['result'] is Map ? (r['result'] as Map)['chats'] : null)
                as List? ??
            const [];
        final chat = chats
            .whereType<Map>()
            .where((x) => _s(x['id']) == _s(i['chat_id']))
            .firstOrNull;
        if (chat == null) {
          throw _BadInput(
            '채팅방을 찾지 못했습니다: ${_s(i['chat_id'])} — teams_chats 결과의 id를 쓰세요',
          );
        }
        return {'chat_name': _s(chat['name'])};
    }
    return const {};
  }

  /// 취소·삭제가 성공하면 같은 대상을 가리키는 되돌리기 기록을 지운다(직접 호출이든 되돌리기든).
  Future<void> _forgetUndo(ToolCall c) => journal.removeWhere((e) {
    final u = e.undo;
    if (u == null || u['tool'] != c.name) return false;
    final a = u['args'] is Map ? u['args'] as Map : const {};
    return c.name == 'cancel_reservation'
        ? _s(a['res_seq']) == _s(c.input['res_seq']) &&
              _seqNum(a['seq_num']) == _seqNum(c.input['seq_num'])
        : _s(a['sch_seq']) == _s(c.input['sch_seq']);
  });

  String _stamp(Object? iso) {
    final t = parseLocal(_s(iso));
    if (t == null) throw const _BadInput('시각 형식이 올바르지 않습니다(YYYY-MM-DDTHH:mm)');
    return gwStamp(t);
  }

  DateTime _day(Object? s) =>
      _date(_s(s)) ?? (throw const _BadInput('날짜 형식이 올바르지 않습니다(YYYY-MM-DD)'));

  Future<void> _log(String tool, String summary, Map<String, dynamic>? undo) =>
      journal.add(
        JournalEntry(
          at: _now().toIso8601String(),
          tool: tool,
          summary: summary,
          undo: undo,
        ),
      );

  Future<Map<String, dynamic>> _gw(GwApi g, ToolCall c) async {
    final i = c.input;
    switch (c.name) {
      case 'my_team':
        return {
          'ok': true,
          'people': [for (final p in await g.myTeam()) p.toJson()],
        };
      case 'find_person':
        return {
          'ok': true,
          'people': [
            for (final p in await g.findPerson(_s(i['query']))) p.toJson(),
          ],
        };
      case 'list_rooms':
        return {
          'ok': true,
          'rooms': [
            for (final r in await g.resources())
              {'resSeq': r.resSeq, 'resName': r.resName, 'group': r.attrName},
          ],
        };
      case 'find_free_rooms':
        final from = _hm(_s(i['from'])), to = _hm(_s(i['to']));
        if (from == null || to == null) {
          throw const _BadInput('시간 창 형식이 올바르지 않습니다(HH:mm)');
        }
        final dur = i['duration_min'] is num
            ? (i['duration_min'] as num).toInt()
            : 60;
        final day = _day(i['date']), now = _now();
        // 오늘이면 지난 시각은 빼고 지금 이후 첫 10분 단위부터
        final start =
            day.year == now.year && day.month == now.month && day.day == now.day
            ? math.max(from, ((now.hour * 60 + now.minute + 9) ~/ 10) * 10)
            : from;
        return {
          'ok': true,
          'date': _s(i['date']),
          'lunchExcluded': '13:00–14:00',
          'rooms': await g.freeRooms(
            day,
            start,
            to,
            dur,
            group: _s(i['group']),
          ),
        };
      case 'my_reservations':
        return {
          'ok': true,
          'reservations': await g.myReservations(
            _day(i['from_date']),
            _day(i['to_date']),
          ),
        };
      case 'reserve_room':
        final start = _stamp(i['start']), end = _stamp(i['end']);
        final r = await g.reserveRoom(
          resSeq: _s(i['res_seq']),
          start: start,
          end: end,
          title: _s(i['title']),
        );
        if (r['ok'] == true) {
          final label =
              "${_when(_s(i['start']), '').trim()} ${_s(i['room_name'])} '${_s(i['title'])}'";
          await _log('reserve_room', cardLine(c), reserveUndo(r, label));
        }
        return r;
      case 'cancel_reservation':
        final r = await g.cancelReservation(
          _s(i['res_seq']),
          _seqNum(i['seq_num']),
          _resIdx(i['res_idx']),
        );
        if (r['ok'] == true) await _forgetUndo(c);
        return r;
      case 'list_calendars':
        return {
          'ok': true,
          'calendars': [
            for (final c in await g.calendars())
              {'mcalSeq': c.mcalSeq, 'title': c.title, 'personal': c.personal},
          ],
        };
      case 'list_events':
        final from = _day(i['from_date']), to = _day(i['to_date']);
        if (to.difference(from).inDays > 31) {
          throw const _BadInput('기간은 31일까지 조회할 수 있습니다');
        }
        final cals = await g.calendars();
        final me = g.client.creds().empSeq;
        final out = <Map<String, dynamic>>[];
        for (var d = from; !d.isAfter(to); d = d.add(const Duration(days: 1))) {
          final evs = await g.events(d);
          for (final e
              in (i['mine_only'] == true ? myEvents(evs, cals, me) : evs)) {
            out.add({
              'schSeq': e.schSeq,
              'title': e.title,
              'start': e.start,
              'end': e.end,
              'allDay': e.allDay,
              'calendar': e.calendar,
              'by': e.createName,
            });
          }
        }
        return {'ok': true, 'events': out};
      case 'create_event':
        // 참석자는 확인 카드와 같은 출처(조직도의 emp_seq)로 — 모델이 쓴 이름·부서는 쓰지 않는다.
        final people = await _attendees(g, i['attendees']);
        if (!_active) return {'ok': false, 'error': '중지되어 실행하지 않았습니다'};
        final r = await g.createEvent(
          title: _s(i['title']),
          start: _stamp(i['start']),
          end: _stamp(i['end']),
          attendees: people,
          place: _s(i['place']),
          calendarId: _s(i['calendar_id']).trim(),
        );
        if (r['ok'] == true) {
          await _log('create_event', cardLine(c), {
            'tool': 'delete_event',
            'args': {
              'sch_seq': r['schSeq'],
              'date': _s(i['start']).substring(0, 10),
              'label':
                  "${_when(_s(i['start']), '').trim()} '${_s(i['title'])}'",
            },
          });
        }
        return r;
      case 'delete_event':
        final r = await g.deleteEvent(_s(i['sch_seq']), ymd(_day(i['date'])));
        if (r['ok'] == true) await _forgetUndo(c);
        return r;
      case 'attendance_today':
        final a = await g.attendanceToday();
        return {
          'ok': true,
          'date': a.workDt,
          'clockIn': a.comeTm,
          'clockOut': a.leaveTm,
          'holiday': a.holiday,
        };
      case 'clock_in':
      case 'clock_out':
        final isIn = c.name == 'clock_in';
        final r = await g.punch(clockIn: isIn);
        var note = r.note;
        if (isIn && r.ok && !r.already && i['notify_teams'] == true) {
          final p = await ClockInNotifyPrefs.load();
          if (!_active) {
            note = '$note (중지되어 Teams에 알리지 않았습니다)';
          } else if (!p.hasChat) {
            note = '$note (Teams 채팅방이 설정되지 않아 알리지 않았습니다 — 출퇴근 화면에서 고르세요)';
          } else {
            final err = await sendClockInToTeams(
              api,
              p.chatId,
              clockInMessage(r.comeTm, _s(i['extra'])),
            );
            note = err == null
                ? '$note · ${p.topic}에 알렸습니다'
                : '$note · Teams 알림 실패: $err';
          }
        }
        if (r.ok && !r.already) await _log(c.name, cardLine(c), null);
        return {
          'ok': r.ok,
          'already': r.already,
          'note': note,
          'clockIn': r.comeTm,
          'clockOut': r.leaveTm,
        };
      case 'mail_list':
        final (unread, items) = await g.inbox(pageSize: 20);
        final limit = i['limit'] is num
            ? (i['limit'] as num).toInt().clamp(1, 20)
            : 20;
        final list = [
          for (final m in items)
            if (i['unread_only'] != true || !m.seen)
              {
                'muid': m.muid,
                'subject': m.subject,
                'from': m.fromName,
                'date': m.tooltip.isNotEmpty ? m.tooltip : m.date,
                'seen': m.seen,
              },
        ];
        return {
          'ok': true,
          'unreadTotal': unread,
          'mails': list.take(limit).toList(),
        };
      case 'mail_read':
        final muid = _s(i['muid']);
        if (!guard.tryUse(muid)) {
          throw const _BadInput(
            '이 메일은 읽을 수 없습니다 — 먼저 mail_list나 search로 찾은 메일만, 요청 한 번에 5통까지 읽습니다',
          );
        }
        return {'ok': true, ...await g.mailRead(muid)};
      case 'mail_save_draft':
        final r = await g.mailSaveDraft(
          to: _strList(i['to']),
          cc: _strList(i['cc']),
          subject: _s(i['subject']),
          body: _s(i['body']),
        );
        if (r['ok'] == true) await _log('mail_save_draft', cardLine(c), null);
        return r;
      case 'mail_send':
        final r = await g.mailSend(
          to: _strList(i['to']),
          cc: _strList(i['cc']),
          subject: _s(i['subject']),
          body: _s(i['body']),
        );
        if (r['ok'] == true) {
          await _log('mail_send', cardLine(c).split('\n').first, null);
        }
        return r;
      case 'approvals_pending':
        final (total, list) = await g.pendingApprovals();
        return {
          'ok': true,
          'total': total,
          'items': [
            for (final a in list)
              {
                'docId': a.docId,
                'formId': a.formId,
                'title': a.title,
                'drafter': a.drafter,
                'form': a.form,
                'waitingDays': a.waitingDays(_now()),
                'unread': a.unread,
              },
          ],
        };
      case 'approval_read':
        final d = await g.approvalDetail(_s(i['doc_id']), _s(i['form_id']));
        return {
          'ok': true,
          'title': d.title,
          'currentApprover': d.currentApprover,
          'attachments': d.attachCount,
          'content': d.content.length > 8000
              ? '${d.content.substring(0, 8000)}…'
              : d.content,
        };
      case 'approval_counts':
        return {'ok': true, 'counts': await g.approvalCounts()};
      case 'notices_list':
        final (total, list) = await g.notices(
          pageSize: 10,
          search: _s(i['search']),
        );
        return {
          'ok': true,
          'total': total,
          'items': [
            for (final n in list)
              {
                'artSeqNo': n.artSeqNo,
                'title': n.title,
                'board': n.board,
                'writer': n.writer,
                'date': n.writeDate,
                'isNew': n.isNew,
              },
          ],
        };
      case 'notice_read':
        final n = await g.notice(_s(i['art_seq_no']));
        return {
          'ok': true,
          'title': n.title,
          'board': n.board,
          'writer': n.writer,
          'date': n.writeDate,
          'content': n.content.length > 8000
              ? '${n.content.substring(0, 8000)}…'
              : n.content,
        };
      case 'search':
        return {
          'ok': true,
          ...await g.search(
            _s(i['query']),
            scope: _s(i['scope']).isEmpty ? '전체' : _s(i['scope']),
            from: _s(i['from_date']),
            to: _s(i['to_date']),
          ),
        };
    }
    return {'ok': false, 'error': '모르는 도구입니다: ${c.name}'};
  }
}
