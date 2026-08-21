# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

This repository is the `eiheil2/deepseek-harness` repair fork. Its preinstalled
runtime contains fixes that are not part of the official
`@deepseek-ai/dsh` npm distribution.

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
