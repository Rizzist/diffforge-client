#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app_path="$repo_root/src-tauri/target/debug/bundle/macos/Diff Forge AI.app"
legacy_app_path="$repo_root/src-tauri/target/debug/bundle/macos/Diff Forge AI Dev.app"
signing_identity="${APPLE_SIGNING_IDENTITY:-Diff Forge AI Local Development}"
dev_keychain="$HOME/Library/Keychains/diffforge-dev.keychain-db"
dev_keychain_password="${DIFFFORGE_DEV_KEYCHAIN_PASSWORD:-diffforge-dev-keychain}"
lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

cd "$repo_root"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This launcher is only for macOS." >&2
  exit 1
fi

register_dev_keychain() {
  keychains=()
  keychain_registered=false
  while IFS= read -r keychain; do
    keychain="${keychain//\"/}"
    [[ -z "$keychain" ]] && continue
    [[ "$keychain" == "$dev_keychain" ]] && keychain_registered=true && continue
    keychains+=("$keychain")
  done < <(security list-keychains -d user)

  if [[ "$keychain_registered" != true ]]; then
    security list-keychains -d user -s "$dev_keychain" "${keychains[@]}"
  fi
}

unlock_dev_keychain() {
  security unlock-keychain -p "$dev_keychain_password" "$dev_keychain" >/dev/null 2>&1
}

create_dev_signing_identity() {
  if ! command -v openssl >/dev/null 2>&1; then
    echo "openssl is required to create the local development signing identity." >&2
    exit 1
  fi

  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' RETURN

  cat >"$tmpdir/openssl.cnf" <<EOF
[ req ]
distinguished_name = dn
x509_extensions = codesign_ext
prompt = no

[ dn ]
CN = $signing_identity

[ codesign_ext ]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
EOF

  openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
    -config "$tmpdir/openssl.cnf" \
    -keyout "$tmpdir/key.pem" \
    -out "$tmpdir/cert.pem" >/dev/null 2>&1

  security import "$tmpdir/key.pem" \
    -k "$dev_keychain" \
    -P "" \
    -T /usr/bin/codesign \
    -T /usr/bin/security >/dev/null

  security import "$tmpdir/cert.pem" -k "$dev_keychain" >/dev/null
  security add-trusted-cert -d -r trustRoot -p codeSign -k "$dev_keychain" "$tmpdir/cert.pem" >/dev/null 2>&1 || true
  rm -rf "$tmpdir"
  trap - RETURN
}

create_dev_keychain() {
  security create-keychain -p "$dev_keychain_password" "$dev_keychain"
  unlock_dev_keychain
  security set-keychain-settings -lut 21600 "$dev_keychain"
  create_dev_signing_identity
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$dev_keychain_password" "$dev_keychain" >/dev/null 2>&1 || true
}

replace_dev_keychain() {
  backup_path="${dev_keychain}.replaced-$(date +%Y%m%d%H%M%S)"
  security delete-keychain "$dev_keychain" >/dev/null 2>&1 || true
  if [[ -f "$dev_keychain" ]]; then
    mv "$dev_keychain" "$backup_path"
    echo "Backed up old development keychain to $backup_path"
  fi
  create_dev_keychain
}

if [[ -f "$dev_keychain" ]]; then
  if ! unlock_dev_keychain; then
    echo "Existing Diff Forge AI development keychain did not unlock with password $dev_keychain_password; recreating it."
    replace_dev_keychain
  fi
else
  create_dev_keychain
fi

register_dev_keychain
security set-keychain-settings -lut 21600 "$dev_keychain"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$dev_keychain_password" "$dev_keychain" >/dev/null 2>&1 || true

if ! security find-identity -v -p codesigning "$dev_keychain" | grep -Fq "\"$signing_identity\""; then
  create_dev_signing_identity
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$dev_keychain_password" "$dev_keychain" >/dev/null 2>&1 || true
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
