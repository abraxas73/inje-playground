// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const m = vi.hoisted(() => ({ userOk: true, adminOk: true, results: [] as unknown[], calls: [] as Array<[string, ...unknown[]]>, from: vi.fn() }));
vi.mock('@/lib/rfp/require-user', () => ({ requireUser: async () => m.userOk ? { ok:true, userId:'self', admin:{from:m.from} } : {ok:false,response:NextResponse.json({}, {status:401})} }));
vi.mock('@/lib/claude-usage/require-admin', () => ({ requireAdmin: async () => m.adminOk ? {ok:true,userId:'admin'} : {ok:false,response:NextResponse.json({}, {status:403})}, adminClientOr500: () => ({ok:true,admin:{from:m.from}}) }));
import { GET, POST } from '@/app/api/mobile/app-requests/route';
import { GET as adminGET } from '@/app/api/admin/app-requests/route';
import { PATCH } from '@/app/api/admin/app-requests/[id]/route';
const id = '11111111-1111-4111-8111-111111111111';
const ctx = {params:Promise.resolve({id})};
const post = (body: unknown) => POST(new NextRequest('http://localhost/api/mobile/app-requests', {method:'POST', body:JSON.stringify(body)}));
const patch = (body: unknown) => PATCH(new NextRequest('http://localhost/api/admin/app-requests/'+id, {method:'PATCH',body:JSON.stringify(body)}),ctx);
beforeEach(() => {
  m.userOk=true; m.adminOk=true; m.results=[];m.calls=[];
  m.from.mockReset().mockImplementation((table: string) => {
    m.calls.push(['from',table]);
    const result=m.results.shift() ?? {data:null,error:null};
    const chain: Record<string,unknown> = {then:(resolve: (x:unknown)=>unknown) => Promise.resolve(result).then(resolve)};
    for(const method of ['select','eq','order','range','in','insert','update']) chain[method]=(...args:unknown[]) => {m.calls.push([method,...args]);return chain;};
    chain.maybeSingle=async()=>result;
    return chain;
  });
});
it('非로그인 신청/조회 및 일반 사용자 관리자 처리를 차단한다',async()=>{
  m.userOk=false;m.adminOk=false;
  expect((await GET()).status).toBe(401);expect((await post({})).status).toBe(401);
  expect((await adminGET(new NextRequest('http://localhost/api/admin/app-requests'))).status).toBe(403);
  expect((await patch({})).status).toBe(403);expect(m.from).not.toHaveBeenCalled();
});
it('개인 조회는 현재 세션 사용자로만 제한한다',async()=>{
  m.results=[{data:[],error:null}];await GET();expect(m.calls).toContainEqual(['eq','user_id','self']);
});
it('신청은 본인 소유·대기 상태로 강제하고 이메일을 정규화한다',async()=>{
  m.results=[{data:null,error:null},{data:{id},error:null}];
  expect((await post({platform:'ios',storeEmail:' Test@Example.com ',user_id:'other',status:'approved'})).status).toBe(200);
  const fields=m.calls.find(x=>x[0]==='insert')?.[1];
  expect(fields).toMatchObject({user_id:'self',platform:'ios',store_email:'test@example.com',status:'pending',admin_note:'',reviewed_by:null});
});
it.each([{platform:'desktop',storeEmail:'a@b.com'},{platform:'ios',storeEmail:'bad'},{platform:'ios',storeEmail:'a@b.com\nb@c.com'}])('잘못된 신청은 쓰기 전에 거부: %j',async body=>{
  expect((await post(body)).status).toBe(400);expect(m.from).not.toHaveBeenCalled();
});
it('처리 중에는 이메일을 변경할 수 없다',async()=>{
  m.results=[{data:{id,status:'processing',revision:2},error:null}];expect((await post({platform:'ios',storeEmail:'a@b.com',revision:2})).status).toBe(409);expect(m.calls.some(x=>x[0]==='update')).toBe(false);
});
it('이메일 변경은 소유권과 revision을 조건으로 재신청한다',async()=>{
  m.results=[{data:{id,status:'approved',store_email:'old@b.com',revision:2},error:null},{data:{id},error:null}];
  expect((await post({platform:'ios',storeEmail:'new@b.com',revision:2})).status).toBe(200);
  expect(m.calls).toContainEqual(['eq','revision',2]);expect(m.calls).toContainEqual(['eq','user_id','self']);
  expect(m.calls.find(x=>x[0]==='update')?.[1]).toMatchObject({status:'pending',revision:3,admin_note:'',reviewed_by:null});
});
it('중복 생성 및 변경 충돌은 409로 처리한다',async()=>{
  m.results=[{data:null,error:null},{data:null,error:{code:'23505'}}];expect((await post({platform:'android',storeEmail:'a@b.com'})).status).toBe(409);
  m.results=[{data:{id,status:'pending',revision:3},error:null}];expect((await post({platform:'ios',storeEmail:'a@b.com',revision:2})).status).toBe(409);
});
it('반려 사유는 필수이고 관리자만 처리자 정보 및 상태를 저장한다',async()=>{
  expect((await patch({status:'rejected',note:' ',revision:1})).status).toBe(400);
  m.results=[{data:{status:'pending',revision:1},error:null},{data:{id},error:null}];
  expect((await patch({status:'approved',note:'초대 완료',revision:1})).status).toBe(200);
  expect(m.calls.find(x=>x[0]==='update')?.[1]).toMatchObject({status:'approved',reviewed_by:'admin',revision:2,admin_note:'초대 완료'});
  expect(m.calls).toContainEqual(['eq','revision',1]);
});
it('관리자가 오래된 신청을 처리하거나 최종 상태를 덮어쓰지 못한다',async()=>{
  m.results=[{data:{status:'pending',revision:2},error:null}];expect((await patch({status:'approved',note:'',revision:1})).status).toBe(409);
  m.results=[{data:{status:'approved',revision:2},error:null}];expect((await patch({status:'rejected',note:'반려',revision:2})).status).toBe(409);
  m.results=[{data:{status:'processing',revision:2},error:null},{data:null,error:null}];expect((await patch({status:'approved',note:'',revision:2})).status).toBe(409);
});
it('관리자 목록은 필터와 페이지를 적용하고 신청자를 함께 반환한다',async()=>{
  m.results=[{data:[{id,user_id:'self'}],error:null,count:1},{data:[{user_id:'self',display_name:'신청자',email:'work@company.com'}],error:null}];
  const res=await adminGET(new NextRequest('http://localhost/api/admin/app-requests?status=pending&platform=ios&page=1'));
  expect((await res.json()).items[0].applicant.name).toBe('신청자');
  expect(m.calls).toContainEqual(['eq','status','pending']);expect(m.calls).toContainEqual(['range',50,99]);
});
it('처리 중 안내만 수정할 때 상태와 기존 처리일을 유지하고 충돌을 방지한다',async()=>{
  m.results=[{data:{status:'processing',revision:2},error:null},{data:{id},error:null}];
  expect((await patch({status:'processing',note:'초대 수락 대기',revision:2})).status).toBe(200);
  const update=m.calls.find(x=>x[0]==='update')?.[1];
  expect(update).toMatchObject({status:'processing',admin_note:'초대 수락 대기',revision:3});
  expect(update).not.toHaveProperty('reviewed_at');expect(update).not.toHaveProperty('reviewed_by');
  expect(m.calls).toContainEqual(['eq','revision',2]);
  m.calls=[];m.results=[{data:{status:'processing',revision:3},error:null}];
  expect((await patch({status:'processing',note:'오래된 안내',revision:2})).status).toBe(409);
  expect(m.calls.some(x=>x[0]==='update')).toBe(false);
});
