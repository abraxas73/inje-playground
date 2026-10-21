import { execFile } from "node:child_process";

const exec = (bin, args, options) => new Promise((resolve, reject) => {
  const child = execFile(bin, args, options, (error, stdout, stderr) => {
    if (error) reject(error); else resolve({ stdout, stderr });
  });
  child.stdin.end(); // ego CLI reads stdin even with -e; signal EOF for unattended runs.
});
const MARKER = "SEAT_EGO_RESULT=";

// One workspace, reopened by name — ego restarts drop agent spaces and renumber them, so numeric IDs broke (2026-10-16·10-20).
// taskSpace(name) reuses the same-named space or recreates it (login cookies are profile-wide). Never take over a user-controlled space.
export async function egoRequest(spaceName, url = "/api/organizations", init = {}, run = exec) {
  if (typeof spaceName !== "string" || !/^[\w-]{1,64}$/.test(spaceName)) throw new Error("SEAT_EGO_SPACE must be a workspace name");
  if (!/^\/api\/organizations(?:\/|$)/.test(url)) throw new Error("Unsupported Claude API path");
  const code = `
const spaceName = ${JSON.stringify(spaceName)};
const existing = (await listTaskSpaces()).find(s => s.name === spaceName);
if (existing && existing.ownership !== "agent") throw new Error("Dedicated ego workspace is user-controlled");
const task = await taskSpace(spaceName);
const page = task.page("p1");
let origin = null;
try { origin = new URL(await page.url()).origin; } catch {}
if (origin !== "https://claude.ai") await page.goto("https://claude.ai/new");
const response = await page.fetch(${JSON.stringify(url)}, ${JSON.stringify({ ...init, timeout: 20000 })});
let json = null;
try { json = JSON.parse(response.body); } catch {}
console.log(${JSON.stringify(MARKER)} + JSON.stringify({status: response.status, json, text: response.body.slice(0, 200)}));
`;
  try {
    const { stdout, stderr = "" } = await run("ego-browser", ["nodejs", "-e", code], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    const line = (stdout + "\n" + stderr).split("\n").find(line => line.startsWith(MARKER));
    if (!line) throw new Error("Missing ego response");
    return JSON.parse(line.slice(MARKER.length));
  } catch {
    // Do not expose execFile errors: they embed the command and request body.
    throw new Error(init.method === "PUT" ? "ego request failed; write outcome unknown, check Claude before retry" : "ego workspace unavailable or request failed");
  }
}
