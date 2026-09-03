# 로컬 launchd 작업 런북 (이 Mac에서 매일 돌아가는 Claude 관련 자동화)

Vercel Cron으로 돌릴 수 없는 작업(로컬 Chrome 세션·사내망·개인 계정이 필요한 것)은 운영자 Mac의 **launchd**(사용자 LaunchAgent)로 돌린다.
클라우드 루틴(Claude Code `/schedule`)은 Anthropic 클라우드 샌드박스에서 실행돼 로컬 Chrome·claude.ai 로그인 쿠키·사내망에 접근할 수 없으므로 이 작업들에는 쓸 수 없다.

## 작업 목록 (2026-09-03 기준)

| 라벨 | 일정(KST) | 하는 일 | 실행 파일 | 로그 |
|---|---|---|---|---|
| `com.innogrid.gitlab-metrics-sync` | 매일 07:45 | 사내 GitLab 커밋·MR 일 집계(최근 3일 창) → `POST /api/admin/work-metrics/sync` (Vercel IP 차단 우회) | `~/.claude/hooks/gitlab-metrics-sync-daily.sh` → `frontend/scripts/gitlab-metrics-sync.py` | `~/Library/Logs/gitlab-metrics-sync.log` |
| `com.claude.teams-daily-quote` | 매일 08:00 | Teams 채널 오늘의 격언(claude -p 생성, 웹훅 전송) | `~/.claude/hooks/teams-daily-quote.sh` | `~/.claude/logs/teams-daily-quote.log` |
| `com.innogrid.claude-usage-csv` | 매일 09:05 | Claude 사용량 CSV·멤버·초대·시트 수집 — `/claude-usage-csv` 스킬을 `claude -p --chrome`으로 헤드리스 실행 | `~/.claude/hooks/claude-usage-csv-daily.sh` | `~/.claude/logs/claude-usage-csv.log`, 회차별 `~/.claude/logs/claude-usage-csv/YYYY-MM-DD.json` |

plist는 모두 `~/Library/LaunchAgents/<라벨>.plist`. 전제: Mac이 깨어 있어야 하고(잠자기 중 놓친 일정은 깨어난 뒤 실행, 꺼져 있으면 실행 안 됨), `claude-usage-csv`는 Chrome 실행 + claude.ai 7개 조직 소유자 로그인 + Claude in Chrome 확장 연동이 필요하다.

## 한 곳에서 보기: `claude-jobs`

`~/.claude/hooks/claude-jobs`(심볼릭 링크 `~/.local/bin/claude-jobs`). `com.claude.*`·`com.innogrid.*` 라벨의 plist를 자동 발견한다.

```bash
claude-jobs                 # = status: 일정·다음 실행·등록 여부·실행 횟수·마지막 종료 코드·로그 갱신 시각·최근 로그 2줄
claude-jobs list
claude-jobs run usage-csv   # 지금 즉시 실행(launchctl kickstart) — 라벨은 고유한 부분 문자열로 지정 가능
claude-jobs log gitlab 50   # 로그 마지막 50줄
claude-jobs disable teams   # 해제(bootout) / claude-jobs enable teams 재등록(bootstrap)
claude-jobs gui             # 시스템 설정 > 일반 > 로그인 항목 및 확장 프로그램 열기
```

## GUI에서 보기

시스템 설정 > **일반** > **로그인 항목 및 확장 프로그램** > **앱 백그라운드 활동**. 서명된 앱이 아닌 LaunchAgent는 `ProgramArguments[0]`의 **실행 파일 이름**으로 표시되므로(예: `/bin/bash 스크립트`면 "bash"), plist는 항상 **스크립트를 직접 실행**하도록 작성한다(스크립트에 shebang + 실행 권한). 그러면 `claude-usage-csv-daily.sh`처럼 이름이 드러난다. 오른쪽 🔍는 Finder에서 plist 위치를 연다. **토글을 끄면 실행되지 않는다.** GUI에는 켜기/끄기와 위치만 있고 일정·종료 코드는 `claude-jobs status`나 `launchctl print gui/$(id -u)/<라벨>`로 본다.

## 새 작업 추가 절차

1. 래퍼 스크립트를 `~/.claude/hooks/<이름>.sh`에 만든다(shebang, `chmod +x`, PATH 명시, 로그 파일에 시작·종료 기록, 필요하면 lock으로 중복 실행 방지).
2. `~/Library/LaunchAgents/com.innogrid.<이름>.plist` 작성 — `ProgramArguments`는 **스크립트 경로 하나만**, `StartCalendarInterval`에 Hour/Minute, `StandardOutPath`/`StandardErrorPath`는 `~/.claude/logs/<이름>.launchd.log`.
3. `plutil -lint` → `launchctl bootstrap gui/$(id -u) <plist>` → `claude-jobs run <이름>`으로 1회 시험 → `claude-jobs status`로 종료 코드 확인.
4. 이 문서의 표와 `claude-jobs`의 `PRIMARY_LOG`/`PURPOSE`에 한 줄 추가.

## 비용·한도

`claude -p`를 쓰는 작업(`claude-usage-csv`, `teams-daily-quote`)은 이 Mac의 CLI가 claude.ai Team 시트로 로그인돼 있어 **API 과금이 아니라 시트 사용량 한도**를 소모한다(`claude auth status`로 확인, `ANTHROPIC_API_KEY`는 설정하지 않는다). `--output-format json`의 `total_cost_usd`는 정가 기준 추정치일 뿐 청구액이 아니다. `claude-usage-csv` 1회는 약 10분·토큰 190만(대부분 캐시 읽기)이며 오전 인터랙티브 한도를 일부 소모하므로, 한도가 빠듯하면 래퍼에 `--model sonnet`을 넣는 것을 검토한다(안정성 재검증 필요).
