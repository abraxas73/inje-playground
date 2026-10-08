import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AppRequestCard from '@/components/settings/AppRequestCard';
import AdminPage from '@/app/admin/app-requests/page';
afterEach(()=>vi.unstubAllGlobals());
const row={id:'r1',user_id:'u1',platform:'ios',store_email:'apple@example.com',status:'pending',admin_note:'',revision:1,submitted_at:'2026-10-08T00:00:00Z',updated_at:'2026-10-08T00:00:00Z',reviewed_at:null};
it('플랫폼마다 이메일을 따로 입력하고 본인 상태를 표시한다',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({items:[]})).mockResolvedValueOnce(Response.json({item:row}));vi.stubGlobal('fetch',fetch);
 render(<AppRequestCard/>);
 const apple=await screen.findByLabelText('Apple 계정 이메일');
 fireEvent.change(apple,{target:{value:'apple@example.com'}});
 fireEvent.submit(apple.closest('form')!);
 expect(await screen.findByText('신청 대기')).toBeInTheDocument();
 expect(screen.getByLabelText('Google Play 계정 이메일')).toHaveValue('');
 expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({platform:'ios',storeEmail:'apple@example.com'});
});
it('처리 결과·안내를 표시하고 처리 중인 플랫폼은 수정 불가',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({items:[{...row,status:'processing',admin_note:'등록 확인 중'},{...row,id:'r2',platform:'android',status:'approved'}]})));
 render(<AppRequestCard/>);
 expect(await screen.findByText('등록 확인 중')).toBeInTheDocument();
 expect(screen.getByLabelText('Apple 계정 이메일')).toBeDisabled();
 expect(screen.getByRole('link',{name:'Google Play에서 열기'})).toHaveAttribute('href','https://play.google.com/apps/internaltest/4701070333674267983');
});
it('신청 조회 실패시 빈 신청폼으로 오인하지 않으며 재시도 가능',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({error:'조회 실패'},{status:500})));
 render(<AppRequestCard/>);expect(await screen.findByRole('alert')).toHaveTextContent('조회 실패');
 expect(screen.queryByLabelText('Apple 계정 이메일')).toBeNull();
 expect(screen.getByRole('button',{name:'앱 신청 상태 새로고침'})).toBeEnabled();
});
it('관리자는 실제 등록 완료 확인 후에만 완료 처리한다',async()=>{
 const fetch=vi.fn().mockImplementation(async(_url:string,init?:RequestInit)=>Response.json(init?.method==='PATCH'?{item:{...row,status:'approved'}}:{items:[{...row,applicant:{name:'김사용',email:'work@example.com'}}],total:1}));
 vi.stubGlobal('fetch',fetch);render(<AdminPage/>);
 await screen.findByText('김사용 · iOS');
 fireEvent.change(screen.getByLabelText('처리 결과'),{target:{value:'approved'}});
 expect(screen.getByRole('button',{name:'처리 결과 저장'})).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox'));
 fireEvent.click(screen.getByRole('button',{name:'처리 결과 저장'}));
 await waitFor(()=>expect(fetch.mock.calls.some(x=>x[1]?.method==='PATCH')).toBe(true));
 await act(async()=>{});
 const call=fetch.mock.calls.find(x=>x[1]?.method==='PATCH')!;
 expect(JSON.parse(call[1]!.body as string)).toEqual({revision:1,status:'approved',note:''});
});
it('처리 중 신청은 상태를 그대로 두고 안내만 저장한다',async()=>{
 const fetch=vi.fn().mockImplementation(async(_url:string,init?:RequestInit)=>Response.json(init?.method==='PATCH'?{item:{...row,status:'processing'}}:{items:[{...row,status:'processing',applicant:{name:'김사용',email:'work@example.com'}}],total:1}));
 vi.stubGlobal('fetch',fetch);render(<AdminPage/>);
 await screen.findByText('김사용 · iOS');
 expect(screen.getByLabelText('처리 결과')).toHaveValue('processing');
 expect(screen.queryByRole('checkbox')).toBeNull();
 fireEvent.change(screen.getByLabelText('신청자에게 보여줄 안내'),{target:{value:'초대 수락 대기 중입니다.'}});
 fireEvent.click(screen.getByRole('button',{name:'처리 결과 저장'}));
 await waitFor(()=>expect(fetch.mock.calls.some(x=>x[1]?.method==='PATCH')).toBe(true));
 await act(async()=>{});
 const call=fetch.mock.calls.find(x=>x[1]?.method==='PATCH')!;
 expect(JSON.parse(call[1]!.body as string)).toEqual({revision:1,status:'processing',note:'초대 수락 대기 중입니다.'});
});
