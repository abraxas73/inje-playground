// Explicit administrative step; no secrets in command arguments or output.
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { readPrivateKey } from './sign-desktop-update.mjs';
import { signUpdate } from './desktop-update-signing.mjs';
const minimumOSByPlatform = { windows: '10.0.17763', linux: '24.04' };
try {
  const platform = process.argv[2] ?? 'windows'; // 인자 없으면 기존처럼 windows
  if (!(platform in minimumOSByPlatform)) throw new Error('Invalid update platform');
  const privateKey = readPrivateKey(platform);
  const keys = JSON.parse(await readFile(new URL('../desktop-update-public-keys.json', import.meta.url), 'utf8'));
  signUpdate({ body: Buffer.from('CI provisioning check'), build: 1, minimumOS: minimumOSByPlatform[platform], privateKey, publicKey: keys[platform] });
  const result = spawnSync('gh', ['secret', 'set', `INNOCREW_${platform.toUpperCase()}_UPDATE_PRIVATE_KEY`, '--repo', 'abraxas73/inje-playground'], { input: privateKey, encoding: 'utf8', maxBuffer: 4096 });
  if (result.status !== 0) throw new Error('CI provisioning failed');
  console.log(`${platform} update key stored in GitHub Actions encrypted secrets`);
} catch { console.error('Could not provision CI update signing key'); process.exitCode = 1; }
