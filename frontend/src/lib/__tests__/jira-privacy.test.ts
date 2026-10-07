// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { cycleSeconds, reportAccounts } from '@/lib/jira/privacy';
import { GET } from '@/app/api/cron/jira-privacy/route';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('Atlassian 주기를 준수하며 기본값은 7일',()=>{
 expect(cycleSeconds(null)).toBe(604800); expect(cycleSeconds('P14D')).toBe(1209600);expect(cycleSeconds('3600')).toBe(3600);
});
it('보고한 계정 중 closed·updated만 삭제 대상으로 삼는다',async()=>{
 const fetch=vi.fn().mockResolvedValue(Response.json({accounts:[{accountId:'one',status:'closed'},{accountId:'two',status:'updated'},{accountId:'unknown',status:'closed'}]},{headers:{'Cycle-Period':'P7D'}}));vi.stubGlobal('fetch',fetch);
 const r=await reportAccounts('token',[{accountId:'one',updatedAt:'2026-10-07'},{accountId:'two',updatedAt:'2026-10-07'}]);expect(r.erase).toEqual(['one','two']);
 expect(fetch.mock.calls[0][0]).toBe('https://api.atlassian.com/app/report-accounts/');
});
it('429는 Retry-After 이후로 미루고 즉시 재시도하지 않는다',async()=>{
 const fetch=vi.fn().mockResolvedValue(new Response('',{status:429,headers:{'Retry-After':'10000'}}));vi.stubGlobal('fetch',fetch);
 expect((await reportAccounts('t',[])).retry).toBe(10000);expect(fetch).toHaveBeenCalledTimes(1);
});
it('보고 작업은 cron 비밀 없이는 실행되지 않는다',async()=>{
 vi.stubEnv('CRON_SECRET','private');expect((await GET(new NextRequest('https://app.test/api/cron/jira-privacy'))).status).toBe(401);
});
