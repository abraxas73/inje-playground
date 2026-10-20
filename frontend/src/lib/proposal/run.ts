/**
 * 제안도우미-일반현황 생성 실행 — after()에서 호출. ppt-service /proposal/outline·/proposal/build를 서명 URL로 부른다.
 * 서명 URL·파일 내용은 로그에 남기지 않는다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import type { DeckLlm } from "@/lib/ppt/llm";
import { createAnthropicDeckLlm } from "@/lib/ppt/llm";
import {
  inventedNumbers, parseReflowSpec, PROPOSAL_BUCKET, REFLOW_SYSTEM, reflowUserMessage, resultPath,
  type OutlineSlide, type ProposalMode, type ReflowSpec, type TemplateInfo,
} from "./core";

export interface ProposalService {
  outline(req: { profileUrl?: string; templateUrl?: string }): Promise<{ profile?: OutlineSlide[]; template?: TemplateInfo }>;
  build(req: { mode: ProposalMode; profileUrl: string; templateUrl: string; pptxUrl: string; spec?: ReflowSpec }): Promise<{ ok: true; slides: number } | { ok: false; message: string }>;
}

export class ProposalServiceError extends Error {}

export function createProposalService(opts: { baseUrl?: string; token?: string; fetchImpl?: typeof fetch } = {}): ProposalService {
  const baseUrl = (opts.baseUrl ?? process.env.PPT_SERVICE_URL ?? "").replace(/\/+$/, "");
  const token = opts.token ?? process.env.PPT_SERVICE_TOKEN ?? "";
  if (!baseUrl || !token) throw new ProposalServiceError("PPT_SERVICE_URL/PPT_SERVICE_TOKEN이 설정되지 않았습니다.");
  const f = opts.fetchImpl ?? fetch;
  async function post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
    let res: Response;
    try {
      res = await f(`${baseUrl}${path}`, { method: "POST", headers: { "x-ppt-token": token, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new ProposalServiceError(`PPT 서비스에 연결할 수 없습니다(${e instanceof Error ? e.name : "error"}).`);
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok || (res.status === 422 && typeof json.ok === "boolean")) return json as T;
    const detail = typeof json.detail === "string" ? json.detail : typeof json.message === "string" ? json.message : `PPT 서비스 오류(${res.status})`;
    throw new ProposalServiceError(detail);
  }
  return {
    async outline(req) {
      const r = await post<{ ok?: false; message?: string; profile?: OutlineSlide[]; template?: TemplateInfo }>("/proposal/outline", req, 120_000);
      if (r.ok === false) throw new ProposalServiceError(r.message ?? "파일을 읽지 못했습니다.");
      return r;
    },
    async build(req) {
      const r = await post<{ ok: boolean; slides?: number; message?: string }>("/proposal/build", req, 240_000);
      return r.ok ? { ok: true, slides: r.slides ?? 0 } : { ok: false, message: r.message ?? "생성에 실패했습니다." };
    },
  };
}

async function signed(admin: SupabaseClient, path: string): Promise<string> {
  const { data, error } = await admin.storage.from(PROPOSAL_BUCKET).createSignedUrl(path, 900);
  if (error || !data) throw new Error("파일 주소를 만들지 못했습니다.");
  return data.signedUrl;
}

/** 레이아웃 재구성 배치표 — 모양이 틀리면 한 번 다시 묻고, 원문에 없는 숫자가 있으면 실패로 돌린다 */
export async function planReflow(llm: DeckLlm, profile: OutlineSlide[], template: TemplateInfo): Promise<ReflowSpec> {
  const imageIds = new Set(profile.flatMap((s) => s.images.map((i) => i.id)));
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: REFLOW_SYSTEM }];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: reflowUserMessage(profile, template) }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await llm.complete(system, messages);
    const spec = parseReflowSpec(reply.text, template.layouts.length, imageIds);
    if (spec) {
      const bad = inventedNumbers(spec, profile);
      if (!bad.length) return spec;
      messages.push({ role: "assistant", content: reply.text }, { role: "user", content: `원문에 없는 숫자가 있다: ${bad.slice(0, 10).join(", ")}. 원문 숫자만 그대로 써서 JSON 전체를 다시 내라.` });
      continue;
    }
    messages.push({ role: "assistant", content: reply.text || "(빈 응답)" }, { role: "user", content: "형식이 맞지 않는다. 설명 없이 {\"slides\":[...]} JSON 하나만 다시 내라." });
  }
  throw new Error("레이아웃 재구성 배치를 만들지 못했습니다(원문 숫자 검사 또는 형식 오류). '모양 유지'로 다시 시도해 보세요.");
}

export interface RunDeps { service?: ProposalService; llm?: DeckLlm }

/** 잡 하나를 끝까지 돌리고 상태를 쓴다. 예외는 삼켜 failed로 남긴다(after()라 던질 곳이 없다). */
export async function runProposalJob(admin: SupabaseClient, jobId: string, deps: RunDeps = {}): Promise<void> {
  const fail = async (message: string) => {
    await admin.from("proposal_jobs").update({ status: "failed", error: message.slice(0, 500), finished_at: new Date().toISOString() }).eq("id", jobId);
  };
  try {
    const { data: job, error } = await admin.from("proposal_jobs").select("id, mode, profile_id, template_path, status").eq("id", jobId).single();
    if (error || !job) return;
    if (job.status !== "queued") return;
    await admin.from("proposal_jobs").update({ status: "running" }).eq("id", jobId);
    const { data: profile } = await admin.from("proposal_profiles").select("storage_path").eq("id", job.profile_id).single();
    if (!profile) return fail("일반현황 PPT를 찾을 수 없습니다.");
    const service = deps.service ?? createProposalService();
    const profileUrl = await signed(admin, profile.storage_path);
    const templateUrl = await signed(admin, job.template_path);
    const out = resultPath(jobId);
    const up = await admin.storage.from(PROPOSAL_BUCKET).createSignedUploadUrl(out, { upsert: true });
    if (up.error || !up.data) return fail("결과 업로드 주소를 만들지 못했습니다.");
    let spec: ReflowSpec | undefined;
    if (job.mode === "reflow") {
      const o = await service.outline({ profileUrl, templateUrl });
      if (!o.profile || !o.template) return fail("일반현황·템플릿을 읽지 못했습니다.");
      spec = await planReflow(deps.llm ?? createAnthropicDeckLlm(), o.profile, o.template);
    }
    const res = await service.build({ mode: job.mode, profileUrl, templateUrl, pptxUrl: up.data.signedUrl, spec });
    if (!res.ok) return fail(res.message);
    await admin.from("proposal_jobs").update({ status: "done", result_path: out, slide_count: res.slides, error: null, finished_at: new Date().toISOString() }).eq("id", jobId);
  } catch (e) {
    await fail(e instanceof Error ? e.message : "생성 중 오류가 났습니다.");
  }
}
