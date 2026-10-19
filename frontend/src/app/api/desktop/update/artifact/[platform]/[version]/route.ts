import { createHash } from "node:crypto";
import { DESKTOP_BUCKET } from "@/lib/desktop/release";
import { UPDATE_HEADERS } from "@/lib/desktop/update-feed";
import { authorizeUpdate, rejectUpdateMethod, updateError } from "@/lib/desktop/update-request";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request, context: { params: Promise<{ platform: string; version: string }> }) {
  const { platform, version } = await context.params;
  const r = await authorizeUpdate(platform, version);
  if (!r.ok) return r.response;
  const a = r.artifact;
  const { data, error } = await r.admin.storage.from(DESKTOP_BUCKET).createSignedUrl(a.path, 300);
  if (error || !data?.signedUrl) return updateError(503);
  // This capability stays server-side. Never forward the caller's bearer or redirect the client.
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 290_000);
  const cleanup = () => { clearTimeout(timer); request.signal.removeEventListener("abort", abort); };
  try {
    if (request.signal.aborted) controller.abort();
    const url = new URL(data.signedUrl);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid storage URL");
    const upstream = await fetch(url.href, { redirect: "error", cache: "no-store", signal: controller.signal, headers: { "Accept-Encoding": "identity" } });
    const length = upstream.headers.get("content-length");
    if (upstream.status !== 200 || !upstream.body || (length !== null && Number(length) !== a.bytes)) {
      await upstream.body?.cancel(); cleanup(); return updateError(502);
    }
    const reader = upstream.body.getReader();
    const hash = createHash("sha256"); let count = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(output) {
        try {
          const chunk = await reader.read();
          if (chunk.done) throw new Error("Unexpected end");
          count += chunk.value.byteLength;
          if (count > a.bytes) throw new Error("Oversized update");
          hash.update(chunk.value);
          // Withhold the final chunk until EOF + digest verification: an HTTP client
          // must not see a complete Content-Length when upstream bytes are corrupt.
          if (count === a.bytes) {
            const end = await reader.read();
            if (!end.done || hash.digest("hex") !== a.sha256) throw new Error("Invalid update");
            output.enqueue(chunk.value); output.close(); cleanup();
          } else output.enqueue(chunk.value);
        } catch {
          controller.abort(); await reader.cancel().catch(() => {}); cleanup();
          output.error(new Error("Update download failed"));
        }
      },
      async cancel() { controller.abort(); await reader.cancel().catch(() => {}); cleanup(); },
    });
    return new Response(body, { headers: {
      ...UPDATE_HEADERS, "Content-Type": "application/octet-stream", "Content-Length": String(a.bytes),
      "Content-Disposition": `attachment; filename="${a.filename}"`, "X-Accel-Buffering": "no",
    } });
  } catch { controller.abort(); cleanup(); return updateError(502); }
}
export const POST = rejectUpdateMethod;
export const PUT = rejectUpdateMethod;
export const PATCH = rejectUpdateMethod;
export const DELETE = rejectUpdateMethod;
export const HEAD = rejectUpdateMethod;
