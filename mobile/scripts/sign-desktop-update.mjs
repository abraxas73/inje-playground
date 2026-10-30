import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { signUpdate } from './desktop-update-signing.mjs';

const minimumOSByPlatform = { macos: '12.0', windows: '10.0.17763', linux: '24.04' };
export function readPrivateKey(platform) {
  if (!['macos', 'windows', 'linux'].includes(platform)) throw new Error('Invalid update platform');
  if (process.env.INNOCREW_UPDATE_PRIVATE_KEY) return process.env.INNOCREW_UPDATE_PRIVATE_KEY;
  if (process.platform !== 'darwin') throw new Error('Update signing key is missing');
  const result = spawnSync('/usr/bin/security', ['find-generic-password', '-s', 'com.innogrid.innocrew.desktop-update.ed25519', '-a', platform, '-w'], { encoding: 'utf8', maxBuffer: 4096 });
  if (result.status !== 0) throw new Error('Update signing Keychain is unavailable');
  return result.stdout.trim(); // consumed in memory; never printed or passed as an argument
}

async function main() {
  const [platform, artifact, buildText] = process.argv.slice(2);
  if (!['macos', 'windows', 'linux'].includes(platform) || !artifact) throw new Error('Expected platform artifact build (or --check-key)');
  const keys = JSON.parse(await readFile(new URL('../desktop-update-public-keys.json', import.meta.url), 'utf8'));
  const privateKey = readPrivateKey(platform);
  const minimumOS = minimumOSByPlatform[platform];
  if (artifact === '--check-key') {
    signUpdate({ body: Buffer.from('InnoCrew signing key check'), build: 1, minimumOS, privateKey, publicKey: keys[platform] });
    console.log(`Verified ${platform} signing key matches embedded public key`); return;
  }
  const update = signUpdate({ body: await readFile(artifact), build: Number(buildText), minimumOS, privateKey, publicKey: keys[platform] });
  await writeFile(`${artifact}.update.json`, JSON.stringify(update, null, 2) + '\n', { flag: 'wx' });
  console.log(`Signed immutable ${platform} artifact; public sidecar created`);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(() => { console.error('Update signing failed. Check key availability, matching public key, build and immutable output path.'); process.exitCode = 1; });
}
