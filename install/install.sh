#!/usr/bin/env sh
# Install the platform-native runtime published by our fork, never the official npm package.
set -eu

REPOSITORY=${DSH_REPOSITORY:-eiheil2/deepseek-harness}
RELEASE_TAG=${DSH_RELEASE_TAG:-dsh-custom-v0.1.0-rc.8-fullfix.1}
PREFIX=${DSH_PREFIX:-${HOME}/.local}

usage() { printf '%s\n' 'Usage: install.sh [--prefix DIR] [--release-tag dsh-custom-vTAG]'; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --prefix) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; PREFIX=$2; shift 2 ;;
    --release-tag) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; RELEASE_TAG=$2; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$RELEASE_TAG" in
  dsh-custom-v[0-9A-Za-z]* ) ;;
  * ) printf 'dsh installer: invalid release tag: %s\n' "$RELEASE_TAG" >&2; exit 1 ;;
esac
case "$RELEASE_TAG" in
  *[!0-9A-Za-z._-]* ) printf 'dsh installer: unsafe release tag: %s\n' "$RELEASE_TAG" >&2; exit 1 ;;
esac
VERSION=${RELEASE_TAG#dsh-custom-v}

platform=$(uname -s)
architecture=$(uname -m)
case "$platform:$architecture" in
  Linux:x86_64|Linux:amd64) target=linux-x64 ;;
  Linux:aarch64|Linux:arm64) target=linux-arm64 ;;
  Darwin:arm64) target=macos-arm64 ;;
  Darwin:x86_64|Darwin:amd64) target=macos-x64 ;;
  *) printf 'dsh installer: unsupported platform %s/%s\n' "$platform" "$architecture" >&2; exit 1 ;;
esac

ASSET=${DSH_RELEASE_ASSET:-dsh-axl-${target}-${VERSION}.tar.gz}
case "$ASSET" in
  */*|*\\*) printf 'dsh installer: release asset must be a filename\n' >&2; exit 1 ;;
esac
URL=${DSH_RELEASE_URL:-https://github.com/${REPOSITORY}/releases/download/${RELEASE_TAG}/${ASSET}}

command -v tar >/dev/null 2>&1 || { printf '%s\n' 'dsh installer: tar is required.' >&2; exit 1; }
if command -v curl >/dev/null 2>&1; then downloader=curl
elif command -v wget >/dev/null 2>&1; then downloader=wget
else printf '%s\n' 'dsh installer: curl or wget is required.' >&2; exit 1
fi

download() {
  destination=$1
  source=$2
  if [ "$downloader" = curl ]; then
    if [ "${DSH_RELEASE_NO_PROXY:-}" = 1 ]; then
      curl --noproxy '*' --fail --location --retry 3 --output "$destination" "$source"
    elif [ -n "${DSH_RELEASE_PROXY:-}" ]; then
      curl --proxy "$DSH_RELEASE_PROXY" --fail --location --retry 3 --output "$destination" "$source"
    else
      curl --fail --location --retry 3 --output "$destination" "$source"
    fi
  elif [ "${DSH_RELEASE_NO_PROXY:-}" = 1 ]; then
    wget --no-proxy -O "$destination" "$source"
  elif [ -n "${DSH_RELEASE_PROXY:-}" ]; then
    wget --execute="https_proxy=$DSH_RELEASE_PROXY" --execute="http_proxy=$DSH_RELEASE_PROXY" -O "$destination" "$source"
  else
    wget -O "$destination" "$source"
  fi
}

tmp=$(mktemp -d "${TMPDIR:-/tmp}/dsh-axl.XXXXXX")
trap 'rm -rf "$tmp"' EXIT INT TERM
archive="$tmp/$ASSET"
checksum="$tmp/$ASSET.sha256"
download "$archive" "$URL"
download "$checksum" "${URL}.sha256"

expected=$(awk 'NR == 1 { print tolower($1) }' "$checksum")
if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$archive" | awk '{ print tolower($1) }')
elif command -v shasum >/dev/null 2>&1; then actual=$(shasum -a 256 "$archive" | awk '{ print tolower($1) }')
elif command -v openssl >/dev/null 2>&1; then actual=$(openssl dgst -sha256 "$archive" | awk '{ print tolower($NF) }')
else printf '%s\n' 'dsh installer: sha256sum, shasum, or openssl is required for verification.' >&2; exit 1
fi
[ -n "$expected" ] && [ "$expected" = "$actual" ] || {
  printf 'dsh installer: checksum mismatch for %s\n' "$ASSET" >&2
  exit 1
}

staging="$tmp/runtime"
mkdir -p "$staging"
tar -xzf "$archive" -C "$staging"
for required in dsh runtime/node node_modules/@deepseek-ai/dsh/lib/bin.js settings.official.yaml BUILD_INFO.txt; do
  [ -e "$staging/$required" ] || {
    printf 'dsh installer: runtime is missing %s\n' "$required" >&2
    exit 1
  }
done

install_root="$PREFIX/lib/dsh-axl/$VERSION"
mkdir -p "$(dirname "$install_root")" "$PREFIX/bin"
rm -rf "$install_root"
mv "$staging" "$install_root"

cat > "$PREFIX/bin/dsh" <<EOF
#!/usr/bin/env sh
exec "$install_root/dsh" "\$@"
EOF
cat > "$PREFIX/bin/dsh-web" <<EOF
#!/usr/bin/env sh
exec "$install_root/start-web" "\$@"
EOF
chmod +x "$PREFIX/bin/dsh" "$PREFIX/bin/dsh-web"

dsh_home=${DSH_HOME:-${HOME}/.dsh}
if [ ! -e "$dsh_home/settings.yaml" ]; then
  mkdir -p "$dsh_home"
  cp "$install_root/settings.official.yaml" "$dsh_home/settings.yaml"
  printf 'installed credential-free settings at %s\n' "$dsh_home/settings.yaml"
else
  printf 'kept existing settings at %s\n' "$dsh_home/settings.yaml"
fi

"$PREFIX/bin/dsh" --version
printf 'preinstalled patched dsh installed from %s\n' "$URL"
printf "Add %s/bin to PATH if 'dsh' is not found.\n" "$PREFIX"
