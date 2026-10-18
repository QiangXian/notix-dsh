#!/bin/sh
#
# Build the Notix notification helper app.
#
# The helper posts UNUserNotificationCenter notifications so the banner shows
# the Notix (DeepSeek whale) icon instead of Script Editor's. macOS only grants
# notification authorization to code-signed apps, so this script signs with a
# real identity when one is supplied and otherwise falls back to an ad-hoc
# signature (which the system rejects for notifications — use it only to check
# the bundle layout).
#
# Usage:
#   ./scripts/build-notifier-app.sh                        # ad-hoc, warns
#   NOTIX_SIGN_IDENTITY="Apple Development: You (TEAMID)" ./scripts/build-notifier-app.sh
#   ./scripts/build-notifier-app.sh --install              # also copy to ~/Applications
#
# Output: build/Notix.app (or the path in NOTIX_APP_OUTPUT)
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${NOTIX_APP_OUTPUT:-"$ROOT/build/Notix.app"}
SWIFT_SRC="$ROOT/scripts/notifier/NotixNotifier.swift"
ICNS="$ROOT/assets/NotixNotifier.icns"
BUNDLE_ID=${NOTIX_BUNDLE_ID:-com.notix.notifier}
IDENTITY=${NOTIX_SIGN_IDENTITY:--}

if ! command -v swiftc >/dev/null 2>&1; then
  echo "build-notifier-app: swiftc not found; install Xcode Command Line Tools" >&2
  exit 1
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/notix-notifier.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
MODULE_CACHE="$WORK/modulecache"
mkdir -p "$MODULE_CACHE"

echo "build-notifier-app: compiling $SWIFT_SRC"
swiftc -module-cache-path "$MODULE_CACHE" -O -o "$WORK/NotixNotifier" "$SWIFT_SRC" \
  -framework Cocoa -framework UserNotifications

rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
cp "$WORK/NotixNotifier" "$OUT/Contents/MacOS/NotixNotifier"
cp "$ICNS" "$OUT/Contents/Resources/NotixNotifier.icns"

cat > "$OUT/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>NotixNotifier</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>Notix</string>
  <key>CFBundleDisplayName</key><string>Notix</string>
  <key>CFBundleIconFile</key><string>NotixNotifier</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

echo "build-notifier-app: signing as '$IDENTITY'"
codesign --force --deep --sign "$IDENTITY" "$OUT"

if [ "$IDENTITY" = "-" ]; then
  cat >&2 <<'WARN'

  WARNING: ad-hoc signature. macOS denies notification authorization to
  ad-hoc-signed apps (requestAuthorization returns "Notifications are not
  allowed for this application"), so the banner keeps the Script Editor icon.
  Set NOTIX_SIGN_IDENTITY to an "Apple Development" or "Developer ID
  Application" identity and rebuild to get the Notix icon.

WARN
fi

if [ "${1:-}" = "--install" ]; then
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/Notix.app"
  cp -R "$OUT" "$HOME/Applications/Notix.app"
  echo "build-notifier-app: installed $HOME/Applications/Notix.app"
fi

echo "build-notifier-app: built $OUT"
