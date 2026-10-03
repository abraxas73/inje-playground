import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../app/brand.dart';
import '../../app/theme.dart';
import 'empty_team_hint.dart';

/// 사다리·커피 타임 공용 참가자 선택 카드.
/// 내 팀은 스위치로 포함/제외(기본 전원 포함), 직접 입력한 이름은 항상 포함(빼기 버튼). 10명을 넘으면 접은 채 시작하고,
/// 접힌 상태에서는 제외된 사람만 칩으로 요약해 누르면 다시 포함한다. 상태(선택·직접 입력)는 화면이 들고 있고 이 위젯은 그리기만 한다.
class ParticipantPicker extends StatefulWidget {
  const ParticipantPicker({
    super.key,
    required this.names,
    required this.selected,
    required this.extras,
    required this.loaded,
    required this.onToggle,
    required this.onSetAll,
    required this.onAddExtra,
    required this.onRemoveExtra,
    required this.onReload,
    this.includeWord = '참가',
    this.rowBadge,
    this.rowAction,
    this.collapseOver = 10,
  });

  /// 내 팀 이름(명부 순서)
  final List<String> names;

  /// 포함된 이름
  final Set<String> selected;

  /// 직접 입력한 이름(항상 포함)
  final List<String> extras;

  /// 내 팀을 불러왔는가(빈 팀 안내 표시 조건)
  final bool loaded;
  final void Function(String name, bool on) onToggle;
  final void Function(bool on) onSetAll;
  final void Function(String name) onAddExtra;
  final void Function(String name) onRemoveExtra;

  /// 설정(WebView)에서 돌아왔을 때 등 내 팀 다시 불러오기
  final Future<void> Function() onReload;

  /// "참가"/"참석" — 버튼·요약 문구에 쓴다
  final String includeWord;

  /// 이름 옆 배지(예: 법카)
  final Widget? Function(String name)? rowBadge;

  /// 스위치 앞 동작 버튼(예: 법카 토글)
  final Widget? Function(String name)? rowAction;
  final int collapseOver;

  @override
  State<ParticipantPicker> createState() => _ParticipantPickerState();
}

class _ParticipantPickerState extends State<ParticipantPicker> {
  /// null = 사용자가 아직 안 건드림 → 인원수로 결정
  bool? _open;
  final _ctl = TextEditingController();

  bool get _isOpen => _open ?? widget.names.length <= widget.collapseOver;

  @override
  void dispose() {
    _ctl.dispose();
    super.dispose();
  }

  void _add() {
    final n = _ctl.text.trim();
    if (n.isEmpty || widget.names.contains(n) || widget.extras.contains(n)) {
      return;
    }
    widget.onAddExtra(n);
    _ctl.clear();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final all = widget.names;
    final allOn = all.isNotEmpty && all.every(widget.selected.contains);
    final anyOn = all.any(widget.selected.contains);
    final count =
        all.where(widget.selected.contains).length + widget.extras.length;
    final hasRows = all.isNotEmpty || widget.extras.isNotEmpty;
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CountTitle('내 팀', all.length),
                const SizedBox(width: 8),
                Text(
                  '$count명 ${widget.includeWord}',
                  style: theme.textTheme.bodySmall,
                ),
                const Spacer(),
                TextButton(
                  onPressed: () => context
                      .push('/web?path=${Uri.encodeComponent('/settings')}')
                      .then((_) => widget.onReload()),
                  child: const Text('편집'),
                ),
                if (hasRows)
                  IconButton(
                    icon: Icon(_isOpen ? Icons.expand_less : Icons.expand_more),
                    tooltip: _isOpen ? '접기' : '펼치기',
                    onPressed: () => setState(() => _open = !_isOpen),
                  ),
              ],
            ),
            if (widget.loaded && all.isEmpty)
              EmptyTeamHint(onReturn: widget.onReload),
            if (all.isNotEmpty)
              Row(
                children: [
                  TextButton(
                    onPressed: allOn ? null : () => widget.onSetAll(true),
                    child: Text('모두 ${widget.includeWord}'),
                  ),
                  TextButton(
                    onPressed: anyOn ? () => widget.onSetAll(false) : null,
                    child: const Text('모두 해제'),
                  ),
                ],
              ),
            if (hasRows)
              if (_isOpen) ...[
                for (final n in all) _row(n, extra: false),
                for (final e in widget.extras) _row(e, extra: true),
              ] else
                _summary(theme),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _ctl,
                    decoration: const InputDecoration(hintText: '직접 입력'),
                    onSubmitted: (_) => _add(),
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
                    onPressed: _add,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _row(String n, {required bool extra}) {
    final on = extra || widget.selected.contains(n);
    final badge = extra ? null : widget.rowBadge?.call(n);
    final action = extra ? null : widget.rowAction?.call(n);
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
                if (badge != null) ...[const SizedBox(width: 8), badge],
                if (extra) ...[
                  const SizedBox(width: 8),
                  Text(
                    '직접 입력',
                    style: TextStyle(fontSize: 11, color: Brand.muted),
                  ),
                ],
              ],
            ),
          ),
          ?action,
          if (extra)
            IconButton(
              icon: const Icon(Icons.close, size: 20),
              tooltip: '빼기',
              onPressed: () => widget.onRemoveExtra(n),
            )
          else
            Switch(value: on, onChanged: (v) => widget.onToggle(n, v)),
        ],
      ),
    );
  }

  /// 접힌 상태: 제외된 사람만 칩으로(누르면 포함), 직접 입력은 지우기 칩으로.
  Widget _summary(ThemeData theme) {
    final off = widget.names
        .where((n) => !widget.selected.contains(n))
        .toList();
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (off.isEmpty)
            Text(
              '전원 ${widget.includeWord} · 펼쳐서 개별 조정',
              style: theme.textTheme.bodySmall,
            )
          else ...[
            Text(
              '미${widget.includeWord} ${off.length}명 · 누르면 ${widget.includeWord}',
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final n in off)
                  ActionChip(
                    label: Text(n),
                    onPressed: () => widget.onToggle(n, true),
                  ),
              ],
            ),
          ],
          if (widget.extras.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              '직접 입력 ${widget.extras.length}명',
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final e in widget.extras)
                  InputChip(
                    label: Text(e),
                    selected: true,
                    deleteIconColor: Colors.white,
                    onDeleted: () => widget.onRemoveExtra(e),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
