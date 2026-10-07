// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { signState } from '@/lib/ms/crypto';
import { encryptionKey } from '@/lib/jira/config';
const m=vi.hoisted(()=>({ authorized:true, exchange:vi.fn(), resource:vi.fn(), me:vi.fn(), upsert:vi.fn(), user:vi.fn() }));
vi.mock('@/lib/rfp/require-user',()=>({requireUser:async()=>m.authorized ? {ok:true,userId:'user',admin:{from:()=>({upsert:m.upsert}),auth:{admin:{getUserById:m.user}}}} : {ok:false,response:NextResponse.json({}, {status:401})}}));
vi.mock('@/lib/jira/oauth', async orig=>({...await orig<typeof import('@/lib/jira/oauth')>(),exchangeCode:m.exchange,companyResource:m.resource}));
vi.mock('@/lib/jira/client',async orig=>({...await orig<typeof import('@/lib/jira/client')>(),jiraRequest:m.me}));
vi.mock('@/lib/audit',()=>({logAudit:vi.fn()}));
import { GET as callback } from '@/app/api/jira/callback/route';
import { GET as connect } from '@/app/api/jira/connect/route';
const origin='https://inje-playground.vercel.app';
function req({user='user',cookie='nonce',app=false,expired=false,error=false}: {user?:string;cookie?:string;app?:boolean;expired?:boolean;error?:boolean}={}) {
 const state=signState({u:user,n:'nonce',r:'/settings',e:Math.floor(Date.now()/1000)+(expired?-1:600),...(app?{a:true as const}:{})},encryptionKey());
 return new NextRequest(origin+'/api/jira/callback?'+new URLSearchParams({state,code:'private-code',...(error?{error:'access_denied'}:{})}),{headers:{cookie:'jira_oauth_state='+cookie}});
}
beforeEach(()=>{
 vi.clearAllMocks();m.authorized=true;vi.stubEnv('MS_TOKEN_ENC_KEY','01'.repeat(32));vi.stubEnv('JIRA_CLIENT_ID','id');vi.stubEnv('JIRA_CLIENT_SECRET','secret');
 m.exchange.mockResolvedValue({accessToken:'private-access',refreshToken:'private-refresh',expiresIn:3600});m.resource.mockResolvedValue('base');m.me.mockResolvedValue({accountId:'me',active:true,emailAddress:'me@innogrid.com',displayName:'홍길동'});m.user.mockResolvedValue({data:{user:{email:'me@innogrid.com'}}});m.upsert.mockResolvedValue({error:null});
});
afterEach(()=>vi.unstubAllEnvs());
it('시작은 HttpOnly SameSite 쿠키와 서명된 state를 만들고 비밀을 노출하지 않는다',async()=>{
 const r=await connect(new NextRequest(origin+'/api/jira/connect?app_return=1'));
 expect(r.status).toBe(302);expect(r.headers.get('set-cookie')).toContain('HttpOnly');expect(r.headers.get('set-cookie')).toContain('SameSite=lax');
 const url=new URL(r.headers.get('location')!);expect(url.origin).toBe('https://auth.atlassian.com');expect(url.searchParams.get('state')).toBeTruthy();expect(url.toString()).not.toContain('secret');
 expect((await connect(new NextRequest('https://evil.test/api/jira/connect'))).status).toBe(400);
});
it('현재 사용자·쿠키·만기 불일치는 토큰을 교환하지 않는다',async()=>{
 for(const request of [req({user:'other'}),req({cookie:'wrong'}),req({expired:true})]) {
  const r=await callback(request);expect(r.headers.get('location')).toContain('jira_error=');
 }
 expect(m.exchange).not.toHaveBeenCalled();expect(m.upsert).not.toHaveBeenCalled();
});
it('취소하거나 다른 회사 이메일이면 저장하지 않는다',async()=>{
 expect((await callback(req({error:true}))).headers.get('location')).toContain('jira_error=');expect(m.exchange).not.toHaveBeenCalled();
 m.me.mockResolvedValue({accountId:'other',emailAddress:'other@innogrid.com'});
 expect((await callback(req())).headers.get('location')).toContain('jira_error=');expect(m.upsert).not.toHaveBeenCalled();
});
it('성공 시 현재 사용자 OAuth 연결을 암호화해 저장하고 state 쿠키를 소모한다',async()=>{
 const r=await callback(req());expect(r.headers.get('location')).toBe(origin+'/settings?jira_connected=1#jira');
 expect(r.headers.get('set-cookie')).toContain('Max-Age=0');expect(m.upsert.mock.calls[0][0]).toMatchObject({user_id:'user',auth_type:'oauth',account_id:'me'});
 expect(JSON.stringify(m.upsert.mock.calls)).not.toMatch(/private-access|private-refresh/);
});
it('앱에서 시작하면 비밀 없는 고정 딥링크로 자동 복귀한다',async()=>{
 const r=await callback(req({app:true}));const body=await r.text();expect(body).toContain('window.location.replace');expect(body).toContain('innogrid://login-callback?jira_connected=1');expect(body).not.toMatch(/private-code|private-access|private-refresh/);
});
it('미인증 콜백은 UTF-8 복구 안내를 표시하고 저장하지 않는다',async()=>{
 m.authorized=false;const r=await callback(req());expect(r.status).toBe(401);expect(r.headers.get('content-type')).toContain('charset=utf-8');expect(m.upsert).not.toHaveBeenCalled();
});
