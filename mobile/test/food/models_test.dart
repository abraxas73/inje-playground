import 'package:flutter_test/flutter_test.dart';
import 'package:playground/features/food/models.dart';

void main() {
  test('KakaoPlace — 카카오 응답(문자열 좌표·거리)을 읽는다', () {
    final p = KakaoPlace.fromJson({'id': '1', 'place_name': '김밥천국', 'category_name': '음식점 > 분식', 'category_group_code': 'FD6', 'category_group_name': '음식점', 'phone': '', 'address_name': '서울 강남구', 'road_address_name': '서울 강남구 테헤란로 1', 'x': '127.03', 'y': '37.50', 'place_url': 'http://place.map.kakao.com/1', 'distance': '120'});
    expect(p.distanceM, 120);
    expect(p.x, 127.03);
    expect(p.shortCategory, '분식');
    expect(p.address, '서울 강남구 테헤란로 1');
  });
  test('FoodFavorite — null 필드 허용, 즐겨찾기 POST 본문은 웹과 같은 키', () {
    final f = FoodFavorite.fromJson({'id': 'f1', 'place_id': '1', 'place_name': 'A', 'category_name': null, 'address': null, 'road_address': null, 'phone': null, 'place_url': null, 'x': null, 'y': null, 'created_at': '2026-10-03T00:00:00Z'});
    expect(f.placeId, '1');
    final body = favoriteBody(KakaoPlace.fromJson({'id': '2', 'place_name': 'B', 'category_name': 'c', 'category_group_code': 'FD6', 'category_group_name': '', 'phone': '02', 'address_name': 'a', 'road_address_name': 'r', 'x': '1', 'y': '2', 'place_url': 'u', 'distance': '5'}));
    expect(body.keys, containsAll(['place_id', 'place_name', 'category_name', 'address', 'road_address', 'phone', 'place_url', 'x', 'y']));
    expect(body['x'], 1.0);
  });
  test('FoodLocation·FoodFilters — 기기 저장 JSON 왕복, 기본값', () {
    final loc = FoodLocation(x: 127.0, y: 37.5, address: '판교');
    expect(FoodLocation.fromJson(loc.toJson()).address, '판교');
    final f = FoodFilters.defaults;
    expect(f.radius, 500);
    expect(f.maxResults, 30);
    expect(f.category, 'ALL');
    expect(FoodFilters.fromJson(f.copyWith(radius: 1000).toJson()).radius, 1000);
  });
}
