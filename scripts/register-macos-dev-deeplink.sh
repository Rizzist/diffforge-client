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

# Adds the dev keychain (code-signing identity only) to the user search list.
#
# This function must stay paranoid: an earlier version stripped quotes but
# not the 4-space indent `security list-keychains` prints, so the "already
# registered" check never matched and every run re-registered whitespace-
# prefixed paths. `security` resolved those relative to ~/Library/Keychains/,
# compounding nested garbage entries until login.keychain-db fell OUT of the
# search list entirely — system-wide breakage (Chrome loses its Safe Storage
# key and logs the user out of everything). Rules now enforced on every run:
#   1. trim whitespace AND quotes from every parsed entry,
#   2. drop entries whose files do not exist (self-heals old corruption),
#   3. login.keychain-db is always present and stays FIRST,
#   4. the dev keychain is appended LAST, never prepended,
#   5. rewrite only when something actually needs to change.
register_dev_keychain() {
  local login_keychain="$HOME/Library/Keychains/login.keychain-db"
  local keychains=()
  local line keychain
  local keychain_registered=false
  local list_dirty=false
  local login_present=false

  while IFS= read -r line; do
    keychain="${line//\"/}"
    keychain="${keychain#"${keychain%%[![:space:]]*}"}"
    keychain="${keychain%"${keychain##*[![:space:]]}"}"
    [[ -z "$keychain" ]] && continue
    if [[ ! -f "$keychain" ]]; then
      # Malformed or stale entry: drop it and rewrite the cleaned list.
      list_dirty=true
      continue
    fi
    if [[ "$keychain" == "$dev_keychain" ]]; then
      keychain_registered=true
      continue
    fi
    [[ "$keychain" == "$login_keychain" ]] && login_present=true
    keychains+=("$keychain")
  done < <(security list-keychains -d user)

  if [[ "$login_present" != true && -f "$login_keychain" ]]; then
    keychains=("$login_keychain" ${keychains[@]+"${keychains[@]}"})
    list_dirty=true
  fi

  if [[ "$keychain_registered" == true && "$list_dirty" != true ]]; then
    return
  fi

  security list-keychains -d user -s ${keychains[@]+"${keychains[@]}"} "$dev_keychain"
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
