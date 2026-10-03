import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../api/client.dart';
import 'divider.dart';
import 'models.dart';
import 'prefs.dart';
import 'repository.dart';

class TeamScreen extends ConsumerStatefulWidget {
  const TeamScreen({super.key});
  @override
  ConsumerState<TeamScreen> createState() => _TeamScreenState();
}

class _TeamScreenState extends ConsumerState<TeamScreen> {
  List<TeamMemberRow> _members = [];
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
    _init();
  }

  @override
  void dispose() {
    _nameCtl.dispose();
    super.dispose();
  }

  Future<void> _init() async {
    final saved = await TeamPrefs.cardHolders();
    try {
      _members = await _repo.members();
    } catch (_) {}
    _cards = {...saved, ..._members.where((m) => m.isCardHolder).map((m) => m.name)};
    _selected.addAll(_members.map((m) => m.name)); // 웹과 같이 내 팀 전원 기본 참석
    if (mounted) setState(() {});
  }

  List<String> get _participants => [..._members.map((m) => m.name).where(_selected.contains), ..._extra];
  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  void _divide() {
    final cfg = TeamConfig(participants: _participants, teamCount: _teamCount, minPerTeam: _min, maxPerTeam: _max, cardHolders: _distributeCards ? _participants.where(_cards.contains).toList() : const []);
    final err = validateTeamConfig(cfg);
    if (err != null) { _snack(err); return; }
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
      _savedId = await _repo.save(participants: c.participants, teamCount: c.teamCount, cardHolderDistribution: _distributeCards, teams: r);
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
    setState(() => _cards.contains(name) ? _cards.remove(name) : _cards.add(name));
    await TeamPrefs.save(_cards);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('커피 타임'), actions: [IconButton(icon: const Icon(Icons.history), tooltip: '이력', onPressed: () => context.push('/team/history'))]),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          const Text('참가자 (법카 아이콘을 눌러 보유자 표시)', style: TextStyle(fontWeight: FontWeight.w600)),
          Wrap(spacing: 6, children: [
            for (final n in [..._members.map((m) => m.name), ..._extra])
              FilterChip(
                label: Text(n),
                selected: _selected.contains(n) || _extra.contains(n),
                avatar: GestureDetector(onTap: () => _toggleCard(n), child: Icon(Icons.credit_card, size: 16, color: _cards.contains(n) ? Colors.orange : Colors.grey.shade400)),
                onSelected: (v) => setState(() {
                  if (_extra.contains(n)) {
                    _extra.remove(n);
                  } else {
                    v ? _selected.add(n) : _selected.remove(n);
                  }
                }),
              ),
          ]),
          Row(children: [
            Expanded(child: TextField(controller: _nameCtl, decoration: const InputDecoration(hintText: '직접 입력', isDense: true), onSubmitted: (_) => _addName())),
            IconButton(icon: const Icon(Icons.add), onPressed: _addName),
          ]),
          const SizedBox(height: 16),
          _stepper('팀 수', _teamCount, 1, 20, (v) => setState(() => _teamCount = v)),
          _stepper('팀당 최소 인원', _min, 1, 50, (v) => setState(() => _min = v)),
          _stepper('팀당 최대 인원', _max, 1, 50, (v) => setState(() => _max = v)),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('법카 보유자 분산'), subtitle: const Text('보유자를 팀마다 한 명씩 먼저 배치'), value: _distributeCards, onChanged: (v) => setState(() => _distributeCards = v)),
          const SizedBox(height: 8),
          FilledButton.icon(onPressed: _divide, icon: const Icon(Icons.shuffle), label: Text('팀 나누기 (${_participants.length}명)')),
          if (_result != null) ...[
            const SizedBox(height: 20),
            for (final t in _result!)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${t.name} (${t.members.length}명)', style: const TextStyle(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 6),
                    Wrap(spacing: 6, children: [for (final m in t.members) Chip(label: Text(m.hasCard ? '${m.name}(법카)' : m.name), backgroundColor: m.hasCard ? Colors.orange.shade50 : null)]),
                  ]),
                ),
              ),
            Row(children: [
              OutlinedButton.icon(onPressed: _busy ? null : () => setState(() { _result = divideTeams(_lastConfig!); _savedId = null; }), icon: const Icon(Icons.refresh), label: const Text('다시 섞기')),
              const Spacer(),
              FilledButton.tonalIcon(onPressed: _busy || _savedId != null ? null : _save, icon: Icon(_savedId != null ? Icons.check : Icons.save_outlined), label: Text(_savedId != null ? '저장됨' : '저장')),
              const SizedBox(width: 8),
              FilledButton.icon(onPressed: _busy ? null : _notify, icon: const Icon(Icons.campaign_outlined), label: const Text('알리기')),
            ]),
          ],
        ]),
      );

  void _addName() {
    final n = _nameCtl.text.trim();
    if (n.isEmpty || _participants.contains(n)) return;
    setState(() { _extra.add(n); _nameCtl.clear(); });
  }

  Widget _stepper(String label, int v, int lo, int hi, ValueChanged<int> on) => Row(children: [
        Expanded(child: Text(label)),
        IconButton(icon: const Icon(Icons.remove_circle_outline), onPressed: v > lo ? () => on(v - 1) : null),
        SizedBox(width: 32, child: Text('$v', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w600))),
        IconButton(icon: const Icon(Icons.add_circle_outline), onPressed: v < hi ? () => on(v + 1) : null),
      ]);
}
