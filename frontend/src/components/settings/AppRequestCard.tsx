"use client";
import { useCallback, useEffect, useState } from 'react';
import { Apple, Smartphone, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { APP_PLATFORMS, REQUEST_STATUS, type AppPlatform, type AppRequest } from '@/lib/mobile/app-requests';
import { ANDROID_INTERNAL_TEST_URL } from '@/lib/mobile/release';
export default function AppRequestCard() {
  const [items, setItems] = useState<AppRequest[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/mobile/app-requests', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '신청 내역을 불러오지 못했습니다.');
      setItems(data.items);
    } catch (e) { setError(e instanceof Error ? e.message : '조회에 실패했습니다.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  return <Card id="app-request" className="scroll-mt-20">
    <CardHeader className="pb-3">
      <div className="flex items-center justify-between gap-2"><CardTitle className="flex items-center gap-2 text-base"><Smartphone className="h-4 w-4" />앱 사용 신청</CardTitle><Button size="sm" variant="ghost" onClick={load} disabled={loading} aria-label="앱 신청 상태 새로고침"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button></div>
      <p className="text-xs text-muted-foreground">사용할 플랫폼별로 신청하세요. 관리자가 테스터로 등록하면 여기에서 결과를 확인할 수 있습니다.</p>
    </CardHeader>
    <CardContent className="space-y-4">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {items === null ? <p role="status" className="text-sm text-muted-foreground">{loading ? '신청 내역을 불러오는 중…' : '새로고침으로 다시 확인해 주세요.'}</p> : APP_PLATFORMS.map(platform => {
        const item = items.find(x => x.platform === platform);
        return <PlatformForm key={`${platform}-${item?.revision ?? 0}`} platform={platform} item={item} onSaved={next => setItems(prev => [...(prev ?? []).filter(x => x.platform !== next.platform), next])} />;
      })}
      <p className="text-xs text-muted-foreground">스토어 계정 이메일은 테스터 등록과 신청 처리에 사용하며 본인과 관리자만 확인합니다. 비밀번호는 입력하지 마세요.</p>
    </CardContent>
  </Card>;
}
function PlatformForm({ platform, item, onSaved }: { platform: AppPlatform; item?: AppRequest; onSaved: (item: AppRequest) => void }) {
  const ios = platform === 'ios';
  const title = ios ? 'iOS · TestFlight' : 'Android · Google Play';
  const [email, setEmail] = useState(item?.store_email ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = item?.status === 'processing';
  const unchanged = email.trim().toLowerCase() === item?.store_email;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const res = await fetch('/api/mobile/app-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform, storeEmail: email, revision: item?.revision }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '신청하지 못했습니다.');
      onSaved(data.item);
    } catch (e) { setError(e instanceof Error ? e.message : '신청에 실패했습니다.'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-3 rounded-lg border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold">{ios ? <Apple className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}{title}</h3><Badge variant={item?.status === 'rejected' ? 'destructive' : 'secondary'}>{item ? REQUEST_STATUS[item.status] : '미신청'}</Badge></div>
    <div className="space-y-1"><label className="text-sm" htmlFor={`store-email-${platform}`}>{ios ? 'Apple 계정 이메일' : 'Google Play 계정 이메일'}</label><Input id={`store-email-${platform}`} type="email" required maxLength={254} autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} disabled={busy || locked} placeholder={ios ? 'Apple 계정에 사용하는 이메일' : 'Play 스토어에 로그인한 이메일'} /></div>
    {item && <p className="break-all text-xs text-muted-foreground">신청 계정: {item.store_email}<br />신청일: {new Date(item.submitted_at).toLocaleString('ko-KR')}</p>}
    {item?.admin_note && <div className="rounded-md bg-muted p-2 text-sm"><p className="font-medium">관리자 안내</p><p className="whitespace-pre-wrap break-words">{item.admin_note}</p></div>}
    {locked && <p className="text-xs text-muted-foreground">관리자가 등록을 처리하고 있습니다. 처리 중에는 이메일을 변경할 수 없습니다.</p>}
    {item?.status === 'approved' && <div className="space-y-2 text-sm">
      <p>{ios ? '신청한 이메일로 받은 TestFlight 초대를 확인하고 앱을 설치하세요.' : '신청한 Google 계정으로 테스트에 참여하세요. 브라우저와 Play 스토어에서 같은 계정을 사용해야 합니다.'}</p>
      {!ios && <Button variant="outline" size="sm" asChild><a href={ANDROID_INTERNAL_TEST_URL} target="_blank" rel="noreferrer">Google Play에서 열기</a></Button>}
      {!unchanged && <p className="text-xs text-muted-foreground">다른 이메일로 신청하면 신청 대기로 바뀌며, 관리자가 다시 등록해야 합니다.</p>}
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" variant="outline" size="sm" disabled={busy || locked || (!!item && unchanged && item.status !== 'rejected')}>{busy ? '저장 중…' : !item ? '신청하기' : item.status === 'rejected' ? '다시 신청' : '이메일 변경 신청'}</Button>
  </form>;
}
