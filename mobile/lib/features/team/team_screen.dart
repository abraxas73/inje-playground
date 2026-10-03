import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../api/client.dart';
import '../../app/brand.dart';
import '../../app/router.dart' show tabTapProvider;
import '../../app/theme.dart';
import '../shared/participant_picker.dart';
import 'divider.dart';
import 'models.dart';
import 'prefs.dart';
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
  final Set<String> _selected = {};
  final List<String> _extra = [];
  Set<String> _cards = {};
  int _teamCount = 2, _min = 1, _max = 10;
  bool _distributeCards = true;
  List<Team>? _result;
  TeamConfig? _lastConfig;
  String? _savedId;
  bool _busy = false;
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
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _reloadMembers();
    }
  }

  Future<void> _init() async {
    final saved = await TeamPrefs.cardHolders();
    _cards = {...saved};
    await _reloadMembers();
  }

  /// 내 팀 다시 불러오기(처음·탭 재선택·앱 복귀·설정에서 돌아올 때·당겨서 새로고침). 새로 들어온 사람은 기본 참석, 빠진 사람은 선택에서 제거.
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

  List<String> get _names => _members.map((m) => m.name).toList();
  List<String> get _participants => [
    ..._names.where(_selected.contains),
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

  @override
  Widget build(BuildContext context) {
    ref.listen(tabTapProvider, (_, _) => _reloadMembers());
    final theme = Theme.of(context);
    final total = _names.length + _extra.length;
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
                                      text: ' / $total',
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
                  ParticipantPicker(
                    names: _names,
                    selected: _selected,
                    extras: _extra,
                    loaded: _membersLoaded,
                    includeWord: '참석',
                    onToggle: (n, v) => setState(
                      () => v ? _selected.add(n) : _selected.remove(n),
                    ),
                    onSetAll: (v) => setState(
                      () => v
                          ? _selected.addAll(_names)
                          : _selected.removeAll(_names),
                    ),
                    onAddExtra: (n) => setState(() => _extra.add(n)),
                    onRemoveExtra: (n) => setState(() => _extra.remove(n)),
                    onReload: _reloadMembers,
                    rowBadge: (n) =>
                        _cards.contains(n) ? const CardHolderBadge() : null,
                    rowAction: (n) => IconButton(
                      icon: Icon(
                        Icons.credit_card,
                        size: 20,
                        color: _cards.contains(n)
                            ? Brand.cardBadgeFg
                            : Brand.faint,
                      ),
                      tooltip: '법카 보유자 표시',
                      onPressed: () => _toggleCard(n),
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
