#!/usr/bin/env bash
# 상시: Claude 시트 할당·해제 실행기 (launchd: com.innogrid.claude-seat-executor, KeepAlive)
# - 전제: ego 워크스페이스 "claude-seat-executor"(이름으로 재개, 없으면 다시 만듦)의 p1에서 조직 소유자 로그인, Mac 깨어 있음
# - 로그: ~/Library/Logs/claude-seat-executor.log · 상태: claude-jobs status · 런북 docs/claude-usage.md §9
# - 수동 중지/재개: claude-jobs disable seat / claude-jobs enable seat 
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export LANG="${LANG:-en_US.UTF-8}"
cd "$HOME/Repos/inje-playground/frontend"
export SEAT_EGO_SPACE=claude-seat-executor  # 같은 ego 공간과 p1을 계속 재사용 — 번호는 ego 재시작마다 바뀌어 이름으로 연다(2026-10-22)
exec node scripts/claude-seat-executor.mjs
