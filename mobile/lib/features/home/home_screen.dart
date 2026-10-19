import '../../app/service_card_grid.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../app/brand.dart';
import '../../app/router.dart' show homeBranch, tabTapProvider;
import '../../app/theme.dart';
import '../../auth/session.dart';
import '../../briefing/briefing_model.dart';
import '../../briefing/briefing_provider.dart';
import '../../briefing/briefing_sections.dart';
import '../../briefing/live_activity.dart';
import '../../briefing/summary_provider.dart';
import '../../gw/gw_creds.dart';
import '../../gw/gw_models.dart' show myEvents;
import '../../gw/gw_notices_card.dart';
import '../../gw/messenger_open.dart';
import '../../more/catalog.dart';
import '../../more/service_grid.dart';
import '../../release/release_provider.dart';
import 'greeting.dart';
import 'quotes.dart';
import 'home_card_layout.dart';

/// 홈 = 오늘의 브리핑. 인사말 → 오늘의 한 줄(격언) → 데일리 브리핑(Claude, 없으면 숨김) → 지금 필요한 것 → 일정 → 팀원 부재 → 결재 → 메일 → Teams → 공지 → 바로 가기·사내 서비스.
/// 수집은 홈을 열 때·홈 탭을 다시 누를 때·당겨서 새로고침. 브리핑은 매일 한국 시간 07:00 및 수동 요청 때 다시 만든다.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key, this.now});
  final DateTime? now; // 테스트에서 고정
  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> with WidgetsBindingObserver {
  int _summaryRequests = 0;
  bool get _summaryBusy => _summaryRequests > 0;
  bool _manualBusy = false;
  bool _allAbsences = false;
  Timer? _dailyTimer;
  late String _period;

  DateTime get _now => ref.read(briefingClockProvider)();

  void _scheduleDaily() {
    _dailyTimer?.cancel();
    _dailyTimer = Timer(untilNextBriefing(_now), _checkDay);
  }

  void _checkDay() {
    if (!mounted) return;
    final period = briefingPeriod(_now);
    if (_period != period) {
      _period = period;
      _refresh();
    }
    _scheduleDaily();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _checkDay();
      ref.invalidate(releaseProvider); // 며칠 떠 있는 앱도 돌아올 때 새 버전을 다시 확인한다
    } else if (state == AppLifecycleState.paused) {
      _dailyTimer?.cancel();
    }
  }

  @override
  void dispose() {
    _dailyTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _forceSummary() async {
    if (_manualBusy || _summaryBusy) return;
    setState(() => _manualBusy = true);
    try {
      await _refresh();
      if (!mounted) return;
      final data = await ref.read(briefingProvider.future);
      if (!mounted) return;
      await _summary(data, force: true);
    } finally {
      if (mounted) setState(() => _manualBusy = false);
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _period = briefingPeriod(_now);
    _scheduleDaily();
    // 첫 수집에 인사말 이름을 실어 보낸다 — 진행 중인 build()와 합쳐져 추가 수집은 없다(BriefingNotifier.refresh).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _refresh();
    });
  }

  Future<void> _refresh() async {
    if (_allAbsences) ref.invalidate(companyAbsencesProvider);
    await ref.read(briefingProvider.notifier).refresh(name: ref.read(sessionProvider).asData?.value?.name);
    if (!mounted) return;
    final data = ref.read(briefingProvider).value;
    // 07:00 이전에 시작된 수집에 합류했다면 새 날짜의 업무 데이터로 다시 수집한다.
    if (data != null && briefingPeriod(data.now) != briefingPeriod(_now)) {
      await ref.read(briefingProvider.notifier).refresh();
    }
  }

  /// 아마란스 또는 Jira가 연결된 경우 실제 업무 데이터로 오늘의 한 마디를 만든다.
  Future<void> _summary(BriefingData d, {bool force = false}) async {
    if (briefingPeriod(d.now) != briefingPeriod(_now)) return;
    if (ref.read(gwProvider).value?.status != GwStatus.connected && d.jira?.connected != true) return;
    final name = ref.read(sessionProvider).asData?.value?.name;
    if (name != null && name.isNotEmpty) d.name = name; // 첫 수집 때 세션이 아직 없었어도 payload에는 이름을 싣는다
    setState(() => _summaryRequests++);
    try {
      final ok = await ref.read(summaryProvider.notifier).ensure(d, force: force);
      if (force && mounted && !ok) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(ref.read(summaryProvider.notifier).failureMessage),
          duration: const Duration(seconds: 8),
        ));
      }
    } finally {
      if (mounted) setState(() => _summaryRequests--);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider).asData?.value;
    final t = widget.now ?? DateTime.now();
    final g = greetingFor(t, name: session?.name);
    final q = dailyQuote(t);
    final theme = Theme.of(context);
    final gw = ref.watch(gwProvider).value;
    final briefing = ref.watch(briefingProvider);
    final data = briefing.value;
    final dooray = session?.isAdmin == true || session?.permissions['dooray'] != false ? data?.dooray : null;
    final company = _allAbsences ? ref.watch(companyAbsencesProvider) : null;
    final summary = ref.watch(summaryProvider).value;
    ref.listen(tabTapProvider, (_, t) { if (t.branch == homeBranch) _refresh(); }); // 홈 탭을 눌렀을 때만(다른 브랜치 전환은 무시)
    ref.listen(briefingProvider, (prev, next) {
      final d = next.value;
      if (d == null || d == prev?.value) return;
      // 새로 수집될 때마다 잠금 화면 라이브 액티비티·Android 상시 알림도 갱신(부가 기능 — 실패는 무시)
      if (liveActivitySupported) syncLiveActivity(d, foreground: true).catchError((_) {});
      if (!_manualBusy) _summary(d);
    });
    Future<void> open(String route) async {
      await context.push(route);
      if (mounted && route.contains('/web?path=')) await _refresh();
    }
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: _refresh,
          child: ListView(padding: const EdgeInsets.fromLTRB(20, 12, 20, 24), children: [
            Row(children: [
              const BrandLogo(width: 86, opacity: 0.8),
              const Spacer(),
              SquareIconButton(icon: Icons.menu_book_outlined, tooltip: '사용자 매뉴얼', onPressed: () => open('/web?path=${Uri.encodeComponent('/manual')}')), // 첫 화면에서 바로 매뉴얼(웹 /manual)로
            ]),
            const SizedBox(height: 14),
            LayoutBuilder(builder: (context, constraints) {
            // 데스크톱 여러 열: 오늘의 한 줄을 인사말 옆, 카드 줄 전체 폭(인사말 1열 + 한 줄 나머지 열)으로 — 사용자 요청.
            final columns = HomeCardLayout.columnsFor(context, constraints.maxWidth);
            final greeting = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(g.title, style: theme.textTheme.headlineSmall),
              const SizedBox(height: 4),
              Text(g.subtitle, style: theme.textTheme.bodySmall),
            ]);
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (columns > 1)
              Row(children: [
                SizedBox(width: (constraints.maxWidth - 16 * (columns - 1)) / columns, child: greeting), // 아래 카드 1열과 같은 폭
                const SizedBox(width: 16),
                Expanded(child: QuoteCard(quote: q)),
              ])
            else
              greeting,
            const SizedBox(height: 16),
            HomeCardLayout(children: [
            if (columns == 1) QuoteCard(quote: q),
            BriefingCard(
              summary: summary == null ? null : SummaryText(text: summary.text, at: summary.at),
              busy: _summaryBusy || _manualBusy,
              onRefresh: gw?.status == GwStatus.connected || data?.jira?.connected == true || dooray?.connected == true ? _forceSummary : null,
              onClockIn: data != null && clockInPending(data.attendance, data.now) ? () => open('/gw/attendance') : null,
              jira: data != null && !data.errors.containsKey('jira') && (session?.isAdmin == true || session?.permissions['jira'] != false) ? data.jira : null,
              dooray: dooray,
              onDoorayMore: () => open('/dooray/calendar'),
              onDoorayRetry: _refresh,
              onJiraMore: () => open('/web?path=${Uri.encodeComponent('/jira')}'),
              onJiraIssue: (key) => open('/web?path=${Uri.encodeComponent('/jira/$key')}'),
              onGwConnect: gw != null && gw.status != GwStatus.connected ? () => context.push('/gw/connect') : null,
              gwRelogin: gw?.status == GwStatus.needsRelogin,
            ),
            if (data != null && !data.errors.containsKey('confluence') && (session?.isAdmin == true || session?.permissions['confluence'] != false))
              ConfluenceSection(
                data: data.confluence,
                onOpenUrl: (u) => launchUrl(Uri.parse(u), mode: LaunchMode.externalApplication),
                onMore: () => open('/web?path=${Uri.encodeComponent('/confluence')}'),
              ),
            if (data != null && !data.errors.containsKey('sharepoint') && (session?.isAdmin == true || session?.permissions['sharepoint'] != false))
              SharepointSection(
                data: data.sharepoint,
                onOpenUrl: (u) => launchUrl(Uri.parse(u), mode: LaunchMode.externalApplication),
                onMore: () => open('/web?path=${Uri.encodeComponent('/sharepoint')}'),
              ),
            if (briefing.isLoading && data == null) const Padding(padding: EdgeInsets.only(top: 14), child: LinearProgressIndicator(minHeight: 2)),
            if (gw != null && gw.status != GwStatus.connected)
              GwConnectCard(relogin: gw.status == GwStatus.needsRelogin, onConnect: () => context.push('/gw/connect'))
            else if (data != null) ...[
              FocusSection(items: focusItems(data), onOpen: open),
              if (data.errors.containsKey('today')) RetryLine(label: '일정', onTap: _refresh) else MeetingsSection(meetings: myMeetings(data), tomorrowCount: myEvents(data.tomorrow ?? const [], data.cals ?? const [], data.empSeq).length, onMore: () => open('/gw/today')),
              AbsenceSection(
                absences: _allAbsences ? orgAbsencesList(company?.asData?.value) : teamAbsences(data),
                title: _allAbsences ? '회사 전체 부재' : data.orgAbsences?.isCenter == true ? '센터원 부재' : '팀원 부재',
                allCompany: _allAbsences,
                loading: _allAbsences && company?.isLoading == true,
                failed: _allAbsences ? company?.hasError == true : data.errors.containsKey('absences'),
                onToggle: (value) => setState(() => _allAbsences = value),
                onRetry: _allAbsences ? () => ref.invalidate(companyAbsencesProvider) : _refresh,
              ),
              if (data.errors.containsKey('approvals')) RetryLine(label: '미결 결재', onTap: _refresh) else ApprovalsSection(total: data.approvals?.$1 ?? 0, items: data.approvals?.$2 ?? const [], now: data.now, onMore: () => open('/gw/approvals')),
              if (data.errors.containsKey('inbox')) RetryLine(label: '메일', onTap: _refresh) else MailsSection(items: data.inbox?.$2 ?? const [], unreadTotal: data.inbox?.$1 ?? 0, onMore: () => open('/gw/mail')),
              if (!data.errors.containsKey('talks')) TalkMentionSection(talks: data.talks, onOpen: openMessenger),
            ],
            if (data != null) ...[
              if (data.errors.containsKey('teams')) RetryLine(label: 'Teams', onTap: _refresh) else TeamsSection(mentions: data.mentions, onOpen: () => open(teamsRoute)),
            ],
            const GwNoticesCard(),
            ]),
            ]);
            }),
            const SizedBox(height: 20),
            Padding(padding: const EdgeInsets.only(left: 4, bottom: 8), child: Text('바로 가기', style: theme.textTheme.titleSmall)),
            ServiceCardGrid(
              children: [
                // Teams 채팅이 맨 앞(사용자 요청) — 권한이 있을 때만. WebView로 연다.
                if (session != null && canUsePage(session, teamsChatEntry))
                  _quick(context, Icons.forum_outlined, 'Teams 채팅', '내가 속한 채팅 읽기·보내기', () => context.push(teamsRoute), Brand.tints[3]),
                _quick(context, Icons.restaurant, '뭐 먹지', '주변 식당·카페', () => context.go('/food'), Brand.tints[2]),
                _quick(context, Icons.stairs, '사다리', '순서·당번 정하기', () => context.go('/ladder'), Brand.tints[0]),
                _quick(context, Icons.coffee, '커피 타임', '팀 나누기·법카', () => context.go('/team'), Brand.tints[1]),
              ],
            ),
            if (session != null && webServices(session).isNotEmpty) ...[
              const SizedBox(height: 20),
              Padding(padding: const EdgeInsets.only(left: 4, bottom: 8), child: Text('사내 서비스', style: theme.textTheme.titleSmall)),
              ServiceGrid(session: session),
            ],
          ]),
        ),
      ),
    );
  }

  Widget _quick(BuildContext context, IconData icon, String label, String desc, VoidCallback onTap, Color tint) => Card(
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              TintIcon(icon, size: 40, background: tint, color: Brand.navy),
              const Spacer(),
              Text(label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 2),
              Text(desc, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis),
            ]),
          ),
        ),
      );
}
