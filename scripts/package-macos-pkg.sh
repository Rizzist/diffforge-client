#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app_name="Diff Forge AI.app"
app_path="${repo_root}/src-tauri/target/release/bundle/macos/${app_name}"
scripts_dir="${repo_root}/scripts/installer/macos"
version="$(cd "${repo_root}" && node -p "require('./package.json').version")"
arch="$(uname -m)"
pkg_dir="${repo_root}/src-tauri/target/release/bundle/pkg"
staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/diffforge-pkg.XXXXXX")"

cleanup() {
  rm -rf "${staging_dir}"
}
trap cleanup EXIT

if [[ ! -d "${app_path}" ]]; then
  echo "Missing built app: ${app_path}" >&2
  echo "Run: tauri build --bundles app" >&2
  exit 1
fi

mkdir -p "${staging_dir}/Applications" "${pkg_dir}"
COPYFILE_DISABLE=1 ditto --norsrc "${app_path}" "${staging_dir}/Applications/${app_name}"
xattr -cr "${staging_dir}/Applications/${app_name}" 2>/dev/null || true
find "${staging_dir}" -name '._*' -delete

pkgbuild \
  --root "${staging_dir}" \
  --scripts "${scripts_dir}" \
  --filter '(^|/)\._' \
  --filter '(^|/)\.DS_Store$' \
  --filter '(^|/)\.svn(/|$)' \
  --filter '(^|/)CVS(/|$)' \
  --identifier "ai.diffforge.desktop" \
  --version "${version}" \
  --install-location "/" \
  "${pkg_dir}/Diff Forge AI-${version}-${arch}.pkg"

echo "Built ${pkg_dir}/Diff Forge AI-${version}-${arch}.pkg"
