#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android"
BUILD_DIR="$ANDROID_DIR/build"
ASSETS_WWW="$ANDROID_DIR/assets/www"

export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk}"
export PATH="$JAVA_HOME/bin:$PATH"

SDK_DIR="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
BUILD_TOOLS="$SDK_DIR/build-tools/${ANDROID_BUILD_TOOLS_VERSION:-33.0.2}"
ANDROID_JAR="$SDK_DIR/platforms/android-${ANDROID_PLATFORM_VERSION:-33}/android.jar"

APP_VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"

# Release signing. Passwords never live in the repo:
#   ANDROID_KEYSTORE_PASSWORD  (prompted on a terminal when unset)
#   ANDROID_KEY_PASSWORD       (defaults to ANDROID_KEYSTORE_PASSWORD)
#   ANDROID_KEYSTORE / ANDROID_KEY_ALIAS to point at an existing key.
KEYSTORE="${ANDROID_KEYSTORE:-$ANDROID_DIR/keystore/uku-release.jks}"
KEY_ALIAS="${ANDROID_KEY_ALIAS:-uku}"
GENERATE_KEYSTORE=0
if [ ! -f "$KEYSTORE" ]; then
  # A release key must never be created by accident: APKs signed with a different
  # key cannot update existing installs.
  if [ "${ANDROID_KEYSTORE_GENERATE:-0}" != "1" ]; then
    echo "ERROR: keystore not found at $KEYSTORE." >&2
    echo "       Point ANDROID_KEYSTORE at your existing release key, or set ANDROID_KEYSTORE_GENERATE=1 to create a new one." >&2
    exit 1
  fi
  GENERATE_KEYSTORE=1
fi

if [ "$GENERATE_KEYSTORE" = "1" ]; then
  # A new key's password is always typed twice on the terminal, never taken from
  # the environment, so a stray or leaked value cannot become the release password.
  if [ ! -t 0 ]; then
    echo "ERROR: creating a release key needs an interactive terminal to enter its password." >&2
    exit 1
  fi
  read -r -s -p "New keystore password (min 8 chars): " ANDROID_KEYSTORE_PASSWORD; echo
  read -r -s -p "Repeat password: " CONFIRM_PASSWORD; echo
  if [ "$ANDROID_KEYSTORE_PASSWORD" != "$CONFIRM_PASSWORD" ]; then
    echo "ERROR: passwords do not match; no key was created." >&2
    exit 1
  fi
  if [ "${#ANDROID_KEYSTORE_PASSWORD}" -lt 8 ]; then
    echo "ERROR: password must be at least 8 characters; no key was created." >&2
    exit 1
  fi
  unset CONFIRM_PASSWORD ANDROID_KEY_PASSWORD
elif [ -z "${ANDROID_KEYSTORE_PASSWORD:-}" ]; then
  if [ ! -t 0 ]; then
    echo "ERROR: set ANDROID_KEYSTORE_PASSWORD (and ANDROID_KEY_PASSWORD if it differs) before building." >&2
    exit 1
  fi
  read -r -s -p "Keystore password for $KEYSTORE: " ANDROID_KEYSTORE_PASSWORD; echo
fi
export ANDROID_KEYSTORE_PASSWORD
export ANDROID_KEY_PASSWORD="${ANDROID_KEY_PASSWORD:-$ANDROID_KEYSTORE_PASSWORD}"

# Fail before the long build if the password does not open an existing key.
if [ "$GENERATE_KEYSTORE" = "0" ] && ! "$JAVA_HOME/bin/keytool" -list -keystore "$KEYSTORE" -storepass:env ANDROID_KEYSTORE_PASSWORD >/dev/null 2>&1; then
  echo "ERROR: wrong password for $KEYSTORE." >&2
  exit 1
fi

AAPT2="$BUILD_TOOLS/aapt2"
D8="$BUILD_TOOLS/d8"
ZIPALIGN="$BUILD_TOOLS/zipalign"
APKSIGNER="$BUILD_TOOLS/apksigner"

echo "==> [1/7] Preparing Android resources and web assets..."
rm -rf "$BUILD_DIR" "$ASSETS_WWW"
mkdir -p "$BUILD_DIR/compiled_res" \
         "$BUILD_DIR/gen" \
         "$BUILD_DIR/classes" \
         "$BUILD_DIR/dex" \
         "$ANDROID_DIR/res/mipmap-xxxhdpi" \
         "$ANDROID_DIR/res/values" \
         "$ANDROID_DIR/keystore" \
         "$ASSETS_WWW"

# Launcher icons are committed under android/res/mipmap-* (see docs/brand), never generated
# here: an earlier build regenerated the icon and silently fell back to an old image on
# machines without the Python imaging library, which is how v1.2.0 shipped a wrong icon.
cat > "$ANDROID_DIR/res/values/strings.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Uku Furigana</string>
</resources>
EOF

echo "==> Building fresh Next.js static export (out/)..."
rm -rf "$ROOT_DIR/out"
node "$ROOT_DIR/scripts/vendor-assets.mjs"
API_BACKUP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/furigana-apk-api-backup.XXXXXX")"
mv "$ROOT_DIR/app/api" "$API_BACKUP_DIR/api"
restore_api() {
  if [ -d "$API_BACKUP_DIR/api" ] && [ ! -d "$ROOT_DIR/app/api" ]; then
    mv "$API_BACKUP_DIR/api" "$ROOT_DIR/app/api"
    rmdir "$API_BACKUP_DIR" 2>/dev/null || true
  fi
}
trap restore_api EXIT
(cd "$ROOT_DIR" && NEXT_EXPORT=true npx next build)
restore_api

cp -r "$ROOT_DIR/out/"* "$ASSETS_WWW/"

# Rename .dat.gz files to .dat.gz.bin so Android AssetManager never auto-decompresses Kuromoji dictionaries
if [ -d "$ASSETS_WWW/dict" ]; then
  for gzfile in "$ASSETS_WWW/dict/"*.dat.gz; do
    if [ -f "$gzfile" ]; then
      mv "$gzfile" "${gzfile}.bin"
    fi
  done
fi

echo "==> [2/7] Compiling Android resources with aapt2..."
"$AAPT2" compile --dir "$ANDROID_DIR/res" -o "$BUILD_DIR/compiled_res/res.zip"

echo "==> [3/7] Linking APK and generating R.java with aapt2..."
"$AAPT2" link \
  -I "$ANDROID_JAR" \
  --manifest "$ANDROID_DIR/AndroidManifest.xml" \
  ${ANDROID_DEBUGGABLE:+--debug-mode} \
  --java "$BUILD_DIR/gen" \
  -A "$ANDROID_DIR/assets" \
  -0 .bin -0 .gz -0 .dat -0 .wasm -0 .onnx -0 .woff2 -0 .mp3 -0 .ogg \
  -o "$BUILD_DIR/unaligned.apk" \
  "$BUILD_DIR/compiled_res/res.zip"

echo "==> [4/7] Compiling Java sources with JDK 17..."
find "$ANDROID_DIR/src" "$BUILD_DIR/gen" -name "*.java" > "$BUILD_DIR/sources.txt"
"$JAVA_HOME/bin/javac" \
  --release 11 \
  -encoding UTF-8 \
  -cp "$ANDROID_JAR" \
  -d "$BUILD_DIR/classes" \
  @"$BUILD_DIR/sources.txt"

echo "==> [5/7] Compiling classes.dex with d8..."
find "$BUILD_DIR/classes" -name "*.class" > "$BUILD_DIR/classes.txt"
"$D8" \
  --lib "$ANDROID_JAR" \
  --min-api 24 \
  --output "$BUILD_DIR/dex" \
  $(cat "$BUILD_DIR/classes.txt")

echo "==> [6/7] Packaging classes.dex and aligning APK..."
(cd "$BUILD_DIR/dex" && zip -q -u "$BUILD_DIR/unaligned.apk" classes.dex)
"$ZIPALIGN" -f -p 4 "$BUILD_DIR/unaligned.apk" "$BUILD_DIR/aligned.apk"

if [ "$GENERATE_KEYSTORE" = "1" ]; then
  echo "==> Generating signing keystore at $KEYSTORE (back it up: losing it blocks future updates)..."
  mkdir -p "$(dirname "$KEYSTORE")"
  "$JAVA_HOME/bin/keytool" -genkeypair \
    -v \
    -keystore "$KEYSTORE" \
    -alias "$KEY_ALIAS" \
    -keyalg RSA \
    -keysize 4096 \
    -validity 10000 \
    -storepass:env ANDROID_KEYSTORE_PASSWORD \
    -keypass:env ANDROID_KEY_PASSWORD \
    -dname "CN=Uku Furigana, O=Cheese"
fi

echo "==> [7/7] Signing and verifying APK..."
FINAL_APK="$ROOT_DIR/UkuFurigana.apk"
VERSIONED_APK="$BUILD_DIR/UkuFurigana-v$APP_VERSION.apk"

"$APKSIGNER" sign \
  --ks "$KEYSTORE" \
  --ks-key-alias "$KEY_ALIAS" \
  --ks-pass env:ANDROID_KEYSTORE_PASSWORD \
  --key-pass env:ANDROID_KEY_PASSWORD \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "$FINAL_APK" \
  "$BUILD_DIR/aligned.apk"

cp "$FINAL_APK" "$VERSIONED_APK"
"$APKSIGNER" verify --verbose "$FINAL_APK"

# Clean temporary build copies of assets to keep repo light
rm -rf "$ASSETS_WWW" "$BUILD_DIR/unaligned.apk" "$BUILD_DIR/aligned.apk"

echo "==> APK successfully built:"
ls -lh "$FINAL_APK" "$VERSIONED_APK"
