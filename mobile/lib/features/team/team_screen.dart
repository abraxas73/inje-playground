import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../api/client.dart';
import '../../app/brand.dart';
import '../../app/router.dart' show tabTapProvider;
import '../../app/theme.dart';
import 'divider.dart';
import 'models.dart';
import 'prefs.dart';
import '../shared/empty_team_hint.dart';
import 'repository.dart';

class TeamScreen extends ConsumerStatefulWidget {
  const TeamScreen({super.key});
  @override
  ConsumerState<TeamScreen> createState() => _TeamScreenState();
}

class _TeamScreenState extends ConsumerState<TeamScreen>
    with WidgetsBindingObserver {
  List<TeamMemberRow> _members = [];
  bool _membersLoaded = false;

  /// 내 팀 목록 펼침 — 많으면(10명 초과) 접은 채 시작, 접힌 상태에선 불참자만 요약.
  bool _membersOpen = true;
  final Set<String> _selected = {};
  final List<String> _extra = [];
  Set<String> _cards = {};
  int _teamCount = 2, _min = 1, _max = 10;
  bool _distributeCards = true;
  List<Team>? _result;
  TeamConfig? _lastConfig;
  String? _savedId;
  bool _busy = false;
  final _nameCtl = TextEditingController();
  TeamRepository get _repo => ref.read(teamRepositoryProvider);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _init();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _nameCtl.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _reloadMembers();
    }
  }

  /// 내 팀 다시 불러오기(탭 재선택·앱 복귀·설정에서 돌아올 때·당겨서 새로고침). 새로 들어온 사람은 기본 참석, 빠진 사람은 선택에서 제거.
  Future<void> _reloadMembers() async {
    try {
      final list = await _repo.members();
      if (!mounted) return;
      setState(() {
        final before = _members.map((m) => m.name).toSet();
        final now = list.map((m) => m.name).toSet();
        _members = list;
        _membersLoaded = true;
        _cards.addAll(list.where((m) => m.isCardHolder).map((m) => m.name));
        _selected.addAll(now.difference(before));
        _selected.removeWhere((n) => !now.contains(n) && !_extra.contains(n));
      });
    } catch (_) {
      if (mounted) setState(() => _membersLoaded = true);
    }
  }

  Future<void> _init() async {
    final saved = await TeamPrefs.cardHolders();
    try {
      _members = await _repo.members();
    } catch (_) {}
    _membersLoaded = true;
    _membersOpen = _members.length <= 10;
    _cards = {
      ...saved,
      ..._members.where((m) => m.isCardHolder).map((m) => m.name),
    };
    _selected.addAll(_members.map((m) => m.name)); // 웹과 같이 내 팀 전원 기본 참석
    if (mounted) setState(() {});
  }

  List<String> get _participants => [
    ..._members.map((m) => m.name).where(_selected.contains),
    ..._extra,
  ];
  void _snack(String m) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  void _divide() {
    final cfg = TeamConfig(
      participants: _participants,
      teamCount: _teamCount,
      minPerTeam: _min,
      maxPerTeam: _max,
      cardHolders: _distributeCards
          ? _participants.where(_cards.contains).toList()
          : const [],
    );
    final err = validateTeamConfig(cfg);
    if (err != null) {
      _snack(err);
      return;
    }
    setState(() {
      _lastConfig = cfg;
      _result = divideTeams(cfg);
      _savedId = null;
    });
  }

  Future<void> _save() async {
    final r = _result, c = _lastConfig;
    if (r == null || c == null) return;
    setState(() => _busy = true);
    try {
      _savedId = await _repo.save(
        participants: c.participants,
        teamCount: c.teamCount,
        cardHolderDistribution: _distributeCards,
        teams: r,
      );
      _snack('저장했습니다.');
    } on ApiException catch (e) {
      _snack(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _notify() async {
    final r = _result;
    if (r == null) return;
    setState(() => _busy = true);
    try {
      _snack(notifyResultMessage(await _repo.notify(r)));
    } on ApiException catch (e) {
      _snack(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _toggleCard(String name) async {
    setState(
      () => _cards.contains(name) ? _cards.remove(name) : _cards.add(name),
    );
    await TeamPrefs.save(_cards);
  }

  void _addName() {
    final n = _nameCtl.text.trim();
    if (n.isEmpty || _participants.contains(n)) return;
    setState(() {
      _extra.add(n);
      _nameCtl.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(tabTapProvider, (_, _) => _reloadMembers());
    final theme = Theme.of(context);
    final names = [..._members.map((m) => m.name), ..._extra];
    return Scaffold(
      appBar: BrandHeader(
        title: '커피 타임',
        actions: [
          SquareIconButton(
            icon: Icons.history,
            tooltip: '이력',
            onPressed: () => context.push('/team/history'),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: RefreshIndicator(
              onRefresh: _reloadMembers,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
                children: [
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Brand.navy,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '오늘 참석',
                                style: TextStyle(
                                  fontSize: 13,
                                  color: Colors.white.withValues(alpha: 0.7),
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text.rich(
                                TextSpan(
                                  style: const TextStyle(
                                    fontSize: 28,
                                    fontWeight: FontWeight.w800,
                                    letterSpacing: -0.5,
                                  ),
                                  children: [
                                    TextSpan(
                                      text: '${_participants.length}',
                                      style: const TextStyle(color: Brand.sky),
                                    ),
                                    TextSpan(
                                      text: ' / ${names.length}',
                                      style: TextStyle(
                                        color: Colors.white.withValues(
                                          alpha: 0.5,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                        Text(
                          '팀 수',
                          style: TextStyle(
                            fontSize: 13,
                            color: Colors.white.withValues(alpha: 0.7),
                          ),
                        ),
                        const SizedBox(width: 10),
                        _pillStepper(
                          _teamCount,
                          1,
                          20,
                          (v) => setState(() => _teamCount = v),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              CountTitle('내 팀', names.length),
                              const Spacer(),
                              TextButton(
                                onPressed: () => context.push(
                                  '/web?path=${Uri.encodeComponent('/settings')}',
                                ),
                                child: const Text('편집'),
                              ),
                              if (names.isNotEmpty)
                                IconButton(
                                  icon: Icon(
                                    _membersOpen
                                        ? Icons.expand_less
                                        : Icons.expand_more,
                                  ),
                                  tooltip: _membersOpen ? '접기' : '펼치기',
                                  onPressed: () => setState(
                                    () => _membersOpen = !_membersOpen,
                                  ),
                                ),
                            ],
                          ),
                          if (_membersLoaded && _members.isEmpty)
                            EmptyTeamHint(onReturn: _reloadMembers),
                          if (names.isNotEmpty) _attendanceActions(),
                          if (_membersOpen)
                            for (final n in names)
                              _memberRow(n, extra: _extra.contains(n))
                          else if (names.isNotEmpty)
                            _collapsedSummary(names),
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              Expanded(
                                child: TextField(
                                  controller: _nameCtl,
                                  decoration: const InputDecoration(
                                    hintText: '직접 입력',
                                  ),
                                  onSubmitted: (_) => _addName(),
                                ),
                              ),
                              const SizedBox(width: 8),
                              SizedBox(
                                width: 48,
                                height: 48,
                                child: IconButton.filled(
                                  style: IconButton.styleFrom(
                                    backgroundColor: Brand.navy,
                                    foregroundColor: Colors.white,
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(14),
                                    ),
                                  ),
                                  icon: const Icon(Icons.add, size: 22),
                                  tooltip: '추가',
                                  onPressed: _addName,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 10, 8),
                      child: Column(
                        children: [
                          _optionRow(
                            '팀당 최소 인원',
                            _pillStepper(
                              _min,
                              1,
                              50,
                              (v) => setState(() => _min = v),
                              dark: false,
                            ),
                          ),
                          _optionRow(
                            '팀당 최대 인원',
                            _pillStepper(
                              _max,
                              1,
                              50,
                              (v) => setState(() => _max = v),
                              dark: false,
                            ),
                          ),
                          _optionRow(
                            '법카 보유자 분산',
                            Switch(
                              value: _distributeCards,
                              onChanged: (v) =>
                                  setState(() => _distributeCards = v),
                            ),
                            subtitle: '보유자를 팀마다 한 명씩 먼저 배치',
                          ),
                        ],
                      ),
                    ),
                  ),
                  if (_result != null) ...[
                    const SizedBox(height: 20),
                    Padding(
                      padding: const EdgeInsets.only(left: 4, bottom: 8),
                      child: Text('결과', style: theme.textTheme.titleSmall),
                    ),
                    for (final t in _result!)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Card(
                          child: Padding(
                            padding: const EdgeInsets.all(14),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${t.name} · ${t.members.length}명',
                                  style: theme.textTheme.titleMedium,
                                ),
                                const SizedBox(height: 8),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: [
                                    for (final m in t.members)
                                      _resultMember(m.name, m.hasCard),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    Row(
                      children: [
                        OutlinedButton.icon(
                          onPressed: _busy
                              ? null
                              : () => setState(() {
                                  _result = divideTeams(_lastConfig!);
                                  _savedId = null;
                                }),
                          icon: const Icon(Icons.refresh, size: 18),
                          label: const Text('다시 섞기'),
                        ),
                        const Spacer(),
                        FilledButton.tonalIcon(
                          onPressed: _busy || _savedId != null ? null : _save,
                          icon: Icon(
                            _savedId != null
                                ? Icons.check
                                : Icons.save_outlined,
                            size: 18,
                          ),
                          label: Text(_savedId != null ? '저장됨' : '저장'),
                        ),
                        const SizedBox(width: 8),
                        FilledButton.icon(
                          onPressed: _busy ? null : _notify,
                          icon: const Icon(Icons.campaign_outlined, size: 18),
                          label: const Text('알리기'),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 16),
            child: PrimaryCta(
              icon: Icons.shuffle,
              label: '${_participants.length}명을 $_teamCount팀으로 나누기',
              onPressed: _divide,
            ),
          ),
        ],
      ),
    );
  }

  /// 모두 참석 / 모두 불참 — 인원이 많을 때 스위치를 하나씩 안 눌러도 되게.
  Widget _attendanceActions() {
    final all = _members.map((m) => m.name).toSet();
    final allOn = all.isNotEmpty && all.every(_selected.contains);
    return Row(
      children: [
        TextButton(
          onPressed: allOn ? null : () => setState(() => _selected.addAll(all)),
          child: const Text('모두 참석'),
        ),
        TextButton(
          onPressed: _selected.isEmpty
              ? null
              : () => setState(() => _selected.removeAll(all)),
          child: const Text('모두 불참'),
        ),
      ],
    );
  }

  /// 접힌 상태 요약: 불참자 이름(없으면 "전원 참석"). 이름을 누르면 바로 참석으로.
  Widget _collapsedSummary(List<String> names) {
    final absent = names
        .where((n) => !_selected.contains(n) && !_extra.contains(n))
        .toList();
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: absent.isEmpty
          ? Text(
              '전원 참석 · 펼쳐서 개별 조정',
              style: Theme.of(context).textTheme.bodySmall,
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '불참 ${absent.length}명 · 누르면 참석으로',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final n in absent)
                      ActionChip(
                        label: Text(n),
                        onPressed: () => setState(() => _selected.add(n)),
                      ),
                  ],
                ),
              ],
            ),
    );
  }

  /// 내 팀 한 줄: 머리글자 · 이름 · 법카 배지 · 법카 토글 · 출석 스위치(직접 입력한 이름은 빼기 버튼).
  Widget _memberRow(String n, {required bool extra}) {
    final on = extra || _selected.contains(n);
    final holder = _cards.contains(n);
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 4),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: Brand.hairline)),
      ),
      child: Row(
        children: [
          InitialBadge(n, size: 36, circle: true),
          const SizedBox(width: 12),
          Expanded(
            child: Row(
              children: [
                Flexible(
                  child: Text(
                    n,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: on ? Brand.navy : Brand.faint,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (holder) ...[
                  const SizedBox(width: 8),
                  const CardHolderBadge(),
                ],
              ],
            ),
          ),
          IconButton(
            icon: Icon(
              Icons.credit_card,
              size: 20,
              color: holder ? Brand.cardBadgeFg : Brand.faint,
            ),
            tooltip: '법카 보유자 표시',
            onPressed: () => _toggleCard(n),
          ),
          if (extra)
            IconButton(
              icon: const Icon(Icons.close, size: 20),
              tooltip: '빼기',
              onPressed: () => setState(() => _extra.remove(n)),
            )
          else
            Switch(
              value: on,
              onChanged: (v) =>
                  setState(() => v ? _selected.add(n) : _selected.remove(n)),
            ),
        ],
      ),
    );
  }

  Widget _optionRow(String label, Widget control, {String? subtitle}) =>
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (subtitle != null)
                    Text(
                      subtitle,
                      style: Theme.of(
                        context,
                      ).textTheme.bodySmall?.copyWith(fontSize: 12),
                    ),
                ],
              ),
            ),
            control,
          ],
        ),
      );

  /// − n + 알약 스테퍼. dark=true는 네이비 카드 위.
  Widget _pillStepper(
    int v,
    int lo,
    int hi,
    ValueChanged<int> on, {
    bool dark = true,
  }) {
    final fg = dark ? Colors.white : Brand.navy;
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: dark ? Colors.white.withValues(alpha: 0.12) : Brand.fill,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _stepBtn(Icons.remove, v > lo ? () => on(v - 1) : null, fg: fg),
          SizedBox(
            width: 28,
            child: Text(
              '$v',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w800,
                color: fg,
              ),
            ),
          ),
          _stepBtn(
            Icons.add,
            v < hi ? () => on(v + 1) : null,
            fg: dark ? Brand.navy : Colors.white,
            bg: dark ? Colors.white : Brand.navy,
          ),
        ],
      ),
    );
  }

  Widget _stepBtn(
    IconData icon,
    VoidCallback? on, {
    required Color fg,
    Color? bg,
  }) => SizedBox(
    width: 34,
    height: 34,
    child: IconButton(
      style: IconButton.styleFrom(
        backgroundColor: bg,
        foregroundColor: fg,
        disabledForegroundColor: fg.withValues(alpha: 0.35),
        disabledBackgroundColor: bg?.withValues(alpha: 0.5),
        padding: EdgeInsets.zero,
      ),
      icon: Icon(icon, size: 18),
      onPressed: on,
    ),
  );

  Widget _resultMember(String name, bool hasCard) => Container(
    height: 34,
    padding: const EdgeInsets.symmetric(horizontal: 12),
    decoration: BoxDecoration(
      color: hasCard ? Brand.cardBadgeBg : Brand.fill,
      borderRadius: BorderRadius.circular(999),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (hasCard) ...[
          const Icon(Icons.credit_card, size: 14, color: Brand.cardBadgeFg),
          const SizedBox(width: 6),
        ],
        Text(
          name,
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: hasCard ? Brand.cardBadgeFg : Brand.navy,
          ),
        ),
      ],
    ),
  );
}
