---
paths:
  - "frontend/src/app/marketing/**"
  - "frontend/src/app/api/marketing/**"
  - "frontend/src/app/api/cron/marketing-email/**"
  - "frontend/src/lib/marketing/**"
  - "frontend/src/lib/__tests__/marketing*"
  - "frontend/src/components/marketing/**"
  - "docs/marketing*.md"
  - "docs/sql/*marketing*"
---
# 마케팅 Master DB (기능 상세)

루트 CLAUDE.md의 기능별 보완 지침. 이 경로의 파일을 다룰 때 자동으로 로드된다. 런북 `docs/marketing-master-db.md`, `docs/marketing-rule-management-v2.md`, `docs/marketing-email-integrity.md`.

## 페이지
- `/marketing` — 마케팅 Master DB(user + 페이지 접근 `marketing`; **기본 차단** — 고정 관리자 강승억·김하연, 마케팅 화면에서 지정한 검수자(`marketing_reviewers`), 또는 `/admin/page-permissions`에서 개별 허용한 사용자(`permissions.marketing=true`, 조회·제출만 — 승인은 검수자 지정 필요, 관리자도 마케팅 키만 개별 설정 가능) — SQL `2026-09-16-marketing-page-permission.sql`): Master 표(엑셀 `01_Master_DB` 2줄 헤더 18컬럼·헤더 클릭 정렬·필터 결과 Excel 다운로드, DB ID 클릭 → 상세·원본·변경 이력·이메일 검증 이력) · Contact 단건/Excel 제출(회사·기관은 **등록된 것만 검색·선택** — `ContactOrganizationPicker`, 신규 회사는 회사·기관 탭에서 선등록) · 검수 큐(승인 차단 오류/담당자 확인 항목 구분, 남은 승인 조건 안내, 반려 사유) · 회사·기관 기준(표준명·분류·승인 별칭·홈페이지/이메일 도메인 기준) · 검수자 관리(고정 관리자만 추가/해제 — `ReviewerManagement`) · 이메일 정합성 검사 실행. AI 추천은 `MARKETING_AI_ENABLED`+`ANTHROPIC_API_KEY`가 있을 때만 활성. 런북 `docs/marketing-master-db.md`(최신 기능 문서 링크 포함)
- `/marketing/rules`, `/marketing/validations`, `/marketing/validations/[id]` — DB 관리 규칙(버전·초안·이력) 편집, 선택 규칙으로 전체/일부 Master 검증 실행·결과·후속 조치. 런북 `docs/marketing-rule-management-v2.md`
- `/marketing/email-checks`, `/marketing/email-checks/[id]` — 이메일 정합성 검사(형식·회사 도메인 연관성·MX·홈페이지 응답, **개별 메일함 존재는 항상 미확인**) 실행 이력·판정·근거·Excel 내보내기. 작업자는 `after()` + 5분 Cron `/api/cron/marketing-email`이 대기·만료 임대 회수. 런북 `docs/marketing-email-integrity.md`

## API
- `/api/marketing/{(GET 목록·상세),submissions,review,reviewers,organizations,excel,export,rules,rules/[id]/versions,validation-runs/[id]/{export,followups},email-checks/[id]/export,email-checks/contacts/[id],email-checks/profiles}` — 마케팅 Master DB(페이지 접근 `marketing`). 사용자 세션 RPC 기반이라 서비스 역할 키는 이메일 검사 작업자·Cron만 사용. 로직 `lib/marketing/`(types·validation·rules·rule-management·search·excel·server·reviewers·ai, `email/` normalize·network·evaluate·worker), 화면 `components/marketing/`

## Supabase 테이블
- `marketing_contacts`(Master, 원본 18필드·버전), `marketing_source_rows`(최초 이관 원본 행), `marketing_import_batches`, `marketing_organizations`(회사·기관 표준명·분류·승인 별칭·버전), `marketing_submissions`(부문별 신규/변경 제출 + `submitted_organization_id`), `marketing_review_events`(승인·반려·회사 등록·검수자 지정·이메일 검증 감사 이력), `marketing_reviewers`(지정 검수자 = 마케팅 접근 근거) — SQL `docs/sql/2026-09-14-marketing-master.sql` → `-pilot-access` → `-completion` → `-reviewer-kim` → `-sort` → `-export` → `2026-09-15-marketing-reviewer-directory` → `-reviewer-delegation` → `-registered-organizations`. 클라이언트 직접 쓰기 없음, 모두 security definer RPC
- `marketing_rules`, `marketing_rule_versions`, `marketing_rule_drafts`, `marketing_rule_history`, `marketing_validations`, `marketing_validation_{runs,targets,results,followups,reference,organizations}` — DB 관리 규칙(버전)·선택 규칙 Master 검증 — SQL `2026-09-14-marketing-rules.sql`, `-rule-management-v2.sql`, `-validation-snapshot-performance.sql`
- `marketing_email_profiles`(회사별 홈페이지·이메일 도메인 기준, 버전)·`marketing_email_profile_history`, `marketing_email_{runs,targets,results}`(실행·임대 120초·결과 스냅샷), `marketing_email_probe_cache`, `marketing_review_events.email_result_id`(결과 확정 트리거로 Contact 이력 1건) — SQL `2026-09-15-marketing-email-integrity.sql`, `-email-contact-history.sql`
