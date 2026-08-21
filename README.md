# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

This repository is the `eiheil2/deepseek-harness` repair fork. Its preinstalled
runtime contains fixes that are not part of the official
`@deepseek-ai/dsh` npm distribution.

## What This Fork Repairs

Compared with the upstream rc8 baseline used by this repository, the repaired
runtime includes:

- **Model capability controls:** per-model text/image input and reasoning-effort
  declarations can be configured in the model editor and changed without a
  restart. The model selector displays the declared capability, disables a
  declared text-only model while an image is attached, and does not guess from
  a model name when capability metadata is absent.
- **Reasoning-effort routing:** the selected effort follows the exact model and
  session across model changes, session creation, and forks. Unsupported
  efforts fail before a network request instead of being silently rewritten.
- **Context and cache accounting:** context pressure is scoped to the active
  provider/model route, displayed token values cannot become negative, unknown
  request overhead is shown separately, and cache hit information is displayed
  only when the provider actually supplies cache telemetry.
- **Multimodal and ACP cancellation:** exact image capability metadata reaches
  the Web UI and Host API, runtime configuration changes are visible on the
  next model resolution, and cancelling ACP image/output conversion no longer
  waits indefinitely for the ordered output tail.
- **Session and workspace recovery:** a session created before workspace
  attachment fails remains visible and is recovered into the ungrouped view
  instead of appearing lost or inviting a duplicate creation attempt.
- **Bounded instruction loading:** aggregate Agent instruction sources have an
  8 MiB default budget across both initial loading and reconciliation.
- **Longer Web tool budget:** the default cooperative timeout for `web_search`
  and `web_fetch` is 120 seconds instead of 30 seconds and remains configurable.
- **Plugin startup recovery:** a plugin activation failure first retries with
  the suspected entries disabled for that process, then falls back to a
  shipped-bundle-only safe mode. It reports the suspected plugin without
  uninstalling packages or rewriting the user's profile.
- **Preinstalled platform runtimes:** release assets bundle Node.js and resolved
  runtime dependencies for Windows x64, Linux x64/arm64, and macOS x64/arm64,
  so installation does not run npm or install development files.

These statements describe implemented and tested code paths, not universal
third-party endpoint certification. A gateway that does not declare image,
reasoning, cache, or capacity metadata remains explicitly unknown until it is
configured or tested. The detailed engineering record is in
[`docs/REPAIR_RECORD_MULTIMODAL_REASONING_2026-08-20.md`](docs/REPAIR_RECORD_MULTIMODAL_REASONING_2026-08-20.md).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Install

### Our repaired fork

These commands install the repaired runtime from **this fork**. They do not
install or fall back to the official npm package.

Windows PowerShell or Command Prompt:

```powershell
git clone --depth 1 https://github.com/eiheil2/deepseek-harness.git
cd deepseek-harness
.\install\install.cmd
```

Linux, WSL2, or macOS:

```sh
git clone --depth 1 https://github.com/eiheil2/deepseek-harness.git
cd deepseek-harness
sh install/install.sh
```

The installer selects the appropriate platform asset, verifies its SHA-256
checksum, and installs the bundled Node runtime and dependencies without
running npm. The current release is `dsh-custom-v0.1.0-rc.8-fullfix.3`. See the
[`install/` guide](install/README.md) for paths and overrides.

### Official upstream package

The following command runs DeepSeek AI's **official npm distribution**, not
this fork and not the repaired runtime above. Install Node.js first:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default. See the
[Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/eiheil2/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
