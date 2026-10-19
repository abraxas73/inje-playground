// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const m = vi.hoisted(() => ({ status: 200, value: "{}", dbError: false, signed: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.status === 200 ? { ok: true, admin: {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: m.value }, error: m.dbError ? {} : null }) }) }) }),
  storage: { from: () => ({ createSignedUrl: m.signed }) },
} } : { ok: false, response: NextResponse.json({}, { status: m.status }) } }));
import { createUpdateAppcast } from "@/lib/desktop/update-feed";
import { parseDesktopRelease } from "@/lib/desktop/release";
import { GET as feed, POST as feedPost } from "@/app/api/desktop/update/appcast/route";
import { GET as discover } from "@/app/api/desktop/release/route";
import { GET as artifact, POST as artifactPost } from "@/app/api/desktop/update/artifact/[platform]/[version]/route";

const bytes = new TextEncoder().encode("signed installer fixture");
const release = (platform = "macos") => ({ version: "1.7.8", filename: `INNOGRID-${platform}-1.7.8.${platform === "macos" ? "dmg" : "exe"}`,
  path: `${platform}/1.7.8/INNOGRID-${platform}-1.7.8.${platform === "macos" ? "dmg" : "exe"}`,
  sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, releasedAt: "2026-10-19T09:00:00Z",
  update: { build: 59, edSignature: Buffer.alloc(64, 1).toString("base64"), minimumOS: "12.0" },
});
const req = (query = "platform=macos&version=1.7.8") => new NextRequest(`https://innocrew.innogrid.com/api/desktop/update/appcast?${query}`, { headers: { authorization: "Bearer private-user-token" } });
const download = (platform = "macos", version = "1.7.8") => artifact(req(), { params: Promise.resolve({ platform, version }) });
beforeEach(() => {
  m.status = 200; m.dbError = false; m.value = JSON.stringify({ macos: release(), windows: release("windows") });
  m.signed.mockReset().mockResolvedValue({ data: { signedUrl: "https://storage.example.test/private?token=storage-secret" } });
  m.fetch.mockReset().mockImplementation(async () => new Response(bytes, { headers: { "content-length": String(bytes.length) } }));
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => vi.unstubAllGlobals());

it("emits a parseable version-pinned same-origin signed feed, never private URLs/tokens", async () => {
  const response = await feed(req()); const xml = await response.text();
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(XMLValidator.validate(xml)).toBe(true);
  const item = new XMLParser({ ignoreAttributes: false }).parse(xml).rss.channel.item;
  expect(String(item["sparkle:version"])).toBe("59");
  expect(item.enclosure["@_sparkle:edSignature"]).toBe(release().update.edSignature);
  expect(item.enclosure["@_url"]).toBe("https://innocrew.innogrid.com/api/desktop/update/artifact/macos/1.7.8");
  expect(xml).not.toMatch(/storage-secret|private-user-token|storage\.example/);
  expect(m.signed).not.toHaveBeenCalled();
});
it("uses Windows semantic version and rejects XML injection instead of interpolating it", () => {
  const xml = createUpdateAppcast("windows", release("windows"));
  expect(new XMLParser().parse(xml).rss.channel.item["sparkle:version"]).toBe("1.7.8");
  expect(() => createUpdateAppcast("macos", { ...release(), version: '1.7.8"><evil/>' })).toThrow();
});
it.each([401, 403])("requires approved authentication (%s) for both routes", async (status) => {
  m.status = status;
  expect((await feed(req())).status).toBe(status); expect((await download()).status).toBe(status);
  expect(m.signed).not.toHaveBeenCalled(); expect(m.fetch).not.toHaveBeenCalled();
});
it("rejects unknown platforms, malformed versions and stale release snapshots", async () => {
  expect((await feed(req("platform=linux&version=1.7.8"))).status).toBe(400);
  expect((await feed(req("platform=macos"))).status).toBe(400);
  expect((await download("../private")).status).toBe(400);
  expect((await download("macos", "../1.7.8")).status).toBe(400);
  expect((await feed(req("platform=macos&version=1.7.7"))).status).toBe(409);
  expect((await download("macos", "1.7.7")).status).toBe(409);
  expect(m.fetch).not.toHaveBeenCalled();
});
it.each([undefined, { build: 0, edSignature: "abc", minimumOS: "12.0" }, { ...release().update, edSignature: "a".repeat(88) }, { ...release().update, minimumOS: '<"&' }])("does not offer malformed or missing update metadata (%j)", async (update) => {
  m.value = JSON.stringify({ macos: { ...release(), update } });
  expect(parseDesktopRelease(m.value).macos?.version).toBe("1.7.8"); // manual install still supported
  expect(parseDesktopRelease(m.value).macos?.update).toBeUndefined();
  expect((await feed(req())).status).toBe(404); expect((await download()).status).toBe(404);
});
it("streams exact bytes with fixed length, attachment name and no redirect/credential forwarding", async () => {
  const response = await download(); expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("content-length")).toBe(String(bytes.length));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  expect(m.fetch.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store" });
  expect(JSON.stringify(m.fetch.mock.calls[0][1])).not.toContain("private-user-token");
});
it.each([bytes.slice(1), new Uint8Array(bytes.length + 1), new Uint8Array(bytes.length)])("aborts truncated, oversized or corrupt stream", async (body) => {
  m.fetch.mockResolvedValue(new Response(body));
  const response = await download();
  await expect(response.arrayBuffer()).rejects.toThrow("Update download failed");
});
it("rejects mismatched length before emitting bytes", async () => {
  m.fetch.mockResolvedValue(new Response(bytes, { headers: { "content-length": "99999999" } }));
  expect((await download()).status).toBe(502);
});
it("rejects unbounded metadata", async () => {
  m.value = JSON.stringify({ macos: { ...release(), bytes: 1024 ** 4 } });
  expect((await download()).status).toBe(404); expect(m.fetch).not.toHaveBeenCalled();
});
it("storage and database failures expose only generic errors", async () => {
  m.dbError = true; expect((await feed(req())).status).toBe(503); m.dbError = false;
  m.fetch.mockRejectedValue(new Error("https://storage.example.test/?token=storage-secret"));
  const response = await download(); expect(response.status).toBe(502);
  expect(await response.text()).not.toMatch(/storage-secret|storage\.example/);
  m.signed.mockResolvedValue({ error: { message: "storage-secret" } });
  expect((await download()).status).toBe(503);
});
it("rejects write methods", async () => {
  expect((await feedPost()).status).toBe(405); expect((await artifactPost()).status).toBe(405);
});
it("automatic discovery returns only official URLs without issuing a Storage capability", async () => {
  const response = await discover(req("platform=macos&mode=automatic"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ version: "1.7.8", update: release().update,
    url: "https://innocrew.innogrid.com/api/desktop/update/artifact/macos/1.7.8" });
  expect(m.signed).not.toHaveBeenCalled();
});
