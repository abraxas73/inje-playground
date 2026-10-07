import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/rfp/require-user';
import { REQUEST_FIELDS, isPlatform, normalizeStoreEmail, validRevision } from '@/lib/mobile/app-requests';
export const runtime = 'nodejs';
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
export async function GET() {
  const r = await requireUser(); if (!r.ok) return r.response;
  const { data, error } = await r.admin.from('mobile_app_requests').select(REQUEST_FIELDS).eq('user_id', r.userId).order('platform');
  if (error) return fail('신청 내역을 불러오지 못했습니다.', 500);
  return NextResponse.json({ items: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(req: NextRequest) {
  const r = await requireUser(); if (!r.ok) return r.response;
  const body = await req.json().catch(() => null);
  const email = normalizeStoreEmail(body?.storeEmail);
  if (!isPlatform(body?.platform) || !email) return fail('플랫폼과 올바른 스토어 계정 이메일을 입력하세요.');
  const { data: existing, error: readError } = await r.admin.from('mobile_app_requests').select('id,status,store_email,revision').eq('user_id', r.userId).eq('platform', body.platform).maybeSingle();
  if (readError) return fail('신청 상태를 확인하지 못했습니다.', 500);
  if (existing?.status === 'processing') return fail('관리자가 처리 중입니다. 이메일 변경은 처리 완료 후 신청해 주세요.', 409);
  if (existing && (!validRevision(body.revision) || body.revision !== existing.revision)) return fail('신청 상태가 변경되었습니다. 새로고침 후 다시 확인하세요.', 409);
  if (existing?.status === 'approved' && existing.store_email === email) return fail('이미 등록 완료된 계정입니다.', 409);
  const now = new Date().toISOString();
  const fields = { store_email: email, status: 'pending', admin_note: '', reviewed_by: null, reviewed_at: null, submitted_at: now, updated_at: now };
  const query = existing
    ? r.admin.from('mobile_app_requests').update({ ...fields, revision: existing.revision + 1 }).eq('id', existing.id).eq('user_id', r.userId).eq('revision', existing.revision)
    : r.admin.from('mobile_app_requests').insert({ ...fields, user_id: r.userId, platform: body.platform });
  const { data, error } = await query.select(REQUEST_FIELDS).maybeSingle();
  if (error?.code === '23505' || (!error && !data)) return fail('신청 상태가 변경되었습니다. 새로고침 후 다시 확인하세요.', 409);
  if (error) return fail('신청을 저장하지 못했습니다.', 500);
  return NextResponse.json({ item: data });
}
