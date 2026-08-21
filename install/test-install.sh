#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INSTALLER="$SCRIPT_DIR/install.sh"
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/dsh-installer-test.XXXXXX")
trap 'rm -rf "$TEST_ROOT"' EXIT

fail() {
  printf 'installer test: %s\n' "$1" >&2
  exit 1
}

make_runtime() {
  output=$1
  version_text=$2
  exit_code=$3
  mkdir -p "$output/runtime" "$output/node_modules/@deepseek-ai/dsh/lib"
  cat > "$output/dsh" <<EOF
#!/usr/bin/env sh
printf '%s\n' '$version_text'
exit $exit_code
EOF
  cat > "$output/runtime/node" <<'EOF'
#!/usr/bin/env sh
exit 0
EOF
  : > "$output/node_modules/@deepseek-ai/dsh/lib/bin.js"
  : > "$output/settings.official.yaml"
  : > "$output/BUILD_INFO.txt"
  chmod +x "$output/dsh" "$output/runtime/node"
}

fake_bin="$TEST_ROOT/fake-bin"
mkdir -p "$fake_bin"
cat > "$fake_bin/uname" <<'EOF'
#!/usr/bin/env sh
case "$1" in
  -s) printf '%s\n' Linux ;;
  -m) printf '%s\n' aarch64 ;;
  *) exit 1 ;;
esac
EOF
cat > "$fake_bin/getconf" <<'EOF'
#!/usr/bin/env sh
exit 1
EOF
cat > "$fake_bin/ldd" <<'EOF'
#!/usr/bin/env sh
printf '%s\n' 'Android Bionic linker'
EOF
cat > "$fake_bin/curl" <<EOF
#!/usr/bin/env sh
: > '$TEST_ROOT/downloader-was-called'
exit 1
EOF
chmod +x "$fake_bin/uname" "$fake_bin/getconf" "$fake_bin/ldd" "$fake_bin/curl"

termux_log="$TEST_ROOT/termux.log"
if PATH="$fake_bin:/usr/bin:/bin" TERMUX_VERSION=0.119 HOME="$TEST_ROOT/termux-home" \
  sh "$INSTALLER" >"$termux_log" 2>&1; then
  fail 'native Termux was accepted'
fi
[ ! -e "$TEST_ROOT/downloader-was-called" ] || fail 'Termux rejection happened after download started'
grep -q 'native Android/Termux is not supported' "$termux_log" || fail 'Termux diagnostic is missing'

good_source="$TEST_ROOT/good-source"
make_runtime "$good_source" 'test-version-good' 0
good_archive="$TEST_ROOT/good.tar.gz"
tar -czf "$good_archive" -C "$good_source" .
sha256sum "$good_archive" > "$good_archive.sha256"

prefix="$TEST_ROOT/prefix"
cache="$TEST_ROOT/cache"
home="$TEST_ROOT/home"
good_url="file://$good_archive"
DSH_PREFIX="$prefix" DSH_CACHE_DIR="$cache" HOME="$home" DSH_RELEASE_URL="$good_url" \
  sh "$INSTALLER" > "$TEST_ROOT/first-install.log"
grep -q 'test-version-good' "$TEST_ROOT/first-install.log" || fail 'first install did not run the staged runtime'

asset=$(find "$cache" -type f -name '*.tar.gz' -print | sed -n '1p')
[ -n "$asset" ] || fail 'verified archive was not cached'
rm "$good_archive"
DSH_PREFIX="$prefix" DSH_CACHE_DIR="$cache" HOME="$home" DSH_RELEASE_URL="$good_url" \
  sh "$INSTALLER" > "$TEST_ROOT/cached-install.log"
grep -q 'using verified cached archive' "$TEST_ROOT/cached-install.log" || fail 'second install did not reuse the cache'

bad_source="$TEST_ROOT/bad-source"
make_runtime "$bad_source" 'test-version-bad' 17
bad_archive="$TEST_ROOT/bad.tar.gz"
tar -czf "$bad_archive" -C "$bad_source" .
sha256sum "$bad_archive" > "$bad_archive.sha256"
if DSH_PREFIX="$prefix" DSH_CACHE_DIR="$TEST_ROOT/bad-cache" HOME="$home" DSH_RELEASE_URL="file://$bad_archive" \
  sh "$INSTALLER" > "$TEST_ROOT/bad-install.log" 2>&1; then
  fail 'runtime with a failing CLI smoke test was installed'
fi
installed_output=$("$prefix/bin/dsh" --version)
[ "$installed_output" = 'test-version-good' ] || fail 'failed update replaced the working installation'

printf '%s\n' 'installer tests: ok'
