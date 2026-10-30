#!/usr/bin/env bash
# Linux(Ubuntu) .deb 패키지를 만든다 — 결과 build/linux/deb/INNOGRID-Linux-<버전>_amd64.deb
# 설치 위치 /opt/innocrew, 실행 /usr/bin/innocrew, innogrid:// 주소는 .desktop의 MimeType으로 이 앱에 연결된다.
# 사용: mobile/scripts/build-linux-deb.sh [--skip-build]
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
line="$(sed -n 's/^version: //p' pubspec.yaml)"
version="${line%%+*}" build="${line##*+}"
[ -n "$version" ] && [ -n "$build" ] || { echo "pubspec.yaml version을 읽지 못했다" >&2; exit 1; }

# 업데이트 서명 공개 키(raw 32바이트 base64). 아직 없으면 빈 값 — 그 앱은 업데이트 서명을 통과시키지 않는다.
update_key="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("linux") or "")' desktop-update-public-keys.json)"

if [ "${1:-}" != "--skip-build" ]; then
  flutter pub get --enforce-lockfile
  flutter build linux --release --dart-define=APP_VERSION="$version" --dart-define=APP_BUILD="$build" --dart-define=INNOCREW_LINUX_UPDATE_KEY="$update_key"
fi
bundle="$root/build/linux/x64/release/bundle"
[ -x "$bundle/playground" ] || { echo "릴리스 빌드가 없다: $bundle" >&2; exit 1; }

out="$root/build/linux/deb"
deb="$out/INNOGRID-Linux-${version}_amd64.deb"
stage="$out/innocrew_${version}_amd64"
rm -rf "$stage" && mkdir -p "$stage/DEBIAN" "$stage/opt/innocrew" "$stage/usr/bin" "$stage/usr/share/applications" "$stage/usr/share/pixmaps"
cp -a "$bundle/." "$stage/opt/innocrew/"
ln -s /opt/innocrew/playground "$stage/usr/bin/innocrew"
sed "s|@EXEC@|/opt/innocrew/playground|" linux/packaging/com.innogrid.playground.desktop > "$stage/usr/share/applications/com.innogrid.playground.desktop"
cp assets/brand/app_icon.png "$stage/usr/share/pixmaps/com.innogrid.playground.png"

# 의존 패키지: 실제 링크된 시스템 라이브러리에서 계산한다(번들 안 lib/는 제외)
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/debian"
printf 'Source: innocrew\n\nPackage: innocrew\nArchitecture: amd64\n' > "$work/debian/control"
mapfile -t elfs < <(find "$stage/opt/innocrew" -type f \( -name playground -o -name '*.so' \))
depends="$(cd "$work" && dpkg-shlibdeps -O -l"$stage/opt/innocrew/lib" --ignore-missing-info "${elfs[@]}" 2>/dev/null | sed -n 's/^shlibs:Depends=//p')"
[ -n "$depends" ] || { echo "의존 패키지를 계산하지 못했다" >&2; exit 1; }
# 앱이 서명 확인(openssl)과 관리자 인증 설치(pkexec)에 쓰는 도구
depends="${depends}, openssl, pkexec"

cat > "$stage/DEBIAN/control" <<EOF
Package: innocrew
Version: ${version}+${build}
Section: net
Priority: optional
Architecture: amd64
Depends: ${depends}
Maintainer: INNOGRID <dgs@innogrid.com>
Homepage: https://innocrew.innogrid.com
Description: INNOCREW - 이노그리드 사내 포털 데스크톱 앱
 이노봇, 아마란스(메일·결재·일정·메신저), Teams, SharePoint, Confluence를 한 곳에서 쓴다.
EOF
# 설치·삭제 후 .desktop 목록을 갱신해 innogrid:// 연결을 바로 반영한다
for s in postinst postrm; do
  printf '#!/bin/sh\nset -e\ncommand -v update-desktop-database >/dev/null && update-desktop-database -q /usr/share/applications || true\n' > "$stage/DEBIAN/$s"
  chmod 755 "$stage/DEBIAN/$s"
done

dpkg-deb --build --root-owner-group "$stage" "$deb" >/dev/null
echo "$deb"
