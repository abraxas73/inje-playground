import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ValidationRunDialog from "@/components/marketing/ValidationRunDialog";
import MasterTable from "@/components/marketing/MasterTable";
import RuleManager from "@/components/marketing/RuleManager";
import { blankRule } from "@/lib/marketing/rule-management";
import { emptyContact } from "@/lib/marketing/types";
const {push}=vi.hoisted(()=>({push:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({push})}));
afterEach(()=>{vi.unstubAllGlobals();push.mockReset();});
it("executes one selected rule against all filtered contacts, not the current page",async()=>{
 const rule={...blankRule(),id:"r1",title:"Eco ID 필수",version:4};
 const fetch=vi.fn(async(url:string,options?:RequestInit)=>({ok:true,json:async()=>url==="/api/marketing/rules"?{rules:[rule],editable:true}:url.includes("view=meta")?{total:7294}:options?.body?{id:"run1"}:{total:2149}}));
 vi.stubGlobal("fetch",fetch);render(<ValidationRunDialog filters={{category:"IT기업",issues:false}} filteredCount={2149} ids={["c1","c2"]} initialRules={[rule]} onClose={()=>{}}/>);
 await screen.findByText("전체 Master · 7,294건");fireEvent.change(screen.getByLabelText("검증 대상"),{target:{value:"filtered"}});fireEvent.click(screen.getByRole("button",{name:"1개 규칙으로 2,149건 검증"}));
 await waitFor(()=>expect(push).toHaveBeenCalledWith("/marketing/validations/run1"));
 const body=JSON.parse(String(fetch.mock.calls.find(([url])=>url==="/api/marketing/validation-runs")?.[1]?.body));expect(body).toMatchObject({scope:"filtered",ids:[],rules:[{id:"r1",version:4}],filters:{category:"IT기업"}});
});
it("preserves other-page selections while toggling the visible page, and sorting is one click",()=>{
 const onSelection=vi.fn();const onSort=vi.fn();const c={id:"c1",db_id:"DB1",version:1,organization_id:null,data:emptyContact()};
 render(<MasterTable contacts={[c]} onOpen={()=>{}} sort="db_id" direction="asc" onSort={onSort} selectedIds={["outside"]} onSelection={onSelection}/>);
 fireEvent.click(screen.getByLabelText("현재 페이지 Contact 전체 선택"));expect(onSelection).toHaveBeenCalledWith(["outside","c1"]);
 fireEvent.click(screen.getByRole("button",{name:"DB ID 내림차순 정렬"}));expect(onSort).toHaveBeenCalledOnce();expect(onSort).toHaveBeenCalledWith("db_id");
});
it("opens original protected rules for editing and saves a draft without publishing",async()=>{
 const rule={...blankRule(),id:"r1",code:"EXCEL-14",title:"최종확인일 형식",protected:true,version:2};
 const fetch=vi.fn(async(_url:string,options?:RequestInit)=>({ok:true,json:async()=>options?.body?{draft:{id:"draft1",revision:1}}:{rules:[rule],drafts:[],versions:[],editable:true}}));
 vi.stubGlobal("fetch",fetch);render(<RuleManager/>);fireEvent.click(await screen.findByRole("button",{name:"수정"}));fireEvent.change(screen.getByLabelText("규칙 이름"),{target:{value:"확인일 검사"}});fireEvent.change(screen.getByLabelText("변경 사유"),{target:{value:"업무 기준 변경"}});fireEvent.click(screen.getByRole("button",{name:"초안 저장"}));
 await screen.findByText("수정본을 저장했습니다. 현재 적용 규칙은 유지됩니다.");const b=JSON.parse(String(fetch.mock.calls.find(([,o])=>o?.body)?.[1]?.body));expect(b).toMatchObject({action:"draft",ruleId:"r1",baseVersion:2,definition:{title:"확인일 검사"}});
});
