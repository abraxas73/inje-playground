#!/usr/bin/env python3
"""Build, Developer ID sign, notarize, and package a macOS DMG (no publishing)."""
from pathlib import Path
import hashlib
import json
import os
import plistlib
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
IDENTITY = 'Developer ID Application: SeungUk Kang (LME2TNRC9G)'

def run(*args, capture=False):
    return subprocess.run([str(a) for a in args], cwd=ROOT, check=True,
                          text=True, capture_output=capture)

def notarize(path, credentials):
    result = run('xcrun', 'notarytool', 'submit', path, *credentials,
                 '--wait', '--output-format', 'json', capture=True)
    receipt = json.loads(result.stdout)
    (path.parent / (path.name + '.notary.json')).write_text(json.dumps(receipt, indent=2))
    if receipt.get('status') != 'Accepted':
        raise RuntimeError(f"Notarization {receipt.get('status')}: {receipt.get('id')}")
    print(f"Notarization accepted: {path.name}", flush=True)

def main():
    config = {}
    for line in (ROOT / '.env.release').read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            config[key.strip()] = value.strip().strip('\"\'')
    key_id, issuer = config['ASC_KEY_ID'], config['ASC_ISSUER_ID']
    candidates = [Path.home() / folder / f'AuthKey_{key_id}.p8'
                  for folder in ('.private_keys', 'private_keys')]
    key = next((p for p in candidates if p.is_file()), None)
    if key is None:
        raise RuntimeError('App Store Connect API key file is missing')
    identities = run('security', 'find-identity', '-v', '-p', 'codesigning', capture=True).stdout
    if IDENTITY not in identities:
        raise RuntimeError('Developer ID Application identity is missing')
    credentials = ['--key', key, '--key-id', key_id, '--issuer', issuer]
    env = dict(os.environ)
    env['PATH'] = str(ROOT / 'scripts/macos-toolchain') + os.pathsep + env['PATH']
    run('flutter', 'pub', 'get', '--enforce-lockfile')
    subprocess.run(['flutter', 'build', 'macos', '--release'], cwd=ROOT, env=env, check=True)
    output = ROOT / 'build/macos/distribution'
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='innocrew-release-') as temporary:
        stage = Path(temporary)
        app = stage / 'INNOGRID.app'
        run('ditto', ROOT / 'build/macos/Build/Products/Release/INNOGRID.app', app)
        sign = ['codesign', '--force', '--options', 'runtime', '--timestamp', '--sign', IDENTITY]
        # Sign nested Mach-O files and bundles from the inside out.
        for path in sorted(app.rglob('*'), key=lambda p: len(p.parts), reverse=True):
            if path.is_symlink():
                continue
            if path.is_file() and 'Mach-O' in run('file', '-b', path, capture=True).stdout:
                run(*sign, path)
            elif path.is_dir() and path.suffix in ('.framework', '.app', '.xpc'):
                run(*sign, path)
        run(*sign, '--entitlements', ROOT / 'macos/Runner/Release.entitlements', app)
        run('codesign', '--verify', '--deep', '--strict', '--verbose=2', app)
        archive = output / 'INNOGRID-notarization.zip'
        run('ditto', '-c', '-k', '--keepParent', app, archive)
        notarize(archive, credentials)
        run('xcrun', 'stapler', 'staple', app)
        run('xcrun', 'stapler', 'validate', app)
        run('spctl', '--assess', '--type', 'execute', '--verbose=2', app)
        (stage / 'Applications').symlink_to('/Applications')
        with (app / 'Contents/Info.plist').open('rb') as source:
            version = plistlib.load(source)['CFBundleShortVersionString']
        dmg = output / f'INNOGRID-macOS-{version}.dmg'
        # Build without mounting a temporary filesystem (Disk Arbitration may stall).
        hybrid = output / 'INNOGRID-hybrid.dmg'
        hybrid.unlink(missing_ok=True)
        run('hdiutil', 'makehybrid', '-hfs', '-hfs-volume-name', 'INNOGRID', '-o', hybrid, stage)
        run('hdiutil', 'convert', hybrid, '-format', 'UDZO', '-ov', '-o', dmg)
        hybrid.unlink()
        run('codesign', '--force', '--timestamp', '--sign', IDENTITY, dmg)
        notarize(dmg, credentials)
        run('xcrun', 'stapler', 'staple', dmg)
        run('xcrun', 'stapler', 'validate', dmg)
        run('hdiutil', 'verify', dmg)
        (output / (dmg.name + '.sha256')).write_text(
            hashlib.sha256(dmg.read_bytes()).hexdigest() + '  ' + dmg.name + '\n')
        print(f'Verified DMG: {dmg}', flush=True)

if __name__ == '__main__':
    main()
