import 'package:flutter/material.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_gate.dart';
import 'gw_models.dart';

class AttendanceScreen extends StatelessWidget {
  const AttendanceScreen({super.key});
  @override
  Widget build(BuildContext context) => GwGate(title: '출퇴근', builder: (_, api) => _Body(api));
}

class _Body extends StatefulWidget {
  const _Body(this.api);
  final GwApi api;
  @override
  State<_Body> createState() => _BodyState();
}

class _BodyState extends State<_Body> {
  Attendance? _a;
  String? _error, _note;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final a = await widget.api.attendanceToday();
      if (mounted) setState(() { _a = a; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  Future<void> _punch(bool clockIn) async {
    final kind = clockIn ? '출근' : '퇴근';
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text('지금 $kind을 기록할까요?'),
        content: const Text('실제 근태에 반영되며 되돌릴 수 없습니다.'),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('취소')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('기록'))],
      ),
    );
    if (ok != true) return;
    setState(() { _busy = true; _note = null; });
    try {
      final r = await widget.api.punch(clockIn: clockIn);
      if (mounted) setState(() { _note = r.note; _a = Attendance(workDt: _a?.workDt ?? '', comeTm: r.comeTm, leaveTm: r.leaveTm, holiday: _a?.holiday ?? false); });
    } catch (e) {
      if (mounted) setState(() => _note = '기록하지 못했습니다: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _date(String wd) => wd.length == 8 ? '${wd.substring(0, 4)}.${wd.substring(4, 6)}.${wd.substring(6, 8)}' : wd;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final a = _a;
    return Scaffold(
      appBar: const BrandHeader(title: '출퇴근', showBack: true),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(20, 4, 20, 24), children: [
          if (_error != null)
            Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(children: [Text(_error!, style: const TextStyle(color: Brand.dangerText)), const SizedBox(height: 8), FilledButton(onPressed: _load, child: const Text('다시 시도'))])))
          else if (a == null)
            const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator()))
          else ...[
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(color: Brand.navy, borderRadius: BorderRadius.circular(16)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${_date(a.workDt)}${a.holiday ? ' · 휴일' : ''}', style: TextStyle(fontSize: 13, color: Colors.white.withValues(alpha: 0.7))),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(child: _Time('출근', a.clockedIn ? hm(a.comeTm) : '—')),
                  Expanded(child: _Time('퇴근', a.clockedOut ? hm(a.leaveTm) : '—')),
                ]),
              ]),
            ),
            const SizedBox(height: 16),
            PrimaryCta(label: a.clockedIn ? '출근 ${hm(a.comeTm)} 기록됨' : '출근 기록', icon: Icons.login, onPressed: a.clockedIn || _busy ? null : () => _punch(true)),
            const SizedBox(height: 10),
            PrimaryCta(label: a.clockedOut ? '퇴근 ${hm(a.leaveTm)} 기록됨' : '퇴근 기록', icon: Icons.logout, onPressed: a.clockedOut || _busy ? null : () => _punch(false)),
            if (_note != null) Padding(padding: const EdgeInsets.only(top: 14), child: Text(_note!, style: theme.textTheme.bodySmall?.copyWith(color: Brand.navy), textAlign: TextAlign.center)),
            const SizedBox(height: 16),
            Text('기록은 아마란스 근태에 그대로 반영됩니다. 이미 기록이 있으면 다시 찍지 않습니다.', style: theme.textTheme.bodySmall, textAlign: TextAlign.center),
          ],
        ]),
      ),
    );
  }
}

class _Time extends StatelessWidget {
  const _Time(this.label, this.value);
  final String label, value;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Brand.sky)),
        const SizedBox(height: 4),
        Text(value, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: Colors.white)),
      ]);
}
