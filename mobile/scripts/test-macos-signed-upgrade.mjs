import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, readdir, lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { signUpdate } from './desktop-update-signing.mjs';

const framework = resolve(process.argv[2]);
const patchedHelper = process.argv[3] ? resolve(process.argv[3]) : null;
const identity = 'Developer ID Application: SeungUk Kang (LME2TNRC9G)';
const root = await mkdtemp(join(tmpdir(), 'innocrew-macos-upgrade-'));
const identifier = `com.innogrid.playground.upgrade-fixture-${Date.now()}`;
const pair = generateKeyPairSync('ed25519');
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32).toString('base64');
const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
const delay = ms => new Promise(r => setTimeout(r, ms));
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
async function until(fn, label, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await delay(200); }
  throw new Error(`Timeout: ${label}; events=${JSON.stringify(events.filter(e => e.event !== 'status' || e.phase !== 'verifying'))}`);
}
let scenario = 'success', events = [], bytes, signature, downloadHit = false;
const server = http.createServer(async (req, res) => {
  if (req.url === '/event') {
    let body = ''; for await (const chunk of req) body += chunk;
    const event = JSON.parse(body); events.push(event);
    if (['launch', 'error', 'termination-request'].includes(event.event)) console.log(`Fixture: ${JSON.stringify(event)}`);
    res.end('ok'); return;
  }
  if (req.headers.authorization !== 'Bearer isolated-upgrade-fixture') { res.writeHead(403); res.end(); return; }
  if (req.url.startsWith('/feed')) {
    if (scenario === 'expired-auth') { res.writeHead(401); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
    res.end(`<?xml version="1.0"?><rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>Isolated update</title><item><sparkle:version>2</sparkle:version><sparkle:shortVersionString>9.0.2</sparkle:shortVersionString><enclosure url="http://127.0.0.1:${server.address().port}/artifact.dmg" sparkle:version="2" sparkle:shortVersionString="9.0.2" sparkle:edSignature="${scenario === 'bad-signature' ? Buffer.alloc(64).toString('base64') : signature}" length="${bytes.length}" type="application/octet-stream" /></item></channel></rss>`);
  } else if (req.url === '/artifact.dmg') {
    downloadHit = true; res.writeHead(200, { 'Content-Length': bytes.length, 'Content-Disposition': 'attachment; filename="fixture.dmg"' });
    if (scenario === 'interrupted-download') { res.write(bytes.subarray(0, 512)); setTimeout(() => res.destroy(), 50); }
    else res.end(bytes);
  } else { res.writeHead(404); res.end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const entitlementFile = join(root, 'fixture.entitlements');
await writeFile(entitlementFile, `<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.app-sandbox</key><true/><key>com.apple.security.network.client</key><true/><key>com.apple.security.temporary-exception.mach-lookup.global-name</key><array><string>${identifier}-spks</string><string>${identifier}-spki</string></array></dict></plist>`);
const binary = join(root, 'Fixture');
try {
  run('xcrun', ['swiftc', '-parse-as-library', '-target', 'arm64-apple-macos12.0', '-F', dirname(framework), '-framework', 'Sparkle', '-Xlinker', '-rpath', '-Xlinker', '@executable_path/../Frameworks', 'mobile/macos/RunnerTests/UpgradeFixture.swift', 'mobile/macos/Runner/UpdaterUserDriver.swift', '-o', binary]);
  async function signNested(path) {
    for (const entry of await readdir(path)) {
      const child = join(path, entry), stat = await lstat(child);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) await signNested(child);
      const signable = stat.isDirectory() ? /\.(app|framework|xpc)$/.test(child) : run('file', ['-b', child]).includes('Mach-O');
      if (signable) run('codesign', ['--force', '--options', 'runtime', '--timestamp', '--sign', identity, ...(child.includes('Downloader.xpc') ? ['--preserve-metadata=entitlements'] : []), child]);
    }
  }
  async function build(version) {
    const app = join(root, `build-${version}`, 'InnoCrewUpdaterFixture.app');
    await mkdir(join(app, 'Contents/MacOS'), { recursive: true });
    await mkdir(join(app, 'Contents/Frameworks'), { recursive: true });
    run('ditto', [binary, join(app, 'Contents/MacOS/Fixture')]);
    run('ditto', [framework, join(app, 'Contents/Frameworks/Sparkle.framework')]);
    if (patchedHelper) run('ditto', [patchedHelper, join(app, 'Contents/Frameworks/Sparkle.framework/Versions/B/Updater.app')]);
    await writeFile(join(app, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string><key>CFBundleName</key><string>InnoCrewUpdaterFixture</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleExecutable</key><string>Fixture</string><key>CFBundleVersion</key><string>${version}</string><key>CFBundleShortVersionString</key><string>9.0.${version}</string><key>LSMinimumSystemVersion</key><string>12.0</string><key>SUPublicEDKey</key><string>${publicKey}</string><key>SUEnableAutomaticChecks</key><false/><key>SUAutomaticallyUpdate</key><false/><key>SUEnableInstallerLauncherService</key><true/><key>SUVerifyUpdateBeforeExtraction</key><true/><key>FixtureBaseURL</key><string>${base}</string><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict></dict></plist>`);
    await signNested(app);
    run('codesign', ['--force', '--options', 'runtime', '--timestamp', '--sign', identity, '--entitlements', entitlementFile, app]);
    run('codesign', ['--verify', '--deep', '--strict', app]);
    return app;
  }
  const oldApp = await build(1), newApp = await build(2);
  const image = join(root, 'fixture.dmg');
  run('hdiutil', ['create', '-srcfolder', dirname(newApp), '-format', 'UDZO', '-volname', 'InnoCrew Updater Fixture', image]);
  bytes = await readFile(image);
  signature = signUpdate({ body: bytes, build: 2, minimumOS: '12.0', privateKey, publicKey }).edSignature;
  for (const test of ['success', 'bad-signature', 'expired-auth', 'interrupted-download', 'read-only']) {
    scenario = test; events = []; downloadHit = false;
    let mount;
    // Diagnostic override compares exactly the same engine with an ASCII path.
    let installed = join(root, process.env.INNOCREW_FIXTURE_ASCII_PATH === '1' ? `${test} path` : `${test} 한글 path`, 'InnoCrewUpdaterFixture.app');
    if (test === 'read-only') {
      const readOnlyImage = join(root, 'read-only-old.dmg');
      run('hdiutil', ['create', '-srcfolder', dirname(oldApp), '-format', 'UDZO', '-volname', 'InnoCrew Read Only Fixture', readOnlyImage]);
      mount = join(root, 'read-only-volume'); await mkdir(mount);
      run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, readOnlyImage]);
      installed = join(mount, 'InnoCrewUpdaterFixture.app');
    } else run('ditto', [oldApp, installed]);
    // LaunchServices grants normal app-bundle sandbox access and registers the
    // process for Sparkle's quit Apple event. exec'ing Contents/MacOS directly
    // does neither and is not a faithful installed-app lifecycle test.
    run('open', ['-n', installed]);
    let oldPid, newPid;
    const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
    try {
      await until(() => events.some(e => e.event === 'launch' && e.version === '1'), 'old sandboxed fixture launch', 15000);
      oldPid = events.find(e => e.event === 'launch' && e.version === '1').pid;
      if (test === 'success') {
        await until(() => events.some(e => e.event === 'launch' && e.version === '2'), 'signed upgrade relaunch');
        const launches = events.filter(e => e.event === 'launch' && e.version === '2');
        assert.equal(launches.length, 1); newPid = launches[0].pid;
        assert.equal((await realpath(launches[0].path)).normalize('NFD'), (await realpath(installed)).normalize('NFD')); assert.equal(launches[0].session, 'fixture-account'); assert.equal(launches[0].preference, 'fixture-preference');
        await until(() => !alive(oldPid), 'old process exit'); process.kill(newPid, 0);
        assert.equal(run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', join(installed, 'Contents/Info.plist')]).trim(), '2');
        assert.equal(downloadHit, true); await delay(500);
        assert.equal(events.filter(e => e.event === 'launch' && e.version === '2').length, 1);
      } else {
        await until(() => events.some(e => e.event === 'error' || (e.event === 'status' && e.phase === 'error')), 'native rejection');
        assert.equal(alive(oldPid), true); assert.equal(events.some(e => e.event === 'launch' && e.version === '2'), false);
        if (test === 'read-only') {
          assert.equal(downloadHit, false, 'read-only app rejected before download');
          assert.equal(run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', join(installed, 'Contents/Info.plist')]).trim(), '1');
        } else if (test !== 'expired-auth') assert.equal(downloadHit, true);
      }
      console.log(`PASS: actual sandboxed Sparkle signed-upgrade ${test}; old PID=${oldPid}${newPid ? ` new PID=${newPid}` : ''}`);
    }
    finally {
      if (oldPid && alive(oldPid)) process.kill(oldPid);
      if (newPid) { try { process.kill(newPid); } catch {} }
      await delay(500);
      if (mount) {
        // LaunchServices/Spotlight may briefly retain the read-only fixture
        // volume after its process exits. Eject only this owned mount, never
        // force-unmount unrelated disks, and wait for normal release.
        if (oldPid) await until(() => !alive(oldPid), 'read-only fixture exit', 10000);
        let ejected = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          const result = spawnSync('/usr/sbin/diskutil', ['eject', mount], { encoding: 'utf8' });
          if (result.status === 0) { ejected = true; break; }
          await delay(1000);
        }
        assert.equal(ejected, true, `owned read-only fixture volume could not eject: ${mount}`);
      }
    }
  }
} finally { server.closeAllConnections(); server.close(); console.log(`macOS upgrade evidence: ${root}`); }
