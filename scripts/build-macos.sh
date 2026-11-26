#!/usr/bin/env bash
# ==============================================================================
# Uku Furigana — macOS Native Desktop Build & DMG Packaging Script
# ==============================================================================
# Builds the static Next.js export (`out/`), packages `desktop_runner.py` into a
# macOS `.app` bundle via PyInstaller (--onedir --windowed), applies an ad-hoc
# code signature, and wraps it into a compressed `.dmg` image for the host arch
# (arm64 on Apple Silicon, x86_64 on Intel).
# ==============================================================================

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: scripts/build-macos.sh must be run on macOS." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="${PYTHON:-python3}"
ARCH="${MACOS_ARCH:-$(uname -m)}"
VERSION="$(node -p "require('./package.json').version")"
APP_NAME="UkuFurigana"
BUNDLE_ID="com.cheese.uku"
DMG_NAME="Uku-Furigana-v${VERSION}-macos-${ARCH}.dmg"
OUTPUT_DMG="${ROOT_DIR}/${DMG_NAME}"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/uku-macos-build.XXXXXX")"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "==> 1. Building Next.js static export (out/)..."
node scripts/build-web.mjs

echo "==> 2. Generating macOS .icns icon from public/logo.png..."
ICONSET_DIR="${WORK_DIR}/AppIcon.iconset"
ICNS_PATH="${WORK_DIR}/app_icon.icns"
mkdir -p "$ICONSET_DIR"

sips -z 16 16     public/logo.png --out "${ICONSET_DIR}/icon_16x16.png" >/dev/null
sips -z 32 32     public/logo.png --out "${ICONSET_DIR}/icon_16x16@2x.png" >/dev/null
sips -z 32 32     public/logo.png --out "${ICONSET_DIR}/icon_32x32.png" >/dev/null
sips -z 64 64     public/logo.png --out "${ICONSET_DIR}/icon_32x32@2x.png" >/dev/null
sips -z 128 128   public/logo.png --out "${ICONSET_DIR}/icon_128x128.png" >/dev/null
sips -z 256 256   public/logo.png --out "${ICONSET_DIR}/icon_128x128@2x.png" >/dev/null
sips -z 256 256   public/logo.png --out "${ICONSET_DIR}/icon_256x256.png" >/dev/null
sips -z 512 512   public/logo.png --out "${ICONSET_DIR}/icon_256x256@2x.png" >/dev/null
sips -z 512 512   public/logo.png --out "${ICONSET_DIR}/icon_512x512.png" >/dev/null
cp public/logo.png "${ICONSET_DIR}/icon_512x512@2x.png"

iconutil -c icns "$ICONSET_DIR" -o "$ICNS_PATH"

echo "==> 3. Packaging ${APP_NAME}.app with PyInstaller (${ARCH})..."
rm -rf "${ROOT_DIR}/dist/${APP_NAME}" "${ROOT_DIR}/dist/${APP_NAME}.app"

UKU_APP_VERSION="${VERSION}" "$PYTHON_BIN" -m PyInstaller \
  --noconfirm \
  --clean \
  --onedir \
  --windowed \
  --collect-all webview \
  --name "$APP_NAME" \
  --icon "$ICNS_PATH" \
  --osx-bundle-identifier "$BUNDLE_ID" \
  --add-data "out:out" \
  desktop_runner.py

APP_BUNDLE="${ROOT_DIR}/dist/${APP_NAME}.app"
if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "ERROR: Expected app bundle not found at ${APP_BUNDLE}" >&2
  exit 1
fi

echo "==> 4. Applying ad-hoc code signature..."
codesign --force --deep --sign - "$APP_BUNDLE"

echo "==> 5. Creating DMG (${DMG_NAME})..."
STAGE_DIR="${WORK_DIR}/dmg-stage"
mkdir -p "$STAGE_DIR"
cp -R "$APP_BUNDLE" "${STAGE_DIR}/"
ln -s /Applications "${STAGE_DIR}/Applications"

rm -f "$OUTPUT_DMG"
for attempt in 1 2 3 4 5; do
  if hdiutil create \
    -volname "Uku Furigana" \
    -srcfolder "$STAGE_DIR" \
    -ov \
    -format UDZO \
    "$OUTPUT_DMG"; then
    break
  fi
  if [[ "$attempt" -eq 5 ]]; then
    echo "ERROR: hdiutil create failed after 5 attempts." >&2
    exit 1
  fi
  echo "hdiutil create busy (attempt ${attempt}/5), retrying in 5s..." >&2
  rm -f "$OUTPUT_DMG"
  sleep 5
done

echo "==> Done: ${OUTPUT_DMG}"
