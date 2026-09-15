// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m=vi.hoisted(()=>({rpc:vi.fn(),auth:vi.fn()}));
vi.mock("@/lib/marketing/server",async original=>({...await original<typeof import("@/lib/marketing/server")>(),marketingAuth:m.auth}));
import { GET,POST } from "@/app/api/marketing/organizations/route";
const id="10000000-0000-4000-8000-000000000001";
beforeEach(()=>{m.auth.mockReset().mockResolvedValue({db:{rpc:m.rpc}});m.rpc.mockReset().mockResolvedValue({data:{id}});});
it("searches literal names and aliases with pagination through the access-checked RPC",async()=>{
 expect((await GET(new NextRequest('https://test.local/api/marketing/organizations?q=HANBIT&page=2'))).status).toBe(200);
 expect(m.rpc).toHaveBeenCalledWith('marketing_find_organizations',{p_q:'HANBIT',p_page:2,p_id:null});
});
it("requires reviewer authentication for separate company registration",async()=>{
 const b={action:'create',id,name:'한빛',aliases:[],category:'IT기업',reason:'등록 근거',reviewStatus:'confirmed',separate:false};
 const response=await POST(new NextRequest('https://test.local/api/marketing/organizations',{method:'POST',body:JSON.stringify(b)}));
 expect(response.status).toBe(200);expect(m.auth).toHaveBeenCalledWith(true);expect(m.rpc).toHaveBeenCalledWith('marketing_create_organization',{p_id:id,p_name:b.name,p_aliases:[],p_category:b.category,p_reason:b.reason,p_review_status:'confirmed',p_separate:false});
});
it("rejects malformed IDs and arbitrary separate flags before calling DB",async()=>{
 expect((await GET(new NextRequest('https://test.local/api/marketing/organizations?id=invalid'))).status).toBe(400);
 expect((await POST(new NextRequest('https://test.local/api/marketing/organizations',{method:'POST',body:JSON.stringify({action:'create',id,aliases:[],separate:'true'})}))).status).toBe(400);
 expect(m.rpc).not.toHaveBeenCalled();
});
