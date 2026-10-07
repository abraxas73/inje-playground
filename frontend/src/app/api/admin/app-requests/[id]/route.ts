import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminClientOr500 } from '@/lib/claude-usage/require-admin';
import { canProcess, REQUEST_FIELDS, validRevision } from '@/lib/mobile/app-requests';
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(); if (!auth.ok) return auth.response;
  const r = adminClientOr500(); if (!r.ok) return r.response;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail('잘못된 신청 ID입니다.');
  const body = await req.json().catch(() => null);
  if (!body || !validRevision(body.revision) || typeof body.note !== 'string' || body.note.length > 2000) return fail('처리 상태와 안내 내용을 확인하세요.');
  const note = body.note.trim();
  if (body.status === 'rejected' && !note) return fail('반려 사유를 입력하세요.');
  const { data: row, error } = await r.admin.from('mobile_app_requests').select('status,revision').eq('id', id).maybeSingle();
  if (error) return fail('신청을 불러오지 못했습니다.', 500);
  if (!row) return fail('신청을 찾을 수 없습니다.', 404);
  if (row.revision !== body.revision || !canProcess(row.status, body.status)) return fail('신청 상태가 변경되었거나 처리할 수 없는 상태입니다. 새로고침하세요.', 409);
  const now = new Date().toISOString();
  const { data, error: updateError } = await r.admin.from('mobile_app_requests').update({ status: body.status, admin_note: note, reviewed_by: auth.userId, reviewed_at: now, updated_at: now, revision: row.revision + 1 }).eq('id', id).eq('revision', row.revision).select(REQUEST_FIELDS).maybeSingle();
  if (updateError) return fail('처리 결과를 저장하지 못했습니다.', 500);
  if (!data) return fail('다른 작업으로 신청이 변경되었습니다. 새로고침하세요.', 409);
  return NextResponse.json({ item: data });
}
