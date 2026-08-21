#!/usr/bin/env sh
# Install the platform-native runtime published by our fork, never the official npm package.
set -eu

REPOSITORY=${DSH_REPOSITORY:-eiheil2/deepseek-harness}
RELEASE_TAG=${DSH_RELEASE_TAG:-dsh-custom-v0.1.0-rc.8-fullfix.3}
INSTALL_PREFIX=${DSH_PREFIX:-${HOME}/.local}
CACHE_DIR=${DSH_CACHE_DIR:-${XDG_CACHE_HOME:-${HOME}/.cache}/dsh-axl}

usage() { printf '%s\n' 'Usage: install.sh [--prefix DIR] [--release-tag dsh-custom-vTAG]'; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --prefix) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; INSTALL_PREFIX=$2; shift 2 ;;
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

require_glibc_linux() {
  libc_description=
  if command -v getconf >/dev/null 2>&1; then
    libc_description=$(getconf GNU_LIBC_VERSION 2>/dev/null || :)
  fi
  case "$libc_description" in
    glibc\ *) return ;;
  esac

  if command -v ldd >/dev/null 2>&1; then
    libc_description=$(ldd --version 2>&1 | sed -n '1p' || :)
  fi
  case "$libc_description" in
    *GLIBC*|*glibc*|*GNU\ libc*|*GNU\ C\ Library*) return ;;
  esac

  if [ -n "${TERMUX_VERSION:-}" ] || [ -n "${ANDROID_ROOT:-}" ]; then
    printf '%s\n' 'dsh installer: native Android/Termux is not supported by the preinstalled Linux runtime.' >&2
    printf '%s\n' 'The bundled Node.js and native dependencies require glibc, while native Termux uses Android Bionic.' >&2
  else
    printf 'dsh installer: unsupported Linux C library%s. The preinstalled runtime requires glibc.\n' \
      "${libc_description:+ ($libc_description)}" >&2
  fi
  printf '%s\n' 'No release archive was downloaded and the existing installation was not changed.' >&2
  exit 1
}

case "$platform:$architecture" in
  Linux:x86_64|Linux:amd64) require_glibc_linux; target=linux-x64 ;;
  Linux:aarch64|Linux:arm64) require_glibc_linux; target=linux-arm64 ;;
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

sha256_file() {
  file=$1
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$file" | awk '{ print tolower($1) }'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$file" | awk '{ print tolower($1) }'
  elif command -v openssl >/dev/null 2>&1; then openssl dgst -sha256 "$file" | awk '{ print tolower($NF) }'
  else printf '%s\n' 'dsh installer: sha256sum, shasum, or openssl is required for verification.' >&2; exit 1
  fi
}

tmp=$(mktemp -d "${TMPDIR:-/tmp}/dsh-axl.XXXXXX")
partial=
incoming=
previous=
restore_previous=0
cleanup() {
  if [ "$restore_previous" = 1 ] && [ -n "$previous" ] && [ -e "$previous" ]; then
    [ -z "${install_root:-}" ] || rm -rf "$install_root"
    mv "$previous" "$install_root" 2>/dev/null || :
  fi
  [ -z "$incoming" ] || rm -rf "$incoming"
  [ -z "$partial" ] || rm -f "$partial"
  rm -rf "$tmp"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
checksum="$tmp/$ASSET.sha256"
download "$checksum" "${URL}.sha256"

expected=$(awk 'NR == 1 { print tolower($1) }' "$checksum")
case "$expected" in
  ''|*[!0-9a-f]*) printf 'dsh installer: invalid checksum file for %s\n' "$ASSET" >&2; exit 1 ;;
esac
[ "${#expected}" -eq 64 ] || { printf 'dsh installer: invalid checksum length for %s\n' "$ASSET" >&2; exit 1; }

mkdir -p "$CACHE_DIR"
archive="$CACHE_DIR/$ASSET"
actual=
if [ -f "$archive" ]; then actual=$(sha256_file "$archive")
fi
if [ "$actual" = "$expected" ]; then
  printf 'using verified cached archive %s\n' "$archive"
else
  [ -z "$actual" ] || printf 'discarding stale or incomplete cached archive %s\n' "$archive" >&2
  partial="$archive.part.$$"
  rm -f "$partial"
  download "$partial" "$URL"
  actual=$(sha256_file "$partial")
  [ "$expected" = "$actual" ] || {
    printf 'dsh installer: checksum mismatch for %s\n' "$ASSET" >&2
    exit 1
  }
  mv "$partial" "$archive"
  partial=
fi

staging="$tmp/runtime"
mkdir -p "$staging"
tar -xzf "$archive" -C "$staging"
for required in dsh runtime/node node_modules/@deepseek-ai/dsh/lib/bin.js settings.official.yaml BUILD_INFO.txt; do
  [ -e "$staging/$required" ] || {
    printf 'dsh installer: runtime is missing %s\n' "$required" >&2
    exit 1
  }
done

if ! "$staging/dsh" --version; then
  printf '%s\n' 'dsh installer: downloaded runtime failed its CLI smoke test; the existing installation was not changed.' >&2
  exit 1
fi

install_root="$INSTALL_PREFIX/lib/dsh-axl/$VERSION"
install_base=$(dirname "$install_root")
mkdir -p "$install_base" "$INSTALL_PREFIX/bin"
incoming="$install_root.incoming.$$"
previous="$install_root.previous.$$"
rm -rf "$incoming" "$previous"
mv "$staging" "$incoming"
if [ -e "$install_root" ]; then
  mv "$install_root" "$previous"
  restore_previous=1
fi
if ! mv "$incoming" "$install_root"; then
  printf '%s\n' 'dsh installer: could not activate the verified runtime; restoring the previous installation.' >&2
  exit 1
fi
incoming=
restore_previous=0
rm -rf "$previous"
previous=

cat > "$INSTALL_PREFIX/bin/dsh" <<EOF
#!/usr/bin/env sh
exec "$install_root/dsh" "\$@"
EOF
cat > "$INSTALL_PREFIX/bin/dsh-web" <<EOF
#!/usr/bin/env sh
exec "$install_root/start-web" "\$@"
EOF
chmod +x "$INSTALL_PREFIX/bin/dsh" "$INSTALL_PREFIX/bin/dsh-web"

dsh_home=${DSH_HOME:-${HOME}/.dsh}
if [ ! -e "$dsh_home/settings.yaml" ]; then
  mkdir -p "$dsh_home"
  cp "$install_root/settings.official.yaml" "$dsh_home/settings.yaml"
  printf 'installed credential-free settings at %s\n' "$dsh_home/settings.yaml"
else
  printf 'kept existing settings at %s\n' "$dsh_home/settings.yaml"
fi

"$INSTALL_PREFIX/bin/dsh" --version
printf 'preinstalled patched dsh installed from %s\n' "$URL"
printf "Add %s/bin to PATH if 'dsh' is not found.\n" "$INSTALL_PREFIX"
