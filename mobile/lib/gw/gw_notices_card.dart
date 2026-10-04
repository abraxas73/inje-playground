import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../app/router.dart' show homeBranch, tabTapProvider;
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_creds.dart';
import 'gw_models.dart';

/// 홈 공지사항 카드 — 아마란스 전 게시판 공지·새 글 최신 3건. 연결돼 있을 때만 그린다.
class GwNoticesCard extends ConsumerStatefulWidget {
  const GwNoticesCard({super.key});
  @override
  ConsumerState<GwNoticesCard> createState() => _GwNoticesCardState();
}

class _GwNoticesCardState extends ConsumerState<GwNoticesCard> {
  GwApi? _loadedWith;
  List<GwNotice>? _items;
  String? _error;

  Future<void> _load(GwApi api) async {
    _loadedWith = api;
    try {
      final (_, list) = await api.notices(pageSize: 3);
      if (mounted) setState(() { _items = list; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final gw = ref.watch(gwProvider).value;
    final api = ref.watch(gwApiProvider);
    ref.listen(tabTapProvider, (_, t) { if (t.branch == homeBranch && api != null) _load(api); });
    if (gw == null || gw.status != GwStatus.connected || api == null) return const SizedBox.shrink();
    if (_loadedWith != api) {
      WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted && _loadedWith != api) _load(api); });
    }
    final items = _items;
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Padding(padding: const EdgeInsets.only(left: 4), child: Text('공지사항', style: theme.textTheme.titleSmall)),
          const Spacer(),
          TextButton(onPressed: () => context.push('/gw/board'), child: const Text('더 보기')),
        ]),
        Card(
          child: _error != null
              ? ListTile(dense: true, title: Text(_error!, style: const TextStyle(color: Brand.dangerText, fontSize: 13)), trailing: TextButton(onPressed: () => _load(api), child: const Text('다시 시도')))
              : items == null
                  ? const Padding(padding: EdgeInsets.all(18), child: Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))))
                  : items.isEmpty
                      ? const Padding(padding: EdgeInsets.all(18), child: Center(child: Text('새 글이 없습니다', style: TextStyle(color: Brand.muted))))
                      : Column(children: [
                          for (final (i, n) in items.indexed) ...[
                            if (i > 0) const Divider(height: 1),
                            ListTile(
                              dense: true,
                              onTap: () => context.push('/gw/board?art=${Uri.encodeComponent(n.artSeqNo)}'),
                              title: Text(n.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: n.read ? FontWeight.w600 : FontWeight.w800, color: Brand.navy)),
                              subtitle: Text([if (n.board.isNotEmpty) n.board, n.writer, n.writeDate.split(' ').first].where((s) => s.isNotEmpty).join(' · '), maxLines: 1, overflow: TextOverflow.ellipsis),
                              trailing: const Icon(Icons.chevron_right, color: Brand.faint),
                            ),
                          ],
                        ]),
        ),
      ]),
    );
  }
}
