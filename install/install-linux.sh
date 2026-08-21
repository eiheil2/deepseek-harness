#!/usr/bin/env sh
# Compatibility entry point for Linux and WSL.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec sh "$SCRIPT_DIR/install.sh" "$@"
