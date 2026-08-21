/** Verify a preinstalled runtime without resolving dependencies from the source workspace. */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { get } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function fail(message) {
  throw new Error(`preinstalled runtime verification: ${message}`)
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  return new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => reject(new Error(`process did not exit within ${String(timeoutMs)}ms`)), timeoutMs)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolveExit({ code, signal })
    })
  })
}

async function waitForFile(filename, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(filename)) {
    if (child.exitCode !== null) fail(`CLI exited before creating ${filename}`)
    if (Date.now() >= deadline) fail(`timed out waiting for ${filename}`)
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
  }
}

async function waitForText(readOutput, expected, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (!readOutput().includes(expected)) {
    if (child.exitCode !== null) fail(`CLI exited before logging ${JSON.stringify(expected)}\n${readOutput()}`)
    if (Date.now() >= deadline) fail(`timed out waiting for ${JSON.stringify(expected)}\n${readOutput()}`)
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
  }
}

function createSafeModeFixture(home) {
  const profile = join(home, 'profiles', 'safe-mode')
  const bundle = join(profile, 'node_modules', 'dsh-safe-mode-bundle')
  mkdirSync(bundle, { recursive: true })
  const ready = join(home, 'ready')
  const healthy = join(bundle, 'healthy.mjs')
  const failing = join(bundle, 'failing.mjs')
  writeFileSync(healthy, [
    "import { writeFileSync } from 'node:fs'",
    "export const name = 'safe-mode-healthy'",
    'export function apply(ctx) {',
    "  writeFileSync(process.env.RAW_READY_FILE, 'ready')",
    '  const heartbeat = setInterval(() => {}, 1000)',
    '  ctx.effect(() => () => clearInterval(heartbeat))',
    '}',
    '',
  ].join('\n'))
  writeFileSync(failing, [
    "export const name = 'safe-mode-failing'",
    "export function apply() { throw new Error('safe-mode fixture failure') }",
    '',
  ].join('\n'))
  writeFileSync(join(bundle, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: safe-mode-healthy',
    `      name: ${pathToFileURL(healthy).href}`,
    '    - id: safe-mode-failing',
    `      name: ${pathToFileURL(failing).href}`,
    '',
  ].join('\n'))
  writeFileSync(join(bundle, 'package.json'), `${JSON.stringify({
    name: 'dsh-safe-mode-bundle',
    version: '0.0.0',
    type: 'module',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2)}\n`)
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-safe-mode',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['dsh-safe-mode-bundle'] } },
  }, null, 2)}\n`)
  writeFileSync(join(profile, 'cordis.patch.yml'), '[]\n')
  return ready
}

function runtimePaths(runtime) {
  const windows = process.platform === 'win32'
  return {
    node: join(runtime, 'runtime', windows ? 'node.exe' : 'node'),
    bin: join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  }
}

async function runNode(node, args, options = {}) {
  const child = spawn(node, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  const result = await waitForExit(child, 30_000)
  if (result.code !== 0) fail(`command failed (${String(result.code)}): ${stderr}`)
  return { stdout, stderr }
}

async function verifyCli(runtime) {
  const paths = runtimePaths(runtime)
  const result = await runNode(paths.node, [paths.bin, '--version'], { cwd: runtime })
  if (!result.stdout.includes('.axl.')) fail(`unexpected CLI version: ${result.stdout.trim()}`)
  await runNode(paths.node, ['--input-type=module', '-e', "import '@deepseek-ai/dsh-acp'"], { cwd: runtime })
}

async function verifySafeMode(runtime, home) {
  const ready = createSafeModeFixture(home)
  const paths = runtimePaths(runtime)
  const child = spawn(paths.node, [paths.bin, '--profile', 'safe-mode'], {
    cwd: home,
    env: { ...process.env, DSH_HOME: home, RAW_READY_FILE: ready },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { output += chunk })
  try {
    await waitForFile(ready, child, 30_000)
    await waitForText(() => output, 'startup recovery succeeded', child, 10_000)
  } finally {
    child.kill()
    await waitForExit(child, 10_000).catch(() => undefined)
  }
  for (const expected of [
    'safe-mode-failing',
    'restarting in culprit safe mode',
    'startup recovery succeeded',
    'disabled suspected plugin entries for this run',
  ]) {
    if (!output.includes(expected)) fail(`safe-mode log is missing ${JSON.stringify(expected)}\n${output}`)
  }
}

function requestOk(url) {
  return new Promise((resolveRequest, reject) => {
    const request = get(url, response => {
      response.resume()
      if (response.statusCode === 200) resolveRequest()
      else reject(new Error(`Web returned ${String(response.statusCode)}`))
    })
    request.once('error', reject)
    request.setTimeout(10_000, () => request.destroy(new Error('Web request timed out')))
  })
}

async function verifyWeb(runtime, home) {
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'settings.yaml'), readFileSync(join(runtime, 'settings.official.yaml')))
  const paths = runtimePaths(runtime)
  const child = spawn(paths.node, [paths.bin, 'web', '--no-open', '--port', '0'], {
    cwd: runtime,
    env: { ...process.env, DSH_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { output += chunk })
  try {
    const deadline = Date.now() + 45_000
    let match
    while (match === undefined) {
      if (child.exitCode !== null) fail(`Web exited before startup\n${output}`)
      match = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]
      if (Date.now() >= deadline) fail(`Web did not start\n${output}`)
      if (match === undefined) await new Promise(resolveDelay => setTimeout(resolveDelay, 200))
    }
    await requestOk(match)
  } finally {
    child.kill()
    await waitForExit(child, 10_000).catch(() => undefined)
  }
}

async function main() {
  const runtime = resolve(process.argv[2] ?? '')
  const scratch = resolve(process.argv[3] ?? join(runtime, '.verify'))
  if (!existsSync(join(runtime, 'BUILD_INFO.txt'))) fail(`not a runtime directory: ${runtime}`)
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })
  try {
    await verifyCli(runtime)
    await verifySafeMode(runtime, join(scratch, 'safe-mode-home'))
    await verifyWeb(runtime, join(scratch, 'web-home'))
    const buildInfo = readFileSync(join(runtime, 'BUILD_INFO.txt'), 'utf8')
    if (!buildInfo.includes('Runtime roots: @deepseek-ai/dsh, @deepseek-ai/dsh-acp')) {
      fail('BUILD_INFO.txt does not declare both runtime roots')
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  process.stdout.write('preinstalled runtime verification: ok\n')
}

await main()
