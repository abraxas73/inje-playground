export const APP_PLATFORMS = ['ios', 'android'] as const;
export type AppPlatform = typeof APP_PLATFORMS[number];
export const REQUEST_STATUS = { pending: '신청 대기', processing: '처리 중', approved: '등록 완료', rejected: '반려' } as const;
export type RequestStatus = keyof typeof REQUEST_STATUS;
export type AppRequest = {
  id: string; user_id: string; platform: AppPlatform; store_email: string; status: RequestStatus;
  admin_note: string; submitted_at: string; updated_at: string; reviewed_at: string | null; revision: number;
};
export type AdminAppRequest = AppRequest & { applicant: { name: string | null; email: string | null } };
export const REQUEST_FIELDS = 'id,user_id,platform,store_email,status,admin_note,submitted_at,updated_at,reviewed_at,revision';
export function isPlatform(v: unknown): v is AppPlatform { return v === 'ios' || v === 'android'; }
export function validRevision(v: unknown): v is number { return typeof v === 'number' && Number.isSafeInteger(v) && v > 0; }
export function normalizeStoreEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const email = v.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
export function canProcess(from: RequestStatus, to: unknown): to is RequestStatus {
  return (from === 'pending' || from === 'processing') && (to === 'processing' || to === 'approved' || to === 'rejected');
}
