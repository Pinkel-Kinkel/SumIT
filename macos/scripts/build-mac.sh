#!/usr/bin/env bash
set -euo pipefail

# Builds standalone SumIT.app + DMG + ZIP for macOS (arm64, x64, or universal).
# Usage:
#   bash scripts/build-mac.sh           # builds for current host architecture
#   bash scripts/build-mac.sh arm64     # builds Apple Silicon (.dmg + .zip)
#   bash scripts/build-mac.sh x64       # builds Intel (.dmg + .zip)
#   bash scripts/build-mac.sh both      # builds both arm64 and x64
#   bash scripts/build-mac.sh universal # builds universal binary

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MACOS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$MACOS_DIR"

TARGET_ARCH="${1:-$(uname -m)}"

echo "[1/4] Generating macOS app icon (build/icon.icns)..."
bash "$SCRIPT_DIR/make-icns.sh"

echo "[2/4] Running syntax & module checks..."
node "$SCRIPT_DIR/check.js"

echo "[3/4] Running offline regression tests..."
node "$SCRIPT_DIR/offline-tests.js"

echo "[4/4] Packaging SumIT.app with electron-builder (target: $TARGET_ARCH)..."
case "$TARGET_ARCH" in
  arm64)
    CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64
    ;;
  x64|x86_64)
    CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --x64
    ;;
  both|all)
    CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --x64
    ;;
  universal)
    CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --universal
    ;;
  dir)
    CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir
    ;;
  *)
    echo "Unknown architecture '$TARGET_ARCH'. Use: arm64 | x64 | both | universal | dir" >&2
    exit 1
    ;;
esac

echo "Build complete. Output artifacts in: $MACOS_DIR/dist"
ls -lh "$MACOS_DIR/dist"
