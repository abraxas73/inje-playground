import { NextRequest } from "next/server";
import { dbCheck, failure, marketingAuth, response } from "@/lib/marketing/server";
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{const {db}=await marketingAuth();const {id}=await params;const page=Math.max(1,Number(req.nextUrl.searchParams.get("page"))||1);const r=await db.from("marketing_rule_versions").select("*",{count:"exact"}).eq("rule_id",id).order("version",{ascending:false}).range((page-1)*25,page*25-1);dbCheck(r.error);return response({rows:r.data,total:r.count});}catch(e){return failure(e);}}
