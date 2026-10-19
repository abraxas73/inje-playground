// Rebuild ONLY the progress/relaunch helper from the exact pinned SDK source.
// The framework, installer, transport and signature-verification binaries stay
// upstream 2.10.0. No runtime swizzling, process-name kill, or sandbox bypass.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const revision = 'eef1a539a373c1f1a320624b1130fc5de7b2e100';
const patch = join(mobile, 'scripts/patches/sparkle-2.10.0-unicode-path.patch');
const output = join(mobile, 'build/desktop-updater');
mkdirSync(output, { recursive: true });
const work = mkdtempSync(join(output, 'sparkle-helper-'));
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: work, stdio: 'inherit', ...options });
// An independent git root is essential: otherwise git apply may silently skip
// paths relative to the surrounding application's repository.
run('git', ['init', '--quiet']);
const source = process.argv[2] ? resolve(process.argv[2]) : work;
const reference = process.argv[2] ? 'HEAD' : 'FETCH_HEAD';
if (!process.argv[2]) run('git', ['fetch', '--depth=1', 'https://github.com/sparkle-project/Sparkle.git', revision]);
const checkedRevision = execFileSync('git', ['-C', source, 'rev-parse', reference], { encoding: 'utf8' }).trim();
if (checkedRevision !== revision) throw new Error('Sparkle source revision does not match pinned 2.10.0');
// git archive reads the committed tree, never mutable checkout contents.
const archive = execFileSync('git', ['-C', source, 'archive', revision], { maxBuffer: 64 * 1024 * 1024 });
run('tar', ['-xf', '-'], { input: archive, stdio: ['pipe', 'inherit', 'inherit'] });
run('git', ['apply', '--check', patch]);
run('git', ['apply', patch]);
const controller = readFileSync(join(work, 'Sparkle/InstallerProgress/InstallerProgressAppController.m'), 'utf8');
if (controller.split('precomposedStringWithCanonicalMapping.pathComponents').length !== 3) {
  throw new Error('Sparkle Unicode patch was not applied exactly twice');
}
run('xcodebuild', ['-project', 'Sparkle.xcodeproj', '-target', 'Installer Progress', '-configuration', 'Release',
  `SYMROOT=${join(work, 'products')}`, `OBJROOT=${join(work, 'objects')}`, 'ARCHS=arm64 x86_64', 'ONLY_ACTIVE_ARCH=NO', 'CODE_SIGN_IDENTITY=-']);
const helper = join(work, 'products/Release/Updater.app');
const architectures = execFileSync('xcrun', ['lipo', '-archs', join(helper, 'Contents/MacOS/Updater')], { encoding: 'utf8' }).trim().split(/\s+/).sort();
if (architectures.join(',') !== 'arm64,x86_64') throw new Error('Sparkle helper must support both Apple Silicon and Intel');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const receipt = { revision, patchSha256: sha256(readFileSync(patch)), helper,
  executableSha256: sha256(readFileSync(join(helper, 'Contents/MacOS/Updater'))) };
writeFileSync(join(output, 'sparkle-helper.json'), JSON.stringify(receipt, null, 2));
console.log(`Verified universal Unicode-safe Sparkle helper: ${helper}`);
