#!/usr/bin/env sh
set -eu

if [ -L /usr/local/bin/diffforge ]; then
  target="$(readlink /usr/local/bin/diffforge || true)"
  case "$target" in
    *rust-diffforge|*"/Diff Forge AI.app/Contents/MacOS/rust-diffforge")
      rm -f /usr/local/bin/diffforge
      ;;
  esac
fi
