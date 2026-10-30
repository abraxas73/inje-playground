#!/usr/bin/env bash
# 개발용: 이 PC의 빌드 결과를 innogrid:// 주소 처리 프로그램으로 등록한다(브라우저 로그인 복귀용).
# 사용: mobile/scripts/linux-register-dev.sh [debug|release]
set -euo pipefail
mode="${1:-debug}"
root="$(cd "$(dirname "$0")/.." && pwd)"
bin="$root/build/linux/x64/$mode/bundle/playground"
[ -x "$bin" ] || { echo "빌드 결과가 없다: $bin (flutter build linux --$mode 먼저)" >&2; exit 1; }
dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$dir"
sed "s|@EXEC@|$bin|" "$root/linux/packaging/com.innogrid.playground.desktop" > "$dir/com.innogrid.playground.desktop"
update-desktop-database "$dir"
xdg-mime default com.innogrid.playground.desktop x-scheme-handler/innogrid
echo "등록 완료: $(xdg-mime query default x-scheme-handler/innogrid)"
