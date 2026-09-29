#!/usr/bin/env bash
# frontend/scripts/claude-seat-login.sh — claude.ai 소유자 계정 로그인(1회). 전용 브라우저 프로필 ~/.claude-seat/profile 에 세션이 남는다.
# 실행기(claude-seat-executor.mjs, launchd com.innogrid.claude-seat-executor)가 이 프로필로 시트 할당·해제를 claude.ai에 반영한다.
# 로그인·Cloudflare 확인은 사용자가 직접 한다. 창을 닫으면 끝. 런북 docs/claude-usage.md §9
set -e
cd "$(dirname "$0")/.."
exec node scripts/claude-seat-executor.mjs --login
