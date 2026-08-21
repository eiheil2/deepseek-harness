# AXL Fork Installers

These installers install the repaired runtime published by
`eiheil2/deepseek-harness`. They never fall back to the official
`@deepseek-ai/dsh` npm package.

The default release is `dsh-custom-v0.1.0-rc.8-fullfix.2`. Its assets are built
by `.github/workflows/custom-runtime-release.yml` on their native GitHub-hosted
runners:

- Windows x64
- Linux x64 and arm64
- macOS x64 and arm64

Each archive contains the fork's packed runtime closure, platform-resolved
optional dependencies, a bundled Node runtime, launchers, build provenance, and
a credential-free settings template. It excludes the source tree, tests,
research notes, debug records, package-manager cache, and development
dependencies.

## Linux, WSL, and macOS

```sh
sh install/install.sh
```

`install-linux.sh` is a compatibility entry point that invokes the same
auto-detecting installer. The script needs `tar`, a downloader (`curl` or
`wget`), and a SHA-256 implementation normally supplied by the operating
system. It does not need Node.js, npm, pnpm, or a compiler.

The default prefix is `$HOME/.local`. Set `DSH_PREFIX` or pass `--prefix` to
change it. The `dsh` and `dsh-web` launchers are written to `$PREFIX/bin`.

## Windows

Double-click `install.cmd`, or run:

```powershell
powershell -ExecutionPolicy Bypass -File install\install.ps1
```

The PowerShell installer uses built-in download, SHA-256, and ZIP extraction
support. It does not invoke npm. The default prefix is `%LOCALAPPDATA%\dsh`;
add that directory to `PATH` after installation.

## Configuration Safety

On a clean DSH home, the installer copies `settings.official.yaml` to
`settings.yaml`. The template contains no credential. An existing settings file
is never replaced.

## Selecting Another Build

Set `DSH_RELEASE_TAG` or pass `--release-tag dsh-custom-v<version>`. Advanced
testing can override `DSH_REPOSITORY`, `DSH_RELEASE_ASSET`, or
`DSH_RELEASE_URL`. Set `DSH_RELEASE_PROXY` to force a download proxy, or set
`DSH_RELEASE_NO_PROXY=1` for a direct local/private-network test. A missing or
invalid fork asset is a hard failure; there is no fallback to an official
distribution.
