#!/bin/bash
set -euo pipefail
# Keep the Xcode 27 lipo compatibility shim local to Flutter assembly.
export PATH="$PROJECT_DIR/../scripts/macos-toolchain:$PATH"
exec "$FLUTTER_ROOT/packages/flutter_tools/bin/macos_assemble.sh" "$@"
