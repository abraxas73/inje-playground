import type { Digest } from "./digest";

/** Verify the actual mailbox immediately before sending; a different linked account cannot be the From. */
export async function sendUserDigest(token: string, email: string, digest: Digest, fetcher: typeof fetch = fetch) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const me = await fetcher("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers, signal: AbortSignal.timeout(10_000) });
  if (!me.ok) throw new Error(`Microsoft 메일 계정 확인 실패 (${me.status})`);
  const account = await me.json();
  const sender = account.mail || account.userPrincipalName;
  if (typeof sender !== "string" || sender.trim().toLowerCase() !== email.trim().toLowerCase()) {
    throw new Error("로그인 이메일과 Microsoft 발신 계정이 다릅니다. 같은 이메일의 계정을 연결해 주세요.");
  }
  const response = await fetcher("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST", headers,
    body: JSON.stringify({ message: { subject: digest.subject, body: { contentType: "HTML", content: digest.html }, toRecipients: [{ emailAddress: { address: email } }] }, saveToSentItems: true }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Microsoft 메일 발송 실패 (${response.status})`);
  return response.headers.get("request-id");
}
