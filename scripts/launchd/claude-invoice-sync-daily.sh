#!/usr/bin/env bash
# 매일 09:30 KST: Claude Team 인보이스 자동 등록 (launchd: com.innogrid.claude-invoice-sync)
# - 전제: ego 작업 공간 "claude-billing"(Profile 2)에 결제 권한 있는 claude.ai 소유자 계정 로그인, Mac 깨어 있음
# - 종료 코드 2 = claude.ai 로그인 필요(그 공간에서 다시 로그인) · 로그: ~/Library/Logs/claude-invoice-sync.log · 상태: claude-jobs status
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export LANG="${LANG:-en_US.UTF-8}"
cd "$HOME/Repos/inje-playground/frontend"
exec node scripts/claude-invoice-sync.mjs
