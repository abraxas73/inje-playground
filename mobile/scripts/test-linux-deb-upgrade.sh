#!/usr/bin/env bash
# Linux .deb 업그레이드를 ubuntu:24.04 컨테이너에서 확인한다.
#  1. 같은 .deb의 Version만 낮춘 사본을 설치한다(이전 버전 역할).
#  2. 실제 .deb를 apt-get install로 설치해 버전·실행 파일을 확인한다(앱이 pkexec로 하는 설치와 같은 명령, 여기서는 root).
#  3. <deb>.update.json의 서명을 앱과 같은 openssl 명령으로 확인하고, 1바이트 바꾼 사본은 거부되는지 확인한다.
# 사용: mobile/scripts/test-linux-deb-upgrade.sh <deb>
#   SKIP_SIGNATURE=1 이면 3단계를 건너뛴다(서명 키가 없는 PC용).
#   서명 확인에 쓸 공개 키는 기본으로 desktop-update-public-keys.json의 linux 값이다.
#   LINUX_UPDATE_PUBLIC_KEY 환경변수(raw 32바이트 base64)로 바꿀 수 있다.
set -euo pipefail
deb="${1:?사용: test-linux-deb-upgrade.sh <deb>}"
[ -f "$deb" ] || { echo "파일이 없다: $deb" >&2; exit 1; }
deb="$(cd "$(dirname "$deb")" && pwd)/$(basename "$deb")"
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$deb" "$work/new.deb"

if [ "${SKIP_SIGNATURE:-}" != "1" ]; then
  [ -f "$deb.update.json" ] || { echo "서명 파일이 없다: $deb.update.json" >&2; exit 1; }
  cp "$deb.update.json" "$work/update.json"
  key="${LINUX_UPDATE_PUBLIC_KEY:-$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("linux") or "")' "$root/desktop-update-public-keys.json")}"
  [ -n "$key" ] || { echo "linux 공개 키가 없다(desktop-update-public-keys.json)" >&2; exit 1; }
  printf '%s' "$key" > "$work/key.b64"
  # 서명(base64 → 64바이트)은 호스트에서 풀어 둔다
  python3 -c 'import base64,json,sys; s=base64.b64decode(json.load(open(sys.argv[1]))["edSignature"]); assert len(s)==64; open(sys.argv[2],"wb").write(s)' "$work/update.json" "$work/new.deb.sig"
fi

cat > "$work/inner.sh" <<'INNER'
#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
mkdir /t && cp /work/* /t/ && cd /t   # root 소유 파일이 호스트 폴더에 남지 않게 컨테이너 안에서 작업한다
apt-get update -qq
apt-get install -y -qq dpkg-dev openssl >/dev/null
new_version="$(dpkg-deb -f new.deb Version)"
echo "새 버전: $new_version"

# 이전 버전 사본: control의 Version만 낮춘다
mkdir old && dpkg-deb -R new.deb old
sed -i 's/^Version: .*/Version: 0.0.1+1/' old/DEBIAN/control
dpkg-deb -b --root-owner-group old old.deb >/dev/null
apt-get install -y -qq ./old.deb >/dev/null
[ "$(dpkg-query -W -f='${Version}' innocrew)" = "0.0.1+1" ] || { echo "이전 버전 설치 실패" >&2; exit 1; }
echo "이전 버전 설치 확인: 0.0.1+1"

# 앱이 pkexec로 실행하는 것과 같은 명령(여기서는 root)
/usr/bin/apt-get install -y ./new.deb >/dev/null
[ "$(dpkg-query -W -f='${Version}' innocrew)" = "$new_version" ] || { echo "업그레이드 후 버전이 다르다" >&2; exit 1; }
[ -x /opt/innocrew/playground ] || { echo "/opt/innocrew/playground가 없다" >&2; exit 1; }
[ -L /usr/bin/innocrew ] || { echo "/usr/bin/innocrew가 없다" >&2; exit 1; }
echo "업그레이드 확인: $new_version"

if [ -f key.b64 ]; then
  # raw 32바이트 키 → SPKI PEM(머리 302a300506032b6570032100)
  { printf '\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00'; base64 -d key.b64; } | openssl pkey -pubin -inform DER -outform PEM -out key.pem
  openssl pkeyutl -verify -pubin -inkey key.pem -rawin -in new.deb -sigfile new.deb.sig
  echo "서명 확인 통과"
  cp new.deb bad.deb
  printf '\x00' | dd of=bad.deb bs=1 seek=100 conv=notrunc status=none
  cmp -s new.deb bad.deb && { echo "변조 사본이 원본과 같다" >&2; exit 1; }
  cp new.deb.sig bad.deb.sig
  if openssl pkeyutl -verify -pubin -inkey key.pem -rawin -in bad.deb -sigfile bad.deb.sig >/dev/null 2>&1; then
    echo "변조한 파일의 서명이 통과했다" >&2; exit 1
  fi
  echo "변조 사본 거부 확인"
else
  echo "서명 확인 건너뜀(SKIP_SIGNATURE=1)"
fi
INNER
chmod +x "$work/inner.sh"
docker run --rm -v "$work:/work:ro" ubuntu:24.04 bash /work/inner.sh
echo "Linux .deb 업그레이드 검증 통과"
