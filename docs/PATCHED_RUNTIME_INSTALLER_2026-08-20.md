# Patched Runtime Installer Record

## Scope

The installer must install the fork's repaired runtime, not the official
`@deepseek-ai/dsh` npm release. The repository is a workspace monorepo, so a
Git checkout or a direct npm Git URL is not a valid consumer installation.

## Release Method

Tagging `dsh-custom-v*` on the fork runs
`.github/workflows/custom-runtime-release.yml`. CI builds the patched source,
packs the dsh, vendor, and Landlock runtime packages, generates a dependency
manifest, and publishes a minimal GitHub Release archive. The archive contains
only tarballs and the manifest; it contains no source, tests, docs, debug logs,
or development dependencies.

## Installer contract

- Linux/macOS: `install/install.sh`
- Windows: `install/install.ps1` and `install/install.cmd`
- Default source: `https://github.com/eiheil2/deepseek-harness/releases/`
- Default tag: `dsh-custom-v0.1.0-rc.8-patched.1`
- No fallback to the official npm package.
- Installation fails if the fork release asset is unavailable.

## Verification status

Static shell, Node, and PowerShell syntax checks pass. The fork tag's release
archive was downloaded and its SHA-256 matched the published checksum. The
archive boundary contains runtime tarballs and the manifest only. A complete
consumer npm install was not used as the acceptance gate because it performs a
large dependency resolution on the host; the CI pack verification remains the
authoritative runtime-install check.
