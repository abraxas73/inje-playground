import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/client.dart';
import '../gw/gw_api.dart';
import '../gw/gw_creds.dart';
import '../gw/gw_models.dart';
import 'briefing_model.dart';

/// 홈 브리핑 수집 — 소스별로 독립(try/catch)·병렬. 실패한 소스는 errors[소스]에만 남고 값은 null이라 나머지 섹션은 그려진다.
/// Teams는 서버 라우트(/api/teams/mentions); 400·401·403·409는 "미연결"로 본다(오류 아님).
final briefingProvider = AsyncNotifierProvider<BriefingNotifier, BriefingData>(BriefingNotifier.new);

class BriefingNotifier extends AsyncNotifier<BriefingData> {
  String? _name;
  Future<BriefingData>? _inflight;

  @override
  Future<BriefingData> build() async {
    final f = _load();
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
    ref.invalidateSelf();
    await future;
  }

  Future<BriefingData> _load() async {
    await ref.read(gwProvider.future); // 크레덴셜 로딩이 끝나야 gwApiProvider가 결정된다
    final api = ref.read(gwApiProvider);
    final d = BriefingData(now: kstNow(), empSeq: api?.client.creds().empSeq ?? '');
    Future<void> src(String key, Future<void> Function() f) async {
      try {
        await f();
      } catch (e) {
        d.errors[key] = '$e';
      }
    }
    await Future.wait([
      if (api != null) ...[
        src('calendars', () async => d.cals = await api.calendars()),
        src('today', () async => d.today = await api.events(d.now)),
        src('tomorrow', () async => d.tomorrow = await api.events(d.now.add(const Duration(days: 1)))),
        src('approvals', () async => d.approvals = await api.pendingApprovals()),
        src('inbox', () async => d.inbox = await api.inbox()),
        src('notices', () async => d.notices = await api.notices(pageSize: 3)),
        src('attendance', () async => d.attendance = await api.attendanceToday()),
      ],
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
    d.name = _name ?? ''; // 로딩 중 refresh(name:)로 들어온 이름도 반영
    return d;
  }
}
