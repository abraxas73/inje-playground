# 연합뉴스 인사·부고

`/people-news`는 user/admin용 기능이다. 공식 RSS `https://www.yna.co.kr/rss/people.xml`의 `[인사]`, `[부고]` 제목을 골라 제목·RSS 요약·송고 시각·원문 URL을 누적 저장한다. 본문을 별도로 크롤링하지 않는다. RSS 제공 기간 이전의 과거 기사는 자동 복원되지 않는다.

## 사용자 흐름

- 검색·날짜·인사/부고 필터, 최신순 20건 페이징, 원문 열기.
- `지금 가져오기`: 즉시 수집 후 목록 갱신. 사용자 세션을 검증하며 수동 요청은 전체 사용자 기준 1분 간격.
- `Microsoft 메일 연결`: 로그인 이메일과 같은 Microsoft 계정을 연결하고 Mail.Send 위임 권한에 동의한다. 기존 SharePoint 연결은 메일 연결을 추가하지 않아도 계속 사용할 수 있다.
- `수신하기`와 한국 시간 설정 후 저장. 기본 07:10, 다음 발송 시각과 최근 발송 결과 표시. 수신 해제도 같은 화면에서 저장한다.
- 본인 Microsoft 주소에서 본인 계정 이메일로 발송한다. 실제 Graph `/me`의 메일 주소를 발송 직전에 확인한다. 다른 계정이면 발송하지 않는다.

## 운영

Supabase 프로젝트 `avooqcxehfeurjhqqgui`, Vercel 프로젝트 `innogrid-playground`, URL `https://inje-playground.vercel.app`.

- `yonhap-notices-daily-0700-kst`: UTC `0 22 * * *` → 매일 07:00 KST. Vault 비밀값으로 `yonhap-notices` Edge Function 인증.
- `yonhap-notice-email-every-minute`: 매분 Supabase가 `/api/cron/yonhap-notice-email` 호출. 구독별 `next_send_at`이 지난 사용자를 원자적으로 선택하며, 동일 사용자/KST 날짜당 1건만 생성한다. 요청 한 번에 10명, 동시 4명 처리하므로 집중 시 순차 발송될 수 있다.
- 발송 시 마지막 성공 메일 이후 **새로 저장된 기사**를 포함한다. 송고 시각 대신 최초 저장 시각을 사용해 늦게 수집한 기사가 누락되지 않게 한다. 첫 메일은 최근 24시간 저장분. 최신 100건까지 메일에 표시하고 전체 건수·화면 링크를 제공한다. 새 기사가 없으면 없음을 알리는 메일을 보낸다.
- SMTP 최종 수신까지 확인하는 기능은 없다. `sent`는 Microsoft가 발송 요청을 수락했다는 뜻이다. 실패나 응답 불명확 시 같은 날 자동 재발송하지 않으며, 실패 이력이 남고 다음날부터 계속한다. 중단된 처리 상태는 10분 후 실패로 정리한다.
- 수집 상태: `yonhap_notice_sync_runs`. 메일 상태: `yonhap_notice_email_deliveries`. 사용자에게는 본인 설정·발송 상태만 공개한다.

배포 순서:

1. `python3 scripts/deploy-yonhap-notices.py --project-ref avooqcxehfeurjhqqgui` — 테이블/RLS/RPC, 수집 Edge Function, 07:00 cron, 최초 수집.
2. Vercel에는 기존 `TEAMS_GRAPH_CLIENT_SECRET`, `MS_TOKEN_ENC_KEY`, `SUPABASE_SERVICE_ROLE_KEY`와 `NEXT_PUBLIC_APP_URL=https://inje-playground.vercel.app` 필요. Microsoft 앱 설정은 기존 settings의 `teams_tenant_id`, `teams_graph_client_id` 사용.
3. 루트에서 `node scripts/configure-yonhap-email.mjs` — 메일 전용 `YONHAP_EMAIL_CRON_SECRET`을 생성하여 Vercel과 Vault에 저장한다. 기존 Cron 비밀값을 변경하지 않는다. 토큰은 인자/로그에 출력하지 않는다.
4. 프런트엔드 빌드·운영 배포 후 같은 스크립트 `--verify`로 정상 응답을 확인하고 `--enable`로 메일 cron을 활성화한다. Vercel CLI가 민감 환경변수를 마스킹하여 내려줄 수 있으므로 내려받은 플레이스홀더를 실제 비밀값으로 사용하지 않는다.

일반 파일 연결에서는 기존 Microsoft 스코프를 유지하며 `/people-news`에서 연결할 때만 `Mail.Send`를 추가 요청한다. 조직이 사용자 동의를 제한하면 관리자가 Microsoft 앱의 위임 `Mail.Send` 권한을 허용해야 한다.

검증: `cd frontend && npm test && npm run build`; 수집기 `cd supabase/functions/yonhap-notices && deno task test`; 예약 SQL `supabase db query --linked --file scripts/check-yonhap-scheduling.sql`(트랜잭션 롤백, 이메일 발송 없음).
# 즉시 수신과 메일 미리보기

- 예약 첫 메일은 최근 24시간 **수집분**, 이후에는 마지막 성공한 예약 발송 이후 수집분을 보냅니다. 기사 송고일이나 화면 검색 조건 기준이 아닙니다.
- **지금 수신**은 예약 여부와 관계없이 최근 24시간 수집분을 본인에게 보냅니다. Microsoft 메일 연결과 인증된 계정 이메일이 필요합니다. 예약 발송 시각·일일 발송 슬롯·마지막 성공 기준은 바뀌지 않아 소식이 중복 포함될 수 있습니다.
- 사용자별 1분 제한은 DB의 원자적 요청 처리로 적용됩니다. 실패도 제한에 포함됩니다.
- **메일 미리보기**는 실제 메일과 같은 HTML 양식을 사용하며, 메일 발송이나 예약 변경 없이 최근 24시간 수집분을 보여줍니다.
- 추가 배포 SQL: `docs/sql/2026-09-11-yonhap-notice-send-now.sql`. 즉시 발송 기록은 서비스 역할만 접근 가능한 `yonhap_notice_manual_deliveries`에 별도로 저장합니다.
