#!/usr/bin/env bash
# 매일 09:05 KST에 /claude-usage-csv 스킬을 헤드리스 claude -p(--no-chrome) + ego-browser로 실행 (launchd: com.innogrid.claude-usage-csv)
# - 전제: ego-browser 사용 가능 + ego 브라우저의 claude.ai에 7개 조직 소유자 계정 로그인 + Mac 깨어 있음
# - 스킬 위치: ~/Repos/inje-playground/.claude/skills/claude-usage-csv (main 체크아웃, cwd로 사용)
# - 로그: ~/.claude/logs/claude-usage-csv.log, 회차별 원본 JSON ~/.claude/logs/claude-usage-csv/YYYY-MM-DD.json
# - 완료 알림: 전역 Stop 훅(~/.claude/hooks/telegram-notify.sh)이 마지막 메시지를 Telegram으로 보냄
# - 수동 실행: launchctl kickstart gui/$(id -u)/com.innogrid.claude-usage-csv   (또는 bash 이 파일)
# - 해제: launchctl bootout gui/$(id -u)/com.innogrid.claude-usage-csv
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export LANG="${LANG:-en_US.UTF-8}"

CLAUDE_BIN="$HOME/.local/bin/claude"
REPO="$HOME/Repos/inje-playground"
LOG_DIR="$HOME/.claude/logs"
LOG_FILE="$LOG_DIR/claude-usage-csv.log"
RUN_DIR="$LOG_DIR/claude-usage-csv"
LOCK_DIR="$LOG_DIR/claude-usage-csv.lock"
mkdir -p "$LOG_DIR" "$RUN_DIR"
log() { printf '%s %s\n' "$(TZ=Asia/Seoul date '+%F %T')" "$*" >> "$LOG_FILE"; }

# 중복 실행 방지(다른 세션/수동 실행과 겹치면 건너뜀)
if ! mkdir "$LOCK_DIR" 2>/dev/null; then log "이미 실행 중(lock: $LOCK_DIR) → 건너뜀"; exit 0; fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT

TODAY="$(TZ=Asia/Seoul date +%F)"
# 분석 창의 끝 날짜는 UTC 어제 → 09:00 KST 전에 받으면 전날과 같은 기간이 나오므로 09:01까지 대기
NOW_HM="$(TZ=Asia/Seoul date +%H%M)"
if [ "$((10#$NOW_HM))" -lt 901 ]; then
  TARGET="$(TZ=Asia/Seoul date -j -f '%F %T' "$TODAY 09:01:00" +%s)"; NOW="$(date +%s)"
  if [ "$TARGET" -gt "$NOW" ]; then log "09:01 KST까지 $((TARGET-NOW))초 대기"; sleep "$((TARGET-NOW))"; fi
fi

# 브라우저 실행·연결은 ego-browser CLI가 담당한다. Chrome 확장/AppleScript로 우회하지 않는다.
command -v ego-browser >/dev/null 2>&1 || { log "ego-browser CLI 없음"; exit 1; }
[ -f "$HOME/.agents/skills/ego-browser/SKILL.md" ] || { log "ego-browser 스킬 없음"; exit 1; }
[ -x "$CLAUDE_BIN" ] || { log "claude CLI 없음: $CLAUDE_BIN"; exit 1; }
[ -f "$REPO/.claude/skills/claude-usage-csv/SKILL.md" ] || { log "스킬 없음: $REPO/.claude/skills/claude-usage-csv"; exit 1; }
cd "$REPO"

PROMPT='/claude-usage-csv 를 지금 실행해. 브라우저는 ego-browser CLI만 사용한다. 전용 TaskSpace ID 28을 재사용하고 p1 탭을 유지해라. 새 워크스페이스를 매일 만들지 마라. 사용자가 전용 공간의 반복 재사용을 요청했으므로 실행 시작에 listTaskSpaces로 ID 28을 확인하고 taskSpace(28)로 재개한다. 공간이 없거나 사용자 제어 중이면 새 공간 생성이나 제어권 탈취 없이 보류한다. 정상 수집 완료 후에도 이 전용 공간과 p1은 다음 예약 실행을 위해 열어 둔다. 먼저 /Users/seunguk.kang/.agents/skills/ego-browser/SKILL.md를 읽어라. Chrome 확장과 Chrome AppleScript 우회는 사용하지 않는다. ego 세션의 조직 소유자 권한이 없으면 해당 조직 수집을 보류하고 실패 응답으로 기존 멤버/초대 데이터를 덮어쓰지 마라. 이 실행은 매일 09:05 KST launchd 스케줄의 무인 실행이다. 사용자에게 질문하거나 확인을 기다리지 말고 스킬 절차를 끝까지 진행하고, 사용자 개입이 필요한 항목(Cloudflare 확인, 로그인, 다운로드 차단 등)은 시도하지 말고 마지막 보고에 적어라. 시트 수 변경이 있으면 orgs PATCH까지 반영해라. 마지막 메시지는 8줄 이내의 한국어 요약으로: 조직별 CSV 업로드 ✓/✗, 멤버·초대 갱신 결과, 시트 변경, 실패·보류 목록, 현재 시각(KST).'
OUT="$RUN_DIR/$TODAY.json"
log "시작 (cwd=$REPO, out=$OUT)"
timeout 1800 "$CLAUDE_BIN" -p --no-chrome --permission-mode bypassPermissions --output-format json "$PROMPT" < /dev/null > "$OUT" 2>> "$LOG_FILE"
RC=$?
python3 - "$OUT" >> "$LOG_FILE" 2>&1 <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print(f"  결과 JSON 파싱 실패: {e}"); sys.exit()
msgs = d if isinstance(d, list) else [d]
for m in msgs:
    if m.get("type") == "result":
        print(f"  is_error={m.get('is_error')} turns={m.get('num_turns')} duration={round((m.get('duration_ms') or 0)/1000)}s cost=${m.get('total_cost_usd')}")
        for line in str(m.get("result") or "").strip().splitlines(): print("  | " + line)
PY
log "종료 rc=$RC"
exit "$RC"
