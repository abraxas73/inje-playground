-- Atlassian(Jira·Confluence) 개인 연결: 연결 때 실제로 받은 권한 목록. Confluence 기능은 이 목록에 Confluence 권한이 있을 때만 쓴다(없으면 다시 연결 안내).
alter table public.jira_connections add column if not exists scopes text[];
