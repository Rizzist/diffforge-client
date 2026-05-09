#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app_path="$repo_root/src-tauri/target/debug/bundle/macos/Diff Forge AI.app"

cd "$repo_root"

npx tauri build --debug --bundles app --no-sign --config '{"bundle":{"targets":["app"]}}'
codesign --force --deep --sign - "$app_path"
open -n "$app_path"

echo "Launched $app_path"
echo "macOS should now route diffforge:// URLs to Diff Forge AI."
