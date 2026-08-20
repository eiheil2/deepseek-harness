#!/bin/sh
# Install the published DeepSeek Harness CLI on Linux or macOS.
# This installer consumes only the production npm package. It never copies the
# repository, source files, tests, or development records to the target host.

set -eu

PACKAGE='@deepseek-ai/dsh'
VERSION=${DSH_VERSION:-latest}
REGISTRY=${DSH_REGISTRY:-https://registry.npmjs.org}
PREFIX=${DSH_INSTALL_PREFIX:-}
UPDATE_PATH=1

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

Install the published @deepseek-ai/dsh CLI without repository or development files.

Options:
  --version <version>     npm version or dist-tag (default: latest)
  --registry <https-url>  npm registry (default: https://registry.npmjs.org)
  --prefix <directory>    npm global prefix (default: writable npm prefix)
  --no-path-update        do not add the install bin directory to a shell profile
  -h, --help              show this help

Environment equivalents: DSH_VERSION, DSH_REGISTRY, DSH_INSTALL_PREFIX.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      [ "$#" -ge 2 ] || { echo 'install.sh: --version needs a value' >&2; exit 2; }
      VERSION=$2
      shift 2
      ;;
    --registry)
      [ "$#" -ge 2 ] || { echo 'install.sh: --registry needs a value' >&2; exit 2; }
      REGISTRY=$2
      shift 2
      ;;
    --prefix)
      [ "$#" -ge 2 ] || { echo 'install.sh: --prefix needs a value' >&2; exit 2; }
      PREFIX=$2
      shift 2
      ;;
    --no-path-update)
      UPDATE_PATH=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "install.sh: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

command -v node >/dev/null 2>&1 || {
  echo 'install.sh: Node.js 22.19+ (22.x) or 24+ is required; node was not found' >&2
  exit 1
}
command -v npm >/dev/null 2>&1 || {
  echo 'install.sh: npm was not found; install it with Node.js first' >&2
  exit 1
}

node <<'NODE'
const [major, minor] = process.versions.node.split('.').map(Number)
const supported = major >= 24 || (major === 22 && minor >= 19)
if (!supported) {
  console.error(`install.sh: unsupported Node.js ${process.versions.node}; require 22.19+ on 22.x or 24+`)
  process.exit(1)
}
NODE

case "$REGISTRY" in
  https://*) ;;
  *)
    echo "install.sh: registry must use HTTPS: $REGISTRY" >&2
    exit 2
    ;;
esac

case "$VERSION" in
  ''|[-.]*|*[!A-Za-z0-9._-]*)
    echo "install.sh: invalid npm version or dist-tag: $VERSION" >&2
    exit 2
    ;;
esac

if [ -z "$PREFIX" ]; then
  PREFIX=$(npm config get prefix 2>/dev/null || true)
fi
if [ -z "$PREFIX" ]; then
  PREFIX=$HOME/.local
fi

is_writable_prefix() {
  mkdir -p "$1" 2>/dev/null || return 1
  probe="$1/.dsh-install-$$"
  (umask 077 && : > "$probe") 2>/dev/null || return 1
  rm -f "$probe"
}

if ! is_writable_prefix "$PREFIX"; then
  if [ -n "${DSH_INSTALL_PREFIX:-}" ]; then
    echo "install.sh: install prefix is not writable: $PREFIX" >&2
    exit 1
  fi
  PREFIX=$HOME/.local
  is_writable_prefix "$PREFIX" || {
    echo "install.sh: cannot find a writable install prefix: $PREFIX" >&2
    exit 1
  }
fi

BIN_DIR=$PREFIX/bin
mkdir -p "$BIN_DIR"
echo "Installing $PACKAGE@$VERSION into $PREFIX"
npm --prefix "$PREFIX" install --global --omit=dev --no-audit --no-fund --registry "$REGISTRY" "$PACKAGE@$VERSION"

ENTRY=''
for candidate in "$BIN_DIR/dsh" "$PREFIX/dsh" "$PREFIX/dsh.cmd"; do
  if [ -f "$candidate" ]; then
    ENTRY=$candidate
    break
  fi
done
[ -n "$ENTRY" ] || {
  echo "install.sh: npm completed but no dsh command was created in $PREFIX" >&2
  exit 1
}

# npm on POSIX uses prefix/bin; Windows npm uses prefix itself. Keep PATH
# updates aligned with the actual shim rather than assuming one platform.
if [ "$ENTRY" = "$PREFIX/dsh" ] || [ "$ENTRY" = "$PREFIX/dsh.cmd" ]; then
  BIN_DIR=$PREFIX
fi

if [ "$UPDATE_PATH" -eq 1 ]; then
  case ":${PATH:-}:" in
    *:"$BIN_DIR":*) ;;
    *)
      profile=''
      shell_name=$(basename "${SHELL:-}")
      case "$shell_name" in
        zsh) profile=$HOME/.zprofile ;;
        bash|ksh|sh|'') profile=$HOME/.profile ;;
      esac
      if [ -n "$profile" ]; then
        # Quote the path as a shell single-quoted literal. A newline is
        # rejected because it cannot be represented safely in a profile line.
        case "$BIN_DIR" in
          *"'"*|*'\'*|*'$'*|*'`'*|*'
'*)
            echo "Warning: install succeeded, but PATH was not updated for unsafe path $BIN_DIR" >&2
            ;;
          *)
            mkdir -p "$(dirname "$profile")"
            marker="# dsh installer: npm global bin ($BIN_DIR)"
            if [ ! -f "$profile" ] || ! grep -F "$marker" "$profile" >/dev/null 2>&1; then
              quoted=$(printf "'%s'" "$BIN_DIR" | sed "s/'/'\\''/g")
              printf '\n%s\nexport PATH=%s:"$PATH"\n' "$marker" "$quoted" >> "$profile"
              echo "Updated $profile; open a new shell or run: export PATH=$BIN_DIR:\$PATH"
            fi
            ;;
        esac
      else
        echo "Add $BIN_DIR to PATH before using dsh (shell profile was not detected)." >&2
      fi
    ;;
  esac
fi

case "$ENTRY" in
  *.cmd) VERSION_OUTPUT=$(cmd.exe /d /c "$ENTRY" --version 2>&1) ;;
  *) VERSION_OUTPUT=$("$ENTRY" --version 2>&1) ;;
esac || {
  echo "install.sh: installed dsh failed its version check" >&2
  printf '%s\n' "$VERSION_OUTPUT" >&2
  exit 1
}
printf 'Installed dsh %s\n' "$VERSION_OUTPUT"
