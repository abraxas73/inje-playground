import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'models.dart';

/// 웹 localStorage(food-location·food-filters)와 같은 역할 — 기기별, 웹과 동기화하지 않는다.
class FoodPrefs {
  static const _loc = 'food-location', _filters = 'food-filters';
  static Future<FoodLocation?> location() async {
    final s = (await SharedPreferences.getInstance()).getString(_loc);
    return s == null ? null : FoodLocation.fromJson(jsonDecode(s) as Map<String, dynamic>);
  }
  static Future<void> saveLocation(FoodLocation l) async => (await SharedPreferences.getInstance()).setString(_loc, jsonEncode(l.toJson()));
  static Future<FoodFilters> filters() async {
    final s = (await SharedPreferences.getInstance()).getString(_filters);
    return s == null ? FoodFilters.defaults : FoodFilters.fromJson(jsonDecode(s) as Map<String, dynamic>);
  }
  static Future<void> saveFilters(FoodFilters f) async => (await SharedPreferences.getInstance()).setString(_filters, jsonEncode(f.toJson()));
}
