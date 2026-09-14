// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
const m=vi.hoisted(()=>({rpc:vi.fn(),deny:false}));
vi.mock("@/lib/marketing/server",async original=>({...await original<typeof import("@/lib/marketing/server")>(),marketingAuth:async()=>{if(m.deny)throw new Error("접근 권한 없음");return {db:{rpc:m.rpc}};}}));
import {GET} from "@/app/api/marketing/validation-runs/[id]/export/route";
const run={id:"run1",created_at:"2026-09-14T00:00:00Z",actor_name:"검사",scope:"filtered",status:"completed",total:501,processed:501,filters:{category:"IT기업"},rules:[{title:"연락처 확인",version:2,config:{operator:"required",field:"phone"}}]};
const target=(i:number)=>({snapshot:{id:String(i),db_id:`DB${i}`,data:{company:"한빛",name:"홍길동",phone:"01000120034"}},stale:false,results:[{rule_index:1,outcome:"fail",severity:"warning",detail:{field:"phone",actual:"=1+1",message:"확인 필요"}}]});
beforeEach(()=>{m.deny=false;m.rpc.mockReset().mockImplementation(async(_name,args)=>({data:{run,total:501,exportToken:"same",rulesChanged:false,counts:{fail:501},rows:args.p_page===1?Array.from({length:500},(_,i)=>target(i)): [target(500)]}}));});
it("exports all matching results across server pages with explicit text and execution metadata",async()=>{
 const response=await GET(new NextRequest("https://test/api?outcome=fail"),{params:Promise.resolve({id:"run1"})});if(response.status!==200)throw new Error(JSON.stringify(await response.json()));
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await response.arrayBuffer());
 const sheet=workbook.getWorksheet("검증 결과")!;expect(sheet.rowCount).toBe(502);expect(sheet.getCell("I2").value).toBe("=1+1");expect(sheet.getCell("A502").value).toBe("DB500");expect(workbook.getWorksheet("실행 정보")).toBeDefined();expect(m.rpc).toHaveBeenCalledTimes(2);
});
it("rejects a mixed export if progress or followup state changes between pages",async()=>{
 m.rpc.mockImplementation(async(_name,args)=>({data:{run,total:501,exportToken:args.p_page===1?"first":"changed",counts:{},rows:args.p_page===1?Array.from({length:500},(_,i)=>target(i)):[target(500)]}}));
 const response=await GET(new NextRequest("https://test/api"),{params:Promise.resolve({id:"run1"})});expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:expect.stringContaining("상태가 바뀌었습니다")});
});
it("checks marketing access before reading validation data",async()=>{m.deny=true;const response=await GET(new NextRequest("https://test/api"),{params:Promise.resolve({id:"run1"})});expect(response.status).not.toBe(200);expect(m.rpc).not.toHaveBeenCalled();});
