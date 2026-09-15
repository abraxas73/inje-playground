import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ContactForm from "@/components/marketing/ContactForm";
import OrganizationEditor from "@/components/marketing/OrganizationEditor";
import { emptyContact, type Organization } from "@/lib/marketing/types";
const org: Organization = { id:"10000000-0000-4000-8000-000000000001", name:"한빛", category:"IT기업", aliases:["HANBIT"],version:3,review_status:"confirmed" };
const data = {...emptyContact(),company:"한빛",name:"김서연",email:"person@example.com"};
function stub(rows = [org]) {
 const fetch = vi.fn(async (url: string, options?: RequestInit) => ({ok:true,json:async()=>url.includes('/rules')?{rules:[]}:options?.method==='POST'?{results:[{status:"submitted",id:"s1"}]}:{rows,total:rows.length,pageSize:25}}));vi.stubGlobal('fetch',fetch);return fetch;
}
afterEach(()=>vi.unstubAllGlobals());
it("requires selecting an existing company, preserves the draft, and submits its canonical ID/version", async()=>{
 const fetch=stub();const saved=vi.fn();render(<ContactForm initial={data} dbId="DB-001" onSaved={saved} onClose={()=>{}}/>);
 expect(screen.getByRole('button',{name:'검증 후 제출'})).toBeDisabled();
 fireEvent.change(screen.getByRole('combobox',{name:'회사명 *'}),{target:{value:'HANBIT'}});
 fireEvent.click(await screen.findByRole('option',{name:/한빛.*IT기업/}));
 expect(screen.getByRole('combobox')).toHaveValue('한빛');
 expect(screen.getByRole('link',{name:/회사·기관에서 먼저 등록/})).toHaveAttribute('target','_blank');
 expect(screen.getByLabelText('성명')).toHaveValue('김서연');
 fireEvent.click(screen.getByRole('button',{name:'검증 후 제출'}));await waitFor(()=>expect(saved).toHaveBeenCalled());
 const post=fetch.mock.calls.find(([url])=>url.includes('/submissions'))!;
 expect(JSON.parse(String(post[1]?.body))).toMatchObject({mode:'form',rows:[{organizationId:org.id,organizationVersion:3,data:{company:'한빛',name:'김서연'},dbId:'DB-001'}]});
});
it("loads an existing relation by ID, but editing the name invalidates selection", async()=>{
 stub();render(<ContactForm initial={data} initialOrganizationId={org.id} onSaved={()=>{}} onClose={()=>{}}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'검증 후 제출'})).toBeEnabled());
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'없는회사'}});
 expect(screen.getByRole('button',{name:'검증 후 제출'})).toBeDisabled();
});
it("does not auto-select same-name organizations, and supports keyboard selection", async()=>{
 stub([org,{...org,id:'10000000-0000-4000-8000-000000000002',category:'금융'}]);render(<ContactForm initial={data} onSaved={()=>{}} onClose={()=>{}}/>);
 await screen.findByRole('option',{name:/한빛.*금융/});expect(screen.getByRole('button',{name:'검증 후 제출'})).toBeDisabled();
 const input=screen.getByRole('combobox');fireEvent.keyDown(input,{key:'ArrowDown'});fireEvent.keyDown(input,{key:'ArrowDown'});fireEvent.keyDown(input,{key:'Enter'});
 expect(screen.getByText(/선택됨 · 한빛 · 금융/)).toBeInTheDocument();
});
it("discards late search results after the query changes", async()=>{
 let resolveOld:(value:unknown)=>void=()=>{};
 vi.stubGlobal('fetch',vi.fn((url:string)=> url.includes('/rules')?Promise.resolve({ok:true,json:async()=>({rules:[]})}):url.includes('q=old')?new Promise(resolve=>{resolveOld=resolve;}):Promise.resolve({ok:true,json:async()=>({rows:[],total:0,pageSize:25})})));
 render(<ContactForm onSaved={()=>{}} onClose={()=>{}}/>);const input=screen.getByRole('combobox');
 fireEvent.change(input,{target:{value:'old'}});await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([u])=>String(u).includes('q=old'))).toBe(true));
 fireEvent.change(input,{target:{value:'new'}});await screen.findByText('등록된 회사·기관이 없습니다. 회사·기관에 먼저 등록해 주세요.');
 await act(async()=>resolveOld({ok:true,json:async()=>({rows:[org],total:1,pageSize:25})}));
 expect(screen.queryByRole('option')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'검증 후 제출'})).toBeDisabled();
});
it("creates a company separately with audit reason and a stable retry ID",async()=>{
 const fetch=stub();const saved=vi.fn();render(<OrganizationEditor onSaved={saved} onClose={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('표준명'),{target:{value:'신규 회사'}});
 fireEvent.change(screen.getByLabelText('등록 사유 / 회사·기관 확인 근거'),{target:{value:'사업자 등록정보 확인'}});
 fireEvent.click(screen.getByRole('button',{name:'회사·기관 등록'}));await waitFor(()=>expect(saved).toHaveBeenCalled());
 const body=JSON.parse(String(fetch.mock.calls[0][1]?.body));expect(body).toMatchObject({action:'create',name:'신규 회사',category:'확인 필요',reviewStatus:'pending',separate:false,reason:'사업자 등록정보 확인'});expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
 expect(fetch.mock.calls[0][0]).toBe('/api/marketing/organizations');
});
