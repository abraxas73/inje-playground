import 'dart:convert';

/// 서버 `GET /api/mobile/release` 응답에서 자기 플랫폼 블록만 읽는다. 형식이 틀리면 null(업데이트 안내 없음).
class ReleaseInfo {
  const ReleaseInfo({required this.version, required this.build, this.url});
  final String version;
  final int build;

  /// Android: APK 서명 URL(600초) · iOS: TestFlight 링크. 없으면 웹 /apps 안내.
  final String? url;
}

/// macOS/Windows용 최신 설치본. URL은 짧게 만료되는 서명 링크다.
class DesktopReleaseInfo {
  const DesktopReleaseInfo({
    required this.version,
    required this.url,
    this.update,
    this.bytes,
  });
  final String version;
  final String url;
  final DesktopUpdateMetadata? update;

  /// 설치 파일 크기(바이트). Linux 설치기가 내려받은 파일을 검증할 때 쓴다.
  final int? bytes;
}

class DesktopUpdateMetadata {
  const DesktopUpdateMetadata({
    required this.build,
    required this.edSignature,
    required this.minimumOS,
  });
  final int build;
  final String edSignature;
  final String minimumOS;
  bool get isValid {
    if (build <= 0 ||
        !RegExp(r'^[A-Za-z0-9+/]{86}==$').hasMatch(edSignature) ||
        !RegExp(r'^\d{1,5}\.\d{1,5}(?:\.\d{1,5})?$').hasMatch(minimumOS)) {
      return false;
    }
    try {
      return base64Encode(base64Decode(edSignature)) == edSignature;
    } catch (_) {
      return false;
    }
  }
}

ReleaseInfo? parseRelease(dynamic json, {required bool android}) {
  if (json is! Map) return null;
  final block = json[android ? 'android' : 'ios'];
  if (block is! Map) return null;
  final version = block['version'];
  final build = block['build'];
  final b = build is int
      ? build
      : (build is String ? int.tryParse(build) : null);
  if (version is! String || version.isEmpty || b == null || b <= 0) return null;
  final url = block['url'];
  return ReleaseInfo(
    version: version,
    build: b,
    url: url is String && url.isNotEmpty ? url : null,
  );
}

/// 앱 빌드 0은 "모름"(dart-define 없는 개발 빌드) — 안내하지 않는다.
bool hasUpdate(ReleaseInfo? r, int appBuild) =>
    appBuild > 0 && r != null && r.build > appBuild;

final _semanticVersion = RegExp(r'^(\d+)\.(\d+)\.(\d+)$');

DesktopReleaseInfo? parseDesktopRelease(dynamic json) {
  if (json is! Map) return null;
  final version = json['version'];
  final url = json['url'];
  if (version is! String ||
      !_semanticVersion.hasMatch(version) ||
      url is! String) {
    return null;
  }
  final uri = Uri.tryParse(url);
  if (uri == null ||
      !uri.hasAuthority ||
      (uri.scheme != 'http' && uri.scheme != 'https')) {
    return null;
  }
  final u = json['update'];
  DesktopUpdateMetadata? update;
  if (u is Map &&
      u['build'] is int &&
      u['edSignature'] is String &&
      u['minimumOS'] is String) {
    final candidate = DesktopUpdateMetadata(
      build: u['build'] as int,
      edSignature: u['edSignature'] as String,
      minimumOS: u['minimumOS'] as String,
    );
    if (candidate.isValid) update = candidate;
  }
  final b = json['bytes'];
  return DesktopReleaseInfo(
    version: version,
    url: url,
    update: update,
    bytes: b is int && b > 0 ? b : null,
  );
}

/// 개발 빌드나 정식 `x.y.z`가 아닌 앱은 안내하지 않는다.
bool hasDesktopUpdate(DesktopReleaseInfo? release, String appVersion) {
  if (release == null) return false;
  final current = _semanticVersion.firstMatch(appVersion);
  final latest = _semanticVersion.firstMatch(release.version);
  if (current == null || latest == null) return false;
  for (var i = 1; i <= 3; i++) {
    final comparison = int.parse(
      latest.group(i)!,
    ).compareTo(int.parse(current.group(i)!));
    if (comparison != 0) return comparison > 0;
  }
  return false;
}

/// 더보기 "앱 버전" 표시: `1.0.0 (1)`, 개발 빌드는 `dev`.
String versionLabel(String version, int build) =>
    build > 0 ? '$version ($build)' : 'dev';
