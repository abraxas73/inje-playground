# Sparkle 2.10.0 Unicode relaunch helper

Upstream revision: `eef1a539a373c1f1a320624b1130fc5de7b2e100`.

`InstallerProgressAppController.runningApplicationsWithBundle` compares an
NSString-resolved bundle path (NFC) against a URL-resolved running-app path
(NFD). On this macOS host, a Korean install path produces unequal component
arrays, so Sparkle incorrectly considers the old app already terminated. It
replaces files while the old process remains alive and does not relaunch.

Evidence: the unmodified signed sandboxed fixture repeatedly failed on a
Korean path; the identical fixture on an ASCII path terminated PID 87138 and
launched PID 87334 exactly once. An external NSRunningApplication probe
reproduced the exact unequal upstream comparison. This is distinct from the
initial invalid direct-executable test launch, which was replaced by normal
LaunchServices `open -n`.

The patch normalizes both comparison operands to NFC, retaining the existing
bundle identifier, resolved full-path matching and graceful termination. It
does not loosen matching to a filename or process name.

`build-sparkle-helper.mjs` archives the exact committed source (not mutable
checkout files), applies and verifies the two-line patch in a separate git
root, and builds only the universal progress/relaunch helper. All other
Sparkle framework, installer, transport and cryptographic binaries remain the
pinned upstream release. `release-macos.py` always rebuilds and embeds this
helper **before** nested Developer ID signing and notarization. A plain
`flutter build macos` is not the distributable release pipeline.

Reproduce the actual signed sandboxed upgrade gate using the patched helper:

```sh
node mobile/scripts/build-sparkle-helper.mjs /path/to/pinned/Sparkle/checkout
node mobile/scripts/test-macos-signed-upgrade.mjs /path/to/Sparkle.framework /path/from/build-receipt/Updater.app
```

The receipt is `mobile/build/desktop-updater/sparkle-helper.json`; source
revision, patch hash, universal executable hash and helper path are recorded.
The private update-signing key is not needed by this helper build. Fixture
tests use an ephemeral key and a separate bundle identifier, never the user's
installed InnoCrew or live Microsoft account.

When upstream resolves canonical path comparison, remove this patch only after
the same Korean-path signed upgrade gate passes against the replacement SDK.
