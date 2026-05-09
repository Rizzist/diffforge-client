#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app_path="$repo_root/src-tauri/target/debug/bundle/macos/Diff Forge AI.app"
legacy_app_path="$repo_root/src-tauri/target/debug/bundle/macos/Diff Forge AI Dev.app"
signing_identity="${APPLE_SIGNING_IDENTITY:-Diff Forge AI Local Development}"
dev_keychain="$HOME/Library/Keychains/diffforge-dev.keychain-db"
lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

cd "$repo_root"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This launcher is only for macOS." >&2
  exit 1
fi

if [[ -f "$dev_keychain" ]]; then
  keychains=()
  keychain_registered=false
  while IFS= read -r keychain; do
    keychain="${keychain//\"/}"
    [[ -z "$keychain" ]] && continue
    keychains+=("$keychain")
    [[ "$keychain" == "$dev_keychain" ]] && keychain_registered=true
  done < <(security list-keychains -d user)

  if [[ "$keychain_registered" != true ]]; then
    security list-keychains -d user -s "$dev_keychain" "${keychains[@]}"
  fi
fi

if ! security find-identity -v -p codesigning | grep -Fq "\"$signing_identity\""; then
  echo "Missing code-signing identity: $signing_identity" >&2
  echo "Run the local macOS signing setup first, then retry this launcher." >&2
  exit 1
fi

if [[ -d "$legacy_app_path" ]]; then
  "$lsregister" -u "$legacy_app_path" 2>/dev/null || true
  rm -rf "$legacy_app_path"
fi

APPLE_SIGNING_IDENTITY="$signing_identity" npx tauri build --debug --bundles app --config '{"bundle":{"targets":["app"]}}'
"$lsregister" -f "$app_path"
codesign --verify --deep --strict --verbose=4 "$app_path"
signature_details="$(codesign -dv --verbose=4 "$app_path" 2>&1)"
if ! grep -Fq "Authority=$signing_identity" <<<"$signature_details"; then
  echo "Built app was not signed by $signing_identity." >&2
  echo "$signature_details" >&2
  exit 1
fi

entitlements="$(codesign -d --entitlements :- "$app_path" 2>/dev/null || true)"
if ! grep -Fq "com.apple.security.device.audio-input" <<<"$entitlements"; then
  echo "Built app is missing the macOS microphone entitlement." >&2
  echo "$entitlements" >&2
  exit 1
fi

open -n "$app_path"

echo "Launched $app_path"
echo "Signed with $signing_identity"
echo "Microphone entitlement present"
echo "macOS should now route diffforge:// URLs to Diff Forge AI."
