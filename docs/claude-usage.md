# Claude 사용량 대시보드 운영 런북

설계: `docs/superpowers/specs/2026-08-26-claude-usage-analytics-design.md` · 화면: `/admin/claude-usage`

## 1. 최초 설정
1. Supabase SQL Editor에서 `docs/sql/2026-08-26-claude-usage.sql` 실행.
2. 환경변수(Vercel Production + `frontend/.env.local`):
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase > Project Settings > API > service_role (서버 전용, 절대 클라이언트 노출 금지)
   - `CLAUDE_OTEL_INGEST_TOKEN` — 임의의 32바이트 이상 랜덤 문자열(`openssl rand -hex 32`)
3. 배포 후 `/admin/claude-usage` > 조직·설정 탭에서 "수집 상태"가 토큰/서비스키 구성됨으로 표시되는지 확인.

## 2. Claude Code 수집 켜기 (조직별 1회) — Task 8에서 채움
## 3. 월간 CSV 절차 — Task 8에서 채움
## 4. 장애 대응 — Task 8에서 채움
