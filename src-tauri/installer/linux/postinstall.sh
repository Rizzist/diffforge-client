#!/usr/bin/env sh
set -eu

if [ -f /usr/bin/diffforge ]; then
  chmod 0755 /usr/bin/diffforge || true
fi
