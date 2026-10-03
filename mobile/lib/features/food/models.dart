class KakaoPlace {
  KakaoPlace({required this.id, required this.name, required this.categoryName, required this.categoryGroupCode, required this.phone, required this.addressName, required this.roadAddressName, required this.x, required this.y, required this.placeUrl, required this.distanceM});
  final String id, name, categoryName, categoryGroupCode, phone, addressName, roadAddressName, placeUrl;
  final double x, y;
  final int distanceM;
  String get address => roadAddressName.isNotEmpty ? roadAddressName : addressName;
  String get shortCategory => categoryName.split('>').last.trim();
  factory KakaoPlace.fromJson(Map<String, dynamic> j) => KakaoPlace(
        id: '${j['id']}',
        name: j['place_name'] as String? ?? '',
        categoryName: j['category_name'] as String? ?? '',
        categoryGroupCode: j['category_group_code'] as String? ?? '',
        phone: j['phone'] as String? ?? '',
        addressName: j['address_name'] as String? ?? '',
        roadAddressName: j['road_address_name'] as String? ?? '',
        x: double.tryParse('${j['x']}') ?? 0,
        y: double.tryParse('${j['y']}') ?? 0,
        placeUrl: j['place_url'] as String? ?? '',
        distanceM: int.tryParse('${j['distance']}') ?? 0,
      );
}

class FoodFavorite {
  FoodFavorite({required this.id, required this.placeId, required this.name, this.categoryName, this.address, this.roadAddress, this.phone, this.placeUrl, this.x, this.y});
  final String id, placeId, name;
  final String? categoryName, address, roadAddress, phone, placeUrl;
  final double? x, y;
  factory FoodFavorite.fromJson(Map<String, dynamic> j) => FoodFavorite(
        id: '${j['id']}',
        placeId: '${j['place_id']}',
        name: j['place_name'] as String? ?? '',
        categoryName: j['category_name'] as String?,
        address: j['address'] as String?,
        roadAddress: j['road_address'] as String?,
        phone: j['phone'] as String?,
        placeUrl: j['place_url'] as String?,
        x: (j['x'] as num?)?.toDouble(),
        y: (j['y'] as num?)?.toDouble(),
      );
}

/// POST /api/food/favorites 본문 — 웹 FoodPage의 toggleFavorite와 같은 키
Map<String, dynamic> favoriteBody(KakaoPlace p) => {
      'place_id': p.id,
      'place_name': p.name,
      'category_name': p.categoryName,
      'address': p.addressName,
      'road_address': p.roadAddressName,
      'phone': p.phone,
      'place_url': p.placeUrl,
      'x': p.x,
      'y': p.y,
    };

class FoodLocation {
  FoodLocation({required this.x, required this.y, required this.address});
  final double x, y; // x=경도, y=위도 (카카오 규약)
  final String address;
  Map<String, dynamic> toJson() => {'x': x, 'y': y, 'address': address};
  factory FoodLocation.fromJson(Map<String, dynamic> j) => FoodLocation(x: (j['x'] as num).toDouble(), y: (j['y'] as num).toDouble(), address: j['address'] as String? ?? '');
}

class FoodFilters {
  const FoodFilters({required this.category, required this.subCategory, required this.detailCategory, required this.radius, required this.maxResults});
  final String category; // ALL | FD6 | CE7
  final String subCategory, detailCategory;
  final int radius, maxResults;
  static const defaults = FoodFilters(category: 'ALL', subCategory: '', detailCategory: '', radius: 500, maxResults: 30);
  FoodFilters copyWith({String? category, String? subCategory, String? detailCategory, int? radius, int? maxResults}) => FoodFilters(
        category: category ?? this.category,
        subCategory: subCategory ?? this.subCategory,
        detailCategory: detailCategory ?? this.detailCategory,
        radius: radius ?? this.radius,
        maxResults: maxResults ?? this.maxResults,
      );
  Map<String, dynamic> toJson() => {'category': category, 'subCategory': subCategory, 'detailCategory': detailCategory, 'radius': radius, 'maxResults': maxResults};
  factory FoodFilters.fromJson(Map<String, dynamic> j) => FoodFilters(
        category: j['category'] as String? ?? 'ALL',
        subCategory: j['subCategory'] as String? ?? '',
        detailCategory: j['detailCategory'] as String? ?? '',
        radius: (j['radius'] as num?)?.toInt() ?? 500,
        maxResults: (j['maxResults'] as num?)?.toInt() ?? 30,
      );
}
