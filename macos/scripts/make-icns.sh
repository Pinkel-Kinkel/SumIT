#!/usr/bin/env bash
set -euo pipefail

# Converts ../assets/icon-512.png into macos/build/icon.icns using native macOS sips + iconutil.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MACOS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_ICON="$MACOS_DIR/../assets/icon-512.png"
BUILD_DIR="$MACOS_DIR/build"
ICONSET_DIR="$BUILD_DIR/icon.iconset"
OUT_ICNS="$BUILD_DIR/icon.icns"

if [[ ! -f "$SRC_ICON" ]]; then
  echo "Error: Source icon not found at $SRC_ICON" >&2
  exit 1
fi

mkdir -p "$BUILD_DIR"
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$SRC_ICON" --out "$ICONSET_DIR/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  if [[ "$double" -le 512 ]]; then
    sips -z "$double" "$double" "$SRC_ICON" --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" >/dev/null
  else
    cp "$SRC_ICON" "$ICONSET_DIR/icon_${size}x${size}@2x.png"
  fi
done

iconutil -c icns "$ICONSET_DIR" -o "$OUT_ICNS"
rm -rf "$ICONSET_DIR"
echo "Generated $OUT_ICNS"
