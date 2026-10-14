import 'dart:async';
import 'dart:convert';

const doorayOrigin = 'https://nhnent.dooray.com';

class DoorayCalendarException implements Exception {
  const DoorayCalendarException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Credentials stay in the WebView cookie jar; only normalized schedule data leaves it.
/// 개인(private) 캘린더만 조회한다 — 내 캘린더와 남이 공유해 준 캘린더. 프로젝트 캘린더(마일스톤·프로젝트 일정)와 구독 캘린더(휴일)는
/// 내 일정이 아니다(2026-10-14 실측: 목록 56개 중 private 4·project 50·subscription 2, 프로젝트 마일스톤 12건이 일간에 섞여 보이던 원인).
/// 행에 캘린더 이름과 소유 여부(me.role === 'owner')를 실어 공유받은 캘린더를 구분한다.
/// [days]는 [day]부터 읽을 날 수(1~42 — 캘린더 월간 격자 6주). timeMax는 그 다음 날 00:00(한국 시각, 끝 제외).
String calendarRequestJs(
  String requestId,
  String day, {
  int days = 1,
  bool unreadMail = false,
}) {
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(day)) {
    throw const FormatException('Invalid day');
  }
  if (days < 1 || days > 42) throw const FormatException('Invalid days');
  final parsed = DateTime.parse(day);
  final date = DateTime.utc(parsed.year, parsed.month, parsed.day);
  if (date.toIso8601String().substring(0, 10) != day) {
    throw const FormatException('Invalid day');
  }
  final end = date
      .add(Duration(days: days))
      .toIso8601String()
      .substring(0, 10);
  return '''
(() => {
  const id = ${jsonEncode(requestId)};
  window.__innocrewCalendar = window.__innocrewCalendar || {};
  const save = value => { window.__innocrewCalendar[id] = value; };
  (async () => {
    if (location.origin !== '$doorayOrigin') { save({error:'login'}); return; }
    const headers = {'Dooray-Caller':'WEB','Dooray-Api-Version':'1.2','Accept':'application/json'};
    async function get(path) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
      const r = await fetch(path, {headers, credentials:'same-origin', cache:'no-store', redirect:'error', signal:controller.signal});
      if (r.status === 401 || r.status === 403) throw new Error('login');
      if (!r.ok) throw new Error('upstream');
      const j = await r.json();
      if (j.header?.isSuccessful !== true || !Array.isArray(j.result?.contents)) throw new Error('shape');
      return j.result;
      } finally { clearTimeout(timer); }
    }
    if (${unreadMail ? 'true' : 'false'}) {
      const mail = await get('/v2/wapi/mails?exceptFolders=sent%2Cdraft%2Cspam%2Ctrash%2Carchive%2Capprovemail&read=false&preview=false&size=5&page=0&order=-createdAt&view=timeline&excludeTotalCount=true');
      save({items:mail.contents.filter(m => m.mailSummary?.flags?.read === false && m.mailSummary?.flags?.deleted === false).map(m => ({id:m.id, subject:m.subject, from:m.users?.from?.emailUser?.name || m.users?.from?.emailUser?.emailAddress || '', sentAt:m.mailSummary?.sentAt, unread:true}))});
      return;
    }
    const list = await get('/v2/wapi/calendars?listed=true&size=10000');
    if (list.totalCount > list.contents.length) throw new Error('incomplete');
    const calendars = list.contents.filter(c => c.type === 'private' && /^\\d+\$/.test(c.id));
    if (!calendars.length) { save({items:[]}); return; }
    const info = Object.fromEntries(calendars.map(c => [String(c.id), {name:c.name || '', owner:c.me?.role === 'owner'}]));
    const query = new URLSearchParams({calendars:calendars.map(c=>c.id).join(','), timeMin:'${day}T00:00:00+09:00', timeMax:'${end}T00:00:00+09:00', postType:'toMe', privateTaskShown:'false'});
    const schedules = await get('/v2/wapi/calendars/*/schedules?' + query);
    if (schedules.totalCount > schedules.contents.length) throw new Error('incomplete');
    save({items:schedules.contents.filter(e => !e.deleteFlag).map(e=>({id:e.id, calendarId:e.calendarId, subject:e.subject, startedAt:e.startedAt, endedAt:e.endedAt, wholeDayFlag:e.wholeDayFlag, calendar:info[String(e.calendarId)]?.name || '', owner:info[String(e.calendarId)]?.owner !== false}))});
  })().catch(e => save({error:e.message === 'login' ? 'login' : 'failed'}));
})();
''';
}

Map<String, dynamic>? calendarResult(Object raw, {bool unreadMail = false}) {
  dynamic value = raw;
  for (var i = 0; i < 2 && value is String; i++) {
    if (value.isEmpty) return null;
    try {
      value = jsonDecode(value);
    } catch (_) {
      return null;
    }
  }
  if (value == null) return null;
  if (value is! Map) throw const DoorayCalendarException('일정 응답을 읽지 못했습니다.');
  if (value['error'] != null) {
    throw DoorayCalendarException(
      value['error'] == 'login'
          ? 'Dooray에 다시 로그인해 주세요.'
          : 'Dooray 일정을 불러오지 못했습니다. 다시 시도해 주세요.',
    );
  }
  final rows = value['items'];
  if (rows is! List ||
      rows.any(
        (x) =>
            x is! Map ||
            x['subject'] is! String ||
            (unreadMail
                ? x['unread'] != true ||
                      x['from'] is! String ||
                      x['sentAt'] is! String
                : x['startedAt'] is! String ||
                      x['endedAt'] is! String ||
                      x['wholeDayFlag'] is! bool),
      )) {
    throw const DoorayCalendarException('일정 응답 형식이 변경되었습니다.');
  }
  return {'items': rows};
}

/// One transport for app calendars. No personal-token fallback.
class DoorayCalendarClient {
  DoorayCalendarClient({required this.run, required this.evaluate});
  final Future<void> Function(String) run;
  final Future<Object> Function(String) evaluate;
  bool _closed = false;
  int _sequence = 0;
  Future<Map<String, dynamic>> read(
    String day, {
    int days = 1,
    bool unreadMail = false,
  }) async {
    if (_closed) throw const DoorayCalendarException('Dooray 연결이 닫혔습니다.');
    final id = 'request${++_sequence}';
    try {
      await run(
        calendarRequestJs(id, day, days: days, unreadMail: unreadMail),
      ).timeout(const Duration(seconds: 10));
      final deadline = DateTime.now().add(const Duration(seconds: 20));
      while (!_closed && DateTime.now().isBefore(deadline)) {
        final raw = await evaluate(
          'JSON.stringify(window.__innocrewCalendar?.[${jsonEncode(id)}] ?? null)',
        ).timeout(const Duration(seconds: 3));
        if (_closed) break;
        final data = calendarResult(raw, unreadMail: unreadMail);
        if (data != null) return data;
        await Future<void>.delayed(const Duration(milliseconds: 150));
      }
      throw const DoorayCalendarException(
        'Dooray 일정 조회 시간이 초과되었습니다. 다시 연결해 주세요.',
      );
    } finally {
      if (!_closed) {
        try {
          await run(
            'delete window.__innocrewCalendar?.[${jsonEncode(id)}]',
          ).timeout(const Duration(seconds: 1));
        } catch (_) {}
      }
    }
  }

  void close() {
    _closed = true;
  }
}
