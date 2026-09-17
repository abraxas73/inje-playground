# 연합뉴스 인사·부고

`/people-news`는 user/admin용 기능이다. 공식 RSS `https://www.yna.co.kr/rss/people.xml`의 `[인사]`, `[부고]` 제목을 골라 제목·RSS 요약·송고 시각·원문 URL을 누적 저장한다.

RSS 요약(`description`)은 기사 앞부분(대개 80자)만 담아 화면·메일 요약이 기사 중간에서 끊긴다. 인사는 `◇ 과장급 전보` 같은 소제목만 남고, 부고는 발인·장지가 잘려 나간다(2026-09-17 기준 인사 52건 중 14건, 부고는 73건 전부). 그래서 **요약이 기사 끝까지 오지 않았을 때**만 원문을 읽어 본문으로 갈음한다(`article.ts`). 판정 기준은 기사 마지막 줄의 발신지 표기(`(서울=연합뉴스)`)이며, 말줄임(`...`)으로 끝나면 잘린 것으로 본다. 본문은 저작권·제보·부고 접수 안내 문단이 나오면 거기서 끝난 것으로 보고 그 앞까지만, 최대 60문단·4,000자를 담는다(넘으면 항목 경계에서 자르고 `…`). **항목만 골라 붙이지 않고 본문 전체로 갈음한다** — 소제목이 빠지면 다음 사람이 앞 소제목에 딸린 것처럼 읽히기 때문이다(2026-09-17 연세대 의료원 오귀속). 본문을 제대로 읽었는지도 확인한다: 끝에 발신지 표기가 있거나 기존 요약 앞부분을 품고 있어야 하며, 아니면 기존 요약을 그대로 둔다. 새 기사이거나 저장된 요약이 아직 기사 끝까지 오지 않은 기사만 대상이고, 1회 수집당 60건·동시 6건·건당 8초·전체 45초 상한이며 실패하면 RSS 요약을 그대로 둔다. RSS는 120건을 유지하므로 상한에 걸린 나머지는 다음 수집에서 이어 받는다. 이미 채워 둔 저장분은 이후 수집이 더 짧은 RSS 요약으로 되돌리지 않는다(길이로 가린다). 대상은 **그때 RSS에 있는 기사**뿐이라, 규칙을 바꾸기 전에 쌓인 과거분은 같은 규칙으로 1회 backfill한다(2026-09-17 21건 → 규칙 개정 후 재실행). RSS 제공 기간 이전의 과거 기사는 자동 복원되지 않는다.

## 사용자 흐름

- 검색·날짜·인사/부고 필터, 최신순 20건 페이징, 원문 열기.
- `지금 가져오기`: 즉시 수집 후 목록 갱신. 사용자 세션을 검증하며 수동 요청은 전체 사용자 기준 1분 간격.
- `이전 발송 내역 제외`(기본 켬): 예약·지금 수신으로 **이미 보낸 소식 다음부터만** 담는다. 끄면 지금 수신이 항상 최근 24시간을 보내 예약분과 겹친다. 켠 상태에서 새 소식이 없으면 지금 수신은 메일을 만들지 않고 `yonhap_notice_manual_deliveries.status='skipped'`로 기록한다(예약은 종전대로 '없음' 메일을 보낸다). 설정은 `yonhap_notice_subscriptions.exclude_sent`.
- `수신하기`와 한국 시간 설정 후 저장. 기본 07:10, 다음 발송 시각과 최근 발송 결과 표시. 수신 해제도 같은 화면에서 저장한다. 인증된 계정 이메일만 필요하고 **Microsoft 계정 연결은 필요하지 않다**(2026-09-16 이전에는 Graph Mail.Send로 본인 Microsoft 메일함에서 보냈으나, 그 메일은 Exchange Online에만 남고 아마란스 메일함에 도착하지 않아 SMTP로 이관).
- 메일은 사내 SMTP 릴레이(`MEDIA_SMTP_HOST`:465, AUTH LOGIN)에서 발신자 `MEDIA_SMTP_USER`(표시 이름 "인사·부고 알림")로 로그인 이메일에 보낸다. 관리 매체·부서 부고 알림과 같은 경로다.

## 운영

Supabase 프로젝트 `avooqcxehfeurjhqqgui`, Vercel 프로젝트 `innogrid-playground`, URL `https://inje-playground.vercel.app`. 메일 발송은 모두 Edge Function `yonhap-notices`가 맡고 Vercel은 세션을 붙여 위임하는 프록시만 둔다.

Edge Function 요청 본문 `action`:

| action | 인증 | 동작 |
|---|---|---|
| (없음)·`collect` | cron 비밀값 또는 사용자 JWT | RSS 수집·저장 → 새 부고 매체 매칭·알림(`docs/media-directory.md`) |
| `send-digests` | cron 비밀값만 | `claim_yonhap_notice_emails(10)`로 due 구독을 잡아 순차 발송, `yonhap_notice_email_deliveries` 갱신 |
| `send-now` | 사용자 JWT만 | 본인 세션으로 `claim_yonhap_notice_send_now`(1분 쿨다운) → 최근 24시간 수집분 발송, `yonhap_notice_manual_deliveries` 기록 |
| `preview` | 사용자 JWT만 | 최근 24시간 수집분을 실제 메일 양식으로 반환(발송·기록 없음) |

- `yonhap-notices-daily-0700-kst`: UTC `0 22 * * *` → 매일 07:00 KST 수집. Vault `yonhap_project_url`·`yonhap_sync_secret`.
- `yonhap-notice-email-every-minute`: 매분 `invoke_yonhap_notice_email()`이 같은 Vault 비밀값으로 Edge Function `{"action":"send-digests"}`를 호출한다. 구독별 `next_send_at`이 지난 사용자를 원자적으로 선택하며 동일 사용자/KST 날짜당 1건만 생성한다. 요청 한 번에 10명 순차 처리라 집중 시 몇 분에 걸쳐 발송될 수 있다. SMTP secrets가 비어 있으면 claim하지 않아 예약이 소비되지 않는다.
- 발송 시 마지막 성공 메일 이후 **새로 저장된 기사**를 포함한다. 송고 시각 대신 최초 저장 시각을 사용해 늦게 수집한 기사가 누락되지 않게 한다. 첫 메일은 최근 24시간 저장분. 최신 100건까지 메일에 표시하고 전체 건수·화면 링크를 제공한다. 새 기사가 없으면 없음을 알리는 메일을 보낸다.
- `sent`는 릴레이가 메시지를 수락했다는 뜻이고 `provider_id`에 Message-ID가 남는다. 최종 수신함 도착까지 확인하는 기능은 없다. 실패는 `failed`+정제된 오류(이메일 주소 제거)로 남고 같은 날 자동 재발송하지 않는다. 중단된 처리 상태는 10분 후 실패로 정리한다.
- 수집 상태: `yonhap_notice_sync_runs`. 예약 메일: `yonhap_notice_email_deliveries`. 지금 수신: `yonhap_notice_manual_deliveries`(service_role만). 사용자에게는 본인 설정·발송 상태만 공개한다.
- 수집 직후 새 부고를 관리 매체·부서와 매칭하고, 새 매칭이 있으면 알림 구독자에게 1통을 보낸다. 응답 `alerts`에 요약. 상세는 `docs/media-directory.md`.

배포 순서(변경 시):

1. `cd supabase/functions/yonhap-notices && deno task test` → `supabase functions deploy yonhap-notices --use-api`. secrets: `YONHAP_SYNC_SECRET`, `MEDIA_SMTP_HOST|PORT|USER|PASS`, `MEDIA_APP_URL`(선택).
2. `supabase db query --linked --file docs/sql/2026-09-16-yonhap-notice-smtp.sql`(Edge Function 배포 **후**에 — 구 함수는 본문을 무시하고 cron 요청을 모두 수집으로 처리한다) → `scripts/check-yonhap-scheduling.sql`로 확인.
3. 프런트엔드 `cd frontend && npm test && npm run build` → `vercel --prod`(반드시 `frontend/`에서).

주의: Edge Function 배포 직후 수 분간 일부 워커가 **구버전 번들을 계속 서빙**할 수 있다(2026-09-16 관측: 같은 리전 ap-northeast-2에서 약 절반이 7분 이상 구버전, 같은 코드 재배포 후 1~2분 내 해소). 구 코드는 본문 `action`을 무시하고 수집을 실행하므로, `curl -X POST …/functions/v1/yonhap-notices -H 'Authorization: Bearer x' -d 'not json'`이 연속 12회 400(`지원하지 않는 요청입니다.`)을 돌려줄 때까지 기다린 뒤 SQL로 cron을 전환하고 화면에서 확인한다.

처음부터 구축할 때는 `python3 scripts/deploy-yonhap-notices.py --project-ref avooqcxehfeurjhqqgui`가 테이블/RLS/RPC·Edge Function·두 cron을 순서대로 적용한다. `MEDIA_SMTP_*` secrets는 별도로 등록한다(`docs/media-directory.md`).

검증: `cd frontend && npm test && npm run build`; Edge Function `cd supabase/functions/yonhap-notices && deno task test`; 예약 SQL `supabase db query --linked --file scripts/check-yonhap-scheduling.sql`(트랜잭션 롤백, 이메일 발송 없음). 운영 확인은 `/people-news`에서 "지금 수신" 후 `yonhap_notice_manual_deliveries`의 `sent`·`provider_id`와 아마란스 메일함 도착.

# 즉시 수신과 메일 미리보기

- 예약 첫 메일은 최근 24시간 **수집분**, 이후에는 마지막 성공한 예약 발송 이후 수집분을 보냅니다. 기사 송고일이나 화면 검색 조건 기준이 아닙니다.
- **지금 수신**은 예약 여부와 관계없이 보냅니다. `이전 발송 내역 제외`가 켜져 있으면 마지막 성공 발송(예약·즉시 통합) 이후, 꺼져 있으면 최근 24시간 수집분입니다. 인증된 계정 이메일만 필요합니다. 예약 발송 시각·일일 발송 슬롯·마지막 성공 기준은 바뀌지 않아 소식이 중복 포함될 수 있습니다.
- 사용자별 1분 제한은 DB의 원자적 요청 처리로 적용됩니다. 실패도 제한에 포함됩니다.
- **메일 미리보기**는 Edge Function이 실제 메일과 같은 템플릿(`digest.ts`)으로 만든 결과를 보여주며 메일 발송이나 예약 변경이 없습니다.
- 배포 SQL: `docs/sql/2026-09-11-yonhap-notice-send-now.sql` → `2026-09-16-yonhap-notice-smtp.sql` → `2026-09-17-yonhap-notice-exclude-sent.sql`(이 SQL은 Edge Function보다 **먼저** 적용한다 — 새 RPC 인자에 기본값이 있어 구 함수도 계속 동작).
