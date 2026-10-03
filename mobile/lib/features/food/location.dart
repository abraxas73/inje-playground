import 'package:geolocator/geolocator.dart';

class LocationDenied implements Exception {
  LocationDenied(this.message, {this.canOpenSettings = false});
  final String message;
  final bool canOpenSettings;
}

/// 현재 위치(경도 x, 위도 y). 권한 거부·서비스 꺼짐은 LocationDenied로 — 화면이 주소 검색으로 유도한다.
Future<({double x, double y})> currentPosition() async {
  if (!await Geolocator.isLocationServiceEnabled()) throw LocationDenied('위치 서비스가 꺼져 있습니다.', canOpenSettings: true);
  var p = await Geolocator.checkPermission();
  if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
  if (p == LocationPermission.denied || p == LocationPermission.deniedForever) {
    throw LocationDenied('위치 권한이 없습니다. 주소로 찾아 주세요.', canOpenSettings: p == LocationPermission.deniedForever);
  }
  final pos = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 10)));
  return (x: pos.longitude, y: pos.latitude);
}
