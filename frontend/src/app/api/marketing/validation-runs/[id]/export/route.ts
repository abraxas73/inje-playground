import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { mkdtemp, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { dbCheck, failure, marketingAuth, MarketingError } from "@/lib/marketing/server";
import { OUTCOMES, RUN_STATUSES, RULE_FIELDS, type ValidationReport } from "@/lib/marketing/rule-management";
import { visibleData } from "@/lib/marketing/types";
export const runtime="nodejs";
export const maxDuration=300;
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}) {
 let directory:string|undefined; let workbook:ExcelJS.stream.xlsx.WorkbookWriter|undefined; let finalized=false;
 try {
  const {db}=await marketingAuth();const {id}=await params;const query=req.nextUrl.searchParams;
  const args={p_id:id,p_rule:Number(query.get("rule"))||0,p_outcome:query.get("outcome")??"",p_q:(query.get("q")??"").slice(0,100),p_followup:query.get("followup")??"",p_limit:500,p_severity:query.get("severity")??""};
  async function page(n:number){const r=await db.rpc("marketing_validation_report",{...args,p_page:n});dbCheck(r.error);return r.data as ValidationReport;}
  const first=await page(1);if(!first.run)throw new MarketingError("검증 실행을 찾을 수 없습니다.",404);
  directory=await mkdtemp(join(tmpdir(),"marketing-validation-"));const filename=join(directory,"results.xlsx");
  workbook=new ExcelJS.stream.xlsx.WorkbookWriter({filename,useStyles:true,useSharedStrings:false});
  const sheet=workbook.addWorksheet("검증 결과",{views:[{state:"frozen",ySplit:1}]});sheet.columns=[{header:"DB ID",width:17},{header:"회사명",width:28},{header:"성명",width:14},{header:"대상 필드",width:22},{header:"규칙",width:36},{header:"버전",width:10},{header:"판정",width:16},{header:"등급",width:12},{header:"검사 당시 값",width:28},{header:"기준·근거",width:64},{header:"관련 후보",width:40},{header:"현재 데이터",width:18},{header:"후속 처리",width:22},{header:"확인 근거",width:40}];sheet.getRow(1).font={bold:true};sheet.getRow(1).commit();
  let seen=0;let rows=0;
  for(let n=1;n<=Math.max(1,Math.ceil(first.total/500));n++){
   const report=n===1?first:await page(n);
   if(report.exportToken!==first.exportToken||report.total!==first.total)throw new MarketingError("다운로드 중 검증 진행 또는 후속 처리 상태가 바뀌었습니다. 다시 다운로드해 주세요.",409);
   for(const target of report.rows){seen++;const data=visibleData(target.snapshot);const results=target.results.length?target.results:[null];
    for(const result of results){const rule=result?first.run.rules[result.rule_index-1]:null;sheet.addRow([target.snapshot.db_id,data.company,data.name,result?.detail.field?RULE_FIELDS[result.detail.field as keyof typeof RULE_FIELDS]??result.detail.field:"",rule?.title??"",rule?String(rule.version):"",OUTCOMES[result?.outcome??"pending"],result?.severity==="error"?"오류":result?"확인 필요":"",result?.detail.actual??"",result?.detail.message??"아직 처리하지 않음",result?.detail.related?.map(x=>x.dbId??`${x.name} (${x.category})`).join(", ")??"",target.stale?"변경됨":"검사 당시와 동일",target.followup_stale?"재확인 필요":target.followup_status==="confirmed"?"확인 완료":target.followup_status==="deferred"?"보류":target.followup_status==="submitted"?"변경 요청 제출":"미처리",target.followup_reason??""]).commit();rows++;}
   }
  }
  if(seen!==first.total)throw new MarketingError("결과 일부를 읽지 못했습니다. 다시 다운로드해 주세요.",503);
  sheet.autoFilter={from:"A1",to:`N${rows+1}`};sheet.commit();
  const info=workbook.addWorksheet("실행 정보");info.columns=[{width:28},{width:110}];
  for(const row of [["실행 ID",id],["기준 시각 (한국)",new Date(first.run.created_at).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})],["실행자",first.run.actor_name],["실행 상태",RUN_STATUSES[first.run.status]],["실행 대상",String(first.run.total)],["처리 Contact",String(first.run.processed)],["미처리 Contact",String(first.run.total-first.run.processed)],["다운로드 Contact",String(seen)],["다운로드 결과 행",String(rows)],["대상 조건",JSON.stringify(first.run.filters)],["결과 필터",JSON.stringify(Object.fromEntries(query))],["판정 집계 (Contact)",Object.entries(first.counts).map(([k,v])=>`${OUTCOMES[k as keyof typeof OUTCOMES]} ${v}`).join(" / ")],["수정본 시험",first.run.trial?"예":"아니오"],["규칙 변경 여부",first.rulesChanged?"실행 이후 변경됨":"동일"],...first.run.rules.map(r=>["선택 규칙",`${r.title} · v${r.version} · ${JSON.stringify(r.config)}`])])info.addRow(row).commit();
  info.commit();await workbook.commit();finalized=true;
  const cleanDirectory=directory;directory=undefined;
  const stream=Readable.from((async function*(){try{for await(const chunk of createReadStream(filename))yield chunk;}finally{await rm(cleanDirectory,{recursive:true,force:true});}})());
  return new NextResponse(Readable.toWeb(stream) as ReadableStream,{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":'attachment; filename="Master-DB-validation.xlsx"',"Cache-Control":"private, no-store","X-Export-Count":String(seen),"X-Result-Count":String(rows)}});
 }catch(e){if(workbook&&!finalized)await workbook.commit().catch(()=>{});if(directory)await rm(directory,{recursive:true,force:true});return failure(e);}
}
