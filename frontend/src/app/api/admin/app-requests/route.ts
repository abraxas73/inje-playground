import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminClientOr500 } from '@/lib/claude-usage/require-admin';
import { REQUEST_FIELDS, REQUEST_STATUS, isPlatform } from '@/lib/mobile/app-requests';
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(); if (!auth.ok) return auth.response;
  const r = adminClientOr500(); if (!r.ok) return r.response;
  const status = req.nextUrl.searchParams.get('status') || 'all';
  const platform = req.nextUrl.searchParams.get('platform') || 'all';
  const page = Number(req.nextUrl.searchParams.get('page') || '0');
  if ((status !== 'all' && !Object.hasOwn(REQUEST_STATUS, status)) || (platform !== 'all' && !isPlatform(platform)) || !Number.isSafeInteger(page) || page < 0 || page > 10000) return NextResponse.json({ error: '잘못된 조회 조건입니다.' }, { status: 400 });
  let query = r.admin.from('mobile_app_requests').select(REQUEST_FIELDS, { count: 'exact' }).order('submitted_at', { ascending: false }).order('id').range(page * 50, page * 50 + 49);
  if (status !== 'all') query = query.eq('status', status);
  if (platform !== 'all') query = query.eq('platform', platform);
  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: '신청 목록을 불러오지 못했습니다.' }, { status: 500 });
  const ids = [...new Set((data ?? []).map(x => x.user_id))];
  const profiles = ids.length ? await r.admin.from('user_profiles').select('user_id,display_name,email').in('user_id', ids) : { data: [], error: null };
  if (profiles.error) return NextResponse.json({ error: '신청자 정보를 불러오지 못했습니다.' }, { status: 500 });
  const people = new Map((profiles.data ?? []).map(x => [x.user_id, x]));
  return NextResponse.json({ items: (data ?? []).map(x => ({ ...x, applicant: { name: people.get(x.user_id)?.display_name ?? null, email: people.get(x.user_id)?.email ?? null } })), total: count ?? 0 }, { headers: { 'Cache-Control': 'no-store' } });
}
