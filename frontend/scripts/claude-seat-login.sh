#!/usr/bin/env bash
# 기존 ego 전용 공간에서 직접 로그인한다. Chrome 프로필은 사용하지 않는다.
set -e
cd "$(dirname "$0")/.."
export SEAT_EGO_SPACE="${SEAT_EGO_SPACE:-claude-seat-executor}"
exec node scripts/claude-seat-executor.mjs --login
