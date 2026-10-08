#!/bin/bash
# Local QA artifact only. Distribution signing/notarization is a separate gate.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then
  echo "This build requires macOS and Xcode." >&2
  exit 1
fi
if [[ "${1:-}" != --preview ]]; then
  echo "Usage: $0 --preview (local QA only; not notarized for distribution)" >&2
  exit 1
fi
flutter pub get --enforce-lockfile
PATH="$PWD/scripts/macos-toolchain:$PATH" flutter build macos --release
mac_app="$PWD/build/macos/Build/Products/Release/INNOGRID.app"
mac_output="$PWD/build/macos/package"
mac_stage="$(mktemp -d "${TMPDIR:-/tmp}/innocrew-dmg.XXXXXX")"
trap 'rm -rf "$mac_stage"' EXIT
mkdir -p "$mac_output"
ditto "$mac_app" "$mac_stage/INNOGRID.app"
ln -s /Applications "$mac_stage/Applications"
cat > "$mac_stage/LOCAL-PREVIEW.txt" <<'NOTICE'
이노크루 macOS 로컬 검증용 빌드
Developer ID 서명과 Apple 공증을 완료한 배포본이 아닙니다.
다른 직원에게 배포하지 마세요. 보안 설정을 끄지 마세요.
NOTICE
mac_dmg="$mac_output/INNOGRID-macOS-local-preview.dmg"
hdiutil create -volname 'INNOGRID Local Preview' -srcfolder "$mac_stage" -ov -format UDZO "$mac_dmg"
hdiutil verify "$mac_dmg"
shasum -a 256 "$mac_dmg" > "$mac_dmg.sha256"
echo "Local preview: $mac_dmg"
