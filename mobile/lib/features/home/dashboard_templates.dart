import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../api/client.dart';
import '../../app/theme.dart';
import 'home_dashboard.dart';

/// 위젯 편집 툴바의 "템플릿" — 기본·공유 템플릿을 골라 내 배치를 바꾸고, 지금 배치를 이름 붙여 공유한다.
Future<void> showDashboardTemplates(BuildContext context) =>
    showDialog(context: context, builder: (_) => const _TemplatesDialog());

class _TemplatesDialog extends ConsumerStatefulWidget {
  const _TemplatesDialog();
  @override
  ConsumerState<_TemplatesDialog> createState() => _TemplatesDialogState();
}

class _TemplatesDialogState extends ConsumerState<_TemplatesDialog> {
  late Future<List<DashboardTemplate>> _list = _load();
  bool _busy = false;

  Future<List<DashboardTemplate>> _load() => fetchDashboardTemplates(ref.read(apiClientProvider));
  String _err(Object e) => e is ApiException ? e.message : '$e';

  Future<void> _run(Future<void> Function() job, String done) async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await job();
      messenger.showSnackBar(SnackBar(content: Text(done)));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(_err(e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _apply(DashboardTemplate t) async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text('‘${t.name}’ 적용'),
      content: const Text('지금 홈 배치가 이 템플릿 배치로 바뀝니다. 계속할까요?'),
      actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('취소')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('적용'))],
    ));
    if (ok != true || !mounted) return;
    final nav = Navigator.of(context);
    final saved = await ref.read(homeDashboardProvider.notifier).save(t.tiles);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(saved ? '‘${t.name}’ 템플릿을 적용했어요.' : '적용하지 못했습니다. 잠시 뒤 다시 시도해 주세요.')));
    if (saved) nav.pop();
  }

  Future<void> _delete(DashboardTemplate t) => _run(() async {
        await deleteDashboardTemplate(ref.read(apiClientProvider), t.id);
        if (mounted) setState(() => _list = _load());
      }, '‘${t.name}’ 템플릿을 지웠어요.');

  Future<void> _share() async {
    // 컨트롤러 대신 입력값만 들고 있는다 — 닫히는 애니메이션 중에 dispose한 컨트롤러를 TextField가 다시 쓰는 오류 방지
    var typed = '';
    final name = await showDialog<String>(context: context, builder: (c) => AlertDialog(
      title: const Text('지금 배치 공유'),
      content: TextField(autofocus: true, maxLength: 40, decoration: const InputDecoration(hintText: '템플릿 이름(예: 영업 담당용)'), onChanged: (v) => typed = v, onSubmitted: (v) => Navigator.pop(c, v)),
      actions: [TextButton(onPressed: () => Navigator.pop(c), child: const Text('취소')), FilledButton(onPressed: () => Navigator.pop(c, typed), child: const Text('공유'))],
    ));
    final n = name?.trim() ?? '';
    if (n.isEmpty || !mounted) return;
    await _run(() async {
      final tiles = await ref.read(homeDashboardProvider.future); // 아직 안 받았으면 서버 배치를 받은 뒤(기본 배치를 내 것으로 공유하지 않게)
      await shareDashboardTemplate(ref.read(apiClientProvider), n, tiles);
      if (mounted) setState(() => _list = _load());
    }, '‘$n’ 템플릿으로 공유했어요. 다른 사람도 고를 수 있습니다.');
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('홈 템플릿'),
      content: SizedBox(
        width: 520,
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('템플릿을 적용하면 지금 홈 배치가 그 배치로 바뀝니다. 내 배치를 공유하면 다른 사람도 고를 수 있어요.', style: TextStyle(fontSize: 12, color: Brand.muted)),
          const SizedBox(height: 8),
          Flexible(child: FutureBuilder<List<DashboardTemplate>>(
            future: _list,
            builder: (context, snap) {
              if (snap.hasError) return Padding(padding: const EdgeInsets.all(16), child: Text('템플릿을 불러오지 못했습니다: ${_err(snap.error!)}'));
              final list = snap.data;
              if (list == null) return const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()));
              if (list.isEmpty) return const Padding(padding: EdgeInsets.all(16), child: Text('아직 템플릿이 없습니다.'));
              return ListView.separated(
                shrinkWrap: true,
                itemCount: list.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (context, i) {
                  final t = list[i];
                  return ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 4),
                    title: Row(children: [
                      Flexible(child: Text(t.name, overflow: TextOverflow.ellipsis)),
                      if (t.isDefault) ...[const SizedBox(width: 6), Chip(label: const Text('기본'), visualDensity: VisualDensity.compact, labelStyle: TextStyle(fontSize: 11, color: Brand.blue))],
                    ]),
                    subtitle: Text('${t.mine ? '내가 공유' : t.owner} · 위젯 ${t.tiles.length}개', style: const TextStyle(fontSize: 12)),
                    trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                      if (t.mine && !t.isDefault) IconButton(tooltip: '템플릿 지우기', icon: const Icon(Icons.delete_outline, size: 20), onPressed: _busy ? null : () => _delete(t)),
                      TextButton(onPressed: _busy || t.tiles.isEmpty ? null : () => _apply(t), child: const Text('적용')),
                    ]),
                  );
                },
              );
            },
          )),
        ]),
      ),
      actions: [
        TextButton.icon(onPressed: _busy ? null : _share, icon: const Icon(Icons.ios_share, size: 18), label: const Text('지금 배치 공유')),
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('닫기')),
      ],
    );
  }
}
