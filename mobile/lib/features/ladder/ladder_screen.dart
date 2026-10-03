import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../api/client.dart';
import '../../app/brand.dart';
import '../../app/router.dart' show tabTapProvider;
import '../../app/theme.dart';
import 'generator.dart';
import 'model.dart';
import 'painter.dart';
import '../shared/empty_team_hint.dart';
import 'repository.dart';

const kDensities = {'낮음': 0.25, '보통': 0.4, '높음': 0.6};
const kResultTypes = {'reward': '당첨', 'punishment': '꽝', 'normal': '일반'};
Color resultColor(String type) => type == 'reward'
    ? const Color(0xFF10B981)
    : type == 'punishment'
    ? const Color(0xFFEF4444)
    : const Color(0xFF6B7280);

class LadderScreen extends ConsumerStatefulWidget {
  const LadderScreen({super.key});
  @override
  ConsumerState<LadderScreen> createState() => _LadderScreenState();
}

class _LadderScreenState extends ConsumerState<LadderScreen>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  // 설정
  List<String> _team = [];
  bool _teamLoaded = false;
  final Set<String> _selected = {};
  final List<String> _extra = [];
  final List<LadderResult> _results = [];
  String _density = '보통';
  final _nameCtl = TextEditingController(),
      _resultCtl = TextEditingController();
  String _resultType = 'normal';
  // 사다리
  LadderData? _ladder;
  final Set<int> _revealed = {};
  final List<LadderMapping> _mappings = [];
  int? _animating;
  bool _saved = false, _saving = false;
  // initState에서 바로 만든다 — late final 지연 생성이면 사다리를 안 만들고 화면이 사라질 때 dispose에서 처음 생성되며 Ticker가 deactivated 조상을 찾아 예외.
  late final AnimationController _anim;

  List<String> get _participants => [
    ..._team.where(_selected.contains),
    ..._extra,
  ];

  @override
  void initState() {
    super.initState();
    _anim = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    )..addListener(() => setState(() {}));
    WidgetsBinding.instance.addObserver(this);
    _reloadTeam();
  }

  /// 내 팀 다시 불러오기 — 처음·탭 재선택·앱 복귀·설정에서 돌아올 때·당겨서 새로고침. 웹에서 저장한 구성원이 앱에도 보이게.
  Future<void> _reloadTeam() async {
    try {
      final n = await ref.read(ladderRepositoryProvider).myTeamNames();
      if (mounted) {
        setState(() {
          _team = n;
          _teamLoaded = true;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _teamLoaded = true);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _reloadTeam();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _anim.dispose();
    _nameCtl.dispose();
    _resultCtl.dispose();
    super.dispose();
  }

  void _snack(String m) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  void _generate() {
    if (_participants.length < 2) {
      _snack('참가자를 2명 이상 넣어 주세요.');
      return;
    }
    if (_results.isEmpty) {
      _snack('결과를 1개 이상 넣어 주세요.');
      return;
    }
    setState(() {
      _ladder = generateLadder(
        _participants,
        _results,
        density: kDensities[_density]!,
      );
      _revealed.clear();
      _mappings.clear();
      _saved = false;
    });
  }

  Future<void> _reveal(int col) async {
    final l = _ladder;
    if (l == null || _revealed.contains(col) || _animating != null) return;
    setState(() => _animating = col);
    await _anim.forward(from: 0);
    if (!mounted) return;
    setState(() {
      _animating = null;
      _revealed.add(col);
      _mappings.add(
        LadderMapping(l.participants[col], l.results[resultIndex(l, col)]),
      );
    });
  }

  Future<void> _revealAll() async {
    for (var c = 0; c < (_ladder?.columns ?? 0); c++) {
      await _reveal(c);
    }
  }

  Future<void> _save() async {
    final l = _ladder;
    if (l == null || _mappings.length < l.columns) return;
    setState(() => _saving = true);
    try {
      await ref
          .read(ladderRepositoryProvider)
          .save(
            ladder: l,
            bridgeDensity: kDensities[_density]!,
            mappings: _mappings,
          );
      setState(() => _saved = true);
      _snack('저장했습니다.');
    } on ApiException catch (e) {
      _snack(e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(tabTapProvider, (_, _) => _reloadTeam());
    return Scaffold(
      appBar: BrandHeader(
        title: '사다리',
        actions: [
          SquareIconButton(
            icon: Icons.history,
            tooltip: '이력',
            onPressed: () => context.push('/ladder/history'),
          ),
        ],
      ),
      body: _ladder == null ? _setup() : _board(_ladder!),
    );
  }

  Widget _setup() => Column(
    children: [
      Expanded(
        child: RefreshIndicator(
          onRefresh: _reloadTeam,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          CountTitle('참가자', _participants.length),
                          const Spacer(),
                          if (_team.isNotEmpty)
                            TextButton(
                              onPressed: () => setState(() {
                                if (_team.every(_selected.contains)) {
                                  _selected.removeAll(_team);
                                } else {
                                  _selected.addAll(_team);
                                }
                              }),
                              child: Text(
                                _team.every(_selected.contains)
                                    ? '모두 해제'
                                    : '모두 선택',
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      if (_teamLoaded && _team.isEmpty)
                        EmptyTeamHint(onReturn: _reloadTeam),
                      if (_team.isNotEmpty || _extra.isNotEmpty) ...[
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            for (final n in _team)
                              FilterChip(
                                label: Text(n),
                                selected: _selected.contains(n),
                                onSelected: (v) => setState(
                                  () => v
                                      ? _selected.add(n)
                                      : _selected.remove(n),
                                ),
                              ),
                            for (final n in _extra)
                              InputChip(
                                label: Text(n),
                                selected: true,
                                deleteIconColor: Colors.white,
                                onDeleted: () =>
                                    setState(() => _extra.remove(n)),
                              ),
                          ],
                        ),
                        const SizedBox(height: 12),
                      ],
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
                          _addButton(_addName),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      CountTitle('결과', _results.length),
                      const SizedBox(height: 12),
                      if (_results.isNotEmpty) ...[
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [for (final r in _results) _resultChip(r)],
                        ),
                        const SizedBox(height: 12),
                      ],
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: _resultCtl,
                              decoration: const InputDecoration(
                                hintText: '예: 커피 사기',
                              ),
                              onSubmitted: (_) => _addResult(),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Container(
                            height: 48,
                            padding: const EdgeInsets.symmetric(horizontal: 10),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(color: Brand.line),
                            ),
                            child: DropdownButtonHideUnderline(
                              child: DropdownButton<String>(
                                value: _resultType,
                                borderRadius: BorderRadius.circular(14),
                                style: const TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                  color: Brand.navy,
                                ),
                                items: [
                                  for (final e in kResultTypes.entries)
                                    DropdownMenuItem(
                                      value: e.key,
                                      child: Text(e.value),
                                    ),
                                ],
                                onChanged: (v) =>
                                    setState(() => _resultType = v ?? 'normal'),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          _addButton(_addResult),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '결과가 참가자보다 적으면 나머지는 "꽝"으로 채웁니다.',
                        style: Theme.of(
                          context,
                        ).textTheme.bodySmall?.copyWith(fontSize: 12),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Card(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          '다리 밀도',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ),
                      SegmentedButton<String>(
                        showSelectedIcon: false,
                        segments: [
                          for (final k in kDensities.keys)
                            ButtonSegment(value: k, label: Text(k)),
                        ],
                        selected: {_density},
                        onSelectionChanged: (v) =>
                            setState(() => _density = v.first),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 16),
        child: PrimaryCta(
          icon: Icons.auto_awesome,
          label: '사다리 만들기 (${_participants.length}명)',
          onPressed: _generate,
        ),
      ),
    ],
  );

  Widget _addButton(VoidCallback onAdd) => SizedBox(
    width: 48,
    height: 48,
    child: IconButton.filled(
      style: IconButton.styleFrom(
        backgroundColor: Brand.navy,
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      icon: const Icon(Icons.add, size: 22),
      tooltip: '추가',
      onPressed: onAdd,
    ),
  );

  Widget _resultChip(LadderResult r) {
    final (bg, fg) = switch (r.type) {
      'reward' => (const Color(0xFFE3F6EE), const Color(0xFF065F46)),
      'punishment' => (const Color(0xFFFDECEC), const Color(0xFF991B1B)),
      _ => (const Color(0xFFEEF1F6), const Color(0xFF3F4A5C)),
    };
    return InputChip(
      avatar: Container(
        width: 8,
        height: 8,
        decoration: BoxDecoration(
          color: resultColor(r.type),
          shape: BoxShape.circle,
        ),
      ),
      label: Text(r.text),
      labelStyle: TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: fg,
      ),
      backgroundColor: bg,
      side: BorderSide.none,
      deleteIconColor: fg.withValues(alpha: 0.6),
      onDeleted: () => setState(() => _results.remove(r)),
    );
  }

  void _addName() {
    final n = _nameCtl.text.trim();
    if (n.isEmpty || _participants.contains(n)) return;
    setState(() {
      _extra.add(n);
      _nameCtl.clear();
    });
  }

  void _addResult() {
    final t = _resultCtl.text.trim();
    if (t.isEmpty) return;
    setState(() {
      _results.add(LadderResult(t, _resultType));
      _resultCtl.clear();
    });
  }

  Widget _board(LadderData l) {
    final allRevealed = _revealed.length == l.columns;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
          child: Row(
            children: [
              for (var c = 0; c < l.columns; c++)
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(2),
                    child: FilledButton.tonal(
                      style: FilledButton.styleFrom(
                        padding: EdgeInsets.zero,
                        backgroundColor: _revealed.contains(c)
                            ? kPathColors[c % kPathColors.length].withValues(
                                alpha: .2,
                              )
                            : null,
                      ),
                      onPressed: _revealed.contains(c) || _animating != null
                          ? null
                          : () => _reveal(c),
                      child: Text(
                        l.participants[c],
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: CustomPaint(
              painter: LadderPainter(
                ladder: l,
                revealed: _revealed,
                animating: _animating,
                progress: _anim.value,
              ),
              child: const SizedBox.expand(),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
          child: Row(
            children: [
              for (var c = 0; c < l.columns; c++)
                Expanded(
                  child: Builder(
                    builder: (_) {
                      final shown =
                          _revealed.any((s) => resultIndex(l, s) == c) ||
                          (_animating != null &&
                              resultIndex(l, _animating!) == c &&
                              _anim.value > .95);
                      final r = l.results[c];
                      return Container(
                        margin: const EdgeInsets.all(2),
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        decoration: BoxDecoration(
                          color: shown
                              ? resultColor(r.type).withValues(alpha: .15)
                              : Colors.grey.shade200,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          shown ? r.text : '?',
                          textAlign: TextAlign.center,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 12,
                            color: shown ? resultColor(r.type) : Colors.grey,
                          ),
                        ),
                      );
                    },
                  ),
                ),
            ],
          ),
        ),
        if (_mappings.isNotEmpty)
          SizedBox(
            height: 36,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [
                for (final m in _mappings)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: Chip(
                      label: Text('${m.participant} → ${m.result.text}'),
                      backgroundColor: resultColor(
                        m.result.type,
                      ).withValues(alpha: .15),
                    ),
                  ),
              ],
            ),
          ),
        Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              OutlinedButton(
                onPressed: _animating == null
                    ? () => setState(() => _ladder = null)
                    : null,
                child: const Text('다시 만들기'),
              ),
              const Spacer(),
              if (!allRevealed)
                FilledButton.tonal(
                  onPressed: _animating == null ? _revealAll : null,
                  child: const Text('전체 공개'),
                ),
              if (allRevealed)
                FilledButton.icon(
                  onPressed: _saved || _saving ? null : _save,
                  icon: Icon(_saved ? Icons.check : Icons.save_outlined),
                  label: Text(_saved ? '저장됨' : '저장'),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
