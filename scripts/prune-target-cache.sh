#!/usr/bin/env bash
set -euo pipefail

# Bounded prune for the cargo target cache. Repeated `tauri dev` and signed
# `tauri build --debug` runs compile the workspace crates under different
# configurations, and every variant keeps its own multi-GB incremental cache
# and dep artifacts forever — the directory only ever grows. This keeps the
# newest cache per crate (so the next build stays incremental and fast) and
# only reaches for stale artifacts when the tree is over its size cap.
#
# Tuning: DIFFFORGE_TARGET_CACHE_CAP_GB (default 12) is the soft cap;
# DIFFFORGE_TARGET_CACHE_STALE_DAYS (default 14) is how old a deps/fingerprint
# artifact must be before it is considered stale. Deleting anything here is
# always safe — cargo rebuilds whatever it misses.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_dir="${DIFFFORGE_TARGET_DIR:-$repo_root/src-tauri/target}"
cap_gb="${DIFFFORGE_TARGET_CACHE_CAP_GB:-12}"
stale_days="${DIFFFORGE_TARGET_CACHE_STALE_DAYS:-14}"
cap_kb=$((cap_gb * 1024 * 1024))

[[ -d "$target_dir" ]] || exit 0

target_size_kb() {
  du -sk "$target_dir" | awk '{print $1}'
}

size_kb="$(target_size_kb)"
if ((size_kb <= cap_kb)); then
  exit 0
fi

echo "Target cache is $((size_kb / 1024 / 1024))G (cap ${cap_gb}G); pruning $target_dir"

# Pass 1: incremental caches are kept per build configuration, so alternating
# dev/build leaves duplicate multi-GB dirs per crate. Keep only the newest
# variant of each crate's cache.
incremental_dir="$target_dir/debug/incremental"
if [[ -d "$incremental_dir" ]]; then
  for dir in "$incremental_dir"/*/; do
    [[ -d "$dir" ]] || continue
    d="${dir%/}"
    name="${d##*/}"
    printf '%s\t%s\t%s\n' "${name%-*}" "$(stat -f %m "$d")" "$d"
  done \
    | sort -t$'\t' -k1,1 -k2,2rn \
    | awk -F'\t' '$1 == prev {print $3} {prev = $1}' \
    | while IFS= read -r stale; do
        echo "  removing duplicate incremental cache ${stale##*/}"
        rm -rf "$stale"
      done
fi

size_kb="$(target_size_kb)"
if ((size_kb <= cap_kb)); then
  echo "Target cache now $((size_kb / 1024 / 1024))G"
  exit 0
fi

# Pass 2: artifacts untouched for a long time belong to old dependency
# versions or abandoned configurations; the current build rewrites what it
# needs, so anything this old is dead weight.
for sub in deps build .fingerprint; do
  dir="$target_dir/debug/$sub"
  [[ -d "$dir" ]] || continue
  find "$dir" -mindepth 1 -maxdepth 1 -mtime +"$stale_days" -exec rm -rf {} +
done

size_kb="$(target_size_kb)"
echo "Target cache now $((size_kb / 1024 / 1024))G"
if ((size_kb > cap_kb)); then
  echo "Still over the ${cap_gb}G cap and everything left is fresh."
  echo "Raise DIFFFORGE_TARGET_CACHE_CAP_GB or run: cargo clean --manifest-path $repo_root/src-tauri/Cargo.toml"
fi
