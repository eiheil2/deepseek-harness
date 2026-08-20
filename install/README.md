# Patched DSH Installers

These installers install **our patched DeepSeek Harness runtime** from the
`eiheil2/deepseek-harness` GitHub fork. They do not install the official npm
`@deepseek-ai/dsh` package and do not copy the source repository, tests, docs,
debug records, or development dependencies.

The default release is `dsh-custom-v0.1.0-rc.8-patched.1`. That tag is built by
`.github/workflows/custom-runtime-release.yml`; the release asset contains only
the packed runtime tarballs and a generated dependency manifest.

## Linux and macOS

```sh
sh install.sh
```

For Linux and WSL, use the Ubuntu-built Linux x64 asset:

```sh
sh install-linux.sh
```

That asset is built and verified on `ubuntu-24.04`. It is intended for normal
x86_64 Linux and WSL2 x86_64 environments.

Use `DSH_PREFIX=$HOME/.local` or `sh install.sh --prefix "$HOME/.local"` to
choose the installation prefix. The script requires Node.js `22.19+` or `24+`,
`npm`, `tar`, and `curl` or `wget`.

## Windows

Double-click `install.cmd`, or run `install.ps1` in PowerShell. The default
prefix is `%LOCALAPPDATA%\dsh`; add that directory to `PATH` after installation.

## Selecting another patched build

Set `DSH_RELEASE_TAG` or pass `--release-tag dsh-custom-v<version>`. The source
repository and release URL can also be overridden with `DSH_REPOSITORY` and
`DSH_RELEASE_URL`. There is deliberately no fallback to the official package:
if the patched release asset is unavailable, installation fails loudly.
