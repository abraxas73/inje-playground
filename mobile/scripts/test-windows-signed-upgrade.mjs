import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { signUpdate } from './desktop-update-signing.mjs';
const fixture = resolve(process.argv[2] ?? 'mobile/build/updater-tests/Release');
const installerScript = resolve('mobile/installer/windows.iss');
const iscc = join(process.env['ProgramFiles(x86)'], 'Inno Setup 6/ISCC.exe');
const root = await mkdtemp(join(tmpdir(), 'innocrew-signed-upgrade-'));
const pair = generateKeyPairSync('ed25519');
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32).toString('base64');
const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
const delay = ms => new Promise(r => setTimeout(r, ms));
const exists = async path => access(path).then(() => true, () => false);
async function until(fn, label) { for (let i = 0; i < 150; i++) { if (await fn()) return; await delay(200); } throw new Error(`Timeout: ${label}`); }
const hash = data => createHash('sha256').update(data).digest('hex');
for (const scenario of ['success', 'bad-signature', 'expired-auth', 'interrupted-download']) {
  const directory = join(root, `${scenario} 한글 path`);
  const app = join(directory, 'App'), state = join(directory, 'state'), payload = join(directory, 'payload'), output = join(directory, 'output');
  for (const path of [app, state, payload, output]) await mkdir(path, { recursive: true });
  await copyFile(join(fixture, 'updater_fixture_1.exe'), join(app, 'INNOGRID.exe'));
  await copyFile(join(fixture, 'updater_fixture_2.exe'), join(payload, 'INNOGRID.exe'));
  for (const path of [app, payload]) await copyFile(join(fixture, 'WinSparkle.dll'), join(path, 'WinSparkle.dll'));
  await writeFile(join(state, 'session-settings'), 'synthetic-account-and-settings');
  const compile = spawnSync(iscc, ['/Q', '/DAppVersion=9.0.2', '/DUpdaterTest=1', `/DTestPayload=${payload}`, `/DTestOutput=${output}`, installerScript], { encoding: 'utf8' });
  assert.equal(compile.status, 0, `compile isolated Setup: ${compile.stderr}`);
  const filename = 'INNOGRID-Windows-9.0.2-Setup.exe';
  const bytes = await readFile(join(output, filename));
  const signature = scenario === 'bad-signature' ? Buffer.alloc(64).toString('base64') : signUpdate({ body: bytes, privateKey, publicKey, build: 9002, minimumOS: '10.0.17763' }).edSignature;
  let feedHit = false, downloadHit = false;
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer isolated-upgrade-fixture');
    if (req.url === '/feed') {
      feedHit = true;
      if (scenario === 'expired-auth') { res.writeHead(401); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
      res.end(`<?xml version="1.0"?><rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>Isolated test</title><item><enclosure url="http://127.0.0.1:${server.address().port}/${filename}" sparkle:version="9.0.2" sparkle:edSignature="${signature}" length="${bytes.length}" type="application/octet-stream" /></item></channel></rss>`);
    } else {
      downloadHit = true;
      if (scenario === 'expired-auth') { res.writeHead(401); res.end(); return; }
      res.writeHead(200, { 'Content-Length': bytes.length, 'Content-Disposition': `attachment; filename="${filename}"` });
      if (scenario === 'interrupted-download') { res.write(bytes.subarray(0, 512)); setTimeout(() => res.destroy(), 50); }
      else res.end(bytes);
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  // Production's artifact URL has no .exe suffix; the native downloader must
  // honor our fixed Content-Disposition filename before installer validation.
  await writeFile(join(state, 'update-config'), `http://127.0.0.1:${server.address().port}/feed\n${publicKey}\n${signature}\nhttp://127.0.0.1:${server.address().port}/artifact/windows/9.0.2\n`);
  const old = spawn(join(app, 'INNOGRID.exe'), [], { stdio: 'ignore' });
  let oldExited = false; old.once('exit', () => { oldExited = true; });
  let newPid;
  try {
    if (scenario === 'success') {
      await until(async () => (await readFile(join(state, 'launches.log'), 'utf8').catch(() => '')).includes('2 '), 'new signed version launch');
      const lines = (await readFile(join(state, 'launches.log'), 'utf8')).trim().split(/\r?\n/);
      const fresh = lines.filter(line => line.startsWith('2 '));
      assert.equal(fresh.length, 1); newPid = Number(fresh[0].split(' ')[1]);
      await until(() => oldExited, 'old PID exit');
      process.kill(newPid, 0);
      assert.equal(hash(await readFile(join(app, 'INNOGRID.exe'))), hash(await readFile(join(payload, 'INNOGRID.exe'))));
      assert.equal(downloadHit, true);
      await delay(500);
      assert.equal((await readFile(join(state, 'launches.log'), 'utf8')).trim().split(/\r?\n/).length, 2);
    } else {
      await until(() => exists(join(state, 'update-error')), 'native update rejection');
      assert.equal(oldExited, false, 'failure preserves current app');
      assert.equal(await exists(join(state, 'installer-launched')), false, 'rejected update never executes');
      if (scenario !== 'expired-auth') assert.equal(downloadHit, true);
    }
    assert.equal(feedHit, false, 'remote appcast is never parsed');
    assert.equal(await readFile(join(state, 'session-settings'), 'utf8'), 'synthetic-account-and-settings');
    console.log(`PASS: actual WinSparkle signed-upgrade ${scenario}; old PID=${old.pid}${newPid ? ` new PID=${newPid}` : ''}`);
  } finally {
    if (!oldExited) old.kill();
    if (newPid) { try { process.kill(newPid); } catch {} }
    server.closeAllConnections(); server.close();
  }
}
console.log(`Signed upgrade evidence: ${root}`);
