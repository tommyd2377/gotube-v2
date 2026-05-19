#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/firetv"
WEB_DIR="$ROOT_DIR/apps/web"
BUILD_DIR="$APP_DIR/build"
ASSETS_DIR="$BUILD_DIR/assets"
GENERATED_R_DIR="$BUILD_DIR/generated/r"
CLASSES_DIR="$BUILD_DIR/classes"
DEX_DIR="$BUILD_DIR/dex"
OUTPUT_DIR="$BUILD_DIR/outputs"

ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
ANDROID_PLATFORM="${ANDROID_PLATFORM:-$(find "$ANDROID_SDK_ROOT/platforms" -maxdepth 1 -type d -name 'android-*' | sort | tail -1 | xargs basename)}"
ANDROID_BUILD_TOOLS_VERSION="${ANDROID_BUILD_TOOLS_VERSION:-$(find "$ANDROID_SDK_ROOT/build-tools" -maxdepth 1 -type d | sort | tail -1 | xargs basename)}"
MIN_SDK="${MIN_SDK:-22}"
TARGET_SDK="${TARGET_SDK:-34}"
DEBUG_KEYSTORE="${DEBUG_KEYSTORE:-$HOME/.android/debug.keystore}"

AAPT2="$ANDROID_SDK_ROOT/build-tools/$ANDROID_BUILD_TOOLS_VERSION/aapt2"
D8="$ANDROID_SDK_ROOT/build-tools/$ANDROID_BUILD_TOOLS_VERSION/d8"
ZIPALIGN="$ANDROID_SDK_ROOT/build-tools/$ANDROID_BUILD_TOOLS_VERSION/zipalign"
APKSIGNER="$ANDROID_SDK_ROOT/build-tools/$ANDROID_BUILD_TOOLS_VERSION/apksigner"
ANDROID_JAR="$ANDROID_SDK_ROOT/platforms/$ANDROID_PLATFORM/android.jar"

for tool in "$AAPT2" "$D8" "$ZIPALIGN" "$APKSIGNER" "$ANDROID_JAR"; do
  if [[ ! -e "$tool" ]]; then
    echo "Missing Android SDK tool or platform file: $tool" >&2
    exit 1
  fi
done

if [[ ! -f "$DEBUG_KEYSTORE" ]]; then
  echo "Missing debug keystore: $DEBUG_KEYSTORE" >&2
  echo "Open Android Studio once or set DEBUG_KEYSTORE to an existing debug signing key." >&2
  exit 1
fi

if [[ -z "${GOTUBE_API_BASE_URL:-}" && -z "${GOTUBE_TV_URL:-}" ]]; then
  echo "Warning: GOTUBE_API_BASE_URL is unset. The bundled app will expect /api on its local WebView origin." >&2
fi

rm -rf "$BUILD_DIR"
mkdir -p "$ASSETS_DIR/gotube" "$GENERATED_R_DIR" "$CLASSES_DIR" "$DEX_DIR" "$OUTPUT_DIR"

VITE_API_BASE_URL="${GOTUBE_API_BASE_URL:-}" npm --workspace apps/web run build -- --base=./
cp -R "$WEB_DIR/dist/." "$ASSETS_DIR/gotube/"

{
  printf 'tvUrl=%s\n' "${GOTUBE_TV_URL:-}"
} > "$ASSETS_DIR/gotube-native-config.properties"

COMPILED_RES="$BUILD_DIR/compiled-resources.zip"
UNSIGNED_APK="$BUILD_DIR/gotube-firetv-unsigned.apk"
UNALIGNED_APK="$BUILD_DIR/gotube-firetv-unaligned.apk"
ALIGNED_APK="$BUILD_DIR/gotube-firetv-aligned.apk"
SIGNED_APK="$OUTPUT_DIR/gotube-firetv-debug.apk"

"$AAPT2" compile --dir "$APP_DIR/src/main/res" -o "$COMPILED_RES"
"$AAPT2" link \
  -o "$UNSIGNED_APK" \
  -I "$ANDROID_JAR" \
  --manifest "$APP_DIR/src/main/AndroidManifest.xml" \
  -R "$COMPILED_RES" \
  -A "$ASSETS_DIR" \
  --java "$GENERATED_R_DIR" \
  --auto-add-overlay \
  --min-sdk-version "$MIN_SDK" \
  --target-sdk-version "$TARGET_SDK"

find "$APP_DIR/src/main/java" "$GENERATED_R_DIR" -name '*.java' > "$BUILD_DIR/java-sources.txt"
javac -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -d "$CLASSES_DIR" @"$BUILD_DIR/java-sources.txt"

find "$CLASSES_DIR" -name '*.class' > "$BUILD_DIR/class-files.txt"
"$D8" --lib "$ANDROID_JAR" --min-api "$MIN_SDK" --output "$DEX_DIR" @"$BUILD_DIR/class-files.txt"

cp "$UNSIGNED_APK" "$UNALIGNED_APK"
(cd "$DEX_DIR" && zip -q -u "$UNALIGNED_APK" classes.dex)

"$ZIPALIGN" -f 4 "$UNALIGNED_APK" "$ALIGNED_APK"
"$APKSIGNER" sign \
  --ks "$DEBUG_KEYSTORE" \
  --ks-key-alias androiddebugkey \
  --ks-pass pass:android \
  --key-pass pass:android \
  --out "$SIGNED_APK" \
  "$ALIGNED_APK"
"$APKSIGNER" verify "$SIGNED_APK"

echo "Built $SIGNED_APK"
