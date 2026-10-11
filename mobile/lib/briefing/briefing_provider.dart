import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/client.dart';
import '../gw/gw_api.dart';
import '../gw/gw_org_absences.dart';
import '../gw/gw_creds.dart';
import 'summary_provider.dart' show briefingClockProvider;
import 'briefing_model.dart';
import 'confluence_briefing.dart';
import 'sharepoint_briefing.dart';
import 'jira_briefing.dart';
import 'dooray_briefing.dart';
import '../dooray/calendar_session.dart';

/// 홈 브리핑 수집 — 소스별로 독립(try/catch)·병렬. 실패한 소스는 errors[소스]에만 남고 값은 null이라 나머지 섹션은 그려진다.
/// Teams는 서버 라우트(/api/teams/mentions); 400·401·403·409는 "미연결"로 본다(오류 아님).
final briefingProvider = AsyncNotifierProvider<BriefingNotifier, BriefingData>(BriefingNotifier.new);

class BriefingNotifier extends AsyncNotifier<BriefingData> {
  String? _name;
  DoorayBriefing? _refreshDooray;
  Future<BriefingData>? _inflight;

  @override
  Future<BriefingData> build() async {
    ref.watch(doorayCalendarTransportProvider);
    final previousDooray = _refreshDooray;
    _refreshDooray = null;
    final f = _load(previousDooray);
    _inflight = f;
    try {
      return await f;
    } finally {
      if (identical(_inflight, f)) _inflight = null;
    }
  }

  /// 홈 탭을 다시 누르거나 당겨서 새로고침. 첫 로딩이 진행 중이면 이름만 반영하고 그 결과를 기다린다(중복 수집 없음).
  /// 아니면 invalidateSelf — 이전 데이터는 isRefreshing 상태로 유지되고 notifier 인스턴스(_name)는 보존된다(Riverpod 3.4).
  Future<void> refresh({String? name}) async {
    if (name != null) _name = name;
    final f = _inflight;
    if (f != null) {
      await f;
      return;
    }
    _refreshDooray = state.value?.dooray;
    ref.invalidateSelf();
    await future;
  }

  Future<BriefingData> _load(DoorayBriefing? previousDooray) async {
    await ref.read(gwProvider.future); // 크레덴셜 로딩이 끝나야 gwApiProvider가 결정된다
    final api = ref.read(gwApiProvider);
    final d = BriefingData(now: ref.read(briefingClockProvider)(), empSeq: api?.client.creds().empSeq ?? '');
    Future<void> src(String key, Future<void> Function() f) async {
      try {
        await f();
      } catch (e) {
        d.errors[key] = '$e';
      }
    }
    final calendarClient = ref.read(doorayCalendarTransportProvider);
    Map<String, dynamic>? localCalendar;
    String? localCalendarError;
    final doorayDate = d.now.toUtc().add(const Duration(hours: 9)).toIso8601String().substring(0, 10);
    await Future.wait([
      if (calendarClient != null) src('dooray_calendar', () async {
        try { localCalendar = await calendarClient.read(doorayDate); }
        catch (_) { localCalendarError = 'Dooray 일정을 새로고침하거나 다시 로그인해 주세요.'; }
      }),
      if (api != null) ...[
        src('calendars', () async => d.cals = await api.calendars()),
        src('today', () async => d.today = await api.events(d.now)),
        src('tomorrow', () async => d.tomorrow = await api.events(d.now.add(const Duration(days: 1)))),
        src('approvals', () async => d.approvals = await api.pendingApprovals()),
        src('inbox', () async => d.inbox = await api.inbox()),
        src('notices', () async => d.notices = await api.notices(pageSize: 3)),
        src('absences', () async => d.orgAbsences = await api.organizationAbsences()),
        src('attendance', () async => d.attendance = await api.attendanceToday()),
        src('talks', () async => d.talks = await api.talkAlerts(pageSize: 10)),
      ],
      src('dooray', () async {
        try {
          final date = '${d.now.year}-${d.now.month.toString().padLeft(2, '0')}-${d.now.day.toString().padLeft(2, '0')}';
          final raw = await ref.read(apiClientProvider).getJson('/api/dooray/overview', query: {'date': date, 'briefing': '1', 'calendarSource': 'app'});
          // App calendar ownership is local even when talking to an older server.
          d.dooray = DoorayBriefing.parse(raw is Map ? {...raw, 'events': {'items': []}} : raw);
        } catch (e) {
          final code = e is ApiException ? e.status : null;
          if (const {400, 401, 403, 404}.contains(code)) {
            d.dooray = null;
          } else {
            if (previousDooray?.connected == true) {
              d.dooray = DoorayBriefing(connected: true, events: const [], mail: previousDooray!.mail, partial: previousDooray.partial,
                refreshError: code == 409 ? 'Dooray 계정을 다시 연결해 주세요.' : 'Dooray를 새로 불러오지 못했습니다. 이전 내용을 표시합니다.');
            }
            if (code != 409) rethrow;
          }
        }
      }),
      src('jira', () async {
        try {
          d.jira = JiraBriefing.parse(await ref.read(apiClientProvider).getJson('/api/jira/issues', query: {'scope': 'open'}));
        } on ApiException catch (e) {
          if (e.status == 409) {
            d.jira = const JiraBriefing(connected: false, reconnect: true);
          } else {
            rethrow;
          }
        }
      }),
      src('confluence', () async {
        try {
          d.confluence = ConfluenceBriefing.parse(await ref.read(apiClientProvider).getJson('/api/confluence/feed', query: {'kind': 'mentions', 'limit': '5'}));
        } on ApiException catch (e) {
          // 미연결(400)·권한 추가 필요(409)·기능 준비 중(503)·페이지 권한 없음(401·403)·구 서버(404)는 오류가 아니라 "표시 안 함"
          if (const {400, 401, 403, 404, 409, 503}.contains(e.status)) {
            d.confluence = null;
          } else {
            rethrow;
          }
        }
      }),
      src('sharepoint', () async {
        try {
          d.sharepoint = SharepointBriefing.parse(await ref.read(apiClientProvider).getJson('/api/sharepoint/feed', query: {'kind': 'used', 'limit': '5'}));
        } on ApiException catch (e) {
          // 미연결(400)·토큰 만료(409)·설정 누락(500)·페이지 권한 없음(401·403)·구 서버(404)는 오류가 아니라 "표시 안 함"
          if (const {400, 401, 403, 404, 409, 500}.contains(e.status)) {
            d.sharepoint = null;
          } else {
            rethrow;
          }
        }
      }),
      src('teams', () async {
        try {
          d.mentions = TeamsMentions.parse(await ref.read(apiClientProvider).getJson('/api/teams/mentions', query: {'days': '2'}));
        } on ApiException catch (e) {
          // 401·403(권한) · 400 not_connected · 409 reconnect(토큰 만료) — 모두 "Microsoft 미연결"이지 수집 오류가 아니다(재시도로 풀리지 않음)
          if (e.status == 401 || e.status == 403 || e.status == 400 || e.status == 409) {
            d.mentions = const TeamsMentions(connected: false, items: []);
          } else {
            rethrow;
          }
        }
      }),
    ]);
    if (calendarClient != null && identical(ref.read(doorayCalendarTransportProvider), calendarClient)) {
      final remote = d.dooray;
      final local = DoorayBriefing.parse({'connected': true, 'events': localCalendar ?? {'items': []}});
      d.dooray = DoorayBriefing(connected: true, events: local.events, eventsError: localCalendarError,
        mail: remote?.mail ?? const [], mailError: remote?.mailError, partial: remote?.partial ?? false, refreshError: remote?.refreshError);
    }
    d.name = _name ?? ''; // 로딩 중 refresh(name:)로 들어온 이름도 반영
    return d;
  }
}

/// 전체 토글을 켰을 때만 회사 명부를 조회한다. 연결 계정 변경·토글 해제 시 캐시를 버린다.
final companyAbsencesProvider = FutureProvider.autoDispose<GwOrgAbsences>((ref) async {
  await ref.watch(gwProvider.future);
  final api = ref.watch(gwApiProvider);
  if (api == null) throw StateError('아마란스 연결이 필요합니다');
  return api.organizationAbsences(allCompany: true);
});
