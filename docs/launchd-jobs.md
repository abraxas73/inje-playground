# 로컬 launchd 작업 런북 (이 Mac에서 매일 돌아가는 Claude 관련 자동화)

Vercel Cron으로 돌릴 수 없는 작업(로컬 Chrome 세션·사내망·개인 계정이 필요한 것)은 운영자 Mac의 **launchd**(사용자 LaunchAgent)로 돌린다.
클라우드 루틴(Claude Code `/schedule`)은 Anthropic 클라우드 샌드박스에서 실행돼 로컬 Chrome·claude.ai 로그인 쿠키·사내망에 접근할 수 없으므로 이 작업들에는 쓸 수 없다.

## 작업 목록 (2026-09-29 기준)

| 라벨 | 일정(KST) | 하는 일 | 실행 파일 | 로그 |
|---|---|---|---|---|
| `com.innogrid.gitlab-metrics-sync` | 매일 07:45 | 사내 GitLab 커밋·MR 일 집계(최근 3일 창) → `POST /api/admin/work-metrics/sync` (Vercel IP 차단 우회) | `~/.claude/hooks/gitlab-metrics-sync-daily.sh` → `frontend/scripts/gitlab-metrics-sync.py` | `~/Library/Logs/gitlab-metrics-sync.log` |
| `com.claude.teams-daily-quote` | 매일 08:00 | Teams 채널 오늘의 격언(claude -p 생성, 웹훅 전송) | `~/.claude/hooks/teams-daily-quote.sh` | `~/.claude/logs/teams-daily-quote.log` |
| `com.innogrid.claude-usage-csv` | 매일 09:05 | Claude 사용량 CSV·멤버·초대·시트 수집 — `/claude-usage-csv` 스킬을 `claude -p --no-chrome` + ego-browser으로 헤드리스 실행 | `~/.claude/hooks/claude-usage-csv-daily.sh` | `~/.claude/logs/claude-usage-csv.log`, 회차별 `~/.claude/logs/claude-usage-csv/YYYY-MM-DD.json` |
| `com.innogrid.claude-seat-executor` | 상시(KeepAlive) | Claude 시트 할당·해제 요청을 ego 전용 워크스페이스 `claude-seat-executor`(이름)에서 처리(15초 폴링, Chrome 실행 없음). 런북 `docs/claude-usage.md` §9 | `~/.claude/hooks/claude-seat-executor.sh` → `frontend/scripts/claude-seat-executor.mjs` | `~/Library/Logs/claude-seat-executor.log` |

plist는 모두 `~/Library/LaunchAgents/<라벨>.plist`. 전제: Mac이 깨어 있어야 한다(잠자기 중 놓친 일정은 깨어난 뒤 실행, 꺼져 있으면 실행 안 됨). `claude-usage-csv`는 ego-browser CLI와 **ego 브라우저의 claude.ai 7개 조직 소유자 로그인**이 필요하다. 예약 래퍼는 Chrome을 띄우지 않으며 `--no-chrome`으로 확장 연동을 끈다. ego 연결·로그인·조직 권한이 없으면 해당 조직을 보류하고 기존 데이터를 유지한다. 09:05 일정은 그대로이며 래퍼/스킬 수정은 다음 실행부터 적용된다(launchd 재등록 불필요). 전용 ego TaskSpace **`claude-usage-csv`**(이름)와 p1을 매일 재사용한다 — ego 재시작으로 사라지면 같은 이름으로 다시 만들고, 사용자 제어 중이면 보류한다. 시트 실행기도 별도 공간 `claude-seat-executor`를 이름으로 재사용한다.

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

### 2026-10-16 ego 전환

Chrome을 재실행하던 시트 실행기의 launchd 작업을 중지한 뒤, 실행기를 ego-browser로 전환했다. 래퍼의 `SEAT_EGO_SPACE_ID=32`로 같은 공간과 p1을 재사용한다. 공간 없음·사용자 제어 중·소유자 권한 부족이면 요청을 claim하지 않고 오프라인 하트비트로 대기한다. 공간/탭은 종료하지 않으며 삭제된 공간을 자동 생성하지 않는다. 사용량 수집은 별도 공간 33, 매일 09:05로 유지한다.

예약 래퍼 원본은 `scripts/launchd/`에 보관한다. 이 Mac에는 같은 내용을 `~/.claude/hooks/`에 적용했다. 다른 Mac에서는 두 래퍼의 저장소 경로와 ego 공간 ID를 맞춘 뒤 설치해야 한다.

### ego 공간 재생성 (2026-10-19)
ego 브라우저의 작업 공간이 모두 사라져(공간 목록 0개) 실행기가 "로그인 필요" 하트비트만 보냈다. 같은 이름으로 새로 만들었고 번호는 고를 수 없어 래퍼를 바꿨다: 시트 실행기 **32**(`claude-seat-executor`), 사용량 CSV **33**(`claude-usage-csv`). 공간이 다시 사라지면 `ego-browser nodejs -e 'console.log(JSON.stringify(await listTaskSpaces()))'`로 확인하고, `taskSpace("<이름>")`으로 만든 뒤 출력된 번호를 래퍼(`~/.claude/hooks/…`와 `scripts/launchd/…` 두 곳)와 이 문서에 반영한다. 로그인 계정이 조직 소유자가 아니면(overview 403) 그 공간의 p1에서 소유자 계정으로 다시 로그인한다.

### 2026-10-22 — 공간을 번호 대신 이름으로

ego 재시작(10-16 수동, 10-20 자동 업그레이드)마다 에이전트 공간이 모두 사라지고 번호가 다시 매겨져, 번호를 고정한 사용량 CSV(33)는 10-20·21 보류, 시트 실행기(32)는 "로그인 필요"로 멈췄다. `taskSpace("이름")`은 같은 이름 공간을 재사용하고 없으면 만든다(실측: 두 번 호출해 같은 번호). 래퍼·지시문·`frontend/scripts/lib/claude-seat-ego.mjs`를 이름(`claude-seat-executor`·`claude-usage-csv`)으로 바꿨고, 새 공간의 탭이 비어 있으면 claude.ai로 옮긴다. 로그인 쿠키는 ego 프로필 공용이라 공간을 다시 만들어도 로그인은 유지된다.
