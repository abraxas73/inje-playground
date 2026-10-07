alter table public.jira_connections add column privacy_next_at timestamptz not null default now();
create index jira_connections_privacy_due_idx on public.jira_connections (privacy_next_at) where auth_type = 'oauth';
