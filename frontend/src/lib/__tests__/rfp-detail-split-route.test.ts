// @vitest-environment node
import { it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/rfp/requirements/[requirementId]/split/route";
const { requireUser }=vi.hoisted(()=>({requireUser:vi.fn()}));
vi.mock("@/lib/rfp/require-user",()=>({requireUser}));
const row={id:"r",project_id:"p",details:"ㅇ HCI\n  - 라이선스\n  - VM",updated_at:"2026-10-01T00:00:00Z",source:{blockIndex:3}};
let query: Record<string, ReturnType<typeof vi.fn>>;
let from: ReturnType<typeof vi.fn>;
beforeEach(()=>{
 query={};for(const name of ["select","eq","update"])query[name]=vi.fn(()=>query);
 query.maybeSingle=vi.fn().mockResolvedValueOnce({data:row,error:null}).mockResolvedValueOnce({data:{status:"ready",mapping_status:"ready"},error:null}).mockResolvedValueOnce({data:{...row,source:{...row.source,detailSplits:{"1":row.details}}},error:null});
 from=vi.fn(()=>query);requireUser.mockResolvedValue({ok:true,userId:"u",admin:{from}});
});
const request=(body:unknown)=>new NextRequest("http://localhost/api/rfp/requirements/r/split",{method:"POST",body:JSON.stringify(body)});
const params={params:Promise.resolve({requirementId:"r"})};
it("원문과 매핑을 보존하고 수정 시각 조건으로 저장",async()=>{
 const res=await POST(request({detailKey:"1",updatedAt:row.updated_at}),params);
 expect(res.status).toBe(200);
 expect((await res.json()).detailSplits).toEqual({"1":row.details});
 expect(query.update).toHaveBeenCalledWith({source:{blockIndex:3,detailSplits:{"1":row.details}},updated_by:"u"});
 expect(query.eq).toHaveBeenCalledWith("updated_at",row.updated_at);
 expect(from.mock.calls.every(([table])=>table!=="rfp_requirement_mappings")).toBe(true);
});
it("rejects stale data without writes",async()=>{
 expect((await POST(request({detailKey:"1",updatedAt:"old"}),params)).status).toBe(409);
 expect(query.update).not.toHaveBeenCalled();
});
it("rejects running mappings",async()=>{
 query.maybeSingle.mockReset().mockResolvedValueOnce({data:row}).mockResolvedValueOnce({data:{status:"ready",mapping_status:"running"}});
 expect((await POST(request({detailKey:"1",updatedAt:row.updated_at}),params)).status).toBe(409);
 expect(query.update).not.toHaveBeenCalled();
});
it("requires authentication",async()=>{
 requireUser.mockResolvedValueOnce({ok:false,response:new Response(null,{status:401})});
 expect((await POST(request({detailKey:"1",updatedAt:row.updated_at}),params)).status).toBe(401);
 expect(from).not.toHaveBeenCalled();
});
it("returns conflict for concurrent updates",async()=>{
 query.maybeSingle.mockReset().mockResolvedValueOnce({data:row}).mockResolvedValueOnce({data:{status:"ready",mapping_status:"ready"}}).mockResolvedValueOnce({data:null});
 expect((await POST(request({detailKey:"1",updatedAt:row.updated_at}),params)).status).toBe(409);
});
