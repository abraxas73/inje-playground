import { createAdminClient } from "@/lib/supabase-admin";
import { dbCheck } from "../server";
import { checkMail, checkWebsite } from "./network";
import { EMAIL_ENGINE, evaluateEmail, planChecks } from "./evaluate";
import type { EmailSnapshot, MailProbe, WebProbe } from "./types";
type Claim = { run_id: string; contact_id: string; lease: string; snapshot: EmailSnapshot };
export async function runEmailWorker(runId: string | null = null, budgetMs = 210000) {
  const db = createAdminClient(); const until = Date.now() + budgetMs; let processed = 0;
  const memo = new Map<string, Promise<MailProbe | WebProbe>>();
  async function probe<T extends MailProbe | WebProbe>(run: string, key: string, load: () => Promise<T>): Promise<T> {
    const combined = `${run}:${key}`;
    if (!memo.has(combined)) memo.set(combined, (async () => {
      const cached = await db.from("marketing_email_probe_cache").select("result").eq("run_id", run).eq("key", key).maybeSingle(); dbCheck(cached.error);
      if (cached.data) return cached.data.result as T;
      const result = await load();
      const saved = await db.from("marketing_email_probe_cache").upsert({ run_id: run, key, result }, { onConflict: "run_id,key", ignoreDuplicates: true }); dbCheck(saved.error);
      return result;
    })());
    return memo.get(combined)! as Promise<T>;
  }
  while (Date.now() < until) {
    const claimed = await db.rpc("marketing_email_claim", { p_run: runId }); dbCheck(claimed.error);
    const targets = claimed.data as Claim[]; if (!targets.length) break;
    // Twenty targets per lease, five bounded network tasks at a time.
    for (let start = 0; start < targets.length; start += 5) await Promise.all(targets.slice(start, start + 5).map(async t => {
      const now = new Date().toISOString();
      let result;
      try {
        const { syntax, website } = planChecks(t.snapshot);
        const [mail, web] = await Promise.all([
          syntax.domain ? probe(t.run_id, `mail:${syntax.domain}`, () => checkMail(syntax.domain)) : Promise.resolve({ domain: "", checkedAt: now, state: "skipped" as const, code: "no_domain", message: "유효한 도메인이 없어 DNS 검사를 생략했습니다." }),
          website ? probe(t.run_id, `web:${website}`, () => checkWebsite(website)) : Promise.resolve({ url: "", checkedAt: now, state: "skipped" as const, code: "no_website", message: "회사 홈페이지 기준이 없거나 공용 메일이므로 홈페이지 추정을 생략했습니다." }),
        ]);
        result = evaluateEmail(t.snapshot, mail, web);
      } catch {
        result = { engine: EMAIL_ENGINE, state: "error", checkedAt: now, email: t.snapshot.email, domain: "", message: "검사를 완료하지 못했습니다. 실행 오류 재시도를 이용하세요." };
      }
      const finished = await db.rpc("marketing_email_finish", { p_run: t.run_id, p_contact: t.contact_id, p_lease: t.lease, p_result: result }); dbCheck(finished.error);
      if (finished.data) processed++;
    }));
  }
  return { processed };
}
