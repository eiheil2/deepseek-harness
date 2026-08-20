#!/usr/bin/env sh
# Linux/WSL installer for the runtime built on Ubuntu 24.04.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RELEASE_TAG=${DSH_RELEASE_TAG:-dsh-custom-v0.1.0-rc.8-linux.1}
VERSION=${RELEASE_TAG#dsh-custom-v}
export DSH_RELEASE_TAG="$RELEASE_TAG"
export DSH_RELEASE_ASSET="${DSH_RELEASE_ASSET:-dsh-custom-runtime-linux-x64-${VERSION}.tar.gz}"
exec sh "$SCRIPT_DIR/install.sh" "$@"
