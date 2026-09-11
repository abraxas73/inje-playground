// Prepare secrets, deploy Next.js, then run this script with --enable.
// --verify checks the deployed scheduler. Never logs secrets.
import { readFileSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const appUrl = "https://inje-playground.vercel.app";
if (readFileSync(join(root, "supabase/.temp/project-ref"), "utf8").trim() !== "avooqcxehfeurjhqqgui") throw new Error("Unexpected Supabase project");
if (JSON.parse(readFileSync(join(root, "frontend/.vercel/project.json"), "utf8")).projectId !== "prj_MIFWuAP33QmVqMVRGuJdVdtJo2XO") throw new Error("Unexpected Vercel project");
const literal = (s) => "'" + s.replaceAll("'", "''") + "'";
function query(sql) {
  const dir = mkdtempSync(join(tmpdir(), "yonhap-mail-"));
  const path = join(dir, "query.sql");
  try {
    writeFileSync(path, sql, { mode: 0o600 });
    let output;
    try { output = execFileSync("supabase", ["db", "query", "--linked", "--file", path, "-o", "json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
    catch { throw new Error("Supabase email configuration failed"); }
    return JSON.parse(output).rows;
  } finally { unlinkSync(path); rmdirSync(dir); }
}
const stored = query("select decrypted_secret as value from vault.decrypted_secrets where name = 'yonhap_cron_secret';");
const token = stored[0]?.value ?? randomBytes(32).toString("hex");
if (process.argv.includes("--verify")) {
  const response = await fetch(`${appUrl}/api/cron/yonhap-notice-email`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(180000) });
  console.log("Scheduler HTTP", response.status, await response.text());
  if (!response.ok) process.exitCode = 1;
} else if (process.argv.includes("--enable")) {
  query(readFileSync(join(root, "docs/sql/2026-09-11-yonhap-notice-email-cron.sql"), "utf8"));
  console.log("Personal email scheduling enabled: every minute, individual Asia/Seoul times.");
  console.log(query("select jobname, schedule, active from cron.job where jobname like 'yonhap%';"));
} else {
for (const [name, value] of [["yonhap_app_url", appUrl], ["yonhap_cron_secret", token]]) {
  query(`do $$ declare secret_id uuid; begin
    select id into secret_id from vault.secrets where name = ${literal(name)};
    if secret_id is null then perform vault.create_secret(${literal(value)}, ${literal(name)});
    else perform vault.update_secret(secret_id, ${literal(value)}); end if;
  end; $$;`);
}
try {
  execFileSync("vercel", ["env", "add", "YONHAP_EMAIL_CRON_SECRET", "production", "--sensitive", "--force"], { cwd: join(root, "frontend"), input: token, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
} catch { throw new Error("Could not configure Vercel email cron secret"); }
console.log("Email-specific secret configured in Vercel and Vault. Deploy the app, then run --verify and --enable.");
}
