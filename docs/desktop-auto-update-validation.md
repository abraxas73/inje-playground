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

## Still required before publishing

- Windows native adapter, menu and Setup lifecycle tests/build.
- Platform update signing keys in secure storage; verified signed immutable publication pipeline.
- Real two-version signed upgrades on macOS and Windows: old process exits, new version starts exactly once, session/settings preserved.
- Real signature mismatch, expired authentication, interrupted transfer, busy/locked target and canceled authorization cases.
- macOS read-only DMG/non-admin installation behavior; final Developer ID signing, notarization, nested helper entitlements and runtime verification.
- Final independent whole-branch review, merge, release builds, authenticated publication and official website verification.

The first updater-capable binary requires one manual installation. No older binary is claimed to support automatic installation retroactively.
