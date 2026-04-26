#!/usr/bin/env bash
set -e

SIMULATOR_UDID="F472A4EF-6875-4FBE-A9B3-610011C58279"
BUNDLE_ID="com.freshbloom.admindashboard"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IOS_DIR="$PROJECT_DIR/ios/App"

# Identify the correct DerivedData by matching the workspace source path
DERIVED_APP=$(
  for dd in ~/Library/Developer/Xcode/DerivedData/App-*/; do
    plist="$dd/info.plist"
    if [[ -f "$plist" ]]; then
      src=$(/usr/libexec/PlistBuddy -c "Print :WorkspacePath" "$plist" 2>/dev/null || true)
      if [[ "$src" == "$IOS_DIR"* ]]; then
        echo "$dd/Build/Products/Debug-iphonesimulator/App.app"
        break
      fi
    fi
  done
)

if [[ -z "$DERIVED_APP" ]]; then
  echo "⚠️  Could not auto-detect DerivedData for this project. Falling back to hardcoded path."
  DERIVED_APP="$HOME/Library/Developer/Xcode/DerivedData/App-cghdptbslcdqtsflprqwnmytlhgp/Build/Products/Debug-iphonesimulator/App.app"
fi

echo "▶  Building web..."
cd "$PROJECT_DIR"
npm run build

echo "▶  Syncing Capacitor..."
npx cap copy ios

echo "▶  Building iOS (simulator)..."
cd "$IOS_DIR"
xcodebuild \
  -project App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination "id=$SIMULATOR_UDID" \
  build | xcpretty 2>/dev/null || xcodebuild \
  -project App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination "id=$SIMULATOR_UDID" \
  build

echo "▶  Installing on simulator..."
xcrun simctl install "$SIMULATOR_UDID" "$DERIVED_APP"

echo "▶  Launching..."
xcrun simctl launch "$SIMULATOR_UDID" "$BUNDLE_ID"

echo "✅  Done — app launched on simulator."
