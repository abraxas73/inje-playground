-- Claude 비용 관리: Stripe 인보이스 원장 + Admin API cost_report. RLS 정책 없음 = service role 전용.
-- 설계 docs/superpowers/specs/2026-09-18-claude-cost-design.md

create table if not exists public.claude_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  org_id text null references public.claude_orgs(id),
  bill_to text not null,
  issued_on date not null,
  period_start date null,
  period_end date null,
  currency text not null default 'USD',
  subtotal_cents integer not null,
  tax_cents integer not null default 0,
  total_cents integer not null,
  seats integer null,
  plan text null,
  source text not null check (source in ('link', 'pdf')),
  source_url text null,
  storage_path text not null,
  raw_text text not null,
  uploaded_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists claude_invoices_org_issued_idx on public.claude_invoices (org_id, issued_on);
alter table public.claude_invoices enable row level security;

create table if not exists public.claude_invoice_lines (
  invoice_id uuid not null references public.claude_invoices(id) on delete cascade,
  position integer not null,
  description text not null,
  quantity integer null,
  amount_cents integer not null,
  tax_rate text null,
  period_start date null,
  period_end date null,
  seats integer null,
  plan text null,
  primary key (invoice_id, position)
);
alter table public.claude_invoice_lines enable row level security;

-- Admin API cost_report: amount는 센트 단위 소수 문자열("123.78912")이라 numeric으로 그대로 보관한다.
create table if not exists public.claude_api_cost_daily (
  day date not null,
  workspace_id text not null default '',
  description text not null,
  cost_type text null,
  model text null,
  amount_cents numeric not null,
  currency text not null default 'USD',
  synced_at timestamptz not null default now(),
  primary key (day, workspace_id, description)
);
alter table public.claude_api_cost_daily enable row level security;

-- 인보이스 PDF 원본(비공개, 2MB). 읽기는 서버가 서명 URL을 만든다.
insert into storage.buckets (id, name, public, file_size_limit)
values ('claude-invoices', 'claude-invoices', false, 2097152)
on conflict (id) do update set public = false, file_size_limit = 2097152;
