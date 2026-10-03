import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../api/client.dart';
import 'models.dart';

class FoodRepository {
  FoodRepository(this._api);
  final ApiClient _api;

  /// GET /api/food/search — 웹 FoodPage와 같은 쿼리(category 'ALL'도 그대로 보낸다, 서버가 FD6·CE7를 합친다). 응답 `{documents, meta}`.
  Future<List<KakaoPlace>> search({required FoodLocation loc, required FoodFilters f, String keyword = ''}) async {
    final j = await _api.getJson('/api/food/search', query: {
      'x': '${loc.x}',
      'y': '${loc.y}',
      'radius': '${f.radius}',
      'category_group_code': f.category,
      if (f.category != 'ALL' && f.subCategory.isNotEmpty) 'sub_category': f.subCategory,
      if (f.category != 'ALL' && f.detailCategory.isNotEmpty) 'detail_category': f.detailCategory,
      if (keyword.isNotEmpty) 'keyword': keyword,
      'max_results': '${f.maxResults}',
    }) as Map<String, dynamic>;
    return ((j['documents'] as List?) ?? []).map((e) => KakaoPlace.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// GET /api/food/categories → string[]
  Future<List<String>> categories(String group, {String sub = ''}) async =>
      ((await _api.getJson('/api/food/categories', query: {'category_group_code': group, if (sub.isNotEmpty) 'sub_category': sub})) as List).cast<String>();

  /// GET /api/food/geocode?query → GeoResult[] {address, road_address, x, y, type, place_name?}. 라벨은 웹 AddressSearchModal과 같이 "건물명 (도로명주소)".
  Future<List<FoodLocation>> geocode(String query) async {
    final list = (await _api.getJson('/api/food/geocode', query: {'query': query})) as List;
    return list.map((e) {
      final m = e as Map<String, dynamic>;
      final road = (m['road_address'] as String?)?.isNotEmpty == true ? m['road_address'] as String : (m['address'] as String? ?? '');
      final label = m['type'] == 'place' && (m['place_name'] as String?)?.isNotEmpty == true ? '${m['place_name']} ($road)' : road;
      return FoodLocation(x: double.parse('${m['x']}'), y: double.parse('${m['y']}'), address: label);
    }).toList();
  }

  /// GET /api/food/reverse-geocode?x&y → {address: string|null}
  Future<String?> reverseGeocode(double x, double y) async =>
      ((await _api.getJson('/api/food/reverse-geocode', query: {'x': '$x', 'y': '$y'})) as Map<String, dynamic>)['address'] as String?;

  Future<List<FoodFavorite>> favorites() async => ((await _api.getJson('/api/food/favorites')) as List).map((e) => FoodFavorite.fromJson(e as Map<String, dynamic>)).toList();
  Future<void> addFavorite(KakaoPlace p) => _api.postJson('/api/food/favorites', favoriteBody(p));
  Future<void> removeFavorite(String placeId) => _api.deleteJson('/api/food/favorites', query: {'place_id': placeId});

  /// POST /api/food/decide — 웹 FoodRecommendModal과 같은 본문. 응답 {decision, webhook_sent, personal_messages_sent, dm_errors}
  Future<Map<String, dynamic>> decide({required KakaoPlace place, required List<String> members, required bool sendToChannel}) async =>
      (await _api.postJson('/api/food/decide', {'place_name': place.name, 'place_url': place.placeUrl, 'category_name': place.categoryName, 'address': place.address, 'members': members, 'send_to_channel': sendToChannel})) as Map<String, dynamic>;

  /// POST /api/food/payco {address, distance} → PAYCO 응답 `{result: [{mrcCd, name, categoryName, address, telNo, distance, latitude, longitude}]}`. 웹과 같이 KakaoPlace로 변환.
  /// address는 웹 searchPayco처럼 "건물명 (도로명주소)"면 괄호 안만 보낸다.
  Future<List<KakaoPlace>> payco({required String address, required int distance}) async {
    final paren = RegExp(r'\(([^)]+)\)\s*$').firstMatch(address);
    final j = await _api.postJson('/api/food/payco', {'address': paren?.group(1)?.trim() ?? address, 'distance': distance}) as Map<String, dynamic>;
    return ((j['result'] as List?) ?? []).map((e) {
      final m = e as Map<String, dynamic>;
      return KakaoPlace(
        id: 'payco_${m['mrcCd']}',
        name: m['name'] as String? ?? '',
        categoryName: m['categoryName'] as String? ?? '',
        categoryGroupCode: '',
        phone: m['telNo'] as String? ?? '',
        addressName: m['address'] as String? ?? '',
        roadAddressName: m['address'] as String? ?? '',
        x: double.tryParse('${m['longitude']}') ?? 0,
        y: double.tryParse('${m['latitude']}') ?? 0,
        placeUrl: '',
        distanceM: (m['distance'] as num?)?.toInt() ?? 0,
      );
    }).toList();
  }
}

final foodRepositoryProvider = Provider((ref) => FoodRepository(ref.watch(apiClientProvider)));
