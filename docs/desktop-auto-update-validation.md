# Desktop automatic update validation

Implementation branch: `feat/desktop-auto-update`. This record is **not** a release-complete claim.

## Evidence recorded so far (2026-10-19)

- Baseline: frontend 1559 passed / 1 skipped, Flutter 567 passed.
- Authenticated distribution: 22 focused frontend tests; Next production build passed. Stream length/hash and version snapshot mismatches abort, unsupported methods fail, no Storage capability is returned by automatic discovery.
- Flutter: 577 tests passed, analyze clean. Global pushed-route strip, one-click start, account cancellation/stale callbacks and startup after role restoration covered.
- macOS: Sparkle **2.10.0**, exact official SPM revision and binary checksum pinned by `Package.resolved` and upstream `Package.swift`. CocoaPods did not publish this version, so SPM is used without downgrading.
- Native test app has identity `com.innogrid.playground.updater-tests` and URL scheme `innocrew-updater-tests`; production installation/data are not the test target.
- Actual Xcode sandboxed/ad-hoc-signed XCTest run passed six adapter tests (exact feed/enclosure validation, one-click install continuation, cancellation using `.skip`, sanitized error, real system-menu target). Menu responder-chain failure was reproduced and fixed by targeting AppDelegate directly. Result: `/tmp/innocrew-updater-native-debug/Logs/Test/Test-Runner-2026.10.19_17-06-20-+0900.xcresult`.
- Local transport probe passed cross-host AND cross-port redirect cases with a synthetic bearer. It exercises the default Foundation URLSession configuration used by Sparkle 2.10.0 SPUDownloader, not a real signed artifact upgrade.
- Windows pinned WinSparkle 0.9.4 actual-DLL redirect probe and C++ lifecycle tests passed on GitHub Windows runner. Full Flutter Windows build and isolated Inno Setup harness passed in run `39221979372` (commit `c08877b`). Unicode/spaced install directory, exact old-process graceful close, exactly one new process, byte-for-byte installed payload, persistent fixture data, unrelated same-named process and 30-second busy-process abort verified. This harness did not yet download a signed update through WinSparkle.

## Final release-candidate gates (2026-10-20, 1.7.9+60)

- Latest main's independent iOS briefing changes (`1d7b86a`) are included; 1.7.8 was already used, so desktop candidate is **1.7.9+60**.
- Full suites after integration: frontend **1585 passed / 1 skipped**, Flutter **579 passed**; analyze and Next production build passed. Download-page copy explains the first manual installation and subsequent app-internal automatic installation/restart.
- Mac native adapter: **7 XCTest tests passed**, including no-relaunch terminal failure. Flutter cancellation failure requires restarting the app and cannot start another native install.
- Independent whole-branch review found Windows credential reattachment after a redirected remote appcast. Red CI `39294127306` reproduced it. The SDK now consumes an exclusively owned loopback feed containing only the exact official version-bound artifact and discovery signature. Green CI `39294706328` rejects the malicious chain without exposing the synthetic bearer. Remote appcasts cannot introduce another authenticated enclosure request.
- Windows full release CI **39306292080**, source **618389f**, passed actual WinSparkle/Setup two-version signed upgrade, old PID exit/new PID exactly once, Unicode path, persistent fixture state, invalid signature/expired auth/interrupted download rejection, unrelated process preservation and busy-process abort. It also covers a production-shaped artifact URL without `.exe`, using Content-Disposition. Final Setup has an Ed25519 update signature. This is **not** Windows Authenticode publisher signing; existing manual-install SmartScreen guidance remains applicable.
- Mac signed sandboxed real upgrade with the release-built helper passed: old PID **34052** -> new PID **34195**, same Korean/spaced path, installed version 2, exactly one restart, persistent fixture account/preferences. Bad signature, expired auth, interrupted download and read-only DMG all rejected without terminating/replacing the old app. Final owned test disk ejected normally. Evidence log `/tmp/innocrew-updater-macos-gate-final.log`, fixture root `innocrew-macos-upgrade-oBvyEM`.
- Mac root cause was upstream Sparkle's literal NFC/NFD path comparison, not a force-quit workaround. Release packaging rebuilds only the universal progress/relaunch helper from pinned 2.10.0 committed source with a two-line canonical normalization patch. See `mobile/scripts/patches/README.md`. Sandbox, exact resolved path matching, transport and cryptographic validation remain intact.
- Final Mac 1.7.9 app and DMG passed Developer ID signing, Apple notarization, stapling, Gatekeeper assessment and DMG verification; the final stapled bytes were then Ed25519 signed. `release-macos.py` must be used for distribution; a bare Flutter build does not embed the patched helper.
- Per-platform update private keys are in login Keychain; Windows CI receives its seed through an encrypted repository secret. Only public keys are committed. Immutable Storage upload verifies signature/size/hash; metadata publication is a platform-scoped compare-and-set via Supabase MCP.

## Validation boundaries / still to publish

- These are actual SDK/installer native fixtures, **not full Flutter Microsoft OAuth E2E**. Fixture account/preferences survived; real Teams/SharePoint reauthentication and production Keychain credentials need physical Windows/macOS account testing. No claim of new Microsoft-login fixes is made by this release.
- Read-only DMG was exercised. A separate non-admin OS account, administrator-owned `/Applications` denial and interactive UAC/password/security-policy cases were not executed. No permission/security prompt is bypassed; those environments can require OS approval or an authorized manual installation.
- Arbitrary unsaved WebView form contents are not automatically saved; the initial strip asks users to save work before the one-click install/restart authorization.
- Merge, production server deployment, signed artifact metadata publication and official-site download verification remain separate final delivery steps below.

### Prepared immutable 1.7.9 artifacts

Native runtime/build source is `618389f02c19c18c4a9a8dc1bee7820c74299c5e`.
Later changes are validation documentation, a fixture disk-eject cleanup, the
same SPM lock for Flutter's project entrypoint, and web download-page copy;
they do not change native runtime or installer bytes. Publishing must preserve
these already verified/stapled/signed bytes rather than re-signing them.

| Platform | Bytes | SHA-256 |
| --- | ---: | --- |
| macOS | 27986433 | `2a75cc9a6447a47df0844d77d6d815607e9d707e2d705e57338912e7bfd848af` |
| Windows | 14472709 | `c1f0bb8979324e9ea0fa084dbe9a9877c857926a4199cfd026d3a2561063d924` |

Private Storage upload/read-back and Ed25519 verification succeeded for both.
Metadata was not changed by upload; publication requires the Supabase MCP
platform-specific conditional update and its returned row.

The first updater-capable binary requires one manual installation. No older binary is claimed to support automatic installation retroactively.
