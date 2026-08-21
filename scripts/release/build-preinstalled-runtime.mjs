/** Assemble a platform-native preinstalled runtime from packed workspace packages. */

import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const DEFAULT_ENTRY_PACKAGES = ['@deepseek-ai/dsh']
const LOCAL_SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies']
const HOST_PLATFORM = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform]

function fail(message) {
  throw new Error(`preinstalled runtime: ${message}`)
}

function tarballManifest(tarball) {
  return JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }))
}

function collectTarballs(directories) {
  const packages = new Map()
  for (const directory of directories) {
    for (const filename of readdirSync(directory).filter(name => name.endsWith('.tgz')).sort()) {
      const tarball = join(directory, filename)
      const manifest = tarballManifest(tarball)
      if (typeof manifest.name !== 'string') fail(`${tarball} has no package name`)
      if (packages.has(manifest.name)) fail(`duplicate local package ${manifest.name}`)
      packages.set(manifest.name, { manifest, tarball })
    }
  }
  return packages
}

function runtimeClosure(packages, entryPackages) {
  const reached = new Set()
  const pending = [...entryPackages]
  while (pending.length > 0) {
    const name = pending.pop()
    if (reached.has(name)) continue
    const entry = packages.get(name)
    if (entry === undefined) fail(`local tarball missing for ${name}`)
    reached.add(name)
    for (const section of LOCAL_SECTIONS) {
      const dependencies = entry.manifest[section]
      if (dependencies === undefined || dependencies === null || typeof dependencies !== 'object') continue
      for (const dependency of Object.keys(dependencies)) {
        if (packages.has(dependency) && !reached.has(dependency)) pending.push(dependency)
      }
    }
  }
  return [...reached].sort()
}

function runNpm(cwd) {
  const args = [
    'install',
    '--include=optional',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
  ]
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm'
  const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd', ...args] : args
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) fail(`npm install exited with ${String(result.status)}`)
}

function writeWindowsLauncher(output, name, fixedArgs = []) {
  const entry = '"%DSH_AXL_ROOT%node_modules\\@deepseek-ai\\dsh\\lib\\bin.js"'
  const argumentsText = fixedArgs.map(value => ` "${value}"`).join('')
  writeFileSync(join(output, name), [
    '@echo off',
    'setlocal',
    'set "DSH_AXL_ROOT=%~dp0"',
    `"%DSH_AXL_ROOT%runtime\\node.exe" ${entry}${argumentsText} %*`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n'), 'ascii')
}

function writeUnixLauncher(output, name, fixedArgs = []) {
  const argumentsText = fixedArgs.map(value => ` '${value}'`).join('')
  const filename = join(output, name)
  writeFileSync(filename, [
    '#!/usr/bin/env sh',
    'set -eu',
    'DSH_AXL_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    `exec "$DSH_AXL_ROOT/runtime/node" "$DSH_AXL_ROOT/node_modules/@deepseek-ai/dsh/lib/bin.js"${argumentsText} "$@"`,
    '',
  ].join('\n'))
  chmodSync(filename, 0o755)
}

function writeLaunchers(output, platform) {
  if (platform === 'windows') {
    writeWindowsLauncher(output, 'dsh.cmd')
    writeWindowsLauncher(output, 'start-web.cmd', ['web'])
  } else {
    writeUnixLauncher(output, 'dsh')
    writeUnixLauncher(output, 'start-web', ['web'])
  }
}

function main() {
  const { values } = parseArgs({
    options: {
      'dsh-pack': { type: 'string' },
      'vendor-pack': { type: 'string' },
      out: { type: 'string' },
      'node-bin': { type: 'string' },
      'settings-template': { type: 'string' },
      repository: { type: 'string', default: 'eiheil2/deepseek-harness' },
      commit: { type: 'string' },
      platform: { type: 'string' },
      arch: { type: 'string' },
      'built-at': { type: 'string' },
      'include-package': { type: 'string', multiple: true, default: [] },
    },
    allowPositionals: false,
  })
  for (const required of ['dsh-pack', 'vendor-pack', 'out', 'node-bin', 'settings-template', 'commit', 'platform', 'arch']) {
    if (values[required] === undefined) fail(`--${required} is required`)
  }
  if (!['windows', 'linux', 'macos'].includes(values.platform)) fail(`unsupported platform ${values.platform}`)
  if (!['x64', 'arm64'].includes(values.arch)) fail(`unsupported architecture ${values.arch}`)
  if (HOST_PLATFORM !== values.platform || process.arch !== values.arch) {
    fail(`host ${String(HOST_PLATFORM)}/${process.arch} cannot build ${values.platform}/${values.arch}`)
  }

  const output = resolve(values.out)
  const nodeBinary = resolve(values['node-bin'])
  const settingsTemplate = resolve(values['settings-template'])
  if (!existsSync(nodeBinary)) fail(`Node executable not found: ${nodeBinary}`)
  if (!existsSync(settingsTemplate)) fail(`settings template not found: ${settingsTemplate}`)

  const packages = collectTarballs([resolve(values['dsh-pack']), resolve(values['vendor-pack'])])
  const entryPackages = [...DEFAULT_ENTRY_PACKAGES, ...values['include-package']]
  const closure = runtimeClosure(packages, entryPackages)

  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })
  const dependencies = Object.fromEntries(closure.map((name) => {
    const tarball = packages.get(name).tarball
    return [name, `file:${relative(output, tarball).replaceAll('\\', '/')}`]
  }))
  writeFileSync(join(output, 'package.json'), `${JSON.stringify({
    name: 'dsh-axl-runtime-build',
    private: true,
    version: '0.0.0',
    dependencies,
  }, null, 2)}\n`)
  runNpm(output)

  const shortCommit = values.commit.slice(0, 8)
  const installedManifestPath = join(output, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const installedManifest = JSON.parse(readFileSync(installedManifestPath, 'utf8'))
  installedManifest.version = `${installedManifest.version}.axl.${shortCommit}`
  writeFileSync(installedManifestPath, `${JSON.stringify(installedManifest, null, 2)}\n`)

  mkdirSync(join(output, 'runtime'), { recursive: true })
  const bundledNodeName = values.platform === 'windows' ? 'node.exe' : 'node'
  const bundledNode = join(output, 'runtime', bundledNodeName)
  copyFileSync(nodeBinary, bundledNode)
  if (values.platform !== 'windows') chmodSync(bundledNode, 0o755)
  copyFileSync(settingsTemplate, join(output, 'settings.official.yaml'))
  writeLaunchers(output, values.platform)

  const builtAt = values['built-at'] ?? new Date().toISOString()
  writeFileSync(join(output, 'RUNTIME_PACKAGES.txt'), `${closure.join('\n')}\n`)
  writeFileSync(join(output, 'BUILD_INFO.txt'), [
    'DSH distribution: AXL fork preinstalled runtime',
    `Source repository: ${values.repository}`,
    `Source commit: ${values.commit}`,
    `CLI version: ${installedManifest.version}`,
    'Build profile: official',
    `Built at: ${builtAt}`,
    `Platform: ${values.platform}`,
    `Architecture: ${values.arch}`,
    `Bundled Node: ${execFileSync(nodeBinary, ['--version'], { encoding: 'utf8' }).trim().replace(/^v/, '')}`,
    `Local runtime package closure: ${String(closure.length)}`,
    `Runtime roots: ${entryPackages.join(', ')}`,
    '',
    'This archive is built from the AXL fork, not the official npm runtime.',
    '',
  ].join(values.platform === 'windows' ? '\r\n' : '\n'))
  writeFileSync(join(output, 'README.txt'), [
    `DSH AXL ${values.platform}-${values.arch}`,
    '',
    `Run ${values.platform === 'windows' ? 'dsh.cmd' : './dsh'} for the CLI or ${values.platform === 'windows' ? 'start-web.cmd' : './start-web'} for the browser UI.`,
    'The launchers use the normal DSH home unless DSH_HOME is explicitly set.',
    'settings.official.yaml is a credential-free official-model template.',
    '',
  ].join(values.platform === 'windows' ? '\r\n' : '\n'))

  writeFileSync(join(output, 'package.json'), `${JSON.stringify({
    name: `dsh-axl-${values.platform}-${values.arch}-runtime`,
    private: true,
    version: installedManifest.version,
  }, null, 2)}\n`)
  rmSync(join(output, 'package-lock.json'), { force: true })
  console.log(`preinstalled runtime: ${String(closure.length)} local packages installed at ${basename(output)}`)
}

main()
