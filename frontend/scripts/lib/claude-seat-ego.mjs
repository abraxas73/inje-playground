import { execFile } from "node:child_process";

const exec = (bin, args, options) => new Promise((resolve, reject) => {
  const child = execFile(bin, args, options, (error, stdout, stderr) => {
    if (error) reject(error); else resolve({ stdout, stderr });
  });
  child.stdin.end(); // ego CLI reads stdin even with -e; signal EOF for unattended runs.
});
const MARKER = "SEAT_EGO_RESULT=";

// One existing workspace only; never create or take over a user-controlled space.
export async function egoRequest(spaceId, url = "/api/organizations", init = {}, run = exec) {
  if (!Number.isSafeInteger(spaceId) || spaceId <= 0) throw new Error("SEAT_EGO_SPACE_ID must be a positive integer");
  if (!/^\/api\/organizations(?:\/|$)/.test(url)) throw new Error("Unsupported Claude API path");
  const code = `
const spaceId = ${JSON.stringify(spaceId)};
const space = (await listTaskSpaces()).find(s => s.id === spaceId);
if (!space || space.ownership !== "agent") throw new Error("Dedicated ego workspace missing or user-controlled");
const task = await taskSpace(spaceId);
const page = task.page("p1");
if (new URL(await page.url()).origin !== "https://claude.ai") throw new Error("Dedicated tab must be on claude.ai");
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
