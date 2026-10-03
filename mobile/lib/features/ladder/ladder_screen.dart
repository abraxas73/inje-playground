import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../api/client.dart';
import 'generator.dart';
import 'model.dart';
import 'painter.dart';
import 'repository.dart';

const kDensities = {'낮음': 0.25, '보통': 0.4, '높음': 0.6};
const kResultTypes = {'reward': '당첨', 'punishment': '꽝', 'normal': '일반'};
Color resultColor(String type) => type == 'reward' ? const Color(0xFF10B981) : type == 'punishment' ? const Color(0xFFEF4444) : const Color(0xFF6B7280);

class LadderScreen extends ConsumerStatefulWidget {
  const LadderScreen({super.key});
  @override
  ConsumerState<LadderScreen> createState() => _LadderScreenState();
}

class _LadderScreenState extends ConsumerState<LadderScreen> with SingleTickerProviderStateMixin {
  // 설정
  List<String> _team = [];
  final Set<String> _selected = {};
  final List<String> _extra = [];
  final List<LadderResult> _results = [];
  String _density = '보통';
  final _nameCtl = TextEditingController(), _resultCtl = TextEditingController();
  String _resultType = 'normal';
  // 사다리
  LadderData? _ladder;
  final Set<int> _revealed = {};
  final List<LadderMapping> _mappings = [];
  int? _animating;
  bool _saved = false, _saving = false;
  late final AnimationController _anim = AnimationController(vsync: this, duration: const Duration(milliseconds: 800))..addListener(() => setState(() {}));

  List<String> get _participants => [..._team.where(_selected.contains), ..._extra];

  @override
  void initState() {
    super.initState();
    ref.read(ladderRepositoryProvider).myTeamNames().then((n) {
      if (mounted) setState(() => _team = n);
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _anim.dispose();
    _nameCtl.dispose();
    _resultCtl.dispose();
    super.dispose();
  }

  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  void _generate() {
    if (_participants.length < 2) { _snack('참가자를 2명 이상 넣어 주세요.'); return; }
    if (_results.isEmpty) { _snack('결과를 1개 이상 넣어 주세요.'); return; }
    setState(() {
      _ladder = generateLadder(_participants, _results, density: kDensities[_density]!);
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
      _mappings.add(LadderMapping(l.participants[col], l.results[resultIndex(l, col)]));
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
      await ref.read(ladderRepositoryProvider).save(ladder: l, bridgeDensity: kDensities[_density]!, mappings: _mappings);
      setState(() => _saved = true);
      _snack('저장했습니다.');
    } on ApiException catch (e) {
      _snack(e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('사다리'), actions: [IconButton(icon: const Icon(Icons.history), tooltip: '이력', onPressed: () => context.push('/ladder/history'))]),
        body: _ladder == null ? _setup() : _board(_ladder!),
      );

  Widget _setup() => ListView(padding: const EdgeInsets.all(16), children: [
        const Text('참가자', style: TextStyle(fontWeight: FontWeight.w600)),
        Wrap(spacing: 6, children: [
          for (final n in _team) FilterChip(label: Text(n), selected: _selected.contains(n), onSelected: (v) => setState(() => v ? _selected.add(n) : _selected.remove(n))),
          for (final n in _extra) InputChip(label: Text(n), onDeleted: () => setState(() => _extra.remove(n))),
        ]),
        Row(children: [
          Expanded(child: TextField(controller: _nameCtl, decoration: const InputDecoration(hintText: '직접 입력', isDense: true), onSubmitted: (_) => _addName())),
          IconButton(icon: const Icon(Icons.add), onPressed: _addName),
        ]),
        const SizedBox(height: 16),
        const Text('결과', style: TextStyle(fontWeight: FontWeight.w600)),
        Wrap(spacing: 6, children: [
          for (final r in _results) InputChip(label: Text(r.text), avatar: CircleAvatar(backgroundColor: resultColor(r.type), radius: 6), onDeleted: () => setState(() => _results.remove(r))),
        ]),
        Row(children: [
          Expanded(child: TextField(controller: _resultCtl, decoration: const InputDecoration(hintText: '예: 커피 사기', isDense: true), onSubmitted: (_) => _addResult())),
          DropdownButton<String>(value: _resultType, items: [for (final e in kResultTypes.entries) DropdownMenuItem(value: e.key, child: Text(e.value))], onChanged: (v) => setState(() => _resultType = v ?? 'normal')),
          IconButton(icon: const Icon(Icons.add), onPressed: _addResult),
        ]),
        Text('결과가 참가자보다 적으면 나머지는 "꽝 N"으로 채웁니다.', style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 16),
        const Text('다리 밀도', style: TextStyle(fontWeight: FontWeight.w600)),
        SegmentedButton<String>(segments: [for (final k in kDensities.keys) ButtonSegment(value: k, label: Text(k))], selected: {_density}, onSelectionChanged: (v) => setState(() => _density = v.first)),
        const SizedBox(height: 24),
        FilledButton.icon(onPressed: _generate, icon: const Icon(Icons.auto_awesome), label: Text('사다리 만들기 (${_participants.length}명)')),
      ]);

  void _addName() {
    final n = _nameCtl.text.trim();
    if (n.isEmpty || _participants.contains(n)) return;
    setState(() { _extra.add(n); _nameCtl.clear(); });
  }

  void _addResult() {
    final t = _resultCtl.text.trim();
    if (t.isEmpty) return;
    setState(() { _results.add(LadderResult(t, _resultType)); _resultCtl.clear(); });
  }

  Widget _board(LadderData l) {
    final allRevealed = _revealed.length == l.columns;
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
        child: Row(children: [
          for (var c = 0; c < l.columns; c++)
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(2),
                child: FilledButton.tonal(
                  style: FilledButton.styleFrom(padding: EdgeInsets.zero, backgroundColor: _revealed.contains(c) ? kPathColors[c % kPathColors.length].withValues(alpha: .2) : null),
                  onPressed: _revealed.contains(c) || _animating != null ? null : () => _reveal(c),
                  child: Text(l.participants[c], maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12)),
                ),
              ),
            ),
        ]),
      ),
      Expanded(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 8), child: CustomPaint(painter: LadderPainter(ladder: l, revealed: _revealed, animating: _animating, progress: _anim.value), child: const SizedBox.expand()))),
      Padding(
        padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
        child: Row(children: [
          for (var c = 0; c < l.columns; c++)
            Expanded(child: Builder(builder: (_) {
              final shown = _revealed.any((s) => resultIndex(l, s) == c) || (_animating != null && resultIndex(l, _animating!) == c && _anim.value > .95);
              final r = l.results[c];
              return Container(
                margin: const EdgeInsets.all(2),
                padding: const EdgeInsets.symmetric(vertical: 6),
                decoration: BoxDecoration(color: shown ? resultColor(r.type).withValues(alpha: .15) : Colors.grey.shade200, borderRadius: BorderRadius.circular(6)),
                child: Text(shown ? r.text : '?', textAlign: TextAlign.center, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: shown ? resultColor(r.type) : Colors.grey)),
              );
            })),
        ]),
      ),
      if (_mappings.isNotEmpty)
        SizedBox(
          height: 36,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12), children: [
            for (final m in _mappings) Padding(padding: const EdgeInsets.only(right: 8), child: Chip(label: Text('${m.participant} → ${m.result.text}'), backgroundColor: resultColor(m.result.type).withValues(alpha: .15))),
          ]),
        ),
      Padding(
        padding: const EdgeInsets.all(12),
        child: Row(children: [
          OutlinedButton(onPressed: _animating == null ? () => setState(() => _ladder = null) : null, child: const Text('다시 만들기')),
          const Spacer(),
          if (!allRevealed) FilledButton.tonal(onPressed: _animating == null ? _revealAll : null, child: const Text('전체 공개')),
          if (allRevealed) FilledButton.icon(onPressed: _saved || _saving ? null : _save, icon: Icon(_saved ? Icons.check : Icons.save_outlined), label: Text(_saved ? '저장됨' : '저장')),
        ]),
      ),
    ]);
  }
}
