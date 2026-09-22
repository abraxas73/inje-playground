-- Claude 사용량 CSV 업로드: 매핑되지 않은 칼럼 기록
-- Anthropic이 members-analytics CSV에 칼럼을 추가하면 파서가 조용히 버린다.
-- 버린 칼럼 이름을 import 행에 남겨 화면·감사 로그에서 바로 알아챌 수 있게 한다.
alter table claude_csv_imports
  add column if not exists unknown_headers text[] not null default '{}'::text[];

comment on column claude_csv_imports.unknown_headers is
  'CSV 헤더 중 MEMBERS_CSV_COLUMNS에 매핑되지 않아 저장하지 않은 칼럼의 원래 이름';
