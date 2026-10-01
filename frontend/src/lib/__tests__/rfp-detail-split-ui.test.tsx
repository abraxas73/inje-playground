import { it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MappingEditor from "@/components/rfp/MappingEditor";
import { parseDetailUnits } from "@/lib/rfp/mapping/detail-items";
import type { RfpRequirement } from "@/types/rfp";
it("splits the clicked group, renders independent children and persists on reload",async()=>{
 const requirement={id:"r",reqId:"ECR-003",title:"HCI",details:"ㅇ 수량\nㅇ HCI 관리\n  - 영구 라이선스\n    ※ 10년\n  - VM 관리",updatedAt:"now"} as RfpRequirement;
 const change=vi.fn();const base={projectId:"p",rows:[],catalog:[],solutions:[],llmAvailable:false,maxCandidates:2,running:false,onRunMapping:vi.fn(),onChange:vi.fn(),onRequirementChange:change};
 const updated={...requirement,detailSplits:{"2":parseDetailUnits(requirement.details).units[1].text}};
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>updated});vi.stubGlobal("fetch",fetcher);
 const view=render(<MappingEditor {...base} requirement={requirement}/>);
 fireEvent.click(screen.getByRole("button",{name:"더 상세하게 추출"}));
 await waitFor(()=>expect(change).toHaveBeenCalledWith(updated));
 expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({detailKey:"2",updatedAt:"now"});
 view.rerender(<MappingEditor {...base} requirement={updated}/>);
 expect(screen.getByText("영구 라이선스")).toBeInTheDocument();
 expect(screen.getByText("VM 관리")).toBeInTheDocument();
 expect(screen.queryByRole("button",{name:"더 상세하게 추출"})).not.toBeInTheDocument();
 view.unmount();vi.unstubAllGlobals();
});

it("상위 그룹 일괄 실행과 하위 개별 실행은 각각의 키를 전달", async () => {
 const details = "○ HCI\n  - 라이선스\n  - VM\n○ 컨테이너\n  - 배포\n  - 로그";
 const requirement = {id:"r",reqId:"ECR-003",title:"도구",details,detailSplits:Object.fromEntries(parseDetailUnits(details).units.map(u=>[u.key,u.text]))} as RfpRequirement;
 const run = vi.fn().mockResolvedValue(undefined);
 const view = render(<MappingEditor projectId="p" requirement={requirement} rows={[]} catalog={[]} solutions={[{code:"s",name:"솔루션",featureCount:1}]} llmAvailable={false} maxCandidates={2} running={false} onRunMapping={run} onChange={vi.fn()} onRequirementChange={vi.fn()}/>);
 expect(Array.from(view.container.querySelectorAll("section")).map(s=>s.querySelector("span")?.textContent)).toEqual(["1","1.1","1.2","2","2.1","2.2"]);
 fireEvent.click(screen.getAllByRole("button",{name:"하위 항목 일괄 매핑"})[0]);
 fireEvent.click(screen.getByRole("button",{name:"하위 항목 일괄 매핑 그룹 1의 하위 항목 2개"}));
 await waitFor(()=>expect(run).toHaveBeenCalledWith(expect.objectContaining({engine:"rules"}),{requirementIds:["r"],detailKey:"1"}));
 await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
 fireEvent.click(screen.getAllByRole("button",{name:"다시 매핑"})[1]);
 fireEvent.click(screen.getByRole("button",{name:"다시 매핑 세부 항목 1.1"}));
 await waitFor(()=>expect(run).toHaveBeenLastCalledWith(expect.anything(),{requirementIds:["r"],detailKey:"1.1"}));
 view.unmount();
});
