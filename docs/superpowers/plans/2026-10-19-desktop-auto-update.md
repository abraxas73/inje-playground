# Desktop Auto Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user click the update strip once and have InnoCrew download, verify, close, install and relaunch without a second install confirmation.

**Architecture:** Flutter owns discovery, global status and start intent. Sparkle 2.10.0 and WinSparkle 0.9.4 own the platform update lifecycle; authenticated same-origin feeds/streams and signed release artifacts preserve the existing private distribution model.

**Tech Stack:** Flutter/Riverpod, Swift/Cocoa/Sparkle, C++/WinSparkle/Inno Setup, Next.js, private Supabase Storage.

**Spec:** `docs/superpowers/specs/2026-10-19-desktop-auto-update-design.md`

## Global Constraints

- macOS and Windows only; leave iOS/Android update behavior unchanged.
- Official origin: `https://innocrew.innogrid.com`.
- A strip click authorizes the entire update; no second `업데이트 적용` or install/relaunch confirmation. OS authorization is an exception.
- Do not disable the macOS sandbox, expose private Storage, clear login/settings, or bypass missing signatures.
- Pin Sparkle 2.10.0 and WinSparkle 0.9.4. Keep Windows 10 1809 x64 and macOS 12 deployment floors unless library validation reveals incompatibility; report rather than silently raise a floor.
- First updater-capable release needs one manual installation; do not claim older binaries can acquire this feature automatically.
- Use Supabase MCP for database operations; keep keys/tokens out of logs and Git. Browser QA uses ego-browser only.

## Review Focus

- Account logout or token expiration during an update must not install under a new account or expose a bearer token to a redirected host (Tasks 1–4).
- A release changing between discovery and download must not mix one version's bytes/signature with another (Tasks 1, 5).
- Native callbacks after widget disposal, overlapping clicks or process close must not trigger duplicate installs/restarts (Tasks 2–4).
- Sandboxed/read-only/non-admin installations and locked files must fail safely, not be mistaken for successful updates (Tasks 3–4, 6).
- A signed native build must actually replace an earlier build and restart once while preserving session/settings; unit tests alone are insufficient (Task 6).

### Task 1: Authenticated, signed update distribution contract

**Files:** Modify `frontend/src/lib/desktop/release.ts`, `frontend/src/app/api/desktop/release/route.ts`; create `frontend/src/lib/desktop/update-feed.ts`, `frontend/src/app/api/desktop/update/appcast/route.ts`, `frontend/src/app/api/desktop/update/artifact/[platform]/[version]/route.ts`, `frontend/src/lib/__tests__/desktop-update-api.test.ts`.

**Interfaces:** Extend `DesktopArtifact` with optional `update: { build: number; edSignature: string; minimumOS: string }`. Add `createUpdateAppcast(platform: DesktopPlatform, artifact: DesktopArtifact): string`. Existing callers remain compatible; only artifacts with valid update metadata are automatically installable. Feed query is `platform=<macos|windows>&version=<x.y.z>`; enclosure is the corresponding same-origin immutable-version artifact endpoint.

- [ ] Write failing tests for valid XML/signature/escaping; missing metadata, wrong platform/version, stale-version race, 401/403, unsupported HTTP methods, oversized/truncated content and storage failure. Assert no bearer or Storage signed URL appears in XML/errors/logs.
- [ ] Run the focused frontend test file and observe the intended failures.
- [ ] Implement strict metadata parsing and same-origin appcast generation. Require existing user authentication for both endpoints; stream Storage bytes server-side with bounded size, no redirect and `Cache-Control: private, no-store`. Reject a version no longer represented by the requested snapshot rather than silently serving different bytes. Do not buffer the whole artifact.
- [ ] Verify malformed/expired authentication never returns executable bytes; frontend focused tests and build pass.
- [ ] Commit the contract and tests without production deployment.

### Task 2: Flutter state machine, global strip and native menu bridge

**Files:** Create `mobile/lib/release/desktop_updater.dart`, `mobile/lib/release/desktop_update_host.dart`, `mobile/test/release/desktop_updater_test.dart`, `mobile/test/release/desktop_update_host_test.dart`; modify `mobile/lib/release/release_check.dart`, `mobile/lib/release/release_provider.dart`, `mobile/lib/release/update_banner.dart`, `mobile/lib/main.dart`, `mobile/lib/app/tab_shell.dart`.

**Interfaces:** `DesktopUpdater.check({required bool manual})`, `DesktopUpdater.start()`, `DesktopUpdater.cancelForSignOut()`; states `idle/checking/available/installing/current/error`. MethodChannel `com.innogrid.playground/updater`: Flutter→native `install({feedUrl, accessToken, expectedVersion})`, `cancel`; native→Flutter `checkForUpdates`, `status({phase, version, progress?, code?})`. Tokens stay in process memory and never enter event payloads or URLs.

- [ ] Write failing provider/widget tests for one startup check after session recovery, manual current/error/login-needed results, a strip above a pushed WebView, one click invoking install once, no second confirmation, progress/error states, signout and ignored stale callbacks.
- [ ] Run the focused Dart tests and observe failure.
- [ ] Implement the controller and root host. Re-fetch metadata and refresh the auth session before installation; reject non-newer or unsigned releases. Move the desktop strip out of TabShell, retaining the mobile banner. Display automatic-restart/save-work notice before the initial click.
- [ ] Run focused tests and `flutter analyze --no-pub`; ensure no secret is stored in persisted state and no browser launcher is used by the new path.
- [ ] Commit the Dart behavior and channel contract.

### Task 3: Sandboxed macOS install/relaunch adapter

**Files:** Create `mobile/macos/Runner/DesktopUpdater.swift`, `mobile/macos/Runner/UpdaterUserDriver.swift`, `mobile/macos/RunnerTests/DesktopUpdaterTests.swift`; modify `mobile/macos/Podfile`, `mobile/macos/Podfile.lock`, `mobile/macos/Runner/MainFlutterWindow.swift`, `mobile/macos/Runner/Base.lproj/MainMenu.xib`, `mobile/macos/Runner/Info.plist`, both Runner entitlements and `mobile/macos/Runner.xcodeproj/project.pbxproj`.

**Interfaces:** Swift `DesktopUpdater` implements Task 2's channel using Sparkle; `UpdaterUserDriver` reports UI state and advances download/install only while the original user-started session remains authorized. Native app menu invokes `checkForUpdates` on the channel.

- [ ] Write failing native tests for one active session, wrong feed origin/version, canceled authorization, failure before app termination and automatic install/relaunch responses after the initial click.
- [ ] Integrate pinned Sparkle, Installer XPC service, required sandbox lookup entitlements and embedded public key. Do not enable the unnecessary Downloader XPC service; existing network-client entitlement is present. Preserve required entitlements while signing nested helpers.
- [ ] Implement the UI driver with visible progress in Flutter, automatic install/relaunch continuation, OS authorization handling and no extra application confirmation. Validate redirect/header behavior with a controlled off-origin test endpoint; patch the adapter/library boundary if needed, never weaken the requirement.
- [ ] Run native tests and an actual sandboxed build. Verify signature mismatch prevents termination and document read-only DMG/non-admin behavior.
- [ ] Commit the macOS adapter and configuration.

### Task 4: Windows lifecycle, menu and unattended Setup path

**Files:** Create `mobile/windows/runner/desktop_updater.h`, `mobile/windows/runner/desktop_updater.cpp`, `mobile/windows/tests/desktop_updater_test.cpp`; modify `mobile/windows/runner/CMakeLists.txt`, `mobile/windows/runner/flutter_window.h`, `mobile/windows/runner/flutter_window.cpp`, `mobile/installer/windows.iss`, `.github/workflows/windows-app.yml`.

**Interfaces:** C++ `DesktopUpdater` implements Task 2's channel and marshals WinSparkle callbacks onto the UI thread. Pin the official WinSparkle 0.9.4 binary and verify its recorded SHA-256 at acquisition. Embed the platform update public key. Automatic Setup mode uses `/INNOCREWAUTOUPDATE=1` plus supported unattended/no-reboot flags; never accept installer command arguments from remote metadata.

- [ ] Write native/harness failures for invalid feed/version, duplicate start, shutdown callback ordering, installer failure and exactly-one successful relaunch. Include Unicode/spaced install paths and another running app that must not be terminated.
- [ ] Integrate WinSparkle `check_update_with_ui_and_install`, auth headers and shutdown callbacks. Provide About/update entries in the window system menu. Start from the explicit click only, with visible native progress and no second install prompt.
- [ ] Update Setup so automatic mode installs in the existing location and restarts once on success, while preserving the manual-install UI and data. Request graceful closure only of InnoCrew; handle busy/failed closure without broad process killing or claiming success.
- [ ] Run harness/tests and build on Windows CI. Verify off-origin redirects cannot receive bearer tokens, malformed/unsigned packages do not execute, and no reboot occurs.
- [ ] Commit Windows lifecycle and installer changes.

### Task 5: Signed artifact publication and first-install migration

**Files:** Modify `mobile/scripts/release-macos.py`, `mobile/scripts/build-windows.ps1`, `frontend/scripts/publish-desktop.mjs`, `docs/mobile-app.md`, `docs/mobile-release-checklist.md`; create `mobile/scripts/sign-desktop-update.mjs` and `frontend/src/lib/__tests__/desktop-update-publication.test.ts`.

**Interfaces:** The signing step emits only `{build, edSignature, minimumOS}` sidecar metadata for the final immutable artifact. Publication verifies SHA-256, size, signature using the embedded public key and an actual library-compatible verification test before atomically updating that platform's metadata. Database publication is routed through approved Supabase MCP operations, not a new direct database connector.

- [ ] Add failing tests for missing key, wrong signature/key, artifact changed after signing, overwrite of an existing version with different bytes and concurrent other-platform publication.
- [ ] Provision per-platform update keys in the approved secure release store, never source files. Re-sign Sparkle services with correct entitlements, notarize macOS, and sign final DMG/EXE update payloads. Do not fall back to unsigned publication.
- [ ] Separate upload-and-verify from metadata publication so MCP can update only the selected platform with concurrency protection. Preserve legacy manual downloads and previously published platform metadata.
- [ ] Run publication tests without publishing; add migration instructions that updater-less versions need one manual installation of the first capable version.
- [ ] Commit signing/publishing changes and documentation.

### Task 6: End-to-end upgrade gates, release and production check

**Files:** Create `mobile/integration_test/desktop_update_test.dart`, `mobile/scripts/test-desktop-update.ps1`, `docs/desktop-auto-update-validation.md`; update release version only after fetching main and checking current published versions.

- [ ] Build two isolated, signed test versions using a distinct test application identity and controlled feed; do not overwrite the user's installed production app. Test the real updater's old→new transition on each OS.
- [ ] Assert old PID exited, new PID started exactly once, actual installed version changed, and test session/settings remained. Test network loss, invalid signature, expired auth, locked files/termination failure, read-only/non-admin Mac installations and repeated clicks.
- [ ] Run full Flutter/frontend suites, analyze, native tests and release builds. Record unexecuted interactive cases explicitly; do not label the lifecycle validated when only unit tests passed.
- [ ] Perform a whole-branch review, merge only the reviewed SHA, build both platforms, publish signed verified artifacts/metadata, then use ego-browser to verify official download/version/time/hash. Do not claim auto-update rollout complete until the native upgrade gates pass.
- [ ] Report first manual-install requirement, delivered version, test evidence and any remaining OS-specific limitations.

## Execution recommendation

Use native execution in this session with one independent whole-branch review: feed, authentication, installer and release signing are tightly coupled. Implementation must not start until the user approves the plan/execution approach. The UX itself was clarified by the user on 2026-10-19: one initial click, automatic installation and restart, no second confirmation.
