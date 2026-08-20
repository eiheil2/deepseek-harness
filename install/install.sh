#!/usr/bin/env sh
# Install the patched runtime published by our fork, never the official npm package.
set -eu

REPOSITORY=${DSH_REPOSITORY:-eiheil2/deepseek-harness}
RELEASE_TAG=${DSH_RELEASE_TAG:-dsh-custom-v0.1.0-rc.8-patched.1}
VERSION=${RELEASE_TAG#dsh-custom-v}
ASSET=${DSH_RELEASE_ASSET:-dsh-custom-runtime-${VERSION}.tar.gz}
PREFIX=${DSH_PREFIX:-${HOME}/.local}
URL=${DSH_RELEASE_URL:-https://github.com/${REPOSITORY}/releases/download/${RELEASE_TAG}/${ASSET}}

usage() { printf '%s\n' 'Usage: install.sh [--prefix DIR] [--release-tag dsh-custom-vTAG]'; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --prefix) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; PREFIX=$2; shift 2 ;;
    --release-tag) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; RELEASE_TAG=$2; VERSION=${RELEASE_TAG#dsh-custom-v}; ASSET=${DSH_RELEASE_ASSET:-dsh-custom-runtime-${VERSION}.tar.gz}; URL=${DSH_RELEASE_URL:-https://github.com/${REPOSITORY}/releases/download/${RELEASE_TAG}/${ASSET}}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

command -v node >/dev/null 2>&1 || { printf '%s\n' 'dsh installer: Node.js 22.19+ or 24+ is required.' >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { printf '%s\n' 'dsh installer: npm is required (it ships with Node.js).' >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { printf '%s\n' 'dsh installer: tar is required to unpack the runtime.' >&2; exit 1; }
node - <<'NODE'
const [major, minor] = process.versions.node.split('.').map(Number)
if (!(major >= 24 || (major === 22 && minor >= 19))) {
  console.error(`dsh installer: unsupported Node.js ${process.versions.node}; use 22.19+ or 24+.`)
  process.exit(1)
}
NODE

tmp=$(mktemp -d "${TMPDIR:-/tmp}/dsh-custom.XXXXXX")
trap 'rm -rf "$tmp"' EXIT INT TERM
archive="$tmp/$ASSET"
checksum="$tmp/$ASSET.sha256"
if command -v curl >/dev/null 2>&1; then curl --fail --location --retry 3 --output "$archive" "$URL"
elif command -v wget >/dev/null 2>&1; then wget -O "$archive" "$URL"
else printf '%s\n' 'dsh installer: curl or wget is required.' >&2; exit 1
fi
if command -v curl >/dev/null 2>&1; then curl --fail --location --retry 3 --output "$checksum" "${URL}.sha256"
else wget -O "$checksum" "${URL}.sha256"
fi
node - "$archive" "$checksum" <<'NODE'
const fs = require('node:fs')
const crypto = require('node:crypto')
const [archive, checksum] = process.argv.slice(2)
const expected = fs.readFileSync(checksum, 'utf8').trim().split(/\s+/)[0].toLowerCase()
const actual = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
if (expected !== actual) {
  console.error(`dsh installer: checksum mismatch for ${archive}`)
  process.exit(1)
}
NODE

install_root="$PREFIX/lib/dsh-custom/$VERSION"
mkdir -p "$install_root"
tar -xzf "$archive" -C "$install_root"
[ -f "$install_root/runtime-manifest.json" ] || { printf '%s\n' 'dsh installer: runtime manifest missing from downloaded asset.' >&2; exit 1; }

node - "$install_root" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const root = process.argv[2]
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'runtime-manifest.json'), 'utf8'))
const dependencies = Object.fromEntries(Object.entries(manifest.packages).map(([name, relative]) => [name, `file:${relative}`]))
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'dsh-custom-runtime', private: true, version: '0.0.0', dependencies }, null, 2) + '\n')
NODE
npm install --prefix "$install_root" --no-audit --no-fund --package-lock=false --omit=optional

mkdir -p "$PREFIX/bin"
cat > "$PREFIX/bin/dsh" <<EOF
#!/usr/bin/env sh
exec node "$install_root/node_modules/@deepseek-ai/dsh/lib/bin.js" "\$@"
EOF
chmod +x "$PREFIX/bin/dsh"
"$PREFIX/bin/dsh" --version
printf '%s\n' "patched dsh installed from ${URL}"
printf '%s\n' "Add ${PREFIX}/bin to PATH if 'dsh' is not found."
