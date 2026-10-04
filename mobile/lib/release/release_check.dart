/// 서버 `GET /api/mobile/release` 응답에서 자기 플랫폼 블록만 읽는다. 형식이 틀리면 null(업데이트 안내 없음).
class ReleaseInfo {
  const ReleaseInfo({required this.version, required this.build, this.url});
  final String version;
  final int build;
  /// Android: APK 서명 URL(600초) · iOS: TestFlight 링크. 없으면 웹 /apps 안내.
  final String? url;
}

ReleaseInfo? parseRelease(dynamic json, {required bool android}) {
  if (json is! Map) return null;
  final block = json[android ? 'android' : 'ios'];
  if (block is! Map) return null;
  final version = block['version'];
  final build = block['build'];
  final b = build is int ? build : (build is String ? int.tryParse(build) : null);
  if (version is! String || version.isEmpty || b == null || b <= 0) return null;
  final url = block['url'];
  return ReleaseInfo(version: version, build: b, url: url is String && url.isNotEmpty ? url : null);
}

/// 앱 빌드 0은 "모름"(dart-define 없는 개발 빌드) — 안내하지 않는다.
bool hasUpdate(ReleaseInfo? r, int appBuild) => appBuild > 0 && r != null && r.build > appBuild;

/// 더보기 "앱 버전" 표시: `1.0.0 (1)`, 개발 빌드는 `dev`.
String versionLabel(String version, int build) => build > 0 ? '$version ($build)' : 'dev';
