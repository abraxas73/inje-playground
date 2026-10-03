import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../api/client.dart';
import '../../app/brand.dart';
import '../../app/theme.dart';
import 'location.dart';
import 'models.dart';
import 'prefs.dart';
import 'recommend_sheet.dart';
import 'repository.dart';

class FoodScreen extends ConsumerStatefulWidget {
  const FoodScreen({super.key});
  @override
  ConsumerState<FoodScreen> createState() => _FoodScreenState();
}

class _FoodScreenState extends ConsumerState<FoodScreen> {
  FoodLocation? _loc;
  FoodFilters _f = FoodFilters.defaults;
  List<KakaoPlace> _places = [];
  List<FoodFavorite> _favs = [];
  List<KakaoPlace> _payco = [];
  bool _busy = false, _showFavs = false;
  String? _error;
  final _keyword = TextEditingController();
  FoodRepository get _repo => ref.read(foodRepositoryProvider);

  @override
  void initState() {
    super.initState();
    _init();
  }

  @override
  void dispose() {
    _keyword.dispose();
    super.dispose();
  }

  Future<void> _init() async {
    _f = await FoodPrefs.filters();
    _loc = await FoodPrefs.location();
    if (_loc == null) {
      await _useCurrentLocation();
    } else if (mounted) {
      setState(() {});
    }
    await _loadFavorites();
  }

  Future<void> _useCurrentLocation() async {
    setState(() { _busy = true; _error = null; });
    try {
      final p = await currentPosition();
      final addr = await _repo.reverseGeocode(p.x, p.y) ?? '${p.y.toStringAsFixed(5)}, ${p.x.toStringAsFixed(5)}'; // 웹과 같이 주소를 못 찾으면 좌표 문자열
      _loc = FoodLocation(x: p.x, y: p.y, address: addr);
      await FoodPrefs.saveLocation(_loc!);
    } on LocationDenied catch (e) {
      _error = e.message;
      if (e.canOpenSettings && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message), action: SnackBarAction(label: '설정', onPressed: () => Geolocator.openLocationSettings())));
      }
    } on ApiException catch (e) {
      _error = e.message;
    } catch (e) {
      _error = locationFailureMessage(e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _search() async {
    final loc = _loc;
    if (loc == null) { setState(() => _error = '위치를 먼저 정해 주세요.'); return; }
    setState(() { _busy = true; _error = null; _showFavs = false; _payco = []; });
    try {
      _places = await _repo.search(loc: loc, f: _f, keyword: _keyword.text.trim());
    } on ApiException catch (e) {
      _error = e.message;
    } catch (e) {
      _error = '$e';
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _searchPayco() async {
    final loc = _loc;
    if (loc == null || loc.address.isEmpty || RegExp(r'^\d+\.\d+\s*,\s*\d+\.\d+$').hasMatch(loc.address.trim())) {
      setState(() => _error = "PAYCO 검색은 주소가 필요합니다. '주소 변경'으로 주소를 설정해주세요.");
      return;
    }
    setState(() { _busy = true; _error = null; });
    try {
      _payco = await _repo.payco(address: loc.address, distance: _f.radius);
      if (_payco.isEmpty) _error = '주변에 PAYCO 식권 가맹점이 없습니다. 반경을 넓혀보세요.';
    } on ApiException catch (e) {
      _error = e.message;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _loadFavorites() async {
    try {
      _favs = await _repo.favorites();
      if (mounted) setState(() {});
    } catch (_) {}
  }

  bool _isFav(String id) => _favs.any((f) => f.placeId == id);

  Future<void> _toggleFav(KakaoPlace p) async {
    try {
      if (_isFav(p.id)) {
        await _repo.removeFavorite(p.id);
      } else {
        await _repo.addFavorite(p);
      }
      await _loadFavorites();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _changeAddress() async {
    final picked = await showDialog<FoodLocation>(context: context, builder: (_) => _AddressDialog(search: _repo.geocode));
    if (picked != null) {
      _loc = picked;
      await FoodPrefs.saveLocation(picked);
      setState(() {});
    }
  }

  Future<void> _openFilters() async {
    final f = await showModalBottomSheet<FoodFilters>(context: context, isScrollControlled: true, builder: (_) => _FilterSheet(initial: _f, categories: _repo.categories));
    if (f != null) {
      _f = f;
      await FoodPrefs.saveFilters(f);
      setState(() {});
    }
  }

  String get _filterSummary {
    final cat = _f.category == 'ALL' ? '전체' : _f.category == 'FD6' ? '음식점' : '카페';
    return '반경 ${_f.radius}m · $cat${_f.subCategory.isNotEmpty ? ' · ${_f.subCategory}' : ''}${_f.detailCategory.isNotEmpty ? ' · ${_f.detailCategory}' : ''}';
  }

  @override
  Widget build(BuildContext context) {
    final list = _showFavs ? _favs.map(_favToPlace).toList() : _places;
    final theme = Theme.of(context);
    final showPayco = !_showFavs && _payco.isNotEmpty;
    return Scaffold(
      appBar: BrandHeader(title: '뭐 먹지', actions: [SquareIconButton(icon: Icons.tune, tooltip: '필터', onPressed: _openFilters)]),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
          child: Column(children: [
            Card(
              child: InkWell(
                onTap: _changeAddress,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 12, 6, 12),
                  child: Row(children: [
                    const TintIcon(Icons.place_outlined),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(_loc?.address ?? '위치 없음 — 눌러서 주소 입력', style: theme.textTheme.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                        const SizedBox(height: 3),
                        Text(_filterSummary, style: theme.textTheme.bodySmall),
                      ]),
                    ),
                    IconButton(icon: const Icon(Icons.my_location, size: 20), tooltip: '현재 위치', onPressed: _busy ? null : _useCurrentLocation),
                  ]),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: TextField(controller: _keyword, decoration: const InputDecoration(hintText: '키워드 (선택) — 예: 국밥, 카페', prefixIcon: Icon(Icons.search, size: 20)), onSubmitted: (_) => _search())),
              const SizedBox(width: 8),
              FilledButton(onPressed: _busy ? null : _search, child: const Text('검색')),
            ]),
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
              SegmentedButton<bool>(
                showSelectedIcon: false,
                segments: const [ButtonSegment(value: false, label: Text('검색 결과')), ButtonSegment(value: true, label: Text('즐겨찾기'))],
                selected: {_showFavs},
                onSelectionChanged: (s) => setState(() => _showFavs = s.first),
              ),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40), padding: const EdgeInsets.symmetric(horizontal: 12), textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                onPressed: _busy ? null : _searchPayco,
                icon: const Icon(Icons.credit_card, size: 16),
                label: const Text('PAYCO'),
              ),
              FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: Brand.navy, minimumSize: const Size(0, 40), padding: const EdgeInsets.symmetric(horizontal: 14), textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                onPressed: _places.isEmpty ? null : () => showRecommendSheet(context, ref, _places),
                icon: const Icon(Icons.auto_awesome, size: 16, color: Brand.sky),
                label: const Text('오늘 뭐 먹지'),
              ),
            ]),
          ]),
        ),
        if (_busy) const Padding(padding: EdgeInsets.fromLTRB(20, 12, 20, 0), child: LinearProgressIndicator(minHeight: 2, borderRadius: BorderRadius.all(Radius.circular(2)))),
        if (_error != null) Padding(padding: const EdgeInsets.fromLTRB(20, 12, 20, 0), child: Text(_error!, style: const TextStyle(fontSize: 13, color: Brand.dangerText))),
        Expanded(
          child: ListView(padding: const EdgeInsets.fromLTRB(20, 16, 20, 20), children: [
            if (showPayco) ...[
              _sectionLabel('PAYCO 식권 가맹점 ${_payco.length}곳'),
              for (final p in _payco) _tile(p),
            ],
            if (list.isEmpty && !_busy && !showPayco)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 48),
                child: Column(children: [
                  TintIcon(_showFavs ? Icons.favorite_border : Icons.restaurant_outlined, size: 56, color: Brand.muted, background: Brand.fill),
                  const SizedBox(height: 12),
                  Text(_showFavs ? '즐겨찾기가 없습니다.' : '검색을 눌러 주변 식당·카페를 찾아보세요.', textAlign: TextAlign.center, style: theme.textTheme.bodySmall),
                ]),
              ),
            if (list.isNotEmpty) _sectionLabel(_showFavs ? '즐겨찾기 ${list.length}곳' : '검색 결과 ${list.length}곳', trailing: _showFavs ? null : '가까운 순'),
            for (final p in list) _tile(p),
          ]),
        ),
      ]),
    );
  }

  Widget _sectionLabel(String text, {String? trailing}) => Padding(
        padding: const EdgeInsets.fromLTRB(0, 4, 0, 8),
        child: Row(children: [
          Text(text, style: Theme.of(context).textTheme.titleSmall),
          const Spacer(),
          if (trailing != null) Text(trailing, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 12)),
        ]),
      );

  Widget _tile(KakaoPlace p) {
    final fav = _isFav(p.id);
    final meta = [p.shortCategory, if (p.distanceM > 0) '${p.distanceM}m', p.address].where((s) => s.isNotEmpty).join(' · ');
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Card(
        child: InkWell(
          onTap: p.placeUrl.isEmpty ? null : () => launchUrl(Uri.parse(p.placeUrl), mode: LaunchMode.externalApplication),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 4, 10),
            child: Row(children: [
              InitialBadge(p.name, size: 48),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(p.name, style: Theme.of(context).textTheme.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 3),
                  Text(meta, style: Theme.of(context).textTheme.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                ]),
              ),
              if (p.phone.isNotEmpty) IconButton(icon: const Icon(Icons.call_outlined, size: 20), tooltip: '전화', onPressed: () => launchUrl(Uri.parse('tel:${p.phone.replaceAll('-', '')}'))),
              IconButton(icon: Icon(fav ? Icons.favorite : Icons.favorite_border, size: 20, color: fav ? Brand.danger : Brand.faint), tooltip: '즐겨찾기', onPressed: () => _toggleFav(p)),
            ]),
          ),
        ),
      ),
    );
  }

  KakaoPlace _favToPlace(FoodFavorite f) => KakaoPlace(
        id: f.placeId, name: f.name, categoryName: f.categoryName ?? '', categoryGroupCode: '', phone: f.phone ?? '',
        addressName: f.address ?? '', roadAddressName: f.roadAddress ?? '', x: f.x ?? 0, y: f.y ?? 0, placeUrl: f.placeUrl ?? '', distanceM: 0,
      );
}

class _AddressDialog extends StatefulWidget {
  const _AddressDialog({required this.search});
  final Future<List<FoodLocation>> Function(String query) search;
  @override
  State<_AddressDialog> createState() => _AddressDialogState();
}

class _AddressDialogState extends State<_AddressDialog> {
  final _q = TextEditingController();
  List<FoodLocation> _results = [];
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  Future<void> _run() async {
    final q = _q.text.trim();
    if (q.isEmpty) return;
    setState(() { _busy = true; _error = null; });
    try {
      _results = await widget.search(q);
      if (_results.isEmpty) _error = '검색 결과가 없습니다.';
    } on ApiException catch (e) {
      _error = e.message;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('주소 변경'),
        content: SizedBox(
          width: double.maxFinite,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: _q, autofocus: true, decoration: InputDecoration(hintText: '건물명·도로명·지번', suffixIcon: IconButton(icon: const Icon(Icons.search), onPressed: _run)), onSubmitted: (_) => _run()),
            if (_busy) const Padding(padding: EdgeInsets.all(12), child: LinearProgressIndicator()),
            if (_error != null) Padding(padding: const EdgeInsets.all(8), child: Text(_error!, style: const TextStyle(color: Colors.red))),
            Flexible(child: ListView(shrinkWrap: true, children: [for (final r in _results) ListTile(dense: true, title: Text(r.address), onTap: () => Navigator.pop(context, r))])),
          ]),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('닫기'))],
      );
}

/// 카테고리(전체/음식점/카페) → 세부 → 상세, 반경, 개수. 세부·상세는 카테고리가 ALL이 아닐 때만(웹과 같음).
class _FilterSheet extends StatefulWidget {
  const _FilterSheet({required this.initial, required this.categories});
  final FoodFilters initial;
  final Future<List<String>> Function(String group, {String sub}) categories;
  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  late FoodFilters _f = widget.initial;
  List<String> _subs = [], _details = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_f.category == 'ALL') {
      setState(() { _subs = []; _details = []; });
      return;
    }
    try {
      final subs = await widget.categories(_f.category);
      final details = _f.subCategory.isEmpty ? <String>[] : await widget.categories(_f.category, sub: _f.subCategory);
      if (mounted) setState(() { _subs = subs; _details = details; });
    } on ApiException catch (_) {
      if (mounted) setState(() { _subs = []; _details = []; });
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(20, 16, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('필터', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          SegmentedButton<String>(
            segments: const [ButtonSegment(value: 'ALL', label: Text('전체')), ButtonSegment(value: 'FD6', label: Text('음식점')), ButtonSegment(value: 'CE7', label: Text('카페'))],
            selected: {_f.category},
            onSelectionChanged: (v) {
              _f = _f.copyWith(category: v.first, subCategory: '', detailCategory: '');
              _load();
            },
          ),
          if (_subs.isNotEmpty)
            DropdownButtonFormField<String>(
              initialValue: _f.subCategory.isEmpty ? '' : _f.subCategory,
              decoration: const InputDecoration(labelText: '세부 분류'),
              items: [const DropdownMenuItem(value: '', child: Text('전체')), for (final c in _subs) DropdownMenuItem(value: c, child: Text(c))],
              onChanged: (v) {
                _f = _f.copyWith(subCategory: v ?? '', detailCategory: '');
                _load();
              },
            ),
          if (_details.isNotEmpty)
            DropdownButtonFormField<String>(
              initialValue: _f.detailCategory.isEmpty ? '' : _f.detailCategory,
              decoration: const InputDecoration(labelText: '상세 분류'),
              items: [const DropdownMenuItem(value: '', child: Text('전체')), for (final c in _details) DropdownMenuItem(value: c, child: Text(c))],
              onChanged: (v) => setState(() => _f = _f.copyWith(detailCategory: v ?? '')),
            ),
          const SizedBox(height: 12),
          const Text('반경'),
          Wrap(spacing: 8, children: [for (final r in const [300, 500, 1000, 2000]) ChoiceChip(label: Text('${r}m'), selected: _f.radius == r, onSelected: (_) => setState(() => _f = _f.copyWith(radius: r)))]),
          const SizedBox(height: 8),
          const Text('최대 개수'),
          Wrap(spacing: 8, children: [for (final n in const [30, 60, 100]) ChoiceChip(label: Text('$n'), selected: _f.maxResults == n, onSelected: (_) => setState(() => _f = _f.copyWith(maxResults: n)))]),
          const SizedBox(height: 16),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(context, _f), child: const Text('적용'))),
        ]),
      );
}
